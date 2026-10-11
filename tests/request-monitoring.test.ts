import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createApp} from '../apps/server/api.js';
import {Precedent} from '../apps/server/service.js';
import {openStore} from '../apps/server/store.js';
import type {ApplicationMonitor} from '../packages/observability/modelence.js';

test('request monitoring records measured route templates once and excludes request secrets',async()=>{
 const completed:Record<string,any>[]=[],errors:Error[]=[];
 const monitor:ApplicationMonitor={startTransaction(type,name,context){return {end(result,fields){completed.push({type,name,initial:context,result,...fields});}};},captureError(error){errors.push(error);}};
 const service=new Precedent(openStore(':memory:'));
 const server=createApp(service,undefined,undefined,undefined,monitor).listen(0,'127.0.0.1');await once(server,'listening');
 const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api`;
 const secret='REQUEST-SECRET-DO-NOT-EXPORT';
 try{
  const {token}=await(await fetch(base+'/login?key='+secret,{method:'POST',headers:{'Content-Type':'application/json',Authorization:secret},body:JSON.stringify({role:'employee'})})).json();
  const session=await(await fetch(base+'/sessions',{method:'POST',headers:{Authorization:'Bearer '+token}})).json();
  const response=await fetch(base+'/sessions/'+session.id+'/heartbeat?task='+secret,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:'{}'});assert.equal(response.status,200);await response.arrayBuffer();
  await new Promise(resolve=>setImmediate(resolve));
  const records=completed.filter(x=>x.context.route==='/api/sessions/:id/heartbeat');assert.equal(records.length,1);
  assert.equal(records[0].context.status,200);assert.ok(records[0].context.durationMs>=0);assert.equal(records[0].context.disconnected,false);
  assert.equal(errors.length,0);assert.ok(!JSON.stringify(completed).includes(secret));assert.ok(!JSON.stringify(completed).includes(token));assert.ok(!JSON.stringify(completed).includes(session.id));
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));service.store.close();}
});

test('server failures capture a sanitized error and exporter failures preserve responses',async()=>{
 for(const throws of [false,true]){
  const errors:Error[]=[],ends:Record<string,any>[]=[];
  const monitor:ApplicationMonitor={startTransaction(){if(throws)throw new Error('sink unavailable');return {end(result,context){ends.push({result,...context});}};},captureError(error){errors.push(error);if(throws)throw new Error('sink unavailable');}};
  const service=new Precedent(openStore(':memory:'));
  const server=createApp(service,undefined,{async resolve(){throw Object.assign(new Error('PROVIDER-SECRET'),{status:502});}},undefined,monitor).listen(0,'127.0.0.1');await once(server,'listening');
  try{const response=await fetch(`http://127.0.0.1:${(server.address() as {port:number}).port}/api/state`);assert.equal(response.status,502);await response.arrayBuffer();assert.equal(errors.length,1);assert.equal(errors[0].message,'Precedent API request failed');assert.ok(!errors[0].stack?.includes('PROVIDER-SECRET'));if(!throws){assert.equal(ends.length,1);assert.equal(ends[0].result,'failure');}}
  finally{await new Promise<void>(resolve=>server.close(()=>resolve()));service.store.close();}
 }
});

test('disconnect ends long-lived event monitoring once without treating it as a server failure',async()=>{
 const completed:Record<string,any>[]=[],errors:Error[]=[];
 const monitor:ApplicationMonitor={startTransaction(){return {end(result,context){completed.push({result,...context});}};},captureError(error){errors.push(error);}};
 const service=new Precedent(openStore(':memory:')),server=createApp(service,undefined,undefined,undefined,monitor).listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api`;
 try{const {token}=await(await fetch(base+'/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role:'employee'})})).json();const abort=new AbortController();await fetch(base+'/events',{headers:{Authorization:'Bearer '+token},signal:abort.signal});abort.abort();
  for(let i=0;i<50&&!completed.some(x=>x.context.route==='/api/events');i++)await new Promise(resolve=>setTimeout(resolve,10));
  const events=completed.filter(x=>x.context.route==='/api/events');assert.equal(events.length,1);assert.equal(events[0].result,'disconnected');assert.equal(events[0].context.disconnected,true);assert.equal(errors.length,0);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));service.store.close();}
});

test('accepted asynchronous comparisons report later failures without exporting task content',async()=>{
 const prior=process.env.EVE_WORKER_URL;process.env.EVE_WORKER_URL='';
 const errors:Error[]=[];const monitor:ApplicationMonitor={startTransaction(){return {end(){}};},captureError(error){errors.push(error);throw new Error('broken optional sink');}};
 const service=new Precedent(openStore(':memory:')),server=createApp(service,undefined,undefined,undefined,monitor).listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api`;
 try{const {token}=await(await fetch(base+'/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role:'employee'})})).json();const headers={'Content-Type':'application/json',Authorization:'Bearer '+token,Prefer:'respond-async'};
  const response=await fetch(base+'/comparison',{method:'POST',headers,body:JSON.stringify({task:'TASK-CONTENT-MUST-NOT-EXPORT',scenario:'investigation',planner:'eve'})});assert.equal(response.status,202);await response.arrayBuffer();
  for(let i=0;i<50&&errors.length<2;i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(errors.length,2);assert.ok(errors.every(error=>error.message==='Precedent comparison failed during planning'));assert.ok(errors.every(error=>!error.stack?.includes('TASK-CONTENT')));assert.equal(service.store.all('run').filter(run=>run.status==='FAILED').length,2);assert.equal(service.store.all('receipt').length,0);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));service.store.close();if(prior===undefined)delete process.env.EVE_WORKER_URL;else process.env.EVE_WORKER_URL=prior;}
});
