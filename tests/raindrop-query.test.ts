import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifyRaindropEvent,verifyRaindropGovernance} from '../packages/observability/raindrop-query.js';

test('Raindrop read-back scopes to an exact event and emits content-free evidence',async()=>{
 const secret='QUERY-KEY-AND-CONTENT-MUST-NOT-EXPORT';const eventId='eve:session:turn';
 const request:typeof fetch=async(input,init)=>{const url=new URL(String(input));assert.equal(url.origin,'https://query.raindrop.ai');assert.equal(url.searchParams.get('event_id'),eventId);assert.equal(url.searchParams.get('trunc_len'),'0');assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer '+secret);return Response.json({data:[{trace_id:'a'.repeat(32),span_id:'b'.repeat(16),span_type:'LLM_GENERATION_STREAM',status:'OK',input:secret,output:secret,attributes:{Authorization:secret}}]});};
 const result=await verifyRaindropEvent(eventId,secret,request);assert.equal(result.visible,true);assert.equal(result.modelSpanCount,1);assert.equal(result.spanCount,1);assert.ok(!JSON.stringify(result).includes(secret));
});
test('governance read-back requires exact audit decisions and receipt identities',async()=>{
 const expected=[{executionId:'allowed',verdict:'ALLOW' as const,policyVersion:2,receiptId:'receipt'},{executionId:'blocked',verdict:'BLOCK' as const,policyVersion:3,receiptId:null}];
 const attributes=(id:string,verdict:string,version:number)=>({'precedent.run_id':'run','precedent.execution_id':id,'precedent.verdict':verdict,'precedent.policy_version':version,Authorization:'SECRET'});
 const data=[{span_name:'precedent.decision.recorded',attributes:attributes('allowed','ALLOW',2)},{span_name:'precedent.decision.recorded',attributes:attributes('blocked','BLOCK',3)},{span_name:'precedent.execution.completed',attributes:{'precedent.run_id':'run','precedent.execution_id':'allowed','precedent.receipt_id':'receipt'},output:'SECRET'}];
 const request:typeof fetch=async()=>Response.json({data});const proof=await verifyRaindropGovernance('run','key',expected,request);
 assert.equal(proof.decisions,2);assert.equal(proof.completed,1);assert.equal(proof.denied,1);assert.ok(!JSON.stringify(proof).includes('SECRET'));
 for(const changed of [[],[...data,data[0]],[...data,{span_name:'precedent.execution.completed',attributes:{'precedent.execution_id':'blocked'}}],data.map(s=>({...s,attributes:{...s.attributes,'precedent.policy_version':99}})),data.map(s=>({...s,attributes:{...s.attributes,'precedent.receipt_id':'wrong'}})),data.map(s=>({...s,attributes:{...s.attributes,'precedent.run_id':'other'}}))]){
  await assert.rejects(verifyRaindropGovernance('run','key',expected,async()=>Response.json({data:changed})),/do not match/);
 }
});
test('missing, rejected, malformed and empty read-back cannot establish trace visibility',async()=>{
 await assert.rejects(verifyRaindropEvent('event',''),/Configure RAINDROP_QUERY_API_KEY/);
 for(const response of [new Response('SECRET-ERROR-BODY',{status:403}),Response.json({data:[]}),Response.json({data:[{trace_id:'invalid'}]})]){
  await assert.rejects(verifyRaindropEvent('event','key',async()=>response),error=>error instanceof Error&&!error.message.includes('SECRET')&&/Raindrop/.test(error.message));
 }
 await assert.rejects(verifyRaindropEvent('event','key',async()=>{throw new Error('SECRET-PROVIDER-ERROR');}),/could not connect/);
});
