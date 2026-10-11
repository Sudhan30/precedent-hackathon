// Builds the clean demo state (packages/demo-prepare) against a running local API. Usage: npm run demo:prepare [-- --reset] [-- --fixture]
import {prepareDemo} from '../packages/demo-prepare/index.js';
const args=new Set(process.argv.slice(2));
const mcpEndpoint=process.env.DEMO_MCP_ENDPOINT??'https://developer.tenable.com/mcp';
try{
 const url=new URL(process.env.PRECEDENT_API_URL??'http://127.0.0.1:4311');
 if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password)throw new Error('Use a local loopback API URL');
 let cookie='';const tokens:Record<string,string>={};
 const request=async(path:string,body?:object,role:'employee'|'admin'='admin',timeout=300000)=>{
  const response=await fetch(new URL('/api/'+path,url),{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...(tokens[role]?{Authorization:'Bearer '+tokens[role]}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(timeout)});
  const next=response.headers.getSetCookie().find(value=>value.startsWith('authToken='));if(next)cookie=next.split(';')[0];
  const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(`${path}: ${data.error??response.status}`);return data;
 };
 const config=await request('config');
 if(config.authentication==='demo'){for(const role of ['employee','admin'] as const)tokens[role]=(await request('login',{role})).token;}
 else{
  // Modelence: one administrator account owns both sides. Credentials come from the
  // environment (or ignored .data/local-login.env) and are never printed.
  const email=process.env.PRECEDENT_DEMO_EMAIL??process.env.PRECEDENT_SETUP_EMAIL,password=process.env.PRECEDENT_DEMO_PASSWORD??process.env.PRECEDENT_SETUP_PASSWORD;
  if(!email||!password)throw new Error('Set PRECEDENT_DEMO_EMAIL and PRECEDENT_DEMO_PASSWORD for an administrator account');
  await request('_internal/method/_system.user.loginWithPassword',{args:{email,password}});if((await request('me')).role!=='admin')throw new Error('The demo account needs the admin role');
 }
 const step=(text:string)=>console.log('… '+text);
 const {version,checks}=await prepareDemo(request,{reset:args.has('--reset'),fixture:args.has('--fixture'),mcpEndpoint,agentATask:process.env.DEMO_AGENT_A_TASK,step});
 console.log('\nDemo readiness · policy v'+version);for(const {ok,name,detail} of checks)console.log(`${ok?'✓':'✗'} ${name}: ${detail}`);
 console.log('\nOn stage: follow DEMO_SCRIPT.md.');
 if(checks.some(check=>!check.ok))process.exitCode=2;
}catch(error){console.error((error as Error).message);process.exitCode=1;}
