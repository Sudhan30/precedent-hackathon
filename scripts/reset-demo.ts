export {};
try{
 const url=new URL(process.env.PRECEDENT_API_URL??'http://127.0.0.1:4311');
 if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password)throw new Error('Use a local loopback API URL');
 const request=async(path:string,body?:object,token?:string)=>{
  const response=await fetch(new URL('/api/'+path,url),{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('Reset request failed; verify administrator access and wait for active executions');
  return response.json();
 };
 const config=await request('config');
 if(config.authentication!=='demo')throw new Error('For Modelence authentication, sign in as an administrator and use Start new demo in the dashboard');
 const {token}=await request('login',{role:'admin'});
 const state=await request('state',undefined,token);
 const reset=await request('demo/reset',{expectedVersion:state.policy.version,expectedDemoRunId:state.demo.demoRunId},token);
 console.log(JSON.stringify({demoRunId:reset.demoRunId,previousDemoRunId:reset.previousDemoRunId,policyVersion:reset.policy.version,auditHistory:'preserved'},null,2));
}catch(error){console.error((error as Error).message);process.exitCode=1;}
