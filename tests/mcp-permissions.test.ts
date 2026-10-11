import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../apps/server/api.js';
import {Precedent} from '../apps/server/service.js';
import {openStore} from '../apps/server/store.js';
import {evaluate} from '../packages/policy-engine/index.js';
import {mcpDecision} from '../packages/mcp/index.js';
test('MCP permissions prevent dispatch, preserve policy versions and reject employee administration',async()=>{
 const store=openStore(':memory:'),service=new Precedent(store);let calls=0;
 const server=createApp(service,undefined,undefined,undefined,undefined,async()=>{calls++;return {status:'CONNECTED',tools:['search','execute-request'],message:'Protocol test server discovery'};}).listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
 const url=`http://127.0.0.1:${(server.address() as any).port}/api`;
 const call=async(path:string,body:unknown,token?:string)=>{const r=await fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});return {status:r.status,data:await r.json() as any};};
 try{
 const employee=(await call('/login',{role:'employee'})).data.token,admin=(await call('/login',{role:'admin'})).data.token;
 const request={task:'Connect Tenable MCP',target:'governed'};
 const denied=await call('/mcp/comparison',request,employee);assert.equal(denied.data.runs[0].mcpResult.status,'BLOCKED');assert.equal(calls,0);
 const policy={expectedVersion:1,tenableAllowed:true,deniedTools:['internal_logs.search'],reason:'Review developer documentation access'};
 assert.equal((await call('/mcp/policy',policy,employee)).status,403);assert.equal((await call('/mcp/policy',policy,admin)).status,200);assert.equal((await call('/mcp/policy',policy,admin)).status,409);
 const connected=await call('/mcp/comparison',request,employee);assert.equal(calls,1);assert.equal(connected.data.runs[0].mcpResult.status,'CONNECTED');assert.equal(connected.data.runs[0].mcpResult.decision.policyVersion,2);assert.equal(store.all('receipt').length,0);
 const session=service.session();assert.equal(evaluate(service.action(session.id,'internal_logs.search','customer-logs','production'),service.policy()).verdict,'BLOCK');
 await call('/mcp/policy',{...policy,expectedVersion:2,tenableAllowed:false},admin);
 const comparison=await call('/mcp/comparison',{...request,target:'both'},employee);assert.equal(calls,2);assert.equal(comparison.data.runs[0].mcpResult.status,'CONNECTED');assert.equal(comparison.data.runs[1].mcpResult.status,'BLOCKED');
 assert.equal(store.all('event').filter(event=>event.type==='mcp.decision.recorded').length,4);
 assert.equal(store.get('policy_version','2').tenableAllowed,true);assert.equal(store.get('policy_version','3').tenableAllowed,false);
 assert.equal(mcpDecision({version:1} as any,'governed').verdict,'BLOCK');
 assert.equal((await call('/mcp/comparison',{...request,url:'http://localhost'},employee)).status,400);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();}
});

test('MCP failure and policy changes preserve intent and never enable discovered tools',async()=>{
 const store=openStore(':memory:'),service=new Precedent(store);service.publish({...service.policy(),tenableAllowed:true});let change=false;
 const server=createApp(service,undefined,undefined,undefined,undefined,async()=>{
  if(!change)throw new Error('Untrusted provider error must not be returned');
  service.publish({...service.policy(),tenableAllowed:false});return {status:'CONNECTED',tools:['search'],message:'Discovery returned tools'};
 }).listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
 const url=`http://127.0.0.1:${(server.address() as any).port}/api`;
 try{
  const login=await fetch(url+'/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role:'employee'})});const {token}=await login.json() as any;
  const request=()=>fetch(url+'/mcp/comparison',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({task:'Connect Tenable MCP',target:'governed'})}).then(response=>response.json()) as Promise<any>;
  const failed=(await request()).runs[0];assert.equal(failed.mcpResult.status,'CONNECTION_FAILED');assert.equal(failed.mcpResult.decision.verdict,'ALLOW');assert.ok(!JSON.stringify(failed).includes('Untrusted provider error'));
  change=true;const stale=(await request()).runs[0];assert.equal(stale.mcpResult.status,'POLICY_CHANGED');assert.deepEqual(stale.mcpResult.tools,[]);assert.equal(stale.mcpResult.decision.policyVersion,2);assert.equal(stale.mcpResult.currentDecision.policyVersion,3);assert.equal(stale.mcpResult.currentDecision.verdict,'BLOCK');
  assert.equal(store.all('receipt').length,0);assert.equal(store.all('event').filter(event=>event.type==='mcp.connection.recorded').length,2);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();}
});
