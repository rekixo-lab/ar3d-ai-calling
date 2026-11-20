// Narrow Cloudflare-edge IP allowlist check for Exotel Voicebot webhooks.
// Bearer token remains mandatory. This is defense-in-depth, NOT proof of
// vendor origin, a cryptographic signature, consent or call-to-tenant mapping.
// Only the Cloudflare-populated CF-Connecting-IP should be trusted in a Worker.
// Never accept X-Forwarded-For, Forwarded or a body-supplied IP as identity.
const MAX_CIDRS=32;
const MAX_BYTES=1024;

export function ipv4Integer(value){
  if(typeof value!=='string'||!/^(?:0|[1-9][0-9]{0,2})(?:\.(?:0|[1-9][0-9]{0,2})){3}$/.test(value))
    return null;
  const parts=value.split('.').map(Number);
  if(parts.some(x=>x>255))return null;
  return ((parts[0]*16777216)+(parts[1]<<16)+(parts[2]<<8)+parts[3])>>>0;
}
function publiclyRoutableIPv4(ip){
  const a=ip>>>24,b=(ip>>>16)&255,c=(ip>>>8)&255;
  return !(a===0||a===10||a===127||a>=224||
    (a===100&&b>=64&&b<=127)||
    (a===169&&b===254)||(a===172&&b>=16&&b<=31)||
    (a===192&&(b===0||b===168))||
    (a===198&&(b===18||b===19||b===51&&c===100))||
    (a===203&&b===0&&c===113));
}
export function parseApprovedExotelCidrs(config){
  if(typeof config!=='string'||config.length===0||config.length>MAX_BYTES)
    return null;
  const entries=config.split(',');
  if(entries.length===0||entries.length>MAX_CIDRS)return null;
  const seen=new Set(),ranges=[];
  for(const item of entries){
    const x=item.trim();
    const match=/^(\d{1,3}(?:\.\d{1,3}){3})(?:\/([1-9]\d?))?$/.exec(x);
    if(!match)return null;
    const ip=ipv4Integer(match[1]);
    const prefix=match[2]===undefined?32:Number(match[2]);
    // Reject broad networks. Exotel must explicitly approve every range.
    if(ip===null||prefix<16||prefix>32||!publiclyRoutableIPv4(ip))
      return null;
    const mask=(0xffffffff << (32-prefix))>>>0;
    const network=(ip & mask)>>>0;
    // Require canonical CIDR, so a typo never broadens the supplied network.
    if(network!==ip||seen.has(network+'/'+prefix))return null;
    seen.add(network+'/'+prefix);
    ranges.push(Object.freeze({network,mask}));
  }
  return Object.freeze(ranges);
}
export function checkExotelWebhookNetwork(req,env={}){
  // No unverified allowlist input: preserve existing bearer-only metadata
  // quarantine mode. Do not upgrade sourceAuthenticated for any outcome.
  const config=env?.EXOTEL_VOICEBOT_ALLOWED_SOURCE_IPV4_CIDRS;
  if(config===undefined)return {state:'bearer_only_quarantine',enforced:false};
  const ranges=parseApprovedExotelCidrs(config);
  if(!ranges)return {state:'invalid_allowlist',enforced:false};
  const ip=ipv4Integer(req?.headers?.get('CF-Connecting-IP'));
  if(ip===null||!publiclyRoutableIPv4(ip))
    return {state:'not_allowlisted',enforced:true};
  return ranges.some(r=>(ip&r.mask)>>>0===r.network)?
    {state:'source_network_allowlisted',enforced:true}:
    {state:'not_allowlisted',enforced:true};
}
