import {test} from 'node:test';
import assert from 'node:assert/strict';
import {raindropCheck} from '../packages/observability/raindrop-check.js';
import {createApp} from '../apps/server/api.js';
import {Precedent} from '../apps/server/service.js';
import {openStore} from '../apps/server/store.js';

// Fake Query API: two runs recorded; run-b matched a NEGATIVE and a POSITIVE signal.
const fake=(events:Record<string,{id:string;name:string}[]>,ok=true)=>(async(url:any)=>{
 if(!ok)return new Response('down',{status:503});const u=new URL(String(url));
 if(u.pathname==='/v1/signals')return Response.json({data:[{id:'s-neg',name:'Attempted Prompt Injection',sentiment:'NEGATIVE'},{id:'s-pos',name:'User Praise',sentiment:'POSITIVE'}]});
 const convo=u.searchParams.get('convo_id')!;return Response.json({data:events[convo]?[{id:convo,signals:events[convo]}]:[]});
}) as typeof fetch;

test('Raindrop second check: verified, flagged by negative signals only, pending, unavailable, not configured',async()=>{
 assert.equal((await raindropCheck(['run-a','run-b'],'key',fake({'run-a':[],'run-b':[{id:'s-pos',name:'User Praise'}]}))).status,'VERIFIED','a positive signal is not a flag');
 const flagged=await raindropCheck(['run-a','run-b'],'key',fake({'run-a':[],'run-b':[{id:'s-neg',name:'Attempted Prompt Injection'}]}));
 assert.deepEqual([flagged.status,flagged.flagged,flagged.message],['FLAGGED',1,'Raindrop flagged 1 of 2 runs: Attempted Prompt Injection.']);
 assert.equal((await raindropCheck(['run-a','run-b'],'key',fake({'run-a':[]}))).status,'PENDING');
 assert.equal((await raindropCheck(['run-a'],'key',fake({},false))).status,'UNAVAILABLE');
 assert.equal((await raindropCheck(['run-a'],'')).status,'NOT_CONFIGURED');
});

test('publishing a self-written rule needs a verified Raindrop check, or an administrator reason that is recorded',async()=>{
 const store=openStore(':memory:');const service=new Precedent(store);let status='FLAGGED';const checked:string[][]=[];
 const check=async(runIds:string[])=>{checked.push(runIds);return {status,total:runIds.length,traced:runIds.length,flagged:status==='FLAGGED'?1:0,runs:[],message:status==='FLAGGED'?'Raindrop flagged 1 of 3 runs: Attempted Prompt Injection.':'Verified in Raindrop: 3 of 3 runs traced, 0 flagged.',checkedAt:1} as any;};
 const server=createApp(service,undefined,undefined,undefined,undefined,undefined,async()=>({status:'CONNECTED',tools:['t'],message:'test'}),undefined,async()=>({searchRelated:false,reason:'x',judge:'test',checkedAt:1}),check).listen(0,'127.0.0.1');
 await new Promise<void>(resolve=>server.once('listening',resolve));const url=`http://127.0.0.1:${(server.address() as any).port}/api`;
 const call=async(path:string,token:string,body?:unknown)=>{const r=await fetch(url+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,data:await r.json() as any};};
 const login=async(role:string)=>(await (await fetch(url+'/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role})})).json() as any).token;
 try{
  const employee=await login('employee'),admin=await login('admin');
  for(let i=0;i<3;i++){const run=(await call('/mcp/comparison',employee,{task:'Connect with Docs Preview MCP',target:'governed'})).data.runs[0];const id=run.mcpResult.requestId;
   await call('/mcp/requests/'+id+'/submit',employee,{name:'Docs Preview',endpoint:'https://developer.tenable.com/mcp',purpose:'Read developer documentation'});
   await call('/mcp/requests/'+id+'/review',admin,{allow:true,scope:'once',expectedVersion:service.policy().version,reason:'ok',ttlSeconds:30});await call('/mcp/requests/'+id+'/resume',employee,{});}
  const draft=store.all('proposal').find((p:any)=>p.status==='DRAFT'&&p.scope.kind==='mcp');assert.ok(draft);
  const seen=(await call('/proposals/'+draft.id+'/raindrop',admin)).data;assert.equal(seen.status,'FLAGGED');
  assert.deepEqual(checked.at(-1)!.sort(),draft.evidenceIds.map((id:string)=>store.get('mcp_request',id).runId).sort(),'checks the runs behind the rule');
  const held=await call('/proposals/'+draft.id+'/publish',admin,{expectedVersion:service.policy().version});
  assert.equal(held.status,409);assert.match(held.data.error,/Raindrop second check: Raindrop flagged 1 of 3 runs/);
  const published=await call('/proposals/'+draft.id+'/publish',admin,{expectedVersion:service.policy().version,override:'Reviewed the flagged run; unrelated to this MCP.'});
  assert.equal(published.status,200);
  const record=store.get('proposal',draft.id);assert.deepEqual([record.status,record.raindropCheck.status,record.publishOverride],['PUBLISHED','FLAGGED','Reviewed the flagged run; unrelated to this MCP.']);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();}
});
