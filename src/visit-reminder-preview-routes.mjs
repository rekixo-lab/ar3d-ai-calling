// Human-review reminder drafts only. This endpoint never sends SMS/WhatsApp,
// creates a Plivo message, places a call or asserts verified channel opt-in.
import {requireMembership} from './human-auth.mjs';
import {resolveCrmDb} from './core.mjs';
const PATH='/v1/human/visit-reminder-preview';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const HEADERS={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json=(data,status=200)=>Response.json(data,{status,headers:HEADERS});
const fail=(message,status=400)=>json({error:message},status);
function localTime(time,language){
 return new Intl.DateTimeFormat(language==='hi'?'hi-IN':'en-IN',{
  timeZone:'Asia/Kolkata',dateStyle:'long',timeStyle:'short'
 }).format(new Date(time));
}

export async function handleVisitReminderPreview(req,env,user,{now=Date.now()}={}){
 const url=new URL(req.url);
 if(url.pathname!==PATH)return null;
 if(req.method!=='GET')return fail('method not allowed',405);
 const keys=['tenantId','visitId','channel','language'];
 if([...url.searchParams.keys()].some(k=>!keys.includes(k)||
    url.searchParams.getAll(k).length!==1)||keys.some(k=>!url.searchParams.has(k)))
  return fail('invalid reminder request');
 const tid=url.searchParams.get('tenantId'),vid=url.searchParams.get('visitId');
 const channel=url.searchParams.get('channel'),language=url.searchParams.get('language');
 if(!UUID.test(tid)||!UUID.test(vid)||
    !['whatsapp','sms'].includes(channel)||!['hi','en'].includes(language)||
    !Number.isSafeInteger(now)||now<0)
  return fail('invalid reminder request');
 try{
  const member=await requireMembership(env.CONTROL_DB,user,tid,true);
  if(!member)return fail('forbidden',403);
  const db=resolveCrmDb(env,member);
  const v=await db.prepare(
   'SELECT v.status AS status,v.scheduled_at AS scheduledAt,l.name AS customer,'+
   'l.consent_status AS consentStatus,l.dnd_status AS dndStatus,'+
   'EXISTS(SELECT 1 FROM lead_opt_out_events o WHERE o.tenant_id=l.tenant_id AND o.lead_id=l.id) AS optedOut '+
   'FROM site_visits v JOIN leads l ON l.tenant_id=v.tenant_id AND l.id=v.lead_id '+
   'WHERE v.tenant_id=? AND v.id=?'
  ).bind(tid,vid).first();
  if(!v)return fail('visit not found',404);
  if(v.optedOut||v.consentStatus==='denied'||v.dndStatus==='blocked')
   return fail('do not contact this customer',409);
  const timestamp=Date.parse(v.scheduledAt);
  if(v.status!=='confirmed'||!Number.isFinite(timestamp)||timestamp<=now||
     timestamp>now+30*86400000)
   return fail('only confirmed upcoming visits can have a reminder draft',409);
  // Strip control characters from user-provided names. Avoid placing PII in
  // logs; the draft is returned only to an authenticated same-tenant admin.
  const name=String(v.customer||'').replace(/[\u0000-\u001f]/g,' ').slice(0,100).trim();
  const when=localTime(v.scheduledAt,language);
  const message=language==='hi'?
   'नमस्ते'+(name?' '+name:'')+' जी, आपकी साइट विजिट '+when+
   ' के लिए निर्धारित है। कृपया समय की पुष्टि करें। बदलना हो तो हमारी टीम को बताइए। धन्यवाद।':
   'Hello'+(name?' '+name:'')+', your site visit is scheduled for '+when+
   '. Please confirm the time. If you need to reschedule, let our team know. Thank you.';
  return json({tenantId:tid,visitId:vid,channel,language,message,
   purpose:'site_visit_reminder',status:'draft_only',sent:false,
   autoSendEnabled:false,channelOptInVerified:false,
   approvedWhatsAppTemplateVerified:false,customerDndVerified:false,
   notice:'Draft only: staff must independently verify channel consent and an approved WhatsApp template or permitted SMS route. No message or call was sent.'});
 }catch{
  console.error('AR3D visit reminder draft unavailable');
  return fail('visit reminder draft temporarily unavailable',503);
 }
}
