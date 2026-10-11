import {test} from 'node:test';import assert from 'node:assert/strict';
import {Precedent} from '../apps/server/service.js';import {openStore} from '../apps/server/store.js';import {createApp} from '../apps/server/api.js';import {ExecutionGateway} from '../packages/execution/index.js';import {connectConnector} from '../packages/demo-tools/client.js';
test('normal application defaults to live planning and refuses scripted requests',async()=>{
 const previousFixture=process.env.ALLOW_FIXTURE_PLANNER,previousWorker=process.env.EVE_WORKER_URL;delete process.env.ALLOW_FIXTURE_PLANNER;delete process.env.EVE_WORKER_URL;
 const service=new Precedent(openStore(':memory:')),server=createApp(service).listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api`;
 try{const config=await(await fetch(base+'/config')).json();assert.equal(config.defaultPlanner,'eve');assert.equal(config.fixturePlannerAvailable,false);const {token}=await(await fetch(base+'/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role:'employee'})})).json();const headers={'Content-Type':'application/json',Authorization:'Bearer '+token};
  const snapshot=await(await fetch(base+'/state',{headers})).json();assert.equal(snapshot.planner,'live eve model');assert.equal(snapshot.livePlannerAvailable,false);
  const scripted=await fetch(base+'/comparison',{method:'POST',headers,body:JSON.stringify({task:'Investigate checkout',scenario:'investigation',planner:'fixture'})});assert.equal(scripted.status,403);assert.equal(service.store.all('run').length,0);
  const live=await fetch(base+'/comparison',{method:'POST',headers,body:JSON.stringify({task:'Investigate checkout',scenario:'investigation'})});assert.equal(live.status,502);assert.equal(service.store.all('run').length,2);assert.ok(service.store.all('run').every(run=>run.status==='FAILED'&&run.planner==='live eve model'));assert.equal(service.store.all('execution').length,0);assert.equal(service.store.all('receipt').length,0);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));service.store.close();if(previousFixture===undefined)delete process.env.ALLOW_FIXTURE_PLANNER;else process.env.ALLOW_FIXTURE_PLANNER=previousFixture;if(previousWorker===undefined)delete process.env.EVE_WORKER_URL;else process.env.EVE_WORKER_URL=previousWorker;}
});
test('run IDs correlate context, planning, gate decisions and receipts',async()=>{
 const service=new Precedent(openStore(':memory:')),connector=await connectConnector(':memory:'),gateway=new ExecutionGateway(service,connector);
 const server=createApp(service,gateway).listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api`;
 try{
  const {token}=await(await fetch(base+'/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role:'employee'})})).json();
  const response=await fetch(base+'/comparison',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({task:'Inspect checkout',scenario:'investigation'})});assert.equal(response.status,200);const {runs}=await response.json();
  for(const run of runs){const events=service.store.all('event').filter(event=>event.runId===run.id);for(const type of ['run.created','planning.started','plan.created','action.proposed','decision.recorded','execution.completed','run.completed'])assert.ok(events.some(event=>event.type===type),type);
   assert.ok(events.every(event=>event.sessionId===run.sessionId&&event.demoRunId===run.demoRunId));assert.equal(run.status,'FINISHED');assert.ok(run.executions.every((execution:any)=>execution.runId===run.id));
   for(const execution of run.executions)if(execution.receiptId)assert.equal(service.store.get('receipt',execution.receiptId).runId,run.id);
  }
  const governed=runs.find((run:any)=>run.mode==='governed'),baseline=runs.find((run:any)=>run.mode==='baseline');assert.ok(service.store.all('event').some(event=>event.runId===governed.id&&event.type==='context.retrieved'));assert.ok(service.store.all('event').some(event=>event.runId===baseline.id&&event.type==='context.omitted'));
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await connector.close();service.store.close();}
});
test('unconfigured live planning records both failed runs and never falls back to fixtures',async()=>{
 const previous=process.env.EVE_WORKER_URL;delete process.env.EVE_WORKER_URL;
 const service=new Precedent(openStore(':memory:')),server=createApp(service).listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api`;
 try{
  const {token}=await(await fetch(base+'/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role:'employee'})})).json();const response=await fetch(base+'/comparison',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({task:'Inspect checkout',scenario:'investigation',planner:'eve'})});assert.equal(response.status,502);
  const runs=service.store.all('run');assert.equal(runs.length,2);assert.ok(runs.every(run=>run.status==='FAILED'&&run.failedPhase==='planning'&&run.planner==='live eve model'));assert.equal(service.store.all('execution').length,0);assert.equal(service.store.all('receipt').length,0);assert.equal(service.store.all('event').filter(event=>event.type==='run.failed').length,2);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));service.store.close();if(previous!==undefined)process.env.EVE_WORKER_URL=previous;}
});

test('live conversational replies persist with zero actions, receipts, approvals or execution memories',async()=>{
 const service=new Precedent(openStore(':memory:')),connector=await connectConnector(':memory:'),gateway=new ExecutionGateway(service,connector);
 const transport:import('../apps/agent-worker/planner.js').PlannerTransport={async health(){return {};},async create(input){const message=JSON.parse(input.message);return {session:{state:{sessionId:'reply-'+message.runId}},response:{async result(){return {data:{goal:'Respond to the message',reply:'Hello! What would you like help with?',steps:[]}};}}};}};
 const observedStatuses:string[]=[];
 const runtime:import('../apps/server/runtime.js').DomainRuntime={mode:'test',async run(fn){const result=await fn(service);observedStatuses.push(...service.store.all('run').map(run=>run.status));return result;},async close(){}};
 const server=createApp(runtime,gateway,undefined,undefined,undefined,undefined,undefined,transport).listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api`;
 try{
  const {token}=await(await fetch(base+'/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role:'employee'})})).json();const headers={'Content-Type':'application/json',Authorization:'Bearer '+token};
  for(const task of ['hellow\nhello','What can you help me with?']){
   const response=await fetch(base+'/comparison',{method:'POST',headers,body:JSON.stringify({task,scenario:'investigation',planner:'eve'})});assert.equal(response.status,200);const {runs}=await response.json();
   assert.equal(runs.length,2);for(const run of runs){assert.equal(run.status,'FINISHED');assert.equal(run.reply,'Hello! What would you like help with?');assert.deepEqual(run.plan,[]);assert.deepEqual(run.executionIds,[]);assert.equal(service.store.get('run',run.id).reply,run.reply);assert.ok(service.store.all('event').some(event=>event.runId===run.id&&event.type==='reply.recorded'));}
  }
  for(const type of ['execution','receipt','approval','episode'] as const)assert.equal(service.store.all(type).length,0,type);
  assert.equal(service.store.all('event').filter(event=>event.type==='action.proposed').length,0);
  assert.ok(!observedStatuses.includes('EXECUTING'),'tool-free replies must never enter execution');
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await connector.close();service.store.close();}
});
