import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../apps/server/api.js';
import {Precedent} from '../apps/server/service.js';
import {openStore} from '../apps/server/store.js';

const endpoint='https://docs.example.com/mcp';
async function harness(){
 const store=openStore(':memory:');let now=Date.now();const service=new Precedent(store,()=>now);const calls:string[]=[];
 const server=createApp(service,undefined,undefined,undefined,undefined,undefined,async url=>{calls.push(url);return {status:'CONNECTED',tools:['search-docs'],message:'Test discovery; no tool executed.'};}).listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
 const url=`http://127.0.0.1:${(server.address() as any).port}/api`;
 const call=async(path:string,body?:unknown,token?:string)=>{const response=await fetch(url+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,data:await response.json() as any};};
 const employee=(await call('/login',{role:'employee'})).data.token,admin=(await call('/login',{role:'admin'})).data.token;
 const start=async(name='Docs Preview')=>(await call('/mcp/comparison',{task:`Connect with ${name} MCP`,target:'governed'},employee)).data.runs[0];
 // One governed request, reviewed once by an administrator, then resumed by its owner.
 const approveOnce=async(allow=true)=>{
  const run=await start(),id=run.mcpResult.requestId;
  assert.equal((await call('/mcp/requests/'+id+'/submit',{name:'Docs Preview',endpoint,purpose:'Read developer documentation'},employee)).status,200);
  assert.equal((await call('/mcp/requests/'+id+'/review',{allow,scope:'once',expectedVersion:service.policy().version,reason:'Routine documentation access',ttlSeconds:30},admin)).status,200);
  if(allow)assert.equal((await call('/mcp/requests/'+id+'/resume',{},employee)).data.mcpResult.status,'CONNECTED');
  return id;
 };
 const drafts=()=>store.all('proposal').filter((p:any)=>p.status==='DRAFT'&&p.scope.kind==='mcp');
 return {store,service,calls,call,employee,admin,start,approveOnce,drafts,close:async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();}};
}

test('repeated one-use MCP approvals produce a self-written draft only at the threshold',async()=>{
 const h=await harness();try{
  await h.approveOnce(false);// a denial is never evidence
  await h.approveOnce();await h.approveOnce();assert.equal(h.drafts().length,0);
  const third=await h.approveOnce();const [draft]=h.drafts();
  assert.ok(draft,'third approval drafts a rule automatically');assert.equal(draft.count,3);assert.ok(draft.evidenceIds.includes(third));
  assert.deepEqual(draft.scope,{kind:'mcp',key:'docs-preview',name:'Docs Preview',endpoint,allowed:true});
  assert.equal(h.service.policy().mcpConnections?.length??0,0,'drafting never changes policy');
 }finally{await h.close();}
});

test('impact preview replays recorded decisions without side effects and proves what stays blocked',async()=>{
 const h=await harness();try{
  const session=(await h.call('/sessions',{},h.employee)).data;
  assert.equal((await h.call('/actions',{sessionId:session.id,executionId:'restricted',toolId:'example_connector.analyze',resourceId:'customer-logs',environment:'production'},h.employee)).data.status,'BLOCKED');
  for(let i=0;i<3;i++)await h.approveOnce();
  const [draft]=h.drafts();const before={events:h.store.all('event').length,policy:h.service.policy().version,calls:h.calls.length};
  assert.equal((await h.call('/proposals/'+draft.id+'/impact',undefined,h.employee)).status,403);
  const impact=(await h.call('/proposals/'+draft.id+'/impact',undefined,h.admin)).data;
  assert.equal(impact.changedCount,3);assert.ok(impact.changed.every((row:any)=>row.kind==='mcp'&&row.from==='REQUIRE_APPROVAL'&&row.to==='ALLOW'));
  assert.equal(impact.newlyRestricted,0);assert.ok(impact.total>=4);assert.equal(impact.sideEffects,0);
  assert.ok(impact.stillBlocked.some((group:any)=>group.ruleId==='DATA-18'&&group.count===1));
  assert.ok(impact.safetyChecks.length>=3&&impact.safetyChecks.every((check:any)=>check.pass));
  assert.deepEqual({events:h.store.all('event').length,policy:h.service.policy().version,calls:h.calls.length},before);
 }finally{await h.close();}
});

test('publishing a self-written rule is version-checked; afterwards only that exact MCP connects without review',async()=>{
 const h=await harness();try{
  for(let i=0;i<3;i++)await h.approveOnce();const [draft]=h.drafts();
  assert.equal((await h.call('/proposals/'+draft.id+'/publish',{expectedVersion:draft.baseVersion},h.employee)).status,403);
  assert.equal((await h.call('/proposals/'+draft.id+'/publish',{expectedVersion:draft.baseVersion+1},h.admin)).status,409);
  const published=(await h.call('/proposals/'+draft.id+'/publish',{expectedVersion:draft.baseVersion},h.admin)).data;
  assert.equal(published.status,'PUBLISHED');assert.equal(h.service.policy().version,draft.baseVersion+1);
  assert.deepEqual(h.service.policy().mcpConnections,[{key:'docs-preview',name:'Docs Preview',endpoint,allowed:true}]);
  const calls=h.calls.length;const next=await h.start();
  assert.equal(next.mcpResult.status,'CONNECTED');assert.equal(next.mcpResult.decision.verdict,'ALLOW');assert.equal(h.calls.length,calls+1);
  const other=await h.start('Prometheus');assert.equal(other.mcpResult.status,'CONFIGURATION_REQUIRED');assert.equal(h.calls.length,calls+1);
  assert.equal((await h.call('/proposals/'+draft.id+'/publish',{expectedVersion:h.service.policy().version},h.admin)).status,400);
 }finally{await h.close();}
});

test('a company-wide MCP decision keeps the self-written draft current: it is re-drafted on the new policy version',async()=>{
 const h=await harness();try{
  await h.approveOnce();await h.approveOnce();await h.approveOnce();
  assert.equal(h.drafts().filter((d:any)=>d.baseVersion===h.service.policy().version).length,1);
  const run=await h.start('Linear');const id=run.mcpResult.requestId;
  await h.call('/mcp/requests/'+id+'/submit',{name:'Linear',endpoint:'https://mcp.linear.app/mcp',purpose:'Issue tracker'},h.employee);
  assert.equal((await h.call('/mcp/requests/'+id+'/review',{allow:true,scope:'company',expectedVersion:h.service.policy().version,reason:'Wanted by many',ttlSeconds:30},h.admin)).status,200);
  assert.equal(h.drafts().filter((d:any)=>d.baseVersion===h.service.policy().version).length,1,'draft re-based on the new policy version');
 }finally{await h.close();}
});
