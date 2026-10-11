import {createHash} from 'node:crypto';
import type {Precedent} from '../../apps/server/service.js';
import type {Action,Decision} from '../contracts/index.js';
interface RecordedRun{id:string;mode:string;sessionId:string;task:string;executionIds?:string[];[key:string]:unknown;}
interface RecordedExecution{id:string;action:Action;baseline:boolean;status:string;receiptId:string|null;toolVersion:string;decision:Decision;}

// Summaries describe stored outcomes, never inferred task completion or permission.
export function saveRunOutcome(service:Precedent,runId:string){
 const run=service.store.get<RecordedRun>('run',runId);
 if(!run||run.mode!=='governed'||!run.executionIds?.length)return null;
 service.requireCurrentSession(run.sessionId);
 const evidence=run.executionIds.flatMap((id:string)=>{
  const original=service.store.get<RecordedExecution>('execution',id),resumed=service.store.get<RecordedExecution>('execution',id+':resume');
  return [original,resumed].filter((execution):execution is RecordedExecution=>Boolean(execution&&!execution.baseline&&execution.action.sessionId===run.sessionId));
 });
 if(!evidence.length)return null;
 const outcomes=evidence.map(execution=>{
  const receipt=execution.receiptId?service.store.get('receipt',execution.receiptId):undefined;
  const confirmed=receipt&&receipt.executionId===execution.id&&receipt.sessionId===run.sessionId&&receipt.toolId===execution.action.toolId&&receipt.toolVersion===execution.toolVersion&&receipt.baseline===false;
  return {executionId:execution.id,action:execution.action,ruleId:execution.decision.ruleId,policyVersion:execution.decision.policyVersion,decision:execution.decision.verdict,reason:execution.decision.reason,status:execution.status==='SUCCEEDED'&&!confirmed?'UNKNOWN':execution.status,receiptId:confirmed?receipt.id:null,result:confirmed?receipt.result:null};
 });
 const latest=run.executionIds.map((id:string)=>outcomes.find(outcome=>outcome.executionId===id+':resume')??outcomes.find(outcome=>outcome.executionId===id)).filter((outcome):outcome is NonNullable<typeof outcome>=>Boolean(outcome));
 const status=latest.length!==run.executionIds.length?'UNKNOWN':latest.some(outcome=>['PENDING','DISPATCHING'].includes(outcome.status))?'WAITING':latest.some(outcome=>outcome.status==='UNKNOWN')?'UNKNOWN':'FINISHED';
 const blocked=outcomes.find(outcome=>outcome.status==='BLOCKED'),succeeded=outcomes.find(outcome=>outcome.status==='SUCCEEDED'&&outcome.receiptId);
 const first=blocked??outcomes[0],last=outcomes.at(-1)!;
 const alternative=blocked?evidence.find(execution=>execution.id===blocked.executionId)?.decision.alternative:null;
 const alternativeOutcome=alternative?outcomes.find(outcome=>outcome.action.toolId===alternative&&outcome.status==='SUCCEEDED'&&outcome.receiptId&&outcome.action.resourceId===blocked!.action.resourceId&&outcome.action.environment===blocked!.action.environment):null;
 const summary=`Task: ${run.task}. Observed outcomes: ${outcomes.map(outcome=>`${outcome.action.toolId}: ${outcome.status} (${outcome.reason})${outcome.result?'; '+String(outcome.result).slice(0,2000):''}`).join(' | ')}${alternativeOutcome?'. Permitted alternative completed: '+alternativeOutcome.action.toolId+'.':''}`;
 const id='run-memory:'+createHash('sha256').update(JSON.stringify({runId,outcomes})).digest('hex').slice(0,24);
 if(service.store.get('episode',id))return id;
 const executionIds=new Set(outcomes.map(outcome=>outcome.executionId));
 const episode={id,kind:'run-outcome',...service.episodeScope(run.sessionId),sessionId:run.sessionId,sourceRunId:runId,taskSummary:run.task,toolId:first.action.toolId,resourceId:first.action.resourceId,environment:first.action.environment,policyVersion:last.policyVersion,policyVersions:[...new Set(outcomes.map(outcome=>outcome.policyVersion))],at:service.clock(),decision:first.decision,summary,alternative:alternative??null,alternativeCompleted:Boolean(alternativeOutcome),outcomeStatus:status,outcomes,evidenceId:(succeeded??last).executionId,evidenceIds:[...executionIds],supportingEventIds:service.store.all('event').filter(event=>executionIds.has(event.executionId)).map(event=>event.id)};
 for(const previous of service.store.all('episode'))if(previous.kind==='run-outcome'&&previous.sourceRunId===runId&&!previous.supersededBy)service.record('episode',{...previous,supersededBy:id});
 service.record('episode',episode);service.record('run',{...run,status,memoryEpisodeId:id});service.emit('episode.saved',{runId,sessionId:run.sessionId,episodeId:id,evidenceIds:episode.evidenceIds});return id;
}
