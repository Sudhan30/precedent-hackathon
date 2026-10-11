import React,{useEffect,useState} from 'react';
import './mission.css';
type Row=Record<string,any>;
type Api=(path:string,body?:unknown,admin?:boolean)=>Promise<any>;
interface Props{state:Row|null;busy:boolean;canAdmin:boolean;api:Api;act:(fn:()=>Promise<unknown>)=>Promise<void>}
type Tab='playbooks'|'guardrails'|'killswitch'|'memory';
const tabs:{id:Tab;label:string;hint:string}[]=[
 {id:'playbooks',label:'Learned playbooks',hint:'Agents learn from each other'},
 {id:'guardrails',label:'Self-writing guardrails',hint:'Rules improve from evidence'},
 {id:'killswitch',label:'Kill switch',hint:'See exposure, stop every agent'},
 {id:'memory',label:'Agent memory',hint:'Learn once, reuse per department'}
];
const toolLabels:Record<string,string>={'example_connector.analyze':'LogLens connector MCP','demo_export.send':'Export connector MCP','internal_logs.search':'Internal log search','staging_db.read':'Staging database','metrics.query':'Service metrics','deploy_history.read':'Deploy history'};
const label=(toolId:string)=>toolLabels[toolId]??toolId;
const shortLabels:Record<string,string>={'example_connector.analyze':'LogLens MCP','demo_export.send':'Export MCP'};
const Lock=()=><svg className="mc-lock" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>;
const verdictText:Record<string,string>={ALLOW:'Allowed',BLOCK:'Blocked',REQUIRE_APPROVAL:'Needs approval'};
const reducedMotion=()=>typeof window!=='undefined'&&window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function useCountUp(target:number){
 const [value,setValue]=useState(0);
 useEffect(()=>{if(reducedMotion()){setValue(target);return;}let frame=0;const start=performance.now();const tick=(now:number)=>{const t=Math.min(1,(now-start)/900);setValue(Math.round(target*(1-Math.pow(1-t,3))));if(t<1)frame=requestAnimationFrame(tick);};frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);},[target]);
 return value;
}
// Fetch admin evidence when its key changes; stale responses are discarded.
function useEvidence(path:string|null,key:string,api:Api,enabled:boolean){
 const [data,setData]=useState<Row|null>(null);const [error,setError]=useState('');
 useEffect(()=>{if(!path||!enabled){setData(null);return;}let active=true;api(path,undefined,true).then(next=>{if(active){setData(next);setError('');}}).catch(e=>{if(active)setError((e as Error).message);});return()=>{active=false;};},[path,key,enabled]);
 return {data,error};
}

export function MissionControl({state,busy,canAdmin,api,act}:Props){
 const [tab,setTab]=useState<Tab>('playbooks');
 const move=(event:React.KeyboardEvent,index:number)=>{if(event.key!=='ArrowRight'&&event.key!=='ArrowLeft')return;const next=tabs[(index+(event.key==='ArrowRight'?1:tabs.length-1))%tabs.length];setTab(next.id);document.getElementById('mc-tab-'+next.id)?.focus();};
 return <section className="mission" aria-label="Mission Control">
  <div className="mission-heading"><span className="eyebrow">MISSION CONTROL</span><h2>Watch the harness learn, adapt and stop.</h2><p>Every number here is read from recorded runs, decisions and connector receipts.</p></div>
  {!canAdmin&&<p className="notice" role="status">Mission Control actions need an administrator account.</p>}
  <div className="mission-tabs" role="tablist" aria-label="Mission Control features">{tabs.map((item,index)=><button key={item.id} id={'mc-tab-'+item.id} role="tab" aria-selected={tab===item.id} aria-controls={'mc-panel-'+item.id} tabIndex={tab===item.id?0:-1} className={tab===item.id?'active':''} onClick={()=>setTab(item.id)} onKeyDown={event=>move(event,index)}><span className="mission-tab-number">{index+1}</span><span><strong>{item.label}</strong><small>{item.hint}</small></span></button>)}</div>
  <div role="tabpanel" id={'mc-panel-'+tab} aria-labelledby={'mc-tab-'+tab} className="mission-panel">
   {tab==='playbooks'&&<PlaybooksTab state={state} api={api} canAdmin={canAdmin}/>}
   {tab==='guardrails'&&<GuardrailsTab state={state} api={api} canAdmin={canAdmin} busy={busy} act={act}/>}
   {tab==='killswitch'&&<KillSwitchTab state={state} api={api} canAdmin={canAdmin} busy={busy} act={act}/>}
   {tab==='memory'&&<MemoryTab state={state} api={api} canAdmin={canAdmin}/>}
  </div>
 </section>;
}

