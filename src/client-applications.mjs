import {landingHtml,landingCss,landingJs} from './landing-page.mjs';
import {currentSuperAdminMfa,mutationOriginAllowed,validEmail} from './human-auth.mjs';
import {reserveLoginAttempt} from './login-guard.mjs';
import {readBoundedBytes} from './scripted-speech.mjs';

const prefix='private/client-applications/v1/';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json=(value,status=200)=>Response.json(value,{status,headers});
const assets=new Map([['/',['text/html',landingHtml]],['/landing.css',['text/css',landingCss]],['/landing.js',['text/javascript',landingJs]]]);
const purposes=new Set(['प्रॉपर्टी पूछताछ','साइट विज़िट फ़ॉलो-अप','अन्य व्यावसायिक उपयोग']);
const requestPattern=/^(\d{13})-([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/;
function field(value,max){
 return typeof value==='string'&&value.trim().length>0&&value.trim().length<=max&&!/[\u0000-\u001f\u007f]/.test(value)?value.trim():null;
}
export async function publicLanding(req,env){
 const path=new URL(req.url).pathname,asset=assets.get(path);
 if(asset){
  if(!['GET','HEAD'].includes(req.method))return new Response(null,{status:405,headers:{Allow:'GET, HEAD'}});
  return new Response(req.method==='HEAD'?null:asset[1],{headers:{...headers,'Content-Type':asset[0]+';charset=utf-8','Content-Security-Policy':"default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"}});
 }
 if(path!=='/v1/public/client-applications')return null;
 if(req.method!=='POST')return json({error:'method not allowed'},405);
 if(!mutationOriginAllowed(req))return json({error:'same origin required'},403);
 if(req.headers.get('content-type')?.split(';')[0]!=='application/json')return json({error:'JSON required'},415);
 let data;
 try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBoundedBytes(req,4096)))}catch{return json({error:'invalid application'},400)}
 const match=requestPattern.exec(data?.requestId),now=Date.now();
 const mobile=field(data?.mobile,16)?.replace(/[ -]/g,''),email=field(data?.email,180);
 const name=field(data?.name,100),company=field(data?.company,140),city=field(data?.city,100);
 if(!match||Math.abs(Number(match[1])-now)>86400000||!name||!company||!city||!email||!validEmail(email)||
    !/^(?:\+91|91)?[6-9]\d{9}$/.test(mobile||'')||!purposes.has(data.purpose)||data.consent!==true)return json({error:'invalid application'},400);
 try{
  if(!env.LOGIN_RATE_LIMIT_SECRET||!env.RECORDINGS?.put)throw Error('storage unavailable');
  const gate=await reserveLoginAttempt(req,{CONTROL_DB:env.CONTROL_DB,LOGIN_RATE_LIMIT_SECRET:env.LOGIN_RATE_LIMIT_SECRET+'/public-application-v1'},now);
  if(!gate.allowed)return json({error:gate.error},gate.status);
  const reference='AR-'+match[2].toUpperCase();
  const key=prefix+String(9999999999999-Number(match[1])).padStart(13,'0')+'-'+match[2];
  const record={reference,name,company,city,email,mobile:'+91'+mobile.slice(-10),purpose:data.purpose,consent:'application_contact_v1',submittedAt:new Date(now).toISOString()};
  const saved=await env.RECORDINGS.put(key,JSON.stringify(record),{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'}});
  return json({reference},saved?201:200);
 }catch{return json({error:'application service unavailable'},503)}
}
export async function listClientApplications(req,env,user){
 if(req.method!=='GET')return json({error:'method not allowed'},405);
 if(!await currentSuperAdminMfa(env.CONTROL_DB,user))return json({error:'current MFA Super Admin required'},403);
 const cursor=new URL(req.url).searchParams.get('cursor');
 if(cursor&&cursor.length>2048)return json({error:'invalid cursor'},400);
 try{
  const page=await env.RECORDINGS.list({prefix,limit:15,...(cursor?{cursor}:{})});
  const records=await Promise.all(page.objects.map(async object=>{
   if(!object.key.startsWith(prefix))throw Error('invalid application key');
   const item=await env.RECORDINGS.get(object.key);
   return item?item.json():null;
  }));
  return json({applications:records.filter(Boolean),cursor:page.truncated?page.cursor:null});
 }catch{return json({error:'applications unavailable'},503)}
}
