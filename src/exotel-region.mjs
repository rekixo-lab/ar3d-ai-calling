// Explicit Exotel account regions only. Never accept caller-controlled URLs,
// arbitrary hostnames, scheme, ports, or domain substitutions (SSRF prevention).
// https://developer.exotel.com/docs/references/authentication
export const EXOTEL_REGION_HOSTS=Object.freeze({
  india:'https://api.in.exotel.com',
  singapore:'https://api.exotel.com'
});
export function exotelApiBase(region){
  if(typeof region!=='string'||!Object.hasOwn(EXOTEL_REGION_HOSTS,region))
    throw Error('invalid Exotel account region: expected india or singapore');
  return EXOTEL_REGION_HOSTS[region];
}
export function configuredExotelRegion(env){
  const region=env?.EXOTEL_REGION;
  return typeof region==='string'&&Object.hasOwn(EXOTEL_REGION_HOSTS,region)?
    region:null;
}