function PlaybooksTab({state,api,canAdmin}:{state:Row|null;api:Api;canAdmin:boolean}){
 // Default to the playbook an agent used most recently; otherwise the richest procedure.
 const lastUse=(p:Row)=>Math.max(0,...(state?.runs??[]).filter((run:Row)=>run.playbookIds?.includes(p.id)).map((run:Row)=>run.createdAt??0));
 const playbooks=[...(state?.playbooks??[])].sort((a:Row,b:Row)=>lastUse(b)-lastUse(a)||(b.steps.length+b.avoid.length)-(a.steps.length+a.avoid.length)||b.at-a.at);
 const [selected,setSelected]=useState('');const playbook=playbooks.find((p:Row)=>p.id===selected)??playbooks[0];
 const uses=playbook?(state?.runs??[]).filter((run:Row)=>run.playbookIds?.includes(playbook.id)).map((run:Row)=>run.id+run.status).join():'';
 const {data:comparison}=useEvidence(playbook?'playbooks/'+playbook.id+'/comparison':null,uses+(playbook?.status??''),api,canAdmin);
 if(!playbook)return <div className="mc-empty"><h3>No playbook yet</h3><p>Send an investigation to the <strong>With Precedent</strong> agent. When a governed run finishes, Precedent keeps the steps that worked, records what was blocked, and saves it as a reusable playbook.</p></div>;
 const before=comparison?.before,after=comparison?.after;
 const tokens=(m:Row|null|undefined)=>m&&m.inputTokens!=null?m.inputTokens+(m.outputTokens??0):null;
 const metrics=[{name:'Findings collected',a:before?.findings,b:after?.findings,unit:''},{name:'Blocked calls',a:before?.blocked,b:after?.blocked,unit:''},{name:'Steps',a:before?.steps,b:after?.steps,unit:''},{name:'Model tokens',a:tokens(before),b:tokens(after),unit:''},{name:'Time',a:before?.durationMs!=null?before.durationMs/1000:null,b:after?.durationMs!=null?after.durationMs/1000:null,unit:'s'}];
 return <div className="mc-grid">
  <article className="mc-card mc-playbook">
   <header><span className={'mc-badge '+(playbook.status==='VALID'?'ok':'warn')}>{playbook.status==='VALID'?'Valid':'Needs re-validation'}</span><span className="mc-badge neutral">{playbook.index?.engine==='atlas-agent-engine'?'Atlas Agent Engine · procedural memory':'Stored in MongoDB Atlas'}</span>{after?.matchedBy&&<span className="mc-badge info">{after.matchedBy==='voyage-rerank'?'Matched by Voyage rerank':after.matchedBy==='atlas-agent-engine'?'Matched by Atlas Agent Engine':'Matched by keyword fallback'}</span>}</header>
   <h3>{playbook.title}</h3>
   <ol className="mc-steps">{playbook.steps.map((step:Row,index:number)=><li key={index}><strong>{label(step.toolId)}</strong>{step.purpose&&<span className="mc-purpose">{step.purpose}</span>}{step.finding&&<small className="mc-finding">Found: {step.finding}</small>}<small>{step.resourceId} · {step.environment}</small></li>)}</ol>
   {playbook.avoid.length>0&&<div className="mc-avoid"><strong>Don’t</strong>{playbook.avoid.map((item:Row)=><p key={item.toolId}>{label(item.toolId)} — {item.reason} <code>{item.ruleId}</code></p>)}</div>}
   <footer>Proven under policy v{playbook.policyVersion} · from run {String(playbook.sourceRunId).slice(0,8)}{playbook.invalidationReason?<><br/><span className="mc-warn-text">{playbook.invalidationReason}</span></>:null}</footer>
   {playbooks.length>1&&<label className="mc-select">Playbook<select value={playbook.id} onChange={event=>setSelected(event.target.value)}>{playbooks.map((p:Row)=><option key={p.id} value={p.id}>{p.title.slice(0,60)}</option>)}</select></label>}
  </article>
  <article className="mc-card">
   <h3>Agent A vs Agent B</h3>
   {!after?<p className="mc-muted">Agent A’s run is recorded. Send a similar task to a fresh <strong>With Precedent</strong> agent: it retrieves this playbook, and the comparison appears here.</p>:<p className="mc-headline">Agent B followed the playbook: <strong>{after.findings} finding{after.findings===1?'':'s'}</strong> with <strong>{after.blocked} blocked</strong> call{after.blocked===1?'':'s'}. Agent A{before?.memory==='none'?' (first day)':''}: {before?.findings} finding{before?.findings===1?'':'s'}, {before?.blocked} blocked.</p>}
   {before&&<div className="mc-sequences">{[['A',before,before.memory==='none'?'First day · no company memory':'Without playbook'],['B',after,'With the learned playbook']].map(([name,run,caption]:any)=>run&&<div key={name} className="mc-sequence"><span className={'mc-seq-name '+(name==='A'?'a':'b')}>Agent {name}</span><small>{caption}</small><ol>{run.tools.map((tool:Row,index:number)=><li key={index} className={tool.status}>{label(tool.toolId)}<em>{tool.status==='SUCCEEDED'?'done':tool.status.toLowerCase()}</em></li>)}</ol></div>)}</div>}
   <div className="mc-bars" role="table" aria-label="Measured comparison">{metrics.map(metric=>{const max=Math.max(metric.a??0,metric.b??0,1);return <div className="mc-bar-row" role="row" key={metric.name}><span role="rowheader">{metric.name}</span>
    <div role="cell" className="mc-bar-pair">
     <div className="mc-bar"><i className="a" style={{width:`${((metric.a??0)/max)*100}%`}}/><b>{metric.a==null?'not recorded':metric.unit?metric.a.toFixed(1)+metric.unit:metric.a.toLocaleString()}</b></div>
     <div className="mc-bar"><i className="b" style={{width:`${((metric.b??0)/max)*100}%`}}/><b>{after?metric.b==null?'not recorded':metric.unit?metric.b.toFixed(1)+metric.unit:metric.b.toLocaleString():'waiting'}</b></div>
    </div></div>;})}</div>
   <p className="mc-legend"><span className="a"/>Agent A · {before?.memory==='none'?'first day, no company memory':'learned the hard way'} <span className="b"/>Agent B · used the playbook</p>
   <small className="mc-muted">{comparison?.source??'Measured from recorded runs.'} A playbook is advice: every step is still checked by current policy.</small>
  </article>
 </div>;
}

