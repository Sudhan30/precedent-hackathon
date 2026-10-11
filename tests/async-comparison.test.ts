import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {Precedent} from '../apps/server/service.js';
import {openStore} from '../apps/server/store.js';
import {LocalRuntime} from '../apps/server/runtime.js';
import {createApp} from '../apps/server/api.js';
import {ExecutionGateway} from '../packages/execution/index.js';

test('independent chat requests create only the selected side and retain policy enforcement',async()=>{
 const service=new Precedent(openStore(':memory:'));
 const server=createApp(service).listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
 const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api`;
 try{
  const {token}=await(await fetch(base+'/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role:'employee'})})).json();
  const headers={'Content-Type':'application/json',Authorization:'Bearer '+token};
  const send=(target:string,task:string)=>fetch(base+'/comparison',{method:'POST',headers,body:JSON.stringify({target,task,scenario:'investigation',planner:'fixture'})});
  const governed=await send('governed','Governed prompt');assert.equal(governed.status,200);const first=await governed.json();assert.equal(first.runs.length,1);assert.equal(first.runs[0].mode,'governed');assert.equal(first.runs[0].task,'Governed prompt');
  assert.equal(first.runs[0].executions[0].status,'BLOCKED');assert.equal(first.runs[0].executions[0].receiptId,null);assert.equal(service.store.all('run').length,1);
  const baseline=await send('baseline','Different baseline prompt');assert.equal(baseline.status,200);const second=await baseline.json();assert.equal(second.runs.length,1);assert.equal(second.runs[0].mode,'baseline');assert.equal(second.runs[0].task,'Different baseline prompt');assert.equal(second.runs[0].executions[0].status,'SUCCEEDED');
  assert.equal(service.store.all('run').length,2);assert.equal(service.store.get('run',first.runs[0].id)?.task,'Governed prompt');
  assert.equal((await send('invalid','Invalid target')).status,400);assert.equal((await send('governed','   ')).status,400);assert.equal(service.store.all('run').length,2);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));service.store.close();}
});

test('async comparison accepts persisted runs before held dispatch and reports eventual receipts',async()=>{
 const service=new Precedent(openStore(':memory:'));
 let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
 const gateway=new ExecutionGateway(service,{async execute(){await held;return {result:'controlled async test'};},async receipts(){return [];}});
 const server=createApp(service,gateway).listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
 const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api`;
 try{
  const {token}=await(await fetch(base+'/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role:'employee'})})).json();
  const headers={'Content-Type':'application/json',Authorization:'Bearer '+token};
  const response=await fetch(base+'/comparison',{method:'POST',headers:{...headers,Prefer:'respond-async'},body:JSON.stringify({task:'Inspect checkout',scenario:'investigation',planner:'fixture'}),signal:AbortSignal.timeout(2000)});
  assert.equal(response.status,202);assert.equal(response.headers.get('Preference-Applied'),'respond-async');
  const accepted=await response.json();assert.equal(accepted.runs.length,2);
  assert.ok(accepted.runs.every((run:any)=>run.comparisonId===accepted.comparisonId&&run.status==='PREPARING'&&run.plan.length===0));
  assert.equal(service.store.all('run').length,2);assert.equal(service.store.all('receipt').length,0);
  release();
  for(let attempt=0;attempt<100&&!service.store.all('run').every(run=>run.status==='FINISHED');attempt++)await delay(10);
  const state=await(await fetch(base+'/state',{headers})).json();
  assert.ok(state.runs.every((run:any)=>run.status==='FINISHED'));
  assert.equal(state.executions.filter((execution:any)=>execution.status==='BLOCKED').length,1);
  assert.equal(state.receipts.length,2);
  for(const execution of state.executions)assert.equal(state.receipts.filter((receipt:any)=>receipt.executionId===execution.id).length,execution.status==='SUCCEEDED'?1:0);
 }finally{release();await new Promise<void>(resolve=>server.close(()=>resolve()));service.store.close();}
});

test('event-stream disconnect during initial read leaves no background polling loop',async()=>{
 const service=new Precedent(openStore(':memory:'));let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});let reads=0;
 class HeldEvents extends LocalRuntime{override async readEvents(cursor:number){reads++;await held;return super.readEvents(cursor);}}
 const server=createApp(new HeldEvents(service)).listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
 const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api`;
 const controller=new AbortController();
 try{
  const {token}=await(await fetch(base+'/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role:'employee'})})).json();
  const response=await fetch(base+'/events',{headers:{Authorization:'Bearer '+token},signal:controller.signal});assert.equal(response.status,200);assert.equal(reads,1);
  controller.abort();await delay(30);release();await delay(1200);assert.equal(reads,1);
 }finally{controller.abort();release();await new Promise<void>(resolve=>server.close(()=>resolve()));service.store.close();}
});

test('backend recovery reports interrupted comparisons without replaying actions or closing approval waits',async()=>{
 const service=new Precedent(openStore(':memory:'));let dispatches=0;
 const gateway=new ExecutionGateway(service,{async execute(){dispatches++;return {};},async receipts(){return [];}});
 try{
  const session=service.session();
  for(const status of ['PREPARING','RETRIEVING','PLANNING','EXECUTING','WAITING','FINISHED'])service.store.put('run',{id:status,sessionId:session.id,status});
  await gateway.recover();
  for(const id of ['PREPARING','RETRIEVING','PLANNING','EXECUTING'])assert.equal(service.store.get('run',id).status,'FAILED');
  assert.equal(service.store.get('run','WAITING').status,'WAITING');assert.equal(service.store.get('run','FINISHED').status,'FINISHED');
  assert.equal(dispatches,0);assert.equal(service.store.all('receipt').length,0);
  assert.equal(service.store.all('event').filter(event=>event.type==='run.failed').length,4);
 }finally{service.store.close();}
});
