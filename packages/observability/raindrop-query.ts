import {z} from 'zod';

const tracesSchema=z.object({data:z.array(z.object({trace_id:z.string().regex(/^[a-f0-9]{32}$/i),span_id:z.string().regex(/^[a-f0-9]{16}$/i),span_type:z.string(),status:z.string()}))});

/** Read only a specific event's traces. Discard content and arbitrary
 * attributes before constructing evidence or printing anything. */
export async function verifyRaindropEvent(eventId:string,key:string,request:typeof fetch=fetch){
 const payload=await readEvent(eventId,key,request);
 const parsed=tracesSchema.safeParse(payload);if(!parsed.success)throw new Error('Raindrop read-back returned an unsupported trace response.');
 const spans=parsed.data.data;if(!spans.length)throw new Error('Raindrop has no visible spans for this event yet.');
 return {eventId,visible:true,spanCount:spans.length,traceIds:[...new Set(spans.map(s=>s.trace_id))],modelSpanCount:spans.filter(s=>['LLM_GENERATION','LLM_GENERATION_STREAM'].includes(s.span_type)).length,errorSpanCount:spans.filter(s=>s.status==='ERROR').length};
}

async function readEvent(eventId:string,key:string,request:typeof fetch){
 if(!key)throw new Error('Configure RAINDROP_QUERY_API_KEY in ignored .env.local first.');
 if(!eventId||eventId.length>512)throw new Error('A valid Raindrop event ID is required.');
 const url=new URL('https://query.raindrop.ai/v1/traces');url.searchParams.set('event_id',eventId);url.searchParams.set('limit','200');url.searchParams.set('trunc_len','0');
 let response:Response;
 try{response=await request(url,{headers:{Authorization:'Bearer '+key,Accept:'application/json'},signal:AbortSignal.timeout(15000)});}catch{throw new Error('Raindrop read-back could not connect.');}
 if(!response.ok)throw new Error('Raindrop read-back failed (HTTP '+response.status+').');
 let payload:unknown;try{payload=await response.json();}catch{throw new Error('Raindrop read-back returned invalid JSON.');}
 return payload;
}

export interface ExpectedGovernanceDecision {executionId:string;verdict:'ALLOW'|'BLOCK'|'REQUIRE_APPROVAL';policyVersion:number;receiptId:string|null;}
/** Cross-check stored decisions/receipts against actual remote spans. Never return trace content. */
export async function verifyRaindropGovernance(eventId:string,key:string,expected:ExpectedGovernanceDecision[],request:typeof fetch=fetch){
 const schema=z.object({data:z.array(z.object({span_name:z.string(),attributes:z.record(z.string(),z.unknown())}))});
 const parsed=schema.safeParse(await readEvent(eventId,key,request));
 if(!parsed.success)throw new Error('Raindrop governance read-back returned an unsupported response.');
 const spans=parsed.data.data;
 const decisions=spans.filter(span=>span.span_name==='precedent.decision.recorded');
 const completions=spans.filter(span=>span.span_name==='precedent.execution.completed');
 for(const item of expected){
  const matches=decisions.filter(span=>span.attributes['precedent.execution_id']===item.executionId);
  const completed=completions.filter(span=>span.attributes['precedent.execution_id']===item.executionId);
  if(matches.length!==1||matches[0].attributes['precedent.verdict']!==item.verdict||matches[0].attributes['precedent.policy_version']!==item.policyVersion||matches[0].attributes['precedent.run_id']!==eventId)throw new Error('Raindrop governance decisions do not match the audit records.');
  if(item.receiptId?(completed.length!==1||completed[0].attributes['precedent.receipt_id']!==item.receiptId||completed[0].attributes['precedent.run_id']!==eventId):completed.length!==0)throw new Error('Raindrop governance outcomes do not match the receipt records.');
 }
 if(decisions.length!==expected.length||completions.length!==expected.filter(item=>item.receiptId).length)throw new Error('Raindrop governance span counts do not match the audit records.');
 return {eventId,verified:true,decisions:decisions.length,completed:completions.length,denied:expected.filter(item=>item.verdict==='BLOCK').length,approvalRequired:expected.filter(item=>item.verdict==='REQUIRE_APPROVAL').length};
}