const ruleText=(scope:Row)=>scope.kind==='mcp'?<>Allow <strong>{scope.name}</strong> MCP for the company — only at <code>{scope.endpoint}</code>.</>:<>Allow <strong>{label(scope.toolId)}</strong> v{scope.toolVersion} for {scope.actorId}, only with {scope.resourceId} in the {scope.environment}.</>;
function GuardrailsTab({state,api,canAdmin,busy,act}:{state:Row|null;api:Api;canAdmin:boolean;busy:boolean;act:Props['act']}){
 const proposals=[...(state?.policyProposals??[])].sort((a:Row,b:Row)=>b.at-a.at);
 const draft=proposals.find((p:Row)=>p.status==='DRAFT'&&p.baseVersion===state?.policy.version);const published=proposals.find((p:Row)=>p.status==='PUBLISHED');
 const {data:impact,error}=useEvidence(draft?'proposals/'+draft.id+'/impact':null,String(state?.policy.version)+':'+(state?.events?.length??0),api,canAdmin);
 const changed=useCountUp(impact?.changedCount??0);
 const progress=Object.entries(((state?.mcpRequests??[]) as Row[]).filter(r=>r.scope==='once'&&r.status==='CONSUMED').reduce((groups:Record<string,number>,r)=>({...groups,[r.name]:(groups[r.name]??0)+1}),{}));
 if(!draft)return <div className="mc-grid">
  <div className="mc-empty"><h3>No draft rule right now</h3><p>When an administrator approves the same MCP connection one request at a time, again and again, Precedent notices. After 3 successful approvals it drafts a narrow company rule here for one-click review.</p>
   {progress.length>0&&<ul className="mc-progress">{progress.map(([name,count])=><li key={name}><span>{name}</span><meter min={0} max={3} value={Math.min(3,count as number)}/><small>{Math.min(3,count as number)} of 3 approvals</small></li>)}</ul>}</div>
  {published&&<article className="mc-card"><span className="mc-badge ok">Published · policy v{published.publishedVersion}</span><h3>Precedent rewrote its own guardrail</h3><p>{ruleText(published.scope)}</p><p className="mc-muted">The next matching request goes straight through. Everything outside this exact scope still needs review.</p></article>}
 </div>;
 return <div className="mc-grid">
  <article className="mc-card mc-draft">
   <span className="mc-badge info">Drafted by Precedent · base policy v{draft.baseVersion}</span>
   <h3>Suggested rule</h3><p className="mc-rule">{ruleText(draft.scope)}</p>
   <p>{draft.description}</p>
   <small className="mc-muted">Evidence: {draft.count} recorded approvals · {draft.evidenceIds.map((id:string)=>id.slice(0,8)).join(', ')}</small>
   <div className="mc-actions"><button disabled={busy||!canAdmin||!impact} onClick={()=>void act(()=>api('proposals/'+draft.id+'/publish',{expectedVersion:state!.policy.version},true))}>Publish rule</button><span className="mc-muted">Creates policy v{(state?.policy.version??0)+1}. Takes effect for every agent immediately.</span></div>
  </article>
  <article className="mc-card">
   <h3>Before you publish: impact on recorded history</h3>
   {error&&<p role="alert" className="error">{error}</p>}
   {!impact?<p className="mc-muted">Replaying recorded decisions…</p>:<>
    <p className="mc-counter"><strong>{changed}</strong><span>of {impact.total} past decisions would change</span></p>
    <ul className="mc-changes">{impact.changed.slice(0,4).map((row:Row)=><li key={row.id}><span>{row.label}</span><em>{verdictText[row.from]} → {verdictText[row.to]}</em></li>)}{impact.changedCount>4&&<li className="mc-muted">+{impact.changedCount-4} more</li>}</ul>
    <h4>Still protected</h4>
    <ul className="mc-checks">{impact.safetyChecks.map((check:Row)=><li key={check.label} className={check.pass?'pass':'fail'}><span aria-hidden="true">{check.pass?'✓':'✗'}</span>{check.label}<em>{verdictText[check.verdict]}</em></li>)}</ul>
    {impact.stillBlocked.length>0&&<p className="mc-muted">Recorded decisions that stay restricted: {impact.stillBlocked.map((group:Row)=>`${group.label} (${group.count})`).join(' · ')}</p>}
    <p className={'mc-badge '+(impact.newlyRestricted===0?'ok':'warn')}>{impact.newlyRestricted===0?'No allowed action becomes blocked':`${impact.newlyRestricted} allowed actions would become blocked`}</p>
    <small className="mc-muted">Counterfactual replay of current policy vs this draft, with original grants and times. {impact.sideEffects} tools executed.</small>
   </>}
  </article>
 </div>;
}

