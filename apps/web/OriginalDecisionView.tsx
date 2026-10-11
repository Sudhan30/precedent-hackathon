import type {OriginalDecision} from '../../packages/audit/index.js';
type Row=Record<string,any>;
const timestamp=(value:unknown)=>{const date=new Date(typeof value==='number'?value:NaN);return Number.isFinite(date.getTime())?date.toISOString():'unrecorded';};
export function OriginalDecisionView({original,onClose}:{original:OriginalDecision;onClose:()=>void}){
 const execution=original.execution,context=original.contextAtPlanning;
 return <section className="original-decision" aria-label="Original decision">
  <h3>Original recorded decision</h3><button className="secondary" onClick={onClose}>Close inspection</button>
  <p>Execution {execution.id}<small>Session {execution.action.sessionId} · demo {execution.demoRunId??original.session?.demoRunId??'legacy'}</small></p>
  <p><strong>Recorded verdict: {execution.decision.verdict}</strong> · {execution.decision.ruleId} · policy v{execution.decision.policyVersion}</p>
  <p>{execution.decision.reason}</p><p>Evaluated at {timestamp(execution.at)} · stored outcome {execution.status}</p>
  <p>{execution.action.actorId} · {execution.action.toolId}@{execution.toolVersion??'unrecorded'} · {execution.action.resourceId} · {execution.action.environment}</p>
  <details><summary>Historical policy used for this decision</summary>{original.policy?<>
   <p>Version {original.policy.version} · published by {original.policy.publishedBy??'unrecorded'}</p><p>Reason: {original.policy.reason??'unrecorded'}</p><p>Published at {timestamp(original.policy.publishedAt)}</p>
   <p>Sandbox exports {original.policy.sandboxAllowed?'allowed':'disabled'} · scoped approvals {original.policy.sandboxApprovalRequired?'required':'disabled'}</p>
   <p>Quarantined versions: {original.policy.quarantined.join(', ')||'none'}</p>
   {original.policy.rules?.map((rule:Row)=><p key={rule.id}>{rule.id} · {rule.description}</p>)}
  </>:<p>Historical policy unavailable. The recorded decision is retained; current policy is not substituted.</p>}</details>
  <details><summary>Recorded pre-plan context and plan</summary>{original.run?<>
   <p>{original.run.task}</p><p>Run {original.run.id} · {original.run.planner??'unrecorded planner'} · {original.runAssociation==='planned-step'?'Planned step':'Later action in this session'}</p>
   <ol>{original.run.plan?.map((tool:string,index:number)=><li key={index+':'+tool}>{tool}</li>)}</ol>
   {context?<><p>Planning context policy v{context.policy?.version} · {context.retrieval?.mode}</p>{context.currentRules?.map((rule:Row)=><p key={rule.id}>{rule.id} · {rule.description}</p>)}{context.episodes?.map((episode:Row)=><p key={episode.id}>{episode.summary}<small>Stored memory reference {episode.id}</small></p>)}</>:<p>{execution.baseline?'Company context was not supplied to the baseline.':'Pre-plan context unavailable for this record.'}</p>}
  </>:<p>No recorded plan is associated with this session.</p>}</details>
  <details><summary>Approval evidence at decision and later review</summary>
   <p>{original.grantSnapshotsAtDecision.length} matching grant snapshots at decision time.</p>
   {original.grantSnapshotsAtDecision.map((grant:Row)=><p key={grant.id}>Grant {grant.id} · policy v{grant.policyVersion} · {grant.toolVersion}<small>Snapshot: {grant.revoked?'revoked':grant.consumed?'consumed':grant.expiresAt<=execution.at?'expired at decision':'within recorded time window'} · expires {timestamp(grant.expiresAt)}</small></p>)}
   {original.approvalReviewRecord?<p>Review record: {original.approvalReviewRecord.status} · reviewer {original.approvalReviewRecord.reviewedBy??'not reviewed'}<small>Review time {original.approvalReviewRecord.reviewedAt?timestamp(original.approvalReviewRecord.reviewedAt):'not recorded'}. This record may reflect a review after the original decision.</small></p>:<p>No approval review record.</p>}
   {original.currentGrantStates.map((grant:Row)=><p key={grant.id}>Current grant record {grant.id}: {grant.revoked?'revoked':grant.consumed?'consumed':'unconsumed'}<small>Current state is separate from the snapshot used for the decision.</small></p>)}
  </details>
  <h4>Recorded tool outcome</h4>{original.receipt?<><p>{original.receiptConfirmed?'Receipt confirmed':'Recorded receipt does not match this execution'} · {original.receipt.id}</p>{original.receiptConfirmed&&<p>{typeof original.receipt.result==='string'?original.receipt.result:JSON.stringify(original.receipt.result)}</p>}</>:<p>No tool receipt was recorded for this execution.</p>}
  <details><summary>Linked event timeline · {original.events.length} records</summary><p>Showing the latest 20 linked records. Inspection performs no evaluation or tool calls.</p>{original.events.slice(-20).map(event=><p key={event.id}>#{event.sequence} · {event.type}<small>{timestamp(event.at)} · event {event.id}</small></p>)}</details>
 </section>;
}
