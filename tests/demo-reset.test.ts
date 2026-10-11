import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../apps/server/api.js';
import {Precedent} from '../apps/server/service.js';
import {openStore} from '../apps/server/store.js';

test('an administrator resets the demo from the UI: fresh namespace, then the same starting history as demo:prepare',async()=>{
 const previous=process.env.ALLOW_FIXTURE_PLANNER;process.env.ALLOW_FIXTURE_PLANNER='true';
 const store=openStore(':memory:');const service=new Precedent(store);
 const server=createApp(service,undefined,undefined,undefined,undefined,undefined,async()=>({status:'CONNECTED',tools:['search-docs'],message:'Test discovery; no tool executed.'})).listen(0,'127.0.0.1');
 await new Promise<void>(resolve=>server.once('listening',resolve));const url=`http://127.0.0.1:${(server.address() as any).port}/api/`;
 const call=async(path:string,token:string,body?:unknown)=>{const r=await fetch(url+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,data:await r.json() as any};};
 try{
  const login=async(role:string)=>(await (await fetch(url+'login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role})})).json() as any).token;
  const admin=await login('admin'),employee=await login('employee');
  const before=service.demo().demoRunId;
  assert.equal((await call('demo/prepare',employee,{})).status,403,'employees cannot reset the demo');
  const started=await call('demo/prepare',admin,{});assert.equal(started.status,202);assert.equal(started.data.status,'RUNNING');
  assert.equal((await call('demo/prepare',admin,{})).status,409,'one reset at a time');
  let job=started.data;for(let i=0;i<200&&job.status==='RUNNING';i++){await new Promise(resolve=>setTimeout(resolve,50));job=(await call('demo/prepare',admin)).data;}
  assert.equal(job.status,'DONE',job.error);
  assert.notEqual(service.demo().demoRunId,before,'a new demo namespace');
  assert.deepEqual(job.checks.map((c:any)=>c.ok),[true,true,true],JSON.stringify(job.checks));
  assert.match(job.steps[0],/fresh demo namespace/);assert.ok(job.steps.some((s:string)=>/approval 3 of 3/.test(s)));
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();if(previous===undefined)delete process.env.ALLOW_FIXTURE_PLANNER;else process.env.ALLOW_FIXTURE_PLANNER=previous;}
});
