import {AsyncLocalStorage} from 'node:async_hooks';
import {ROOT_CONTEXT,trace,SpanStatusCode,type Context,type Attributes,type Span} from '@opentelemetry/api';
import {BasicTracerProvider,BatchSpanProcessor,AlwaysOnSampler,type SpanExporter,type SpanProcessor} from '@opentelemetry/sdk-trace-base';
import {resourceFromAttributes} from '@opentelemetry/resources';
import {OTLPHttpJsonTraceExporter} from '@vercel/otel';
import type {DomainRuntime} from '../../apps/server/runtime.js';
import type {Precedent} from '../../apps/server/service.js';

type Event=Record<string,any>;
const types=new Set(['run.created','retrieval.started','context.retrieved','context.omitted','planning.started','worker.session.created','plan.created','action.proposed','decision.recorded','approval.requested','approval.approved','approval.denied','approval.granted','approval.revoked','execution.intent','execution.started','execution.completed','execution.unknown','episode.saved','run.completed','run.waiting','run.unknown','run.failed','policy.published','policy.acknowledged','incident.recorded','proposal.created','proposal.published']);
export function eventAttributes(event:Event):Attributes{
 const attributes:Attributes={'precedent.event_type':event.type,'precedent.source':'committed-audit-event','ai.operationId':'precedent.audit','ai.telemetry.metadata.raindrop.ai.userId':'precedent-governance'};
 for(const [field,key] of Object.entries({id:'event_id',runId:'run_id',sessionId:'session_id',demoRunId:'demo_run_id',executionId:'execution_id',workerSessionId:'worker_session_id',receiptId:'receipt_id',approvalId:'approval_id'}))if(typeof event[field]==='string')attributes['precedent.'+key]=event[field];
 if(typeof event.runId==='string')attributes['ai.telemetry.metadata.raindrop.eventId']=event.runId;
 for(const [field,key] of Object.entries({durationMs:'duration_ms',evaluationDurationMs:'evaluation_duration_ms',dispatchDurationMs:'dispatch_duration_ms'}))if(Number.isFinite(event[field]))attributes['precedent.'+key]=event[field];
 const version=event.decision?.policyVersion??event.version;if(Number.isInteger(version))attributes['precedent.policy_version']=version;
 if(event.decision){attributes['precedent.verdict']=event.decision.verdict;attributes['precedent.rule_id']=event.decision.ruleId;}
 if(event.action?.toolId)attributes['precedent.tool_id']=event.action.toolId;
 if(event.context?.retrieval)attributes['precedent.retrieval_degraded']=Boolean(event.context.retrieval.degraded);
 if(typeof event.status==='string')attributes['precedent.outcome']=event.status;
 if(typeof event.phase==='string')attributes['precedent.failed_phase']=event.phase;
 return attributes;
}
export class BackendTelemetry{
 private readonly provider:BasicTracerProvider;private readonly scope=new AsyncLocalStorage<Context>();private readonly tracer;
 constructor(exporter:SpanExporter,processor?:SpanProcessor,private readonly trackEvents?:(events:Event[])=>Promise<unknown>){this.provider=new BasicTracerProvider({resource:resourceFromAttributes({'service.name':'precedent-api'}),sampler:new AlwaysOnSampler(),spanProcessors:[processor??new BatchSpanProcessor(exporter,{exportTimeoutMillis:2000,scheduledDelayMillis:1000,maxQueueSize:1024})]});this.tracer=this.provider.getTracer('precedent-governance');}
 async run<T>(identity:{runId:string;mode:string;demoRunId:string},fn:()=>Promise<T>):Promise<T>{
  let span:Span;try{span=this.tracer.startSpan('precedent.run',{attributes:{'precedent.run_id':identity.runId,'precedent.mode':identity.mode,'precedent.demo_run_id':identity.demoRunId,'ai.telemetry.metadata.raindrop.eventId':identity.runId,'ai.operationId':'precedent.governance','ai.telemetry.metadata.raindrop.ai.userId':'precedent-governance'}},this.scope.getStore()??ROOT_CONTEXT);}catch{return fn();}
  return this.scope.run(trace.setSpan(this.scope.getStore()??ROOT_CONTEXT,span),async()=>{try{return await fn();}catch(error){span.setStatus({code:SpanStatusCode.ERROR,message:'Run failed'});throw error;}finally{try{span.end();}catch{/* Export failure cannot change the run result. */}}});
 }
 record(event:Event){if(!types.has(event.type))return;try{const span=this.tracer.startSpan('precedent.'+event.type,{attributes:eventAttributes(event),startTime:Number.isFinite(event.at)?event.at:undefined},this.scope.getStore()??ROOT_CONTEXT);if(['run.failed','execution.unknown','run.unknown'].includes(event.type))span.setStatus({code:SpanStatusCode.ERROR,message:'Outcome failed or unconfirmed'});span.end(Number.isFinite(event.at)?event.at:undefined);}catch{/* Optional telemetry cannot change an authorization outcome. */}}
 // One dashboard Event per run, sharing the run ID with its trace. Like the spans, it never
 // carries task text: only mode, scenario, outcome and each tool's policy verdict.
 trackRun(run:{runId:string;mode:string;scenario:string;status:string;executions:{action:{toolId:string};status:string;decision?:{verdict:string;ruleId?:string}}[];properties?:Record<string,string|number|boolean>}){
  if(!this.trackEvents)return;const count=(verdict:string)=>run.executions.filter(e=>e.decision?.verdict===verdict).length;
  const properties={...run.properties,mode:run.mode,scenario:run.scenario,status:run.status,allowed:count('ALLOW'),blocked:count('BLOCK'),approvalRequired:count('REQUIRE_APPROVAL')};
  const event={event_id:run.runId,user_id:'precedent-'+run.mode,event:'precedent.run',properties,ai_data:{input:`${run.mode} run · ${run.scenario}`,output:`${run.status} · ${properties.allowed} allowed · ${properties.blocked} blocked · ${properties.approvalRequired} need approval`,convo_id:run.runId,
   // Raindrop silently drops an event whose tool call carries any status other than "error",
   // so the outcome goes in result and status marks only genuine failures (UNKNOWN or FAILED).
   tool_calls:run.executions.map(e=>({name:e.action.toolId,result:`${e.status}${e.decision?` · ${e.decision.verdict}${e.decision.ruleId?' '+e.decision.ruleId:''}`:''}`,...(['UNKNOWN','FAILED'].includes(e.status)?{status:'error',error:`${e.status}: outcome not confirmed`}:{})}))}};
  void this.trackEvents([event]).catch(()=>undefined);
 }
 async flush(){await this.provider.forceFlush();}
 async close(){await this.provider.shutdown().catch(()=>undefined);}
}
export function raindropSignal(key=process.env.RAINDROP_WRITE_KEY){
 if(!key)return undefined;
 return (signal:{eventId:string;name:string;sentiment:'POSITIVE'|'NEGATIVE';properties?:Record<string,string|number|boolean>})=>void fetch('https://api.raindrop.ai/v1/signals/track',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify([{event_id:signal.eventId,signal_name:signal.name,signal_type:'feedback',sentiment:signal.sentiment,properties:signal.properties??{}}]),signal:AbortSignal.timeout(5000)})
  .then(response=>{if(!response.ok)console.warn('Raindrop signal export failed: HTTP '+response.status);}).catch(error=>console.warn('Raindrop signal export failed: '+(error as Error).name));
}
export function configuredTelemetry(key=process.env.RAINDROP_WRITE_KEY){return key?new BackendTelemetry(new OTLPHttpJsonTraceExporter({url:'https://api.raindrop.ai/v1/traces',headers:{Authorization:'Bearer '+key}}),undefined,
 events=>fetch('https://api.raindrop.ai/v1/events/track',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(events),signal:AbortSignal.timeout(5000)}).then(response=>{if(!response.ok)console.warn('Raindrop event export failed: HTTP '+response.status);return response;},error=>{console.warn('Raindrop event export failed: '+(error as Error).name);throw error;})):undefined;}
