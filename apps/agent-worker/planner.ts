import {Client} from 'eve/client';
import {z} from 'zod';
import {toolIds} from '../../packages/contracts/index.js';
// Social-only messages have no action intent. Mixed greeting + action prompts
// still use normal planning and policy enforcement. Replies come from the model.
export function isSocialMessage(task:string){
 const normalized=task.toLowerCase().replace(/[.,!?…\s]+/g,' ').trim();
 const phrase='(?:hello(?: there)?|hellow|hi(?: there)?|hey(?: there)?|good (?:morning|afternoon|evening)|thanks|thank you|bye|goodbye)';
 return new RegExp(`^${phrase}(?: ${phrase})*$`).test(normalized);
}
export const planSchema=z.object({goal:z.string(),reply:z.string().trim().max(4000).default(''),steps:z.array(z.object({toolId:z.enum(toolIds),target:z.string().max(120).optional(),purpose:z.string(),policyReferences:z.array(z.string()),memoryReferences:z.array(z.string())})).max(8)});
export interface PlannerTransport{health():Promise<unknown>;create(input:{message:string;outputSchema:typeof planSchema}):Promise<{session:{state:{sessionId:string}};response:{result():Promise<{data?:unknown;events?:unknown[]}>}}>;}
function verifyReferences(plan:z.infer<typeof planSchema>,context:unknown){
 const packet=(context&&typeof context==='object'?context:{}) as Record<string,unknown>;
 const ids=(records:unknown,fields:string[])=>Array.isArray(records)?records.flatMap(record=>record&&typeof record==='object'?fields.map(field=>record[field]).filter((id):id is string=>typeof id==='string'):[]):[];
 const policies=new Set([...ids(packet.currentRules,['id','ruleId']),...ids(packet.semanticMemory,['id','ruleId'])]);
 const memories=new Set([...ids(packet.episodes,['id']),...ids(packet.playbooks,['id']),...ids(packet.knowledge,['id'])]);
 const unverifiedReferences:{stepIndex:number;kind:'policy'|'memory';reference:string}[]=[];
 const steps=plan.steps.map((step,stepIndex)=>{
  const keep=(references:string[],valid:Set<string>,kind:'policy'|'memory')=>references.filter(reference=>{if(valid.has(reference))return true;unverifiedReferences.push({stepIndex,kind,reference});return false;});
  return {...step,policyReferences:keep(step.policyReferences,policies,'policy'),memoryReferences:keep(step.memoryReferences,memories,'memory')};
 });
 // Preserve rejected model values as audit metadata. References are context
 // citations only; they never authorize the proposed actions.
 return {...plan,steps,...(unverifiedReferences.length?{unverifiedReferences}:{})};
}
export async function planWithEve(task:string,resource:string,environment:string,context:unknown,options:{runId:string;onSession?:(workerSessionId:string)=>Promise<void>;transport?:PlannerTransport;warehouse?:{availableTables:string[];tableHint:{table:string;definitions:string|null}|null}}){
 const host=process.env.EVE_WORKER_URL;if(!host&&!options.transport)throw new Error('EVE_WORKER_URL is not configured; live planning unavailable');
 const client=options.transport?null:new Client({host:host!,redirect:'error'});
 const transport=options.transport??{health:()=>client!.health(),create:(input:{message:string;outputSchema:typeof planSchema})=>client!.sessions.create(input)};
 await transport.health();
 // Every plan uses a fresh conversation. Only the governed run receives the
 // current rules and persisted episodes; no previous transcript is shared.
 const socialOnly=isSocialMessage(task);
 const {session,response}=await transport.create({message:JSON.stringify({runId:options.runId,task,resource,environment,availableTools:socialOnly?[]:resource==='warehouse'?['warehouse.query']:toolIds.filter(id=>id!=='warehouse.query'),...(options.warehouse?{availableTables:options.warehouse.availableTables,...(options.warehouse.tableHint?{tableHint:options.warehouse.tableHint}:{})}:{}),responseGuidance:'Reply conversationally with zero steps when no action is requested. Data scope is not a request to access data. For action requests, propose only relevant steps and never claim results before execution.'+(options.warehouse?.tableHint?' The user supplied tableHint for this question: propose a warehouse.query step with target set to that table. Do not answer with instructions instead of querying.':''),...(context?{companyContext:context}:{})}),outputSchema:planSchema});
 await options.onSession?.(session.state.sessionId);
 const result=await response.result();const plan=planSchema.parse(result.data);
 if(socialOnly&&plan.steps.length)throw new Error('A social message cannot authorize a tool plan');
 if(!plan.steps.length&&!plan.reply)throw new Error('A tool-free response must contain an assistant reply');
 // Provider-reported usage from each completed model call; absent values stay null.
 const steps=(result.events??[]).filter((event):event is {type:string;data:{usage?:{inputTokens?:number;outputTokens?:number}}}=>Boolean(event&&typeof event==='object'&&(event as {type?:string}).type==='step.completed'));
 const reported=steps.filter(step=>step.data?.usage);
 const usage=reported.length?{inputTokens:reported.reduce((sum,step)=>sum+(step.data.usage!.inputTokens??0),0),outputTokens:reported.reduce((sum,step)=>sum+(step.data.usage!.outputTokens??0),0),modelCalls:reported.length}:null;
 return {...verifyReferences(plan,context),usage};
}