function KillSwitchTab({state,api,canAdmin,busy,act}:{state:Row|null;api:Api;canAdmin:boolean;busy:boolean;act:Props['act']}){
 const [toolId,setToolId]=useState('example_connector.analyze');const [reported,setReported]=useState(false);const [test,setTest]=useState<Row|null>(null);
 const {data:preview,error}=useEvidence(reported?'incidents/preview?toolId='+encodeURIComponent(toolId):null,toolId+':'+String(state?.policy.version)+':'+(state?.events?.length??0),api,canAdmin);
 const invalidated=(state?.playbooks??[]).filter((p:Row)=>p.status==='NEEDS_REVALIDATION'&&p.steps.some((s:Row)=>s.toolId===toolId));
 const version=toolId==='example_connector.analyze'||toolId==='demo_export.send'?'2.4':'';
 return <div className="mc-kill">
  <div className="mc-steps-bar">
   <label className="mc-select">Connector<select value={toolId} onChange={event=>{setToolId(event.target.value);setReported(false);setTest(null);}}><option value="example_connector.analyze">LogLens connector MCP v2.4</option><option value="demo_export.send">Export connector MCP v2.4</option></select></label>
   <button className="danger" disabled={busy||!canAdmin||reported} onClick={()=>setReported(true)}>1 · Report incident</button>
   <button disabled={busy||!canAdmin||!preview||preview.quarantined} onClick={()=>void act(async()=>{await api('incidents',{toolId},true);setTest(null);})}>2 · Quarantine v{version}</button>
   <button className="secondary" disabled={busy||!canAdmin||!preview} onClick={()=>void act(async()=>setTest(await api('incidents/test-call',{toolId},true)))}>3 · Send test call</button>
  </div>
  {!reported?<div className="mc-empty"><h3>Simulate a vendor security advisory</h3><p>Report an incident against <strong>{label(toolId)} v{version}</strong>. Precedent reads its recorded decisions to show exactly what this tool touched — before anything is changed.</p></div>:<>
   <p className="mc-advisory" role="status"><strong>Simulated advisory:</strong> {label(toolId)} v{version} may leak request payloads. Severity: critical.</p>
   {error&&<p role="alert" className="error">{error}</p>}
   {preview&&<div className="mc-grid">
    <article className="mc-card"><BlastGraph preview={preview}/></article>
    <article className="mc-card mc-blast-summary">
     <h3>{preview.quarantined?<><Lock/> Quarantined</>:'Blast radius'}</h3>
     <p className="mc-headline">Exposure: <strong>{preview.summary.exposedAgents} agent{preview.summary.exposedAgents===1?'':'s'} · {preview.summary.exposedCalls} call{preview.summary.exposedCalls===1?'':'s'}</strong>{preview.summary.resourcesExposed.length?` · ${preview.summary.resourcesExposed.join(', ')}`:''}</p>
     <p className={'mc-badge '+(preview.summary.restrictedDataExposed?'block':'ok')}>Restricted customer data: {preview.summary.restrictedDataExposed?'EXPOSED':'not exposed'}</p>
     <ul className="mc-legend-list">
      <li className="exposed"><b>{preview.summary.exposedCalls}</b> calls ran and sent data <em>exposed</em></li>
      <li className="attempted"><b>{preview.summary.blockedAttempts}</b> attempts were blocked — never reached the tool <em>not exposed</em></li>
      <li className="unused"><b>{preview.summary.neverUsedAgents}</b> agents had access but never used it <em>risk only</em></li>
      <li className="baseline"><b>{preview.summary.baselineCalls}</b> calls by the agent without Precedent <em>ungoverned</em></li>
     </ul>
     <div className="mc-receipts"><span>Connector’s own receipt count</span><strong>{test?test.receipts.after:preview.receipts.count}</strong>{test&&<small className={test.receipts.after===test.receipts.before?'ok':'warn'}>{test.receipts.after===test.receipts.before?`unchanged (${test.receipts.before} → ${test.receipts.after})`:`increased (${test.receipts.before} → ${test.receipts.after})`}</small>}<small>{preview.receipts.source}</small></div>
     {test&&<p className={'mc-test '+(test.execution.status==='BLOCKED'?'blocked':'allowed')} role="status">Test call: <strong>{test.execution.status}</strong> · {test.execution.decision.reason} <code>{test.execution.decision.ruleId}</code></p>}
     {invalidated.length>0&&<p className="mc-muted">{invalidated.length} playbook{invalidated.length===1?'':'s'} using this tool marked “needs re-validation”.</p>}
     
    </article>
   </div>}
  </>}
 </div>;
}

