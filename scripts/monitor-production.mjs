// Public, no-secret production monitor. No POST, customer data, cookies,
// bills, real dial operations or synthetic changes to live records.
import {smoke} from './smoke-main.mjs';
const TARGET='https://aicalling.ar3dstudio.in';
export async function monitor({base=TARGET,fetchFn=fetch}={}){
  // smoke() enforces an exact Calling Worker hostname allowlist, HTTP paths,
  // methods, no redirects, expected content types and a 401 auth barrier.
  // The periodic monitor stays GET-only. Only the deploy acceptance smoke
  // uses the safe POST-to-Hangup Plivo Application Answer check.
  const healthy=await smoke(base,fetchFn,{checkPlivoAnswer:false});
  return {healthy,service:'ar3d-ai-calling',checkedWithoutSecrets:true};
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  try{
    const result=await monitor();
    if(!result.healthy){
      console.error('AR3D AI Calling production read-only monitoring failed');
      process.exitCode=1;
    }else console.log('AR3D AI Calling production read-only monitoring PASS');
  }catch{
    console.error('AR3D AI Calling monitoring rejected an unsafe or unreachable target');
    process.exitCode=1;
  }
}
