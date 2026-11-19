// Super Admin-only engineering sandbox, strictly separated from customer CRM.
// All operations are read-only or in-memory, with zero provider or D1 writes.
import {parseJsonBody} from './core.mjs';
import {productionReadiness} from './release-gates.mjs';
import {runSyntheticPilot} from './sandbox-pilot.mjs';
import {runExotelMockPilot} from './exotel-mock-pilot.mjs';
import {runExotelMediaHarness} from './exotel-media-harness.mjs';
import {operationalReadiness} from './operational-readiness.mjs';
import {probeExotelConnectivity} from './provider-connectivity.mjs';
import {exotelTrialReadiness,managedVoicebotInstructions} from './exotel-trial-readiness.mjs';
import {ownSipSetup} from './own-sip-readiness.mjs';
import {runExotelVoicebotOfflineFixture} from './exotel-voicebot-webhook-contract.mjs';

const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer','X-Frame-Options':'DENY'};
const json=(obj,status=200)=>Response.json(obj,{status,headers});
const fail=(message,status)=>json({error:message},status);
const BASE='/v1/human/engineering/';
const MAX_BYTES=512;
async function boundedJson(req){
  if(!req.body||Number(req.headers.get('content-length'))>MAX_BYTES)
    throw Error('invalid or oversized request');
  const reader=req.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
  let text='',size=0;
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>MAX_BYTES){await reader.cancel();throw Error('request too large')}
      text+=decoder.decode(value,{stream:true});
    }
    text+=decoder.decode();
  }finally{reader.releaseLock()}
  return parseJsonBody(text,MAX_BYTES);
}
export async function handleEngineeringRequest(req,user,env={}){
  const path=new URL(req.url).pathname;
  if(!path.startsWith(BASE))return null;
  if(user?.globalRole!=='super_admin')return fail('forbidden',403);
  if(path===BASE+'status'){
    if(req.method!=='GET')return fail('method not allowed',405);
    return json({...productionReadiness(),operational:operationalReadiness(env)});
  }
  if(path===BASE+'pilot'){
    if(req.method!=='POST')return fail('method not allowed',405);
    try{
      const input=await boundedJson(req);
      if(!input||typeof input!=='object'||Array.isArray(input)||
         Object.keys(input).some(k=>!['count','scenario','quotaCalls','ratePaisePerMinute'].includes(k)))
        return fail('invalid sandbox request',400);
      return json(runSyntheticPilot(input));
    }catch{
      return fail('invalid sandbox input; no simulation executed',400);
    }
  }
  if(path===BASE+'provider-pilot'){
    if(req.method!=='POST')return fail('method not allowed',405);
    try{
      const input=await boundedJson(req);
      if(!input||typeof input!=='object'||Array.isArray(input)||
         Object.keys(input).some(k=>!['count','scenario'].includes(k)))
        return fail('invalid mock provider request',400);
      return json(runExotelMockPilot(input));
    }catch{
      return fail('invalid provider simulation request; nothing executed',400);
    }
  }
  if(path===BASE+'media-protocol'){
    if(req.method!=='POST')return fail('method not allowed',405);
    try{
      const input=await boundedJson(req);
      if(!input||typeof input!=='object'||Array.isArray(input)||
         Object.keys(input).some(k=>!['frames','sampleRate'].includes(k)))
        return fail('invalid media protocol request',400);
      return json(runExotelMediaHarness(input));
    }catch{
      return fail('invalid media protocol simulation; nothing executed',400);
    }
  }
  if(path===BASE+'voicebot-fixture'){
    if(req.method!=='POST')return fail('method not allowed',405);
    try{
      const input=await boundedJson(req);
      if(!input||typeof input!=='object'||Array.isArray(input)||
         Object.keys(input).some(k=>k!=='scenario'))
        return fail('invalid fictional Voicebot scenario',400);
      return json(runExotelVoicebotOfflineFixture(input.scenario));
    }catch{
      return fail('invalid fictional Voicebot event; no processing occurred',400);
    }
  }
  if(path===BASE+'own-sip-setup'){
    if(req.method!=='GET')return fail('method not allowed',405);
    return json(ownSipSetup());
  }
  if(path===BASE+'exotel-trial-setup'){
    if(req.method!=='GET')return fail('method not allowed',405);
    return json({...exotelTrialReadiness(env),
      managedVoicebotPrompt:managedVoicebotInstructions()});
  }
  if(path===BASE+'provider-connectivity'){
    if(req.method!=='POST')return fail('method not allowed',405);
    try{
      const input=await boundedJson(req);
      if(Object.keys(input).length!==0)
        return fail('connectivity check accepts no caller/customer inputs',400);
      return json(await probeExotelConnectivity(env));
    }catch{
      return fail('provider connectivity check could not complete',503);
    }
  }
  return fail('not found',404);
}
