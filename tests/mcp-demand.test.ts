import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createApp} from '../apps/server/api.js';
import {Precedent} from '../apps/server/service.js';
import {openStore} from '../apps/server/store.js';
import {recordDemand,demandFor} from '../packages/mcp/demand.js';

test('demand counts distinct people per MCP: asking again never bumps, a new person adds one',()=>{
 const service=new Precedent(openStore(':memory:'));const demoRunId=service.demo().demoRunId;
 const request=(requesterId:string,name='Sentry')=>({id:randomUUID(),runId:randomUUID(),sessionId:randomUUID(),demoRunId,tenantId:'acme-demo',requesterId,name,endpoint:'https://mcp.sentry.dev/mcp',purpose:'x',policyVersion:1,status:'PENDING' as const,createdAt:1});
 assert.equal(recordDemand(service,request('alice')).demand.count,1);
 const again=recordDemand(service,request('alice'));assert.deepEqual([again.demand.count,again.bumped,again.demand.requestIds.length],[1,false,2],'same person twice: no bump');
 assert.equal(recordDemand(service,request('bob')).demand.count,2);
 assert.equal(recordDemand(service,request('carol')).demand.count,3);
 assert.equal(recordDemand(service,request('alice','Linear')).demand.count,1,'each MCP has its own counter');
 assert.equal(demandFor(service,{demoRunId,tenantId:'acme-demo',name:'sentry mcp'})?.count,3,'name variants share one key');
});

test('submitting a request records demand; blocked search MCPs are not counted; employees never see who asked',async()=>{
 const store=openStore(':memory:');const service=new Precedent(store);
 const classify=async(input:any)=>({searchRelated:/search/i.test(JSON.stringify(input)),reason:'test',judge:'test judge',checkedAt:1});
 const server=createApp(service,undefined,undefined,undefined,undefined,undefined,async()=>({status:'CONNECTED',tools:[],message:'test'}),undefined,classify).listen(0,'127.0.0.1');
 await new Promise<void>(resolve=>server.once('listening',resolve));const url=`http://127.0.0.1:${(server.address() as any).port}/api`;
 const call=async(path:string,token:string,body?:unknown)=>{const r=await fetch(url+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},...(body===undefined?{}:{body:JSON.stringify(body)})});return await r.json() as any;};
 const login=async(role:string)=>(await (await fetch(url+'/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role})})).json() as any).token;
 try{
  const employee=await login('employee'),admin=await login('admin');
  const ask=async(task:string,endpoint:string)=>{const run=(await call('/mcp/comparison',employee,{task,target:'governed'})).runs[0];return call('/mcp/requests/'+run.mcpResult.requestId+'/submit',employee,{name:run.mcpResult.name,endpoint,purpose:'Investigate production errors'});};
  await ask('https://mcp.sentry.dev/mcp','https://mcp.sentry.dev/mcp');await ask('Connect Sentry MCP','https://mcp.sentry.dev/mcp');
  await ask('Connect Linear MCP','https://mcp.linear.app/mcp');
  await call('/mcp/comparison',employee,{task:'Install Parallel Search MCP',target:'governed'});
  const demand=store.all('mcp_demand');
  assert.deepEqual(demand.map((d:any)=>[d.key,d.count,d.requestIds.length]).sort(),[['linear',1,1],['sentry',1,2]],'same person twice counts once; MCP-03 blocks are not counted');
  const seen=(await call('/state',employee)).mcpDemand;assert.equal(seen.length,2);assert.ok(seen.every((d:any)=>d.requesterIds.length===0),'employees see counts, not people');
  assert.ok((await call('/state',admin)).mcpDemand.every((d:any)=>d.requesterIds.length===1));
  // A company-wide approval answers everyone waiting on the same MCP and endpoint.
  const [first,second]=store.all('mcp_request').filter((r:any)=>r.name==='Sentry'&&r.status==='PENDING');
  await call('/mcp/requests/'+first.id+'/review',admin,{allow:true,scope:'company',expectedVersion:service.policy().version,reason:'Wanted by several teams',ttlSeconds:30});
  assert.deepEqual([store.get('mcp_request',first.id).status,store.get('mcp_request',second.id).status,store.get('mcp_request',second.id).scope],['APPROVED','APPROVED','company']);
  assert.equal((await call('/mcp/requests/'+second.id+'/resume',employee,{})).mcpResult.status,'CONNECTED');
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();}
});
