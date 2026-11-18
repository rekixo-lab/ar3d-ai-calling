// Read-only checks against the isolated AR3D AI Calling main Worker.
// Never sends client data, sets a session or performs any write operation.
const base=process.argv[2];
if(!base||!/^https:\/\/ar3d-ai-calling\.[a-z0-9-]+\.workers\.dev\/?$/i.test(base)){
  console.error('Usage: npm run smoke:main -- https://ar3d-ai-calling.<workers-subdomain>.workers.dev');
  process.exit(2);
}
for(const [path,expected] of [['/health',200],['/app',200],['/v1/human/me',401]]){
  const res=await fetch(new URL(path,base),{redirect:'error'});
  console.log(path,res.status);
  if(res.status!==expected)process.exitCode=1;
}
