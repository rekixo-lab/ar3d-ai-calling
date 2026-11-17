// Read-only smoke test after a manually authorized staging deploy.
const base=process.argv[2];
if(!base||!/^https:\/\/[-a-z0-9.]+\.workers\.dev\/?$/.test(base)){
  console.error('Usage: npm run smoke:staging -- https://ar3d-ai-calling-staging.<account>.workers.dev');
  process.exit(2);
}
for(const [path,expected] of [['/health',200],['/app',200],['/v1/human/me',401],['/v1/human/leads?tenantId=11111111-1111-4111-8111-111111111111',401]]){
  const res=await fetch(new URL(path,base),{redirect:'error'});
  console.log(path,res.status);
  if(res.status!==expected)process.exitCode=1;
}
