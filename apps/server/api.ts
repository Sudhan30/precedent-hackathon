import express from 'express';
import {registerMcpRequests} from './mcp-routes.js';
import {isMcpConnectionPrompt,nameFromPrompt} from '../../packages/mcp/contracts.js';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {type Precedent} from './service.js';
import {asRuntime,type DomainRuntime} from './runtime.js';
import {retrieveForRuntime} from './context.js';
import {policyChangeSchema,previewPolicyChange} from '../../packages/policies/index.js';
import {planWithEve,isSocialMessage,type PlannerTransport} from '../agent-worker/planner.js';
import {runEvaluations} from '../../packages/evaluation/index.js';
import {impactPreview} from '../../packages/proposals/impact.js';
import {candidatePlaybooks,discoverPlaybooks,distillPlaybook,playbookComparison,playbookContext,voyagePlaybookRanker,type Playbook} from '../../packages/playbooks/index.js';
import {agentEngineIndex} from '../../packages/playbooks/agent-engine.js';
import {prepareDemo,type DemoCheck,type DemoRequest} from '../../packages/demo-prepare/index.js';
import {blastRadius} from '../../packages/incidents/index.js';
import {approveCandidate,departmentKnowledge,knowledgeComparison,knowledgeContext,proposeFromRun,rankKnowledge,rejectCandidate} from '../../packages/knowledge/index.js';
import {tableNamePattern,tableNames} from '../../packages/warehouse/index.js';
import {actionInputSchema,departmentSchema,snapshotRecordsSchema,toolIds,type ToolId} from '../../packages/contracts/index.js';
import type {Department} from '../../packages/warehouse/index.js';
import type {ExecutionGateway} from '../../packages/execution/index.js';
import type {BackendTelemetry} from '../../packages/observability/index.js';
import {requestMonitoring,type ApplicationMonitor} from '../../packages/observability/modelence.js';
import {discoverTenable,mcpDecision,tenableEndpoint,type McpDiscovery} from '../../packages/mcp/index.js';
const actionInput=actionInputSchema;
export interface AuthenticatedPrincipal{userId:string;role:'employee'|'admin';tenantId:string;department?:Department;}
export interface IdentityAdapter{resolve(req:express.Request):Promise<AuthenticatedPrincipal|null>;}
export function createApp(source:Precedent|DomainRuntime,gateway?:ExecutionGateway,identity?:IdentityAdapter,telemetry?:BackendTelemetry,applicationMonitor?:ApplicationMonitor,mcpDiscover:()=>Promise<McpDiscovery>=discoverTenable,reviewedDiscover?:(endpoint:string)=>Promise<McpDiscovery>,plannerTransport?:PlannerTransport){
 const runtime=asRuntime(source);
 // Read-only views (display, lookups) use a consistent snapshot outside the write queue.
 const read=<T>(fn:(service:Precedent)=>T|Promise<T>)=>runtime.read?runtime.read(fn):runtime.run(fn);const playbookIndex=agentEngineIndex()??runtime.playbookIndex;
 // Playbooks are stored in Atlas; Agent Engine (optional) or Atlas vector search + Voyage rerank
 // matches them to tasks, with plain Voyage rerank as the fallback.
 const playbookRanker=[playbookIndex,voyagePlaybookRanker()].filter((index):index is NonNullable<typeof index>=>Boolean(index));const run=<T>(fn:(service:Precedent)=>T|Promise<T>)=>runtime.run(fn);
 const control=<T>(fn:(service:Precedent)=>T|Promise<T>)=>gateway?gateway.control(fn):run(fn);
 // Every open tab reloads state after each event. Concurrent and repeated reloads share one
 // snapshot read until this server commits another write (5 s safety limit for outside writers).
 let stateCache:{writes:number;at:number;value:Promise<ReturnType<Precedent['snapshot']>>}|undefined;
 const sharedSnapshot=()=>{const writes=runtime.writes;if(writes===undefined)return read(s=>s.snapshot());
  if(stateCache&&stateCache.writes===writes&&Date.now()-stateCache.at<5000)return stateCache.value;
  const value=read(s=>s.snapshot());stateCache={writes,at:Date.now(),value};value.catch(()=>{if(stateCache?.value===value)stateCache=undefined;});return value;};
 const controlAs=<T>(res:express.Response,fn:(service:Precedent)=>T|Promise<T>)=>control(s=>{s.reviewerId=res.locals.principal.userId??'local-demo-administrator';return fn(s);});
 const execute=(...args:Parameters<Precedent['execute']>)=>gateway?gateway.execute(...args):run(s=>s.execute(...args));
 const app=express();app.disable('x-powered-by');if(applicationMonitor)app.use(requestMonitoring(applicationMonitor));app.use(express.json({limit:'16kb'}));
 const tokens=new Map<string,{role:'employee'|'admin';tenantId:string;sessions:Set<string>;department?:Department}>();
 const fixturePlannerAvailable=process.env.ALLOW_FIXTURE_PLANNER==='true';const defaultPlanner=fixturePlannerAvailable?'fixture':'eve';
 const loginAliases=identity?z.record(z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/),z.string().email()).parse(JSON.parse(process.env.PRECEDENT_LOGIN_ALIASES??'{}')):{};
 app.get('/api/config',(_req,res)=>res.json({authentication:identity?'modelence':'demo',defaultPlanner,fixturePlannerAvailable,loginAliases}));
 app.post('/api/login',(req,res)=>{if(identity){res.status(403).json({error:'Use Modelence login; client-selected roles are disabled'});return;}const {role}=z.object({role:z.enum(['employee','admin'])}).strict().parse(req.body);const token=randomUUID();tokens.set(token,{role,tenantId:'acme-demo',sessions:new Set()});res.json({token,role,mode:'Local synthetic demonstration identity; not production authentication'});});
 const principals=new Map<string,{sessions:Set<string>;department?:Department;role:string;loadedAt:number}>();
 app.use('/api',async(req,res,next)=>{
  if(identity){const user=await identity.resolve(req);if(!user){res.status(401).json({error:'Login required'});return;}
   // Session ownership is cached per user: only this process creates sessions, and new
   // ones are added to the shared Set. Refreshed on role change or after five minutes.
   let cached=principals.get(user.userId);
   if(!cached||cached.role!==user.role||Date.now()-cached.loadedAt>300000){
    const loaded=await read(s=>{const owned=s.store.all('session').filter(session=>session.principalId===user.userId&&session.tenantId===user.tenantId);return {sessions:new Set(owned.map(session=>session.id)),stale:owned.filter(session=>session.role!==user.role).map(session=>session.id),department:s.store.get('membership',user.userId)?.department as Department|undefined};});
    if(loaded.stale.length)await run(s=>{for(const id of loaded.stale){const session=s.store.get('session',id);if(session&&session.role!==user.role)s.store.put('session',{...session,role:user.role});}});
    cached={sessions:loaded.sessions,department:loaded.department,role:user.role,loadedAt:Date.now()};principals.set(user.userId,cached);
   }
   res.locals.principal={...user,sessions:cached.sessions,...(cached.department?{department:cached.department}:{})};next();return;
  }
  const token=req.headers.authorization?.replace(/^Bearer /,'');const principal=token?tokens.get(token):undefined;if(!principal){res.status(401).json({error:'Login required'});return;}res.locals.principal=principal;next();
 });
 app.get('/api/me',(_req,res)=>res.json({role:res.locals.principal.role,userId:res.locals.principal.userId??null,department:res.locals.principal.department??null}));
 // Department is self-declared once per account; afterwards only an administrator can change it.
 app.post('/api/me/department',async(req,res)=>{const {department}=z.object({department:departmentSchema}).strict().parse(req.body);const principal=res.locals.principal;
  if(principal.department)throw Object.assign(new Error('Your department is already set. Ask an administrator to change it.'),{status:409});
  if(identity)await run(s=>{if(s.store.get('membership',principal.userId))throw Object.assign(new Error('Your department is already set. Ask an administrator to change it.'),{status:409});s.record('membership',{id:principal.userId,tenantId:principal.tenantId,department,selfDeclared:true,chosenAt:s.clock()});s.emit('membership.department.declared',{principalId:principal.userId,department});});
  principal.department=department;const entry=principals.get(principal.userId);if(entry)entry.department=department;res.json({department,selfDeclared:true});});
 const admin=(res:express.Response)=>{if(res.locals.principal.role!=='admin')throw Object.assign(new Error('Administrator required'),{status:403});};
 const contextVisible=(context:any,principal:AuthenticatedPrincipal)=>!context?.scope||(context.scope.tenantId===principal.tenantId&&(context.scope.role!=='admin'||principal.role==='admin'));
 const owned=(res:express.Response,id:string)=>{if(!res.locals.principal.sessions.has(id))throw Object.assign(new Error('Session access denied'),{status:403});};
 app.get('/api/evaluations',(_req,res)=>res.json(runEvaluations()));
 app.get('/api/state',async(_req,res)=>{const state={...await sharedSnapshot()};const principal=res.locals.principal;state.mcpRequests=state.mcpRequests.filter(record=>record.tenantId===principal.tenantId&&(!identity||principal.role==='admin'||principal.sessions.has(record.sessionId)));state.events=state.events.filter(event=>contextVisible(event.context,principal));state.runs=state.runs.filter(record=>contextVisible(record.context,principal)&&(!identity||principal.role==='admin'||principal.sessions.has(record.sessionId)));state.episodes=state.episodes.filter(episode=>episode.tenantId===principal.tenantId&&episode.visibleRoles?.includes(principal.role));
  // Agent memory is department data: non-administrators see only their own department's entries.
  const sameDepartment=(record:Record<string,any>)=>record.tenantId===principal.tenantId&&(principal.role==='admin'||(principal.department&&record.department===principal.department));state.knowledge=state.knowledge.filter(sameDepartment);state.memoryCandidates=state.memoryCandidates.filter(sameDepartment);const currentIds=new Set(state.executions.map(e=>e.id));res.json({...snapshotRecordsSchema.parse(state),planner:defaultPlanner==='eve'?'live eve model':'deterministic fixture; no live model',viewer:{role:principal.role,userId:principal.userId??null,tenantId:principal.tenantId},storage:runtime.mode,policyNotifications:runtime.notifications??{state:'local transaction events'},executionMode:gateway?'MCP connector with committed intent':'in-process synthetic receipts',downstreamReceipts:gateway?(await gateway.receipts()).filter(r=>currentIds.has(r.executionId)):[],livePlannerAvailable:Boolean(process.env.EVE_WORKER_URL),fixturePlannerAvailable,defaultPlanner});});
 app.get('/api/downstream',async(_req,res)=>res.json({receipts:gateway?await gateway.receipts():[],mode:gateway?'independent MCP receipt store':'not configured'}));
 app.post('/api/sessions',async(_req,res)=>{const s=await run(s=>s.session({tenantId:res.locals.principal.tenantId,role:res.locals.principal.role},res.locals.principal.userId,undefined,res.locals.principal.department));res.locals.principal.sessions.add(s.id);res.json(s);});
 app.post('/api/sessions/:id/heartbeat',async(req,res)=>{z.object({}).strict().parse(req.body);owned(res,String(req.params.id));res.json(await run(s=>s.store.atomic(()=>s.workerHeartbeat(String(req.params.id)))));});
 app.post('/api/actions',async(req,res)=>{const a=actionInput.parse(req.body);owned(res,a.sessionId);const action=await run(s=>s.action(a.sessionId,a.toolId,a.resourceId,a.environment,a.target));res.json(await execute(action,a.executionId));});
 app.post('/api/approvals/:id',async(req,res)=>{admin(res);const {allow,ttlSeconds}=z.object({allow:z.boolean(),ttlSeconds:z.number().finite().positive().max(300)}).strict().parse(req.body);res.json(await controlAs(res,s=>{const result=s.approve(String(req.params.id),ttlSeconds,allow);s.refreshRunOutcome(String(req.params.id));return result;}));});
 app.post('/api/grants/:id/revoke',async(req,res)=>{admin(res);z.object({}).strict().parse(req.body);res.json(await controlAs(res,s=>s.revoke(String(req.params.id))));});
 app.post('/api/resume/:id',async(req,res)=>{const original=await run(s=>{const e=s.store.get('execution',String(req.params.id));if(!e||e.status!=='PENDING')throw new Error('No held action');owned(res,e.action.sessionId);if(s.store.get('approval',e.id)?.status!=='APPROVED')throw new Error('Approval required');return e;});const result=await execute(original.action,original.id+':resume');await run(s=>s.refreshRunOutcome(original.id));
  const resumedRun=await run(s=>s.store.all('run').find(record=>record.mode==='governed'&&record.executionIds?.includes(original.id)&&record.status==='FINISHED')?.id);if(resumedRun){await savePlaybook(resumedRun);const record=await run(s=>s.store.get('run',resumedRun));if(record?.scenario==='warehouse'&&record.hint)await run(s=>s.store.atomic(()=>proposeFromRun(s,resumedRun,record.hint))).catch(()=>undefined);}
  // Self-writing guardrails: look for repeated approvals after each resume. A separate
  // transaction, so analysis can never undo or block the completed action.
  await control(s=>s.analyzeProposals()).catch(()=>undefined);res.json(result);});
 app.post('/api/demo/reset',async(req,res)=>{admin(res);const {expectedVersion,expectedDemoRunId}=z.object({expectedVersion:z.number().int().positive(),expectedDemoRunId:z.string().uuid()}).strict().parse(req.body);res.json(await controlAs(res,s=>s.resetDemo(expectedVersion,expectedDemoRunId)));});
 // "Reset demo" (admins): the same steps as `npm run demo:prepare -- --reset`, run in the background
 // by calling this API on loopback with the requesting administrator's own credentials.
 let demoJob:{id:string;status:'RUNNING'|'DONE'|'FAILED';steps:string[];checks?:DemoCheck[];version?:number;error?:string;startedAt:number;finishedAt?:number}|undefined;
 app.post('/api/demo/prepare',async(req,res)=>{admin(res);
  if(demoJob?.status==='RUNNING')throw Object.assign(new Error('A demo reset is already running'),{status:409});
  const base=`http://127.0.0.1:${req.socket.localPort}/api/`;const caller={...(req.headers.authorization?{Authorization:req.headers.authorization}:{}),...(req.headers.cookie?{Cookie:req.headers.cookie}:{})};
  let employeeToken='';
  const request:DemoRequest=async(path,body,role='admin')=>{
   const response=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(role==='employee'&&employeeToken?{Authorization:'Bearer '+employeeToken}:caller)},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(300000)});
   const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(`${path}: ${data.error??response.status}`);return data;
  };
  const job:NonNullable<typeof demoJob>={id:randomUUID(),status:'RUNNING',steps:[],startedAt:Date.now()};demoJob=job;
  void (async()=>{
   try{
    // Local demo sign-in has separate employee and admin roles; account sign-in uses the admin for both.
    if(!identity)employeeToken=(await request('login',{role:'employee'})).token;
    const result=await prepareDemo(request,{reset:true,step:text=>job.steps.push(text)});
    Object.assign(job,{status:'DONE',checks:result.checks,version:result.version});
   }catch(error){Object.assign(job,{status:'FAILED',error:(error as Error).message});}
   finally{job.finishedAt=Date.now();}
  })();
  res.status(202).json(job);
 });
 app.get('/api/demo/prepare',(_req,res)=>{admin(res);res.json(demoJob??null);});
 app.post('/api/policy/preview',async(req,res)=>{admin(res);const input=policyChangeSchema.parse(req.body);res.json(await run(s=>previewPolicyChange(s.policy(),input)));});
 app.post('/api/policy',async(req,res)=>{admin(res);const input=policyChangeSchema.parse(req.body);res.json(await controlAs(res,s=>{const reviewed=previewPolicyChange(s.policy(),input);return s.publish({...s.policy(),sandboxAllowed:reviewed.input.sandboxAllowed,sandboxApprovalRequired:reviewed.input.sandboxApprovalRequired},false,reviewed.input.reason);}));});
 app.post('/api/mcp/policy',async(req,res)=>{
  admin(res);const input=z.object({expectedVersion:z.number().int().positive(),tenableAllowed:z.boolean(),deniedTools:z.array(z.enum(toolIds)),reason:z.string().trim().min(1).max(1000)}).strict().parse(req.body);
  res.json(await controlAs(res,s=>{if(s.policy().version!==input.expectedVersion)throw Object.assign(new Error('Policy changed; refresh before publishing'),{status:409});return s.publish({...s.policy(),tenableAllowed:input.tenableAllowed,deniedTools:[...new Set(input.deniedTools)]},false,input.reason);}));
 });
 const unknownMcp=registerMcpRequests(app,{run,controlAs,admin,owned,exclusive:fn=>gateway?gateway.exclusive(fn):fn(),discover:reviewedDiscover});
 app.post('/api/mcp/comparison',async(req,res)=>{
  const {task,target}=z.object({task:z.string().trim().min(1).max(2000).refine(task=>isMcpConnectionPrompt(task)||(/\btenable\b/i.test(task)&&/\b(connect|add|install|download)\b/i.test(task)),'Explicitly request connecting an MCP'),target:z.enum(['both','baseline','governed']).default('both')}).strict().parse(req.body);
  if(!(/^tenable(?: |$)/i.test(nameFromPrompt(task))||(!/\bmcp\b/i.test(task)&&/\btenable\b/i.test(task)))){res.json(await unknownMcp(res,task,target));return;}
  const comparisonId=randomUUID(),runs=[];
  for(const mode of (target==='both'?['baseline','governed']:[target]) as ('baseline'|'governed')[]){
   const perform=async()=>{const id=randomUUID();const intent=await run(s=>{
    const session=s.session({tenantId:res.locals.principal.tenantId,role:res.locals.principal.role},res.locals.principal.userId,id);res.locals.principal.sessions.add(session.id);
    const decision=mcpDecision(s.policy(),mode);const record={id,comparisonId,demoRunId:s.demo().demoRunId,sessionId:session.id,task,mode,scenario:'tenable',planner:'Explicit MCP connection request; no model-generated plan',plan:[],createdAt:s.clock(),status:decision.verdict==='BLOCK'?'FINISHED':'EXECUTING',executionIds:[],mcpResult:{decision,endpoint:tenableEndpoint,status:decision.verdict==='BLOCK'?'BLOCKED':'CONNECTING',tools:[],message:decision.verdict==='BLOCK'?'No connection attempted.':'Connection intent recorded before contacting the MCP server.'}};
    s.record('run',record);s.emit('mcp.decision.recorded',{runId:id,sessionId:session.id,decision});return record;
   });
   if(intent.mcpResult.decision.verdict==='ALLOW'){
    let discovery:McpDiscovery;try{discovery=await mcpDiscover();}catch{discovery={status:'CONNECTION_FAILED',tools:[],message:'MCP connection failed; inspect server configuration.'};}
    return await run(s=>{
     const current=mcpDecision(s.policy(),mode),session=s.store.get('session',intent.sessionId)!;
     const stale= !s.sessionIsCurrent(session)||current.verdict==='BLOCK';
     const record={...intent,status:'FINISHED',mcpResult:{...intent.mcpResult,...discovery,...(stale?{status:'POLICY_CHANGED',tools:[],message:'Policy or demo changed during discovery. Discovered tools were not enabled. The earlier connection attempt remains in the audit.'}:{}),currentDecision:current}};
     s.record('run',record);s.emit('mcp.connection.recorded',{runId:id,sessionId:intent.sessionId,status:record.mcpResult.status,decision:current,toolCount:record.mcpResult.tools.length});return record;
    });
   }else return intent;
   };runs.push(await (gateway?gateway.exclusive(perform):perform()));
  }
  res.json({comparisonId,runs});
 });
 // Kill switch. Receipt counts come from the connector's own independent store when a
 // gateway is configured, so "the tool never received the call" is not self-reported.
 const receiptCount=async(toolId:ToolId)=>gateway?(await gateway.receipts()).filter(r=>(r.input?.toolId??r.toolId)===toolId).length:run(s=>s.store.all('receipt').filter(r=>r.toolId===toolId).length);
 const receiptSource=gateway?'independent connector receipt store':'in-process synthetic receipts';
 app.get('/api/incidents/preview',async(req,res)=>{admin(res);const {toolId}=z.object({toolId:z.enum(toolIds)}).strict().parse(req.query);res.json({...await read(s=>blastRadius(s,toolId)),receipts:{count:await receiptCount(toolId),source:receiptSource}});});
 app.post('/api/admin/members/:id/department',async(req,res)=>{admin(res);if(!identity)throw Object.assign(new Error('Accounts exist only with Modelence authentication'),{status:400});const {department}=z.object({department:departmentSchema}).strict().parse(req.body);
  res.json(await run(s=>{const previous=s.store.get('membership',String(req.params.id));const record={id:String(req.params.id),tenantId:res.locals.principal.tenantId,department,selfDeclared:false,chosenAt:previous?.chosenAt??s.clock(),changedBy:res.locals.principal.userId,changedAt:s.clock()};s.record('membership',record);s.emit('membership.department.changed',{principalId:record.id,department,changedBy:record.changedBy});return record;}).then(record=>{principals.delete(record.id);return record;}));});
 // Agent memory: only the user who owns the run's session can approve or reject its proposal.
 const ownCandidate=async(res:express.Response,id:string)=>{const candidate=await run(s=>s.store.get('memory_candidate',id));if(!candidate)throw Object.assign(new Error('Unknown memory proposal'),{status:404});owned(res,candidate.sessionId);};
 app.post('/api/memory/candidates/:id/approve',async(req,res)=>{// Only department scope exists; anything else is invalid input and leaves the proposal open.
  const {scope}=z.object({scope:z.literal('department')}).strict().parse(req.body);await ownCandidate(res,String(req.params.id));res.json(await run(s=>s.store.atomic(()=>approveCandidate(s,String(req.params.id),scope,res.locals.principal.userId??'demo-user'))));});
 app.post('/api/memory/candidates/:id/reject',async(req,res)=>{z.object({}).strict().parse(req.body);await ownCandidate(res,String(req.params.id));res.json(await run(s=>s.store.atomic(()=>rejectCandidate(s,String(req.params.id),res.locals.principal.userId??'demo-user'))));});
 app.get('/api/knowledge/:id/comparison',async(req,res)=>{admin(res);res.json(await read(s=>knowledgeComparison(s,String(req.params.id))));});
 app.post('/api/incidents',async(req,res)=>{admin(res);const {toolId}=z.object({toolId:z.enum(toolIds)}).strict().parse(req.body);const before=await receiptCount(toolId);const incident=await controlAs(res,s=>s.incident(toolId));res.json({...incident,receipts:{before,after:await receiptCount(toolId),source:receiptSource}});});
 app.post('/api/incidents/test-call',async(req,res)=>{
  admin(res);const {toolId}=z.object({toolId:z.enum(['example_connector.analyze','demo_export.send'])}).strict().parse(req.body);const before=await receiptCount(toolId);
  const session=await run(s=>s.session({tenantId:res.locals.principal.tenantId,role:res.locals.principal.role},res.locals.principal.userId));res.locals.principal.sessions.add(session.id);
  const action=await run(s=>s.action(session.id,toolId,'sandbox-logs','sandbox'));const execution=await execute(action,randomUUID());
  res.json({execution,receipts:{before,after:await receiptCount(toolId),source:receiptSource}});
 });
 app.post('/api/proposals/analyze',async(req,res)=>{admin(res);z.object({}).strict().parse(req.body);res.json(await controlAs(res,s=>s.analyzeProposals()));});
 // A playbook is saved in its own transaction after the run completes; indexing in
 // Agent Engine happens afterwards. Neither can change the recorded run outcome.
 const savePlaybook=async(runId:string)=>{try{
  const playbook=await run(service=>service.store.atomic(()=>distillPlaybook(service,runId,playbookIndex?.save?'PENDING':'LOCAL_ONLY')));if(!playbook||!playbookIndex?.save)return;
  let status:Playbook['index']['status']='LOCAL_ONLY';if(playbookIndex?.save){try{await playbookIndex.save(playbook);status='INDEXED';}catch{status='INDEX_FAILED';}}
  await run(service=>{const current=service.store.get('playbook',playbook.id);if(current)service.record('playbook',{...current,index:{engine:playbookIndex&&status==='INDEXED'?playbookIndex.engine:'precedent-local',status}});});
 }catch{/* Playbook learning is advisory; it never changes the completed run. */}};
 app.get('/api/playbooks/:id/comparison',async(req,res)=>{admin(res);res.json(await read(s=>playbookComparison(s,String(req.params.id))));});
 app.get('/api/proposals/:id/impact',async(req,res)=>{admin(res);res.json(await read(s=>impactPreview(s,String(req.params.id))));});
 app.post('/api/proposals/:id/publish',async(req,res)=>{admin(res);const {expectedVersion}=z.object({expectedVersion:z.number().int().positive()}).strict().parse(req.body);res.json(await controlAs(res,s=>s.publishProposal(String(req.params.id),expectedVersion)));});
 app.get('/api/executions/:id/original',async(req,res)=>{res.json(await run(s=>{const original=s.inspectOriginal(String(req.params.id)),principal=res.locals.principal;
  if(original.session?.tenantId!==principal.tenantId||(identity&&principal.role!=='admin'&&original.session?.principalId!==principal.userId)||(principal.role!=='admin'&&(original.session?.role==='admin'||original.contextAtPlanning?.scope?.role==='admin')))throw Object.assign(new Error('Historical evidence access denied'),{status:403});
  return original;
 }));});
 app.post('/api/replay',async(req,res)=>{const {executionId,version}=z.object({executionId:z.string(),version:z.number().int().positive()}).strict().parse(req.body);res.json(await run(s=>s.replay(executionId,version)));});
 app.post('/api/comparison',async(req,res)=>{
  // memory:'none' is a governed "first day" agent: the policy gate still enforces every
  // call, but no company rules, episodes or playbooks are supplied before planning.
  const {task,scenario,planner,target,memory,hint,previousRunIds}=z.object({task:z.string().trim().min(1).max(2000),previousRunIds:z.array(z.string().uuid()).max(20).optional(),scenario:z.enum(['investigation','sandbox','sandbox-export','staging','warehouse']),planner:z.enum(['fixture','eve']).default(defaultPlanner),target:z.enum(['both','baseline','governed']).default('both'),memory:z.enum(['full','none']).default('full'),
   // A user-supplied table (and optional definitions) for the warehouse scenario.
   hint:z.object({table:z.string().max(120).regex(tableNamePattern).refine(name=>tableNames.includes(name),'Unknown warehouse table'),definitions:z.string().trim().max(1000).optional(),previousRunId:z.string().uuid().optional()}).strict().optional()}).strict().refine(input=>!input.hint||input.scenario==='warehouse','Table hints apply to the warehouse scenario').parse(req.body);
  if(planner==='fixture'&&!fixturePlannerAvailable)throw Object.assign(new Error('Scripted planning is disabled; configure the live eve worker'),{status:403});
  const demoRunId=await read(s=>s.demo().demoRunId);
  const comparisonId=randomUUID(),starts:Promise<Record<string,any>>[]=[];
  const jobs=(target==='both'?['baseline','governed']:[target]).map(mode=>{
   let accepted!:(record:Record<string,any>)=>void,rejected!:(error:unknown)=>void;
   const ready=new Promise<Record<string,any>>((resolve,reject)=>{accepted=resolve;rejected=reject;});starts.push(ready);
   const runId=randomUUID();
   const perform=async()=>{
   const sandbox=scenario==='sandbox'||scenario==='sandbox-export';
   const resource=scenario==='warehouse'?'warehouse':scenario==='staging'?'staging-records':sandbox?'sandbox-logs':'customer-logs';
   // Status writes are queued in order but not awaited before the model call; they finish
   // while the model plans, and are awaited (errors included) before the run moves on.
   const pending:Promise<unknown>[]=[];const queue=(write:Promise<unknown>)=>{write.catch(()=>undefined);pending.push(write);};
   const created=run(service=>service.store.atomic(()=>{if(service.demo().demoRunId!==demoRunId)throw Object.assign(new Error('Demo changed; retry the task'),{status:409});const session=service.session({tenantId:res.locals.principal.tenantId,role:res.locals.principal.role},res.locals.principal.userId,runId,res.locals.principal.department);service.store.put('run',{id:runId,comparisonId,demoRunId,sessionId:session.id,task,scenario,mode,department:res.locals.principal.department??null,...(hint?{hint}:{}),...(mode==='governed'?{memoryMode:memory}:{}),responseMode:isSocialMessage(task)?'reply':'plan',plan:[],planner:planner==='eve'?'live eve model':'deterministic fixture; no live model',createdAt:service.clock(),status:'PREPARING',executionIds:[]});service.emit('run.created',{runId,sessionId:session.id,mode,planner});return {session,record:service.store.get('run',runId)!};}));
   // A greeting needs nothing from the database, so its model call starts while the run is
   // being recorded; the worker session id is recorded once the run exists.
   let earlyWorkerSession:string|undefined;
   const early=isSocialMessage(task)&&planner==='eve'?planWithEve(task,resource,sandbox?'sandbox':'production',null,{runId,transport:plannerTransport,onSession:async id=>{earlyWorkerSession=id;}}):undefined;early?.catch(()=>undefined);
   const s=await created;res.locals.principal.sessions.add(s.session.id);
   accepted(s.record);const sessionId=s.session.id;
   let phase='retrieval';const started=performance.now();
   const update=async(status:string,fields:Record<string,unknown>={})=>run(service=>{service.requireCurrentSession(sessionId);const record=service.store.get('run',runId)!;service.store.put('run',{...record,status,...fields});});
   try{
   const socialOnly=isSocialMessage(task);const withMemory=mode==='governed'&&memory==='full'&&!socialOnly;
   const retrievalStarted=performance.now();if(withMemory)await run(service=>{service.requireCurrentSession(sessionId);const record=service.store.get('run',runId)!;service.store.put('run',{...record,status:'RETRIEVING'});service.emit('retrieval.started',{runId,sessionId});});
   const retrieved=withMemory?await retrieveForRuntime(runtime,sessionId,resource,task):null;
   // Learned playbooks: ranked outside the transaction (Agent Engine is a network
   // call), then rechecked against current scope and status before planning.
   let context:Record<string,any>|null=retrieved,playbookIds:string[]=[],knowledgeIds:string[]=[];
   if(retrieved&&scenario!=='warehouse'){const candidates=await read(service=>candidatePlaybooks(service,service.memoryScope(sessionId)));const found=await discoverPlaybooks(task,candidates,res.locals.principal.tenantId,playbookRanker);
    const valid=await read(service=>new Set(candidatePlaybooks(service,service.memoryScope(sessionId)).map(p=>p.id)));const chosen=found.playbooks.filter(p=>valid.has(p.id));playbookIds=chosen.map(p=>p.id);
    context={...retrieved,playbooks:chosen.map(playbookContext),playbookRetrieval:{engine:found.engine,degraded:found.degraded,candidates:candidates.length}};}
   // Agent memory for warehouse questions: filtered to this tenant and department before
   // ranking, ranked outside the transaction, then rechecked before planning.
   if(retrieved&&scenario==='warehouse'){const department=res.locals.principal.department;const entries=await read(service=>departmentKnowledge(service,res.locals.principal.tenantId,department));const ranked=await rankKnowledge(task,entries);
    const valid=await read(service=>new Set(departmentKnowledge(service,res.locals.principal.tenantId,department).map(k=>k.id)));const chosen=ranked.entries.filter(k=>valid.has(k.id));knowledgeIds=chosen.map(k=>k.id);
    context={...retrieved,knowledge:chosen.map(k=>knowledgeContext(k,ranked.engine)),knowledgeRetrieval:{engine:ranked.engine,degraded:ranked.degraded,department:department??null,available:entries.length}};}
   // The chat's own earlier turns (same user, same side, this demo), so follow-ups such as
   // "can you read that data" resolve. Context only: every proposed step is still checked.
   const recentTurns=previousRunIds?.length?await read(service=>previousRunIds.map(id=>service.store.get('run',id)).filter((r):r is Record<string,any>=>Boolean(r&&r.id!==runId&&r.mode===mode&&r.demoRunId===demoRunId&&(res.locals.principal.sessions.has(r.sessionId)||(Boolean(res.locals.principal.userId)&&service.store.get('session',r.sessionId)?.principalId===res.locals.principal.userId)))).slice(-3).map(r=>({user:String(r.task).slice(0,500),scope:r.scenario,agentReply:String(r.reply??'').slice(0,500)||null,
    toolResults:(r.executionIds??[]).map((e:string)=>service.store.get('execution',e)).filter(Boolean).map((e:any)=>({toolId:e.action.toolId,target:e.action.target??null,status:e.status,result:String(service.store.get('receipt',e.receiptId??'')?.result??'').slice(0,300)||null}))}))):[];
   phase='planning';const planningStarted=performance.now();
   queue(run(service=>{service.requireCurrentSession(sessionId);const record=service.store.get('run',runId)!;service.store.put('run',{...record,status:'PLANNING',context,playbookIds,knowledgeIds});service.emit(context?'context.retrieved':'context.omitted',{runId,sessionId,context,durationMs:performance.now()-retrievalStarted});service.emit('planning.started',{runId,sessionId,planner,companyContextSupplied:Boolean(context)});}));
   let steps:readonly ToolId[]=scenario==='warehouse'?['warehouse.query']:scenario==='staging'?['staging_db.read']:sandbox?[scenario==='sandbox-export'?'demo_export.send':'example_connector.analyze']:mode==='baseline'?['example_connector.analyze']:['example_connector.analyze','internal_logs.search'];
   // Fixture planning: the hinted table, else approved agent memory, else the first catalogued table.
   let targets:(string|undefined)[]=scenario==='warehouse'?[hint?.table??context?.knowledge?.[0]?.table??tableNames[0]]:[];
   const structuredPlan=early?await early.then(plan=>{const workerSessionId=earlyWorkerSession;if(workerSessionId)queue(run(service=>{service.requireCurrentSession(sessionId);const record=service.store.get('run',runId)!;service.store.put('run',{...record,workerSessionId});service.emit('worker.session.created',{runId,sessionId,workerSessionId});}));return plan;}):planner==='eve'?await planWithEve(task,resource,sandbox?'sandbox':'production',context,{runId,transport:plannerTransport,recentTurns,warehouse:scenario==='warehouse'?{availableTables:tableNames,tableHint:hint?{table:hint.table,definitions:hint.definitions??null}:null}:undefined,onSession:async workerSessionId=>{queue(run(service=>{service.requireCurrentSession(sessionId);const record=service.store.get('run',runId)!;service.store.put('run',{...record,workerSessionId});service.emit('worker.session.created',{runId,sessionId,workerSessionId});}));}}):socialOnly?{goal:'Respond to a greeting',reply:'Hello! What would you like help with?',steps:[]}:null;
   await Promise.all(pending);
   if(structuredPlan){steps=structuredPlan.steps.map(step=>step.toolId);targets=structuredPlan.steps.map(step=>step.target);}
   const usage=structuredPlan&&'usage' in structuredPlan?structuredPlan.usage:null;const metrics={inputTokens:usage?.inputTokens??null,outputTokens:usage?.outputTokens??null,modelCalls:usage?.modelCalls??null,planningMs:performance.now()-planningStarted};
   // A tool-free reply is completed atomically with its audit events. It never
   // enters EXECUTING or waits on execution-memory writes with no evidence.
   if(!steps.length){
    const record=await run(service=>{service.requireCurrentSession(sessionId);const original=service.store.get('run',runId)!;const completed={...original,status:'FINISHED',responseMode:'reply',metrics,structuredPlan,reply:structuredPlan?.reply??'',plan:[],durationMs:performance.now()-started};service.store.put('run',completed);service.emit('plan.created',{runId,sessionId,steps:[],durationMs:performance.now()-planningStarted});service.emit('reply.recorded',{runId,sessionId,actionCount:0});service.emit('run.completed',{runId,sessionId,status:'FINISHED',durationMs:completed.durationMs});return completed;});
    return {...record,memoryEpisodeId:null,executions:[]};
   }
   await run(service=>{service.requireCurrentSession(sessionId);const record=service.store.get('run',runId)!;service.store.put('run',{...record,status:'EXECUTING',metrics,structuredPlan,reply:structuredPlan?.reply??'',plan:steps});service.emit('plan.created',{runId,sessionId,steps,durationMs:performance.now()-planningStarted});});phase='execution';
   const executions:Awaited<ReturnType<typeof execute>>[]=[];// A table applies only to warehouse.query; a malformed model value becomes "no table",
   // which the gate blocks (DATA-30) instead of failing the whole run.
   for(const [index,toolId] of steps.entries()){const target=toolId==='warehouse.query'&&typeof targets[index]==='string'&&tableNamePattern.test(targets[index]!)?targets[index]:undefined;const action=await read(service=>service.action(sessionId,toolId,resource,sandbox?'sandbox':'production',target));const execution=await execute(action,randomUUID(),mode==='baseline');executions.push(execution);}
   // One transaction records the execution ids, the reply event, the run-outcome memory
   // and completion; the screen already shows each execution as it is recorded.
   phase='memory';const {record,memoryEpisodeId}=await run(service=>{service.requireCurrentSession(sessionId);service.store.put('run',{...service.store.get('run',runId)!,executionIds:executions.map(execution=>execution.id)});if(structuredPlan?.reply)service.emit('reply.recorded',{runId,sessionId,actionCount:steps.length});const memoryEpisodeId=mode==='governed'?service.saveRunOutcome(runId):null;const record=service.store.get('run',runId)!;const status=record.status==='EXECUTING'?(executions.some(e=>e.status==='UNKNOWN')?'UNKNOWN':executions.some(e=>e.status==='PENDING'||e.status==='DISPATCHING')?'WAITING':'FINISHED'):record.status;const completed={...record,status,durationMs:performance.now()-started};service.store.put('run',completed);service.emit(status==='WAITING'?'run.waiting':status==='UNKNOWN'?'run.unknown':'run.completed',{runId,sessionId:sessionId,status,durationMs:completed.durationMs});return {record:completed,memoryEpisodeId};});
   if(mode==='governed'&&record.status==='FINISHED')await savePlaybook(runId);
   // Agent learning: a hinted answer becomes a memory proposal, checkpointed immediately.
   // Nothing is stored until the user approves it. A separate transaction; never alters the run.
   if(mode==='governed'&&scenario==='warehouse'&&hint&&record.status==='FINISHED')await run(service=>service.store.atomic(()=>proposeFromRun(service,runId,hint))).catch(()=>undefined);
   return {...record,memoryEpisodeId,executions};
   }catch(error){const status=(error as {status?:number}).status;await run(service=>{const record=service.store.get('run',runId)!;service.store.put('run',{...record,status:'FAILED',failedPhase:phase,durationMs:performance.now()-started});service.emit('run.failed',{runId,sessionId:sessionId,phase,reasonCode:status===409?'STALE_CONTEXT_OR_DEMO':'STAGE_FAILED'});});try{applicationMonitor?.captureError(new Error('Precedent comparison failed during '+phase));}catch{/* Optional monitoring cannot change recorded failure or authorization. */}if(status===409)throw error;throw Object.assign(new Error('Comparison failed during '+phase+'; inspect the recorded run and verify configured services'),{status:502});}
   };const job=telemetry?telemetry.run({runId,mode,demoRunId},perform):perform();
   if(telemetry)void job.then(record=>telemetry.trackRun({runId,mode,scenario,status:record.status,executions:record.executions??[]}),()=>telemetry.trackRun({runId,mode,scenario,status:'FAILED',executions:[]}));
   void job.catch(rejected);return job;
  });
  // Observe every job even after the HTTP caller disconnects. Errors are also
  // recorded on each run; asynchronous acceptance never reports completion.
  const completion=Promise.allSettled(jobs);
  const ready=Promise.all(starts);
  if(req.get('Prefer')?.split(',').some(value=>value.trim()==='respond-async')){
   res.setHeader('Preference-Applied','respond-async');res.status(202).json({comparisonId,runs:await ready});return;
  }
  await ready;const results=await completion;const failed=results.find(result=>result.status==='rejected');if(failed?.status==='rejected')throw failed.reason;res.json({runs:results.map(result=>(result as PromiseFulfilledResult<unknown>).value)});
 });
 app.get('/api/events',async(req,res)=>{
  res.setHeader('Content-Type','text/event-stream');res.setHeader('Cache-Control','no-cache');res.flushHeaders();const raw=req.headers['last-event-id'];let cursor=typeof raw==='string'&&/^\d+$/.test(raw)?Number(raw):0,reading=false,closed=false;
  let timer:ReturnType<typeof setInterval>|undefined,heartbeat:ReturnType<typeof setInterval>|undefined;
  // Register cleanup before the first database await: disconnects during that
  // read must not leave a background polling loop behind.
  const close=()=>{closed=true;clearInterval(timer);clearInterval(heartbeat);};
  req.on('close',close);res.on('close',close);
  // Poll the database only after this server commits a write, or every 5 s for outside writers.
  let seen:number|undefined,lastRead=0;
  const flush=async()=>{if(reading||closed)return;if(runtime.writes!==undefined&&seen===runtime.writes&&Date.now()-lastRead<5000)return;reading=true;seen=runtime.writes;lastRead=Date.now();try{if(identity){const user=await identity.resolve(req);if(!user||user.role!==res.locals.principal.role){res.end();return;}}
   const events=runtime.readEvents?await runtime.readEvents(cursor):await run(s=>s.store.all('event').slice(cursor));
   if(events.length>=200)seen=undefined;
   for(const event of events){if(closed)break;cursor++;res.write(contextVisible(event.context,res.locals.principal)?`id: ${cursor}\ndata: ${JSON.stringify({...event,sequence:cursor})}\n\n`:`id: ${cursor}\n\n`);}
  }catch{if(!closed)res.end();}finally{reading=false;}};
  await flush();if(closed)return;
  timer=setInterval(()=>void flush(),runtime.writes===undefined?1000:200);heartbeat=setInterval(()=>{if(!closed)res.write(': keepalive\n\n');},15000);
 });
 app.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{const e=error as Error&{status?:number};res.status(e.status??400).json({error:e.name?.startsWith('Mongo')?'Database operation failed; verify server configuration':e.message});});return app;
}