export class TelemetryRuntime implements DomainRuntime{
 private tail:Promise<unknown>=Promise.resolve();
 constructor(private readonly source:DomainRuntime,private readonly telemetry:BackendTelemetry){}
 get mode(){return this.source.mode;}get writes(){return this.source.writes;}
 // Reads emit no events: they skip the export wrapper and the write queue, as without telemetry.
 get read(){const source=this.source;return source.read?<T>(fn:(service:Precedent)=>T|Promise<T>)=>source.read!(fn):undefined;}
 get searchEpisodes(){return this.source.searchEpisodes;}get searchPolicies(){return this.source.searchPolicies;}get playbookIndex(){return this.source.playbookIndex;}get notifications(){return this.source.notifications;}
 async run<T>(fn:(service:Precedent)=>T|Promise<T>):Promise<T>{
  const job=this.tail.then(()=>this.source.run(async service=>{const before=new Set(service.store.all('event').map(event=>event.id));const value=await fn(service);return {value,events:service.store.all('event').filter(event=>!before.has(event.id))};}));
  this.tail=job.catch(()=>undefined);const committed=await job;
  // Export only after a successful transaction, never from retryable callbacks.
  for(const event of committed.events)this.telemetry.record(event);return committed.value;
 }
 async readEvents(cursor:number){return this.source.readEvents?this.source.readEvents(cursor):this.source.run(s=>s.store.all('event').slice(cursor,cursor+200));}
 async close(){await this.tail;await this.source.close();}
}
