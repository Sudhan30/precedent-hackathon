// The clean demo state the 2-minute Mission Control demo relies on, built by driving the real
// API: real runs, real approvals, real MCP discovery and recorded decisions. Nothing is inserted
// into the database directly. Shared by `npm run demo:prepare` and the admin "Reset demo" button.
export type DemoRequest=(path:string,body?:object,role?:'employee'|'admin')=>Promise<any>;
export interface DemoCheck{ok:boolean;name:string;detail:string}
export interface PrepareOptions{reset:boolean;fixture?:boolean;mcpEndpoint?:string;agentATask?:string;step?:(text:string)=>void}
export async function prepareDemo(request:DemoRequest,options:PrepareOptions):Promise<{version:number;checks:DemoCheck[]}>{
 const mcpEndpoint=options.mcpEndpoint??'https://developer.tenable.com/mcp';
 const planner=options.fixture?{planner:'fixture'}:{};
 const step=options.step??(()=>undefined);
 if(options.reset){const state=await request('state');await request('demo/reset',{expectedVersion:state.policy.version,expectedDemoRunId:state.demo.demoRunId});step('Started a fresh demo namespace; audit history preserved');}

 // Feature 2 — Agent A is a first-day agent: the gate enforces every call, but it has no
 // company memory yet. Whatever the model actually does is recorded, never scripted.
 step('Agent A: first-day governed investigation, no company memory (live model unless --fixture)');
 const agentA=(await request('comparison',{task:options.agentATask??'Customer Globex reports checkout failures since today. Find the root cause.',scenario:'investigation',target:'governed',memory:'none',...planner},'employee')).runs[0];
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
 // Raindrop second check on the draft: give Raindrop a few seconds to index the approval runs.
 let raindrop:any=null;
 if(draft){step('Raindrop second check on the draft rule');for(let attempt=0;attempt<8;attempt++){raindrop=await request('proposals/'+draft.id+'/raindrop');if(!['PENDING','UNAVAILABLE'].includes(raindrop.status))break;await new Promise(resolve=>setTimeout(resolve,4000));}}
 const checks=[
  [Boolean(playbook),'Playbook saved',playbook?`${playbook.steps.length} step(s), ${playbook.avoid.length} to avoid · Agent A: ${agentA.status} · index ${playbook.index?.engine}/${playbook.index?.status}`:`Agent A ${agentA.status}; no successful steps to learn from`],
  [Boolean(draft),'Self-written draft ready',draft?`${draft.count} approvals · ${impact.changedCount} of ${impact.total} past decisions would change · safety checks ${impact.safetyChecks.filter((c:any)=>c.pass).length}/${impact.safetyChecks.length}`:'no draft for the current policy version'],
  [Boolean(raindrop)&&['VERIFIED','NOT_CONFIGURED'].includes(raindrop.status),'Raindrop second check',raindrop?raindrop.message:'no draft to check'],
  [blast.summary.exposedCalls+blast.summary.baselineCalls+blast.summary.blockedAttempts>0,'LogLens usage recorded',`${blast.summary.exposedCalls} exposed · ${blast.summary.blockedAttempts} blocked · ${blast.summary.baselineCalls} baseline · ${blast.receipts.count} connector receipts`]
 ] as const;
 return {version:state.policy.version,checks:checks.map(([ok,name,detail])=>({ok,name,detail}))};
}