function BlastGraph({preview}:{preview:Row}){
 const groups=[{kind:'exposed',items:preview.exposed},{kind:'attempted',items:preview.attempted},{kind:'baseline',items:preview.baseline},{kind:'unused',items:preview.neverUsed}].flatMap(group=>group.items.slice(0,6).map((item:Row)=>({...item,kind:group.kind})));
 const cx=320,cy=180,r=135;const locked=preview.quarantined;
 return <figure className={'mc-graph'+(locked?' locked':'')}>
  <svg viewBox="0 0 640 360" role="img" aria-label={`${preview.summary.exposedAgents} exposed agents, ${preview.summary.blockedAttempts} blocked attempts, ${preview.summary.neverUsedAgents} agents with unused access, ${preview.summary.baselineCalls} baseline calls${locked?'; tool quarantined':''}`}>
   {groups.map((node,index)=>{const angle=(index/Math.max(groups.length,1))*Math.PI*2-Math.PI/2;const x=cx+Math.cos(angle)*r*1.55,y=cy+Math.sin(angle)*r*0.95;
    return <g key={node.kind+node.sessionId} className={'mc-node '+node.kind} style={{animationDelay:`${index*90}ms`}}>
     <line x1={x} y1={y} x2={cx} y2={cy} className="mc-edge"/>
     {node.kind==='attempted'&&<text x={(x+cx)/2} y={(y+cy)/2+4} className="mc-x" textAnchor="middle">✕</text>}
     <circle cx={x} cy={y} r={15}/><text x={x} y={y+31} textAnchor="middle" className="mc-node-label">{node.agentId}</text>
     {node.calls!=null&&<text x={x} y={y+4} textAnchor="middle" className="mc-node-count">{node.calls}</text>}
    </g>;})}
   <g className="mc-center"><circle cx={cx} cy={cy} r={52}/><text x={cx} y={cy-6} textAnchor="middle">{shortLabels[preview.toolId]??'Connector'}</text><text x={cx} y={cy+14} textAnchor="middle" className="mc-center-version">v{preview.toolVersion}</text>{locked&&<text x={cx} y={cy+74} textAnchor="middle" className="mc-locked-label">QUARANTINED</text>}</g>
  </svg>
  <figcaption><span className="exposed">Exposed</span><span className="attempted">Blocked attempt</span><span className="baseline">Without Precedent</span><span className="unused">Access, never used</span></figcaption>
 </figure>;
}

