import type {PolicyChangePreview} from '../../packages/policies/index.js';
const labels={sandboxAllowed:'Direct sandbox exports',sandboxApprovalRequired:'Scoped sandbox approval setting'};
export function PolicyChangeReview({preview,currentVersion,busy,canPublish,onReason,onPublish,onCancel}:{preview:PolicyChangePreview;currentVersion:number;busy:boolean;canPublish:boolean;onReason:(reason:string)=>void;onPublish:()=>void;onCancel:()=>void}){
 const stale=currentVersion!==preview.baseVersion,rule=preview.afterRules.find(rule=>rule.id==='SANDBOX-04');
 return <section className="policy-review" aria-label="Policy change review">
  <h3>Review policy change</h3><p>Base policy v{preview.baseVersion} → proposed v{preview.baseVersion+1}</p>
  {preview.differences.length?<table><thead><tr><th>Setting</th><th>Before</th><th>After</th></tr></thead><tbody>{preview.differences.map(change=><tr key={change.field}><td>{labels[change.field]}</td><td>{change.before?'Enabled':'Disabled'}</td><td>{change.after?'Enabled':'Disabled'}</td></tr>)}</tbody></table>:<p>No sandbox settings change.</p>}
  <p>Effective sandbox rule: {rule?.description}</p>
  <label htmlFor="policy-change-reason">Reason for this change</label><textarea id="policy-change-reason" maxLength={1000} value={preview.input.reason} onChange={event=>onReason(event.target.value)}/>
  {stale&&<p role="alert">This review is stale. Policy v{currentVersion} is now active. Cancel and review the change again.</p>}
  <button disabled={busy||stale||!canPublish||!preview.differences.length||!preview.input.reason.trim()} onClick={onPublish}>Publish reviewed policy</button> <button className="secondary" disabled={busy} onClick={onCancel}>Cancel policy review</button>
 </section>;
}
