// Voice app inbound answer: safe no-service response until AR3D explicitly
// implements and authorizes an inbound calling product. Outbound Voice API
// calls set their own signed, per-call answer_url and hangup_url and do not
// use this Plivo Application-level default.
const PATH='/v1/provider/plivo/inbound-unavailable';
const HEADERS={
 'Cache-Control':'no-store',
 'Content-Type':'application/xml; charset=utf-8',
 'X-Content-Type-Options':'nosniff'
};
export function handleUnavailableInboundVoice(req){
 const url=new URL(req.url);
 if(url.pathname!==PATH)return null;
 if(req.method!=='POST')
  return new Response(null,{status:405,headers:{Allow:'POST','Cache-Control':'no-store'}});
 return new Response('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>',
  {status:200,headers:HEADERS});
}