function MemoryTab({state,api,canAdmin}:{state:Row|null;api:Api;canAdmin:boolean}){
 const entries=[...(state?.knowledge??[])].sort((a:Row,b:Row)=>b.approvedAt-a.approvedAt);
 const denied=(state?.memoryCandidates??[]).filter((c:Row)=>c.status==='DENIED');
 const [selected,setSelected]=useState('');const entry=entries.find((k:Row)=>k.id===selected)??entries[0];
 const uses=entry?(state?.runs??[]).filter((run:Row)=>run.knowledgeIds?.includes(entry.id)).map((run:Row)=>run.id+run.status).join():'';
 const {data:comparison,error:comparisonError}=useEvidence(entry?'knowledge/'+entry.id+'/comparison':null,uses+(entry?.status??''),api,canAdmin);
 // Until the measured comparison arrives, show that it is loading rather than "not recorded".
 const loading=Boolean(entry)&&!comparison;
 const learning=comparison?.learning,reuse=comparison?.reuse;
 const metrics=[{name:'Warehouse queries',a:learning?.queries,b:reuse?.queries,unit:''},{name:'Empty results',a:learning?.emptyResults,b:reuse?.emptyResults,unit:''},{name:'User interventions',a:learning?.userInterventions,b:reuse?.userInterventions,unit:''},{name:'Model tokens',a:learning?.tokens,b:reuse?.tokens,unit:''},{name:'Time',a:learning?.durationMs!=null?learning.durationMs/1000:null,b:reuse?.durationMs!=null?reuse.durationMs/1000:null,unit:'s'}];
 const value=(v:number|null|undefined,unit:string)=>loading?'…':v==null?'not recorded':unit?v.toFixed(1)+unit:v.toLocaleString();
 return <div className="mc-grid">
  <article className="mc-card">
   <h3>Approved agent memory</h3>
   {!entries.length?<p className="mc-muted">Nothing learned yet. In the <strong>With Precedent</strong> chat, choose the data warehouse scope and ask a question. When the first attempt finds nothing, point the agent to the right table; after it answers, approve saving it for your department.</p>:
    <ul className="mc-memory-list">{entries.map((k:Row)=><li key={k.id}><button className={'secondary'+(entry?.id===k.id?' active':'')} onClick={()=>setSelected(k.id)}><span className="mc-badge info">{k.department}</span><strong><code>{k.table}</code></strong><small>{k.question}</small><span className={'mc-badge '+(k.status==='VALID'?'ok':'warn')}>{k.status==='VALID'?'Valid':'Needs re-validation'}</span></button></li>)}</ul>}
   {denied.length>0&&<><h4>Blocked at the checkpoint</h4><ul className="mc-checks">{denied.map((c:Row)=><li key={c.id} className="fail"><span aria-hidden="true">✗</span><code>{c.table}</code> for {c.department??'no department'}<em>{c.checkpoint.code}</em></li>)}</ul><p className="mc-muted">{denied[0].checkpoint.reason}</p></>}
   
  </article>
  <article className="mc-card">
   <h3>Learning once vs reusing</h3>
   {!entry?<p className="mc-muted">The measured comparison appears after an entry is approved.</p>:comparisonError?<p className="mc-muted" role="alert">Could not load the comparison: {comparisonError}</p>:loading?<p className="mc-muted" role="status">Measuring from recorded runs…</p>:!reuse?<p className="mc-muted">Learned by {entry.department}. Ask a similar question as another {entry.department} user to see the reuse.</p>:<p className="mc-headline">A colleague in {entry.department} got the answer with <strong>{reuse.queries} quer{reuse.queries===1?'y':'ies'}</strong> and <strong>no help</strong>; learning it took {learning?.queries} queries, {learning?.emptyResults} empty result{learning?.emptyResults===1?'':'s'} and {learning?.userInterventions} user correction.</p>}
   {entry&&<><div className="mc-bars" role="table" aria-label="Measured memory comparison">{metrics.map(metric=>{const max=Math.max(metric.a??0,metric.b??0,1);return <div className="mc-bar-row" role="row" key={metric.name}><span role="rowheader">{metric.name}</span><div role="cell" className="mc-bar-pair">
    <div className="mc-bar"><i className="a" style={{width:`${((metric.a??0)/max)*100}%`}}/><b>{value(metric.a,metric.unit)}</b></div>
    <div className="mc-bar"><i className="b" style={{width:`${((metric.b??0)/max)*100}%`}}/><b>{loading||reuse?value(metric.b,metric.unit):'waiting'}</b></div></div></div>;})}</div>
   <p className="mc-legend"><span className="a"/>First time · learned with the user <span className="b"/>Reuse · approved agent memory</p></>}
   <small className="mc-muted">{comparison?.source??'Measured from recorded runs.'}</small>
  </article>
 </div>;
}
