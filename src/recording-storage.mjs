// Private encrypted R2 storage adapter, intentionally NOT reachable via HTTP.
// Does not authorize recording, initiate calls, or bypass local telecom rules.
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const TYPES=new Set(['audio/wav','audio/ogg','audio/mpeg','audio/webm']);
export const MAX_RECORDING_BYTES=10*1024*1024;
async function encryptionKey(secret){
  if(typeof secret!=='string'||secret.length<32)throw Error('recording encryption key missing');
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('ar3d-recording-v1:'+secret));
  return crypto.subtle.importKey('raw',hash,{name:'AES-GCM'},false,['encrypt','decrypt']);
}
export function recordingContext(input){
  if(!input||typeof input!=='object'||!uuid.test(input.tenantId)||!uuid.test(input.callId)||
     input.source!=='provider_verified'||input.consentVerified!==true||
     input.recordingNoticeGiven!==true||input.callerNumberApproved!==true||
     !TYPES.has(input.contentType)||!Number.isSafeInteger(input.retentionDays)||
     input.retentionDays<1||input.retentionDays>365)
    throw Error('recording safety requirements not satisfied');
  return {tenantId:input.tenantId,callId:input.callId,
    contentType:input.contentType,retentionDays:input.retentionDays};
}
export async function putEncryptedRecording(env,input,audio){
  const ctx=recordingContext(input);
  if(env?.RECORDING_STORAGE_ENABLED!=='true'||!env.RECORDINGS?.put)
    throw Error('private recording storage not provisioned or disabled');
  const key=await encryptionKey(env.RECORDING_ENCRYPTION_KEY);
  if(!(audio instanceof Uint8Array)||audio.length<1||audio.length>MAX_RECORDING_BYTES)
    throw Error('recording payload must be bounded binary audio');
  const iv=crypto.getRandomValues(new Uint8Array(12));
  // Bind tenant/call IDs cryptographically as AES-GCM additional authenticated data.
  const aad=new TextEncoder().encode(ctx.tenantId+':'+ctx.callId);
  const ciphertext=new Uint8Array(await crypto.subtle.encrypt(
    {name:'AES-GCM',iv,additionalData:aad},key,audio));
  const encrypted=new Uint8Array(iv.length+ciphertext.length);
  encrypted.set(iv);encrypted.set(ciphertext,iv.length);
  const objectKey='tenant/'+ctx.tenantId+'/calls/'+ctx.callId+'/'+crypto.randomUUID()+'.aesgcm';
  const expiresAt=new Date(Date.now()+ctx.retentionDays*86400000).toISOString();
  // No public URL and no unencrypted audio/phone numbers in metadata.
  await env.RECORDINGS.put(objectKey,encrypted,{
    httpMetadata:{contentType:'application/octet-stream'},
    customMetadata:{version:'aes-gcm-v1',tenantId:ctx.tenantId,callId:ctx.callId,
      originalContentType:ctx.contentType,retentionExpiresAt:expiresAt}
  });
  return {objectKey,expiresAt,encryption:'aes-gcm-v1',publicUrl:null,
    notice:'Encrypted R2 object only. Retention deletion and legal recording permissions still need operator review.'};
}
export async function decryptRecordingForAuthorizedWorker(env,objectKey,expectedTenantId,expectedCallId,encrypted){
  if(!uuid.test(expectedTenantId)||!uuid.test(expectedCallId)||
     typeof objectKey!=='string'||!objectKey.startsWith(
       'tenant/'+expectedTenantId+'/calls/'+expectedCallId+'/')||
     !/^tenant\/[a-f0-9-]+\/calls\/[a-f0-9-]+\/[a-f0-9-]+\.aesgcm$/i.test(objectKey))
    throw Error('recording is outside authorized tenant/call scope');
  if(env?.RECORDING_STORAGE_ENABLED!=='true')throw Error('recording access disabled');
  const key=await encryptionKey(env.RECORDING_ENCRYPTION_KEY);
  if(!(encrypted instanceof Uint8Array)||encrypted.length<29||
     encrypted.length>MAX_RECORDING_BYTES+64)throw Error('invalid encrypted recording');
  const aad=new TextEncoder().encode(expectedTenantId+':'+expectedCallId);
  return new Uint8Array(await crypto.subtle.decrypt(
    {name:'AES-GCM',iv:encrypted.subarray(0,12),additionalData:aad},
    key,encrypted.subarray(12)));
}
