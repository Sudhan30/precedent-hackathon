import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../apps/server/api.js';
import {Precedent} from '../apps/server/service.js';
import {openStore} from '../apps/server/store.js';
test('API role enforcement, validation, comparison, policy updates and approvals',async()=>{
 const store=openStore(':memory:');const service=new Precedent(store);const server=createApp(service).listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const address=server.address() as {port:number};const url=`http://127.0.0.1:${address.port}/api`;
 const call=async(path:string,body?:unknown,token?:string)=>{const r=await fetch(url+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,data:await r.json() as any};};
 try{
 assert.equal((await call('/state')).status,401);
 const employee=(await call('/login',{role:'employee'})).data.token;const admin=(await call('/login',{role:'admin'})).data.token;
 assert.equal((await call('/policy',{expectedVersion:1,sandboxAllowed:false},employee)).status,403);
 const compare=await call('/comparison',{task:'Investigate checkout failures',scenario:'investigation'},employee);assert.equal(compare.status,200);
 const [baseline,governed]=compare.data.runs;assert.equal(baseline.executions[0].status,'SUCCEEDED');assert.equal(governed.executions[0].status,'BLOCKED');assert.equal(governed.executions[1].status,'SUCCEEDED');assert.equal(store.all('receipt').length,2);
 assert.equal((await call('/actions',{...governed.executions[0].action,executionId:'unsafe'},employee)).status,400);
 assert.equal((await call('/actions',{sessionId:governed.sessionId,toolId:'internal_logs.search',resourceId:'customer-logs',environment:'production',executionId:'foreign'},admin)).status,403);
 assert.equal((await call('/policy',{expectedVersion:1,sandboxAllowed:false},admin)).status,200);
 assert.equal((await call('/policy',{expectedVersion:1,sandboxAllowed:true},admin)).status,409);
 const sandbox=(await call('/comparison',{task:'Analyze sandbox',scenario:'sandbox'},employee)).data.runs[1];assert.equal(sandbox.executions[0].status,'BLOCKED');
 const staging=(await call('/comparison',{task:'Read staging',scenario:'staging'},employee)).data.runs[1];const id=staging.executions[0].id;
 assert.equal((await call('/resume/'+id,{},employee)).status,400);
 assert.equal((await call('/approvals/'+id,{allow:true,ttlSeconds:30},admin)).status,200);
 assert.equal(store.all('event').find(event=>event.type==='approval.granted'&&event.approvalId===id)?.runId,staging.id);
 assert.equal((await call('/resume/'+id,{},employee)).data.status,'SUCCEEDED');
 const count=store.all('receipt').length;assert.equal((await call('/resume/'+id,{},employee)).data.status,'SUCCEEDED');assert.equal(store.all('receipt').length,count);
 const current=(await call('/state',undefined,admin)).data;const resetBody={expectedVersion:current.policy.version,expectedDemoRunId:current.demo.demoRunId};
 assert.equal((await call('/demo/reset',resetBody,employee)).status,403);assert.equal((await call('/demo/reset',{...resetBody,expectedVersion:1},admin)).status,409);
 assert.equal((await call('/demo/reset',resetBody,admin)).status,200);assert.equal((await call('/demo/reset',resetBody,admin)).status,409);
 const after=(await call('/state',undefined,employee)).data;assert.equal(after.executions.length,0);assert.equal(after.auditExecutions.length,current.auditExecutions.length);assert.equal(store.all('receipt').length,count);
 assert.equal((await call('/actions',{sessionId:governed.sessionId,toolId:'internal_logs.search',resourceId:'customer-logs',environment:'production',executionId:'after-reset'},employee)).status,409);
 assert.equal((await call('/replay',{executionId:governed.executions[1].id,version:1},employee)).data.sideEffects,0);
 }finally{await new Promise<void>(r=>server.close(()=>r()));store.close();}
});
test('authenticated session ownership survives requests and role changes refresh memory scope',async()=>{
 const store=openStore(':memory:');const service=new Precedent(store);let role:'employee'|'admin'='admin';
 const server=createApp(service,undefined,{async resolve(req){const userId=req.headers.authorization==='Bearer second'?'second':'first';return {userId,tenantId:'acme-demo',role};}}).listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${(server.address() as any).port}/api`;
 const call=(path:string,body?:unknown,user='first')=>fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+user},...(body===undefined?{}:{body:JSON.stringify(body)})});
 try{const session=await(await call('/sessions',{})).json() as any;assert.equal(session.role,'admin');
 const action={sessionId:session.id,toolId:'internal_logs.search',resourceId:'customer-logs',environment:'production',executionId:crypto.randomUUID()};assert.equal((await call('/sessions/'+session.id+'/heartbeat',{},'second')).status,403);assert.equal((await call('/sessions/'+session.id+'/heartbeat',{})).status,200);assert.equal((await call('/actions',action,'second')).status,403);assert.equal((await call('/actions',action)).status,200);
 role='employee';assert.equal((await call('/me')).status,200);assert.equal(service.memoryScope(session.id).role,'employee');assert.equal((await call('/policy',{expectedVersion:1,sandboxAllowed:false})).status,403);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();}
});
test('SSE resumes after a durable sequence cursor',async()=>{
 const store=openStore(':memory:');const service=new Precedent(store);const server=createApp(service).listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const url=`http://127.0.0.1:${(server.address() as any).port}/api`;
 try{const login=await fetch(url+'/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role:'employee'})});const {token}=await login.json() as any;service.emit('test.second',{});
 const response=await fetch(url+'/events',{headers:{Authorization:`Bearer ${token}`,'Last-Event-ID':'1'}});const reader=response.body!.getReader();const {value}=await reader.read();const text=new TextDecoder().decode(value);assert.ok(text.includes('test.second'));assert.ok(!text.includes('policy.published'));assert.ok(text.includes('id: 2'));await reader.cancel();
 }finally{await new Promise<void>(r=>server.close(()=>r()));store.close();}
});
