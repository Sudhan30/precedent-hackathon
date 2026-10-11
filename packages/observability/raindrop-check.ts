import {z} from 'zod';
// Independent second check on self-writing guardrails. MongoDB evidence triggers a draft rule;
// before it may be published, Raindrop is asked about the exact runs behind it: was each one
// recorded, and did Raindrop flag any of them with a negative signal? Raindrop can hold a rule
// change, never approve one: anything other than VERIFIED requires an administrator's reason.
export type RaindropCheckStatus='VERIFIED'|'FLAGGED'|'PENDING'|'UNAVAILABLE'|'NOT_CONFIGURED';
export interface RaindropCheck{status:RaindropCheckStatus;total:number;traced:number;flagged:number;runs:{runId:string;traced:boolean;signals:string[]}[];message:string;checkedAt:number}
const eventsSchema=z.object({data:z.array(z.object({id:z.string(),signals:z.array(z.object({id:z.string(),name:z.string()})).optional()}).loose())});
const signalsSchema=z.object({data:z.array(z.object({id:z.string(),name:z.string(),sentiment:z.string().nullable().optional()}).loose())});
export async function raindropCheck(runIds:string[],key=process.env.RAINDROP_QUERY_API_KEY,fetcher:typeof fetch=fetch,now=Date.now()):Promise<RaindropCheck>{
 const empty={total:runIds.length,traced:0,flagged:0,runs:[] as RaindropCheck['runs'],checkedAt:now};
 if(!key)return {...empty,status:'NOT_CONFIGURED',message:'Raindrop read access is not configured; the second check is off.'};
 const get=async(path:string)=>{const response=await fetcher('https://query.raindrop.ai'+path,{headers:{Authorization:'Bearer '+key,Accept:'application/json'},signal:AbortSignal.timeout(8000),redirect:'error'});if(!response.ok)throw new Error('HTTP '+response.status);return response.json();};
 try{
  // Only negative signals (failures, injection attempts, frustration…) count as flags.
  const negative=new Set(signalsSchema.parse(await get('/v1/signals?limit=100')).data.filter(s=>s.sentiment==='NEGATIVE').map(s=>s.id));
  const runs=await Promise.all(runIds.map(async runId=>{
   const event=eventsSchema.parse(await get('/v1/events?limit=5&convo_id='+encodeURIComponent(runId))).data.find(item=>item.id===runId);
   return {runId,traced:Boolean(event),signals:(event?.signals??[]).filter(s=>negative.has(s.id)).map(s=>s.name)};
  }));
  const traced=runs.filter(r=>r.traced).length,flagged=runs.filter(r=>r.signals.length).length,names=[...new Set(runs.flatMap(r=>r.signals))];
  const base={...empty,runs,traced,flagged};
  if(flagged)return {...base,status:'FLAGGED',message:`Raindrop flagged ${flagged} of ${runIds.length} runs: ${names.join(', ')}.`};
  if(traced<runIds.length)return {...base,status:'PENDING',message:`Raindrop has ${traced} of ${runIds.length} runs so far; recent runs can take a few seconds to appear.`};
  return {...base,status:'VERIFIED',message:`Verified in Raindrop: ${traced} of ${runIds.length} runs traced, 0 flagged.`};
 }catch{return {...empty,status:'UNAVAILABLE',message:'Raindrop could not be reached; the second check did not run.'};}
}

// Raindrop evidence for one MCP over the last 7 days: its request and connection events, the
// negative signals matched on them (including InfoSec denials sent back as feedback) and
// how many real connection attempts failed.
const mcpEventsSchema=z.object({data:z.array(z.object({id:z.string(),properties:z.record(z.string(),z.unknown()).optional(),signals:z.array(z.object({id:z.string(),name:z.string()})).optional()}).loose())});
export async function raindropMcpEvidence(mcp:string,key=process.env.RAINDROP_QUERY_API_KEY,fetcher:typeof fetch=fetch,now=Date.now()){
 const empty={events:0,negativeSignals:[] as string[],connectionAttempts:0,connectionErrors:0};
 if(!key)return {...empty,status:'NOT_CONFIGURED' as const};
 const get=async(path:string)=>{const response=await fetcher('https://query.raindrop.ai'+path,{headers:{Authorization:'Bearer '+key,Accept:'application/json'},signal:AbortSignal.timeout(8000),redirect:'error'});if(!response.ok)throw new Error('HTTP '+response.status);return response.json();};
 try{
  const signals=signalsSchema.parse(await get('/v1/signals?limit=100')).data;
  const negative=new Set(signals.filter(s=>s.sentiment==='NEGATIVE').map(s=>s.id));
  const since=new Date(now-7*86400e3).toISOString();
  const events=mcpEventsSchema.parse(await get(`/v1/events?limit=200&event_name=precedent.run&properties[mcp]=${encodeURIComponent(mcp)}&timestamp[gte]=${encodeURIComponent(since)}`)).data;
  const flagged=events.flatMap(event=>(event.signals??[]).filter(s=>negative.has(s.id)||s.name==='mcp_denied').map(s=>s.name));
  const outcomes=events.map(event=>String(event.properties?.outcome??''));
  return {status:'OK' as const,events:events.length,negativeSignals:[...new Set(flagged)],connectionAttempts:outcomes.filter(o=>['CONNECTED','CONNECTION_FAILED'].includes(o)).length,connectionErrors:outcomes.filter(o=>o==='CONNECTION_FAILED').length};
 }catch{return {...empty,status:'UNAVAILABLE' as const};}
}
