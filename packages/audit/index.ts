import type {Precedent} from '../../apps/server/service.js';
import type {Action,Grant} from '../contracts/index.js';
const sameAction=(a:Action,b:Action)=>['actorId','agentId','sessionId','toolId','resourceId','environment'].every(key=>a[key as keyof Action]===b[key as keyof Action]);

export function inspectOriginal(service:Precedent,executionId:string){
 const execution=service.store.get('execution',executionId);
 if(!execution)throw Object.assign(new Error('Unknown execution'),{status:404});
 const session=service.store.get('session',execution.action.sessionId)??null;
 const run=service.store.all('run').find(run=>run.sessionId===execution.action.sessionId)??null;
 const planned=run?.executionIds?.some((id:string)=>id===execution.id||id+':resume'===execution.id)??false;
 const originalId=executionId.endsWith(':resume')?executionId.slice(0,-7):executionId;
 const grantSnapshots=(execution.grants??[]).filter((grant:Grant)=>grant.action&&sameAction(grant.action,execution.action));
 const receipt=execution.receiptId?service.store.get('receipt',execution.receiptId)??null:null;
 const receiptConfirmed=Boolean(receipt&&receipt.executionId===executionId&&receipt.sessionId===execution.action.sessionId&&receipt.toolId===execution.action.toolId&&receipt.toolVersion===execution.toolVersion&&receipt.baseline===execution.baseline);
 const policy=service.store.get('policy_version',String(execution.decision.policyVersion))??null;
 const events=service.store.all('event').map((event,index)=>({...event,sequence:index+1})).filter(event=>event.executionId===executionId||event.approvalId===originalId||(run&&event.runId===run.id)||(event.sessionId===execution.action.sessionId&&event.type==='policy.acknowledged'));
 return {mode:'recorded-evidence',sideEffects:0,execution:{...execution,grants:grantSnapshots},session,policy,run,runAssociation:run?(planned?'planned-step':'later-session-action'):'unavailable',contextAtPlanning:run?.context??null,grantSnapshotsAtDecision:grantSnapshots,approvalReviewRecord:service.store.get('approval',originalId)??null,currentGrantStates:grantSnapshots.map((grant:Grant)=>service.store.get('grant',grant.id)).filter(Boolean),receipt,receiptConfirmed,events,availability:{historicalPolicy:Boolean(policy),prePlanContext:Boolean(run?.context),receipt:receipt?'recorded':'none'}};
}
export type OriginalDecision=ReturnType<typeof inspectOriginal>;
