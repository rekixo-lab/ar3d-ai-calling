// Real UI, route handlers and migrated SQLite databases, all on loopback.
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {chromium} from 'playwright';
import {fixture} from '../tests/helpers/calling-fixture.mjs';
import worker from '../src/index.mjs';
import {encryptSecret,totpAt} from '../src/mfa.mjs';
import {makePassword} from '../src/human-auth.mjs';

const f=fixture(),db=f.c.db,env=f.env;
env.MFA_ENCRYPTION_KEY='synthetic-team-browser-encryption-key';
env.LOGIN_RATE_LIMIT_SECRET='synthetic-team-browser-rate-limit-key';
const password='Fictional-admin-password-65',boss='boss@example.invalid';
const owner='admin@example.invalid',pw=await makePassword(password);
db.prepare("UPDATE human_users SET password_salt=?,password_hash=?,password_iterations=? WHERE id='admin'").run(pw.salt,pw.hash,pw.iterations);
const ownerSecret=crypto.getRandomValues(new Uint8Array(20)),encrypted=await encryptSecret(ownerSecret,env);
db.prepare("UPDATE human_mfa_settings SET secret_iv=?,secret_ciphertext=? WHERE user_id='admin'").run(encrypted.secret_iv,encrypted.secret_ciphertext);
const server=http.createServer(async(req,res)=>{
 try{
  const url='http://'+req.headers.host+req.url;
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const response=await worker.fetch(new Request(url,{method:req.method,headers:{...req.headers,'cf-connecting-ip':'127.0.0.1'},body:chunks.length?Buffer.concat(chunks):undefined}),env);
  res.writeHead(response?.status||404,Object.fromEntries(response?.headers||[]));res.end(await response?.text());
 }catch{res.writeHead(500);res.end()}
});
server.listen(0,'127.0.0.1');await once(server,'listening');
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'chrome',headless:true});
const realClock=Date.now;
let offset=0;
Date.now=()=>realClock()+offset;
const nextCode=async secret=>{offset+=30000;return totpAt(secret,Math.floor(Date.now()/30000))};
async function signIn(page,email,secret,pwd=password){
 await page.goto(origin+'/app#team');
 await page.getByLabel('Email address').fill(email);
 await page.getByLabel('Password',{exact:true}).fill(pwd);
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByLabel('Verification code').fill(await nextCode(secret));
 await page.getByRole('button',{name:'Verify and sign in'}).click();
 await page.getByRole('heading',{name:'Team members'}).waitFor();
}
try{
 const ownerPage=await browser.newPage(),memberPage=await browser.newPage();
 await signIn(ownerPage,owner,ownerSecret);
 async function invite(page,email,secret){
  await page.getByLabel('Member email').fill(email);
  await page.getByLabel('Your current authenticator code').first().fill(await nextCode(secret));
  await page.getByRole('button',{name:'Add Super Admin'}).click();
  await page.getByLabel('Private link').waitFor();
  return page.getByLabel('Private link').inputValue();
 }
 const link=await invite(ownerPage,boss,ownerSecret);
 await memberPage.goto(link);
 await memberPage.getByLabel('Invited email').fill(boss);
 const bossPassword='Boss-private-password-73';
 await memberPage.getByLabel('Password (existing').fill(bossPassword);
 await memberPage.getByRole('button',{name:'Set up authenticator'}).click();
 const key=await memberPage.getByLabel('Setup key').inputValue();
 const bits=[...key].map(c=>'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5,'0')).join('');
 const bossSecret=Uint8Array.from(bits.match(/.{8}/g),b=>parseInt(b,2));
 assert.notDeepEqual(bossSecret,ownerSecret);
 const token=link.split('=')[1],details={token,email:boss,password:bossPassword};
 const post=(page,action,data)=>page.evaluate(async({action,data})=>(await fetch('/v1/human/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})).status,{action,data});
 const get=(page,action)=>page.evaluate(async action=>(await fetch('/v1/human/'+action)).status,action);
 assert.equal((await post(memberPage,'login',details)),401);
 assert.equal((await post(memberPage,'team/accept',{...details,code:'invalid'})),403);
 assert.equal((await get(memberPage,'team')),401);
 await memberPage.getByLabel('Your authenticator code').fill(await nextCode(bossSecret));
 await memberPage.getByRole('button',{name:'Activate Super Admin access'}).click();
 assert.equal((await memberPage.getByLabel('Recovery codes —').inputValue()).split('\n').length,8);
 assert.equal((await post(memberPage,'team/setup',details)),409);
 await memberPage.getByRole('button',{name:'Continue to sign in'}).click();
 await signIn(memberPage,boss,bossSecret,bossPassword);
 assert.deepEqual(await memberPage.locator('nav a').allTextContents(),await ownerPage.locator('nav a').allTextContents());
 for(const area of ['tenants','credits/admin-dashboard','credits/admin-transactions']){
  assert.equal(await get(ownerPage,area),200,area);
  assert.equal(await get(memberPage,area),200,area);
 }
 const other=await invite(memberPage,'next@example.invalid',bossSecret);
 await memberPage.getByRole('button',{name:'Cancel invitation',exact:true}).click();
 await memberPage.getByLabel('Your current authenticator code').last().fill(await nextCode(bossSecret));
 await memberPage.getByRole('button',{name:'Confirm cancel invitation'}).click();
 await memberPage.getByText('next@example.invalid',{exact:true}).waitFor({state:'detached'});
 assert.equal((await post(memberPage,'team/setup',{...details,email:'next@example.invalid',token:other.split('=')[1]})),409);
 await ownerPage.getByRole('button',{name:'Refresh team'}).click();
 await ownerPage.getByRole('button',{name:'Remove access',exact:true}).click();
 await ownerPage.getByLabel('Your current authenticator code').last().fill(await nextCode(ownerSecret));
 await ownerPage.getByRole('button',{name:'Confirm remove access'}).click();
 await ownerPage.getByText(boss,{exact:true}).waitFor({state:'detached'});
 assert.equal((await get(memberPage,'team')),401);
 assert.equal((await get(ownerPage,'team')),200);
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM tenant_audit_events WHERE action LIKE 'team.%'").get().n,5);
 console.log('Team browser flow passed with separate accounts, authenticators and browser contexts.');
}finally{Date.now=realClock;await browser.close();server.close();f.close()}
