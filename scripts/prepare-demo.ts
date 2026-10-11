// Builds the history the 2-minute Mission Control demo relies on by driving the real
// API: real runs, real approvals, real MCP discovery and recorded decisions. Nothing
// is inserted into the database directly. Live publish/quarantine clicks are left
// for the stage. Usage: npm run demo:prepare [-- --reset] [-- --fixture]
export {};
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
 const planner=args.has('--fixture')?{planner:'fixture'}:{};
 const step=(text:string)=>console.log('… '+text);
 if(args.has('--reset')){const state=await request('state');await request('demo/reset',{expectedVersion:state.policy.version,expectedDemoRunId:state.demo.demoRunId});step('Started a fresh demo namespace; audit history preserved');}

 // Feature 2 — Agent A is a first-day agent: the gate enforces every call, but it has no
 // company memory yet. Whatever the model actually does is recorded, never scripted.
 step('Agent A: first-day governed investigation, no company memory (live model unless --fixture)');
 const agentA=(await request('comparison',{task:process.env.DEMO_AGENT_A_TASK??'Customer Globex reports checkout failures since yesterday. Find the root cause.',scenario:'investigation',target:'governed',memory:'none',...planner},'employee')).runs[0];
 // Feature 3 — usage of the LogLens connector (governed and the ungoverned baseline).
 step('LogLens connector usage in the sandbox (governed + baseline)');
 await request('comparison',{task:'Analyze the synthetic sandbox logs with example_connector.analyze.',scenario:'sandbox',target:'both',...planner},'employee');
 // Feature 1 — the same MCP connection approved one request at a time, three times.
 // Last, because it must not be followed by any policy change before the stage.
 let state=await request('state');
 if(state.policy.mcpConnections?.some((item:{key:string})=>item.key==='docs-preview'))step('Docs Preview MCP is already configured; skipping approvals (use --reset for a fresh demo)');
 else for(let i=1;i<=3;i++){
  step(`Docs Preview MCP approval ${i} of 3 (real discovery at ${mcpEndpoint})`);
  const run=(await request('mcp/comparison',{task:'Connect with Docs Preview MCP',target:'governed'},'employee')).runs[0];const id=run.mcpResult.requestId;
  await request('mcp/requests/'+id+'/submit',{name:'Docs Preview',endpoint:mcpEndpoint,purpose:'Read developer documentation for an integration task'},'employee');
  state=await request('state');await request('mcp/requests/'+id+'/review',{allow:true,scope:'once',expectedVersion:state.policy.version,reason:'Routine documentation access for this task',ttlSeconds:120});
  const resumed=await request('mcp/requests/'+id+'/resume',{},'employee');if(resumed.mcpResult.status!=='CONNECTED')throw new Error(`Docs Preview discovery returned ${resumed.mcpResult.status}; check the public endpoint and retry`);
 }
 state=await request('state');
 const playbook=(state.playbooks??[]).find((p:Record<string,any>)=>p.sourceRunId===agentA.id)??(state.playbooks??[]).at(-1);
 const draft=(state.policyProposals??[]).find((p:Record<string,any>)=>p.status==='DRAFT'&&p.scope?.kind==='mcp'&&p.baseVersion===state.policy.version);
 const impact=draft?await request('proposals/'+draft.id+'/impact'):null;
 const blast=await request('incidents/preview?toolId=example_connector.analyze');
 const checks=[
  [Boolean(playbook),'Playbook saved',playbook?`${playbook.steps.length} step(s), ${playbook.avoid.length} to avoid · Agent A: ${agentA.status} · index ${playbook.index?.engine}/${playbook.index?.status}`:`Agent A ${agentA.status}; no successful steps to learn from`],
  [Boolean(draft),'Self-written draft ready',draft?`${draft.count} approvals · ${impact.changedCount} of ${impact.total} past decisions would change · safety checks ${impact.safetyChecks.filter((c:any)=>c.pass).length}/${impact.safetyChecks.length}`:'no draft for the current policy version'],
  [blast.summary.exposedCalls+blast.summary.baselineCalls+blast.summary.blockedAttempts>0,'LogLens usage recorded',`${blast.summary.exposedCalls} exposed · ${blast.summary.blockedAttempts} blocked · ${blast.summary.baselineCalls} baseline · ${blast.receipts.count} connector receipts`]
 ] as const;
 console.log('\nDemo readiness · policy v'+state.policy.version);for(const [ok,name,detail] of checks)console.log(`${ok?'✓':'✗'} ${name}: ${detail}`);
 console.log('\nOn stage: Agent B asks a similar task live (e.g. "Initech says payments fail at checkout. Find the root cause.") → Publish rule → Report incident → Quarantine → Send test call.');
 if(checks.some(([ok])=>!ok))process.exitCode=2;
}catch(error){console.error((error as Error).message);process.exitCode=1;}
