import React,{useLayoutEffect,useRef,useState} from 'react';
import {McpRequestControls} from './McpRequestControls.js';
import {Icon} from './Icon.js';

type Row = Record<string, any>;
interface Props {
 mode: 'baseline' | 'governed';
 mcpRequest?:Row;
 mcpDemand?:Row;
 now:number;
 currentVersion:number;
 onMcpAction:(path:string,body:unknown)=>void;
 run?: Row;
 draft: string;
 scenario: string;
 sending: boolean;
 canSend: boolean;
 history: Row[];
 onDraft: (value:string) => void;
 onScenario: (value:string) => void;
 onSend: () => void;
 executions: Row[];
 receipts: Row[];
 busy: boolean;
 onRepeat: (execution: Row) => void;
 onResume: (id: string) => void;
 onOpenControls: () => void;
 department?: string|null;
 memoryCandidate?: Row;
 onMemoryDecision?: (id:string,approve:boolean)=>void;
 onHint?: (table:string,definitions:string)=>void;
}
const activePhases=['PREPARING','RETRIEVING','PLANNING','EXECUTING'];
// The visible progress steps for a run; the governed agent also reads company context.
function RunSteps({status,governed}:{status:string;governed:boolean}){
 const steps:[string,string,string][]=[...(governed?[['RETRIEVING','Context','Reading current policy and memory'] as [string,string,string]]:[]),['PLANNING','Plan','The model is choosing tools'],['EXECUTING','Act',governed?'Each action is checked, then run':'Running the plan']];
 const at=activePhases.indexOf(status);
 return <ol className="run-steps" aria-hidden="true">{steps.map(([phase,label,detail])=>{const index=activePhases.indexOf(phase);const state=at>index?'done':at===index?'current':'pending';return <li key={phase} className={state}><span className="run-step-dot"/><span><strong>{label}</strong><small>{detail}</small></span></li>;})}</ol>;
}
const phaseText: Record<string, string> = {
 PREPARING: 'Starting a fresh agent session…',
 RETRIEVING: 'Retrieving current policy and relevant experience…',
 PLANNING: 'The model is preparing a tool plan…',
 EXECUTING: 'Executing the recorded plan…',
 WAITING: 'An action needs your approval. Review it below.',
 FINISHED: 'Run finished. Review the action results below.',
 FAILED: 'This run failed. No scripted fallback was substituted.',
 UNKNOWN: 'An action has an unconfirmed outcome. Check the audit before retrying.',
};
const columnLabels:Record<string,string>={iso_week:'Week',region:'Region',active_customers:'Active customers',revenue_usd:'Revenue (USD)',customer_id:'Customer',quarter:'Quarter'};
// A few rows of a query result as a small table; the numeric column gets an inline bar.
function ResultPreview({preview}:{preview:{table:string;columns:string[];rows:Record<string,string|number>[];rowCount:number}}){
 const numeric=preview.columns.find(column=>preview.rows.every(row=>typeof row[column]==='number'));
 const max=numeric?Math.max(...preview.rows.map(row=>Number(row[numeric])),1):1;
 return <figure className="result-preview" aria-label={`Preview of ${preview.table}`}>
  <figcaption><strong>{preview.rowCount} {preview.rowCount===1?'row':'rows'}</strong> from <code>{preview.table}</code></figcaption>
  <table><thead><tr>{preview.columns.map(column=><th key={column} className={column===numeric?'num':undefined}>{columnLabels[column]??column}</th>)}</tr></thead>
   <tbody>{preview.rows.map((row,index)=><tr key={index}>{preview.columns.map(column=><td key={column} className={column===numeric?'num':undefined}>{column===numeric?<><span className="bar" style={{width:`${Math.round(Number(row[column])/max*100)}%`}} aria-hidden="true"/><span>{Number(row[column]).toLocaleString()}</span></>:String(row[column])}</td>)}</tr>)}</tbody></table>
  {preview.rowCount>preview.rows.length&&<p className="result-footnote">Showing the {preview.rows.length} most recent of {preview.rowCount} rows. The full result is in the tool output below.</p>}
 </figure>;
}
export function AgentConversation({mode,run,mcpRequest,mcpDemand,now,currentVersion,onMcpAction,draft,scenario,sending,canSend,history,onDraft,onScenario,onSend,executions,receipts,busy,onRepeat,onResume,onOpenControls,department,memoryCandidate,onMemoryDecision,onHint}: Props) {
 const [hintTable,setHintTable]=useState(''),[hintDefinitions,setHintDefinitions]=useState('');
 const governed = mode === 'governed';
 const conversationalReply=Boolean(run?.reply&&run.status==='FINISHED'&&!run.plan?.length);
 // A finished tool run is summarized in plain language from its recorded outcomes and receipts;
 // nothing here comes from the model, so no number can be invented.
 const finishedSummary=(()=>{if(run?.status!=='FINISHED'||!executions.length)return null;
  const ok=executions.filter(e=>e.status==='SUCCEEDED'),blocked=executions.filter(e=>e.status==='BLOCKED');
  const previews=ok.map(e=>receipts.find(r=>r.id===e.receiptId)?.preview).filter(Boolean);
  const empty=ok.filter(e=>String(receipts.find(r=>r.id===e.receiptId)?.result??'').startsWith('0 rows'));
  const parts:string[]=[];
  if(previews.length){const p=previews[0];parts.push(`Here's what I found: ${p.rowCount} ${p.rowCount===1?'row':'rows'} from ${p.table}.${p.rowCount>p.rows.length?` The ${p.rows.length} most recent are below.`:''}`);}
  else if(empty.length)parts.push(`${empty[0].action.target??'That table'} returned no rows for this question.`);
  else if(ok.length)parts.push(`Done. ${ok.length===1?'1 action ran':`${ok.length} actions ran`}; the results are below.`);
  if(blocked.length)parts.push(`${blocked.length===1?'1 action was':`${blocked.length} actions were`} blocked by policy before running.`);
  return parts.join(' ')||null;})();
 const promptRef=useRef<HTMLTextAreaElement>(null),contentRef=useRef<HTMLDivElement>(null);
 // Show the message immediately while the request is being accepted.
 const pendingPrompt=sending&&draft.trim()?draft.trim():'';
 const working=Boolean(pendingPrompt)||Boolean(run&&activePhases.includes(run.status));
 // Like a desktop assistant: while working, keep your latest message and its status at
 // the top of the view; when results or a memory proposal arrive, reveal them.
 const scrollTo=(top:number)=>{const element=contentRef.current;if(!element)return;const reduce=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;element.scrollTo({top,behavior:reduce?'auto':'smooth'});};
 useLayoutEffect(()=>{const message=contentRef.current?.querySelector<HTMLElement>('.user-message:last-of-type');if(message&&contentRef.current)scrollTo(Math.max(0,message.offsetTop-contentRef.current.offsetTop-12));},[run?.id,pendingPrompt]);
 useLayoutEffect(()=>{if(run&&!activePhases.includes(run.status)&&contentRef.current)scrollTo(contentRef.current.scrollHeight);},[run?.status,executions.length,memoryCandidate?.status]);
 useLayoutEffect(()=>{const input=promptRef.current;if(input){input.style.height='auto';input.style.height=`${Math.min(input.scrollHeight,180)}px`;}},[draft]);
 const starters=[
  {prompt:'Connect Tenable MCP to read its developer documentation.',scope:'investigation',icon:'link',title:'Connect Tenable MCP',detail:'Test connection permissions'},
  {prompt:'Use internal_logs.search to investigate checkout errors in customer logs.',scope:'investigation',icon:'activity',title:'Investigate checkout errors',detail:'Search internal customer logs'},
  {prompt:'Use staging_db.read to check the staging records.',scope:'staging',icon:'clock',title:'Request staging access',detail:'Test a temporary approval'},
  {prompt:'Weekly active customers by region last quarter',scope:'warehouse',icon:'activity',title:'Query the data warehouse',detail:'Undocumented tables, learn once'},
 ] as const;
 const choosePrompt=(prompt:string,scope:string)=>{onDraft(prompt);onScenario(scope);promptRef.current?.focus();};
 return <section className={`panel conversation ${mode}`} aria-label={governed?'With Precedent conversation':'Without Precedent conversation'}>
  <div className="terminal-header"><span className="agent-avatar"><Icon name={governed?'shield':'terminal'}/></span><div className="agent-identity"><h2>{governed?'With Precedent':'Without Precedent'}</h2><small>{governed?'Policy-aware agent':'Baseline agent'}</small></div><span className="pill">{governed?'Policy enforced':'Controlled bypass'}</span></div>
  <div className="conversation-content" ref={contentRef} aria-busy={working}>
  {history.length>0&&<details className="chat-history"><summary>{history.length===1?'Show 1 earlier message':`Show ${history.length} earlier messages`}</summary>{history.map(previous=><div className="history-turn" key={previous.id}><p className="history-user">{previous.task}</p><p className="history-agent">{previous.reply?previous.reply:phaseText[previous.status]??previous.status}</p>{(previous.results??[]).map((result:Row)=><p className="history-result" key={result.id}><strong>{result.toolId}{result.target?' · '+result.target:''}</strong> · {result.verdict??'NO DECISION'}{result.result?' · '+String(result.result):''}</p>)}</div>)}</details>}
  {pendingPrompt ? <div className="pending-turn">
   <div className="chat-message user-message"><span className="message-author">You</span><p>{pendingPrompt}</p></div>
   <div className="assistant-response"><div className="chat-message agent-message"><span className="message-author">Agent activity</span><p className="thinking" role="status"><span className="thinking-mark" aria-hidden="true"/>Sending your message…</p></div></div>
  </div> : run ? <>
   <div className="chat-message user-message"><span className="message-author">You</span><p>{run.task}</p></div>
   <div className="assistant-response"><div className="chat-message agent-message"><span className="response-avatar"><Icon name={governed?'shield':'terminal'}/></span><span className="message-author">{conversationalReply?'Agent':'Agent activity'}</span><p aria-label={`${mode} run status`} aria-live="polite" className={activePhases.includes(run.status)?'thinking':undefined}>{activePhases.includes(run.status)&&<span className="thinking-mark" aria-hidden="true"/>}{conversationalReply?run.reply:finishedSummary??(run.responseMode==='reply'&&['PREPARING','PLANNING'].includes(run.status)?'Writing a reply…':phaseText[run.status]??run.status)}<small>{conversationalReply?'No tools used':`Run status: ${run.status}${run.failedPhase?` · failed during ${run.failedPhase}`:''}`}</small></p>{activePhases.includes(run.status)&&run.responseMode!=='reply'&&<RunSteps status={run.status} governed={governed}/>}</div>
   {run.context && <details className="context-inspector"><summary>Inspect context · policy v{run.context.policy.version} · {(count=>`${count} ${count===1?'memory':'memories'}`)(run.context.episodes.length+(run.context.knowledge?.length??0)+(run.context.playbooks?.length??0))}{run.context.knowledge?.length?` · ${run.context.knowledge.length} from agent memory`:''}</summary><p>{run.context.retrieval?.mode} · {run.context.retrieval?.reason}</p>{run.context.currentRules?.map((rule:Row)=><p key={rule.id}><strong>{rule.id}</strong> · {rule.description}</p>)}<h3>Semantic policy memory</h3>{run.context.semanticMemory?.map((rule:Row)=><p key={rule.id}><strong>{rule.ruleId}</strong> · {rule.description}<small>Current policy v{rule.policyVersion}</small></p>)}{run.context.knowledgeRetrieval&&<><h3>Agent memory · {run.context.knowledgeRetrieval.department??'no department'}</h3>{run.context.knowledge?.length?run.context.knowledge.map((entry:Row)=><p key={entry.id}><strong>{entry.table}</strong> · {entry.question}{entry.definitions&&<small>{entry.definitions}</small>}<small>Approved for {entry.approvedForDepartment} · matched by {run.context.knowledgeRetrieval.engine}</small></p>):<p>No approved agent memory for this department matched this question.</p>}</>}<p>{run.context.episodes.length} persisted experiences retrieved from other sessions.</p>{run.context.episodes.map((episode:Row)=><p key={episode.id}>{episode.kind==='run-outcome'&&<strong>Run outcome · {episode.outcomeStatus} · </strong>}{episode.summary}<small>{episode.evidenceIds?.length?`${episode.evidenceIds.length} execution references · `:''}Evidence {episode.evidenceId.slice(0,8)}</small></p>)}</details>}
   {run.plan?.length>0 && <details className="plan-inspector"><summary>Inspect proposed plan · {run.plan.length} actions</summary>{run.structuredPlan?.unverifiedReferences?.length>0&&<p className="muted">{run.structuredPlan.unverifiedReferences.length} unsupported model citations omitted; original values remain in the audit.</p>}<ol>{run.plan.map((step:string,index:number)=><li key={index}>{step}{run.structuredPlan?.steps[index]&&<small>{run.structuredPlan.steps[index].purpose} · policies {run.structuredPlan.steps[index].policyReferences.join(', ')||'none'} · memories {run.structuredPlan.steps[index].memoryReferences.join(', ')||'none'}</small>}</li>)}</ol></details>}
   {run.mcpResult&&<article className="decision mcp-connection" aria-label={`${mode} MCP connection result`}><div className="tool-command"><code>{run.mcpResult.name?(/\bmcp$/i.test(run.mcpResult.name)?run.mcpResult.name:`${run.mcpResult.name} MCP`):"Tenable documentation MCP"}</code><strong className={run.mcpResult.decision.verdict==='BLOCK'?'BLOCKED':run.mcpResult.decision.verdict==='REQUIRE_APPROVAL'?'PENDING':'SUCCEEDED'}>{run.mcpResult.decision.verdict}</strong></div><p>{run.mcpResult.decision.reason}</p>{run.mcpResult.classification&&<p className={'mcp-check '+(run.mcpResult.classification.searchRelated?'flagged':'clear')}><Icon name="shield"/><span><strong>Policy check · {run.mcpResult.classification.judge}</strong>{run.mcpResult.classification.searchRelated?'Web search or browsing MCP (MCP-03)':'Not a web search MCP'} · {run.mcpResult.classification.reason}</span></p>}<div className="connection-outcome"><strong>{run.mcpResult.status.replaceAll('_',' ')}</strong><p>{run.mcpResult.message}</p></div><small>Policy v{run.mcpResult.decision.policyVersion} · {run.mcpResult.endpoint}</small>{run.mcpResult.tools.length>0&&<details><summary>Discovered tools · {run.mcpResult.tools.length}</summary>{run.mcpResult.tools.map((tool:string)=><p key={tool}><code>{tool}</code></p>)}</details>}</article>}
   {mcpRequest&&<McpRequestControls key={mcpRequest.id} request={mcpRequest} demand={mcpDemand} mode={mode} busy={busy} now={now} currentVersion={currentVersion} onAction={onMcpAction}/>}
   <div className="tool-activity" aria-label={`${mode} tool activity`}>
    {executions.map(execution=>{
     const receipt=receipts.find(item=>item.id===execution.receiptId);
     return <article className={`decision tool-message outcome-${execution.status.toLowerCase()}`} key={execution.id}>
      <div className="tool-command"><span aria-hidden="true">❯</span><code>{execution.action.toolId}</code><strong className={execution.status}>{execution.status}</strong></div>
      <p>{execution.decision.reason}</p>
      <small>{execution.action.target?<><code>{execution.action.target}</code> · </>:null}{execution.action.resourceId} · {execution.action.environment} · Policy v{execution.decision.policyVersion} · receipt {execution.receiptId?execution.receiptId.slice(0,8):'none'}</small>
      {receipt?.preview&&<ResultPreview preview={receipt.preview}/>}
      {receipt&&<details className="tool-result"><summary>{receipt.preview?'View full tool result':'View tool result'}</summary><pre>{typeof receipt.result==='string'?receipt.result:JSON.stringify(receipt.result,null,2)}</pre></details>}
      {governed&&execution.status==='SUCCEEDED'&&<button className="secondary" disabled={busy} onClick={()=>onRepeat(execution)}>Run this action again</button>}
      {execution.status==='PENDING'&&<div className="action-buttons"><button className="secondary" onClick={onOpenControls}>Review approval</button><button disabled={busy} onClick={()=>onResume(execution.id)}>Resume after approval</button></div>}
     </article>;
    })}
   </div>
   {run.scenario==='warehouse'&&run.status==='FINISHED'&&!run.hint&&executions.some(execution=>execution.status==='SUCCEEDED'&&String(receipts.find(item=>item.id===execution.receiptId)?.result??'').startsWith('0 rows'))&&onHint&&<form className="decision hint-form" aria-label={`${mode} table hint`} onSubmit={event=>{event.preventDefault();if(hintTable.trim())onHint(hintTable.trim(),hintDefinitions);}}>
    <strong>No results found.</strong><p>Company data is spread across many undocumented tables. If you know where this lives, point the agent to it.</p>
    <label>BigQuery table<input value={hintTable} onChange={event=>setHintTable(event.target.value)} placeholder="dataset.table" required maxLength={120}/></label>
    <label>Definitions (optional)<textarea value={hintDefinitions} onChange={event=>setHintDefinitions(event.target.value)} rows={2} maxLength={1000} placeholder="e.g. active = at least one order in the trailing 7 days"/></label>
    <button type="submit" disabled={busy||!hintTable.trim()}>Ask again with this table</button>
   </form>}
   {governed&&memoryCandidate&&<article className={`decision memory-card memory-${memoryCandidate.status.toLowerCase()}`} aria-label="Agent memory proposal">
    <strong>{memoryCandidate.status==='PROPOSED'?'Add this to agent memory?':memoryCandidate.status==='APPROVED'?'Saved to agent memory':memoryCandidate.status==='DENIED'?'Checkpoint: not saved to agent memory':'Not saved'}</strong>
    <p>Table <code>{memoryCandidate.table}</code>{memoryCandidate.definitions?<> · {memoryCandidate.definitions}</>:null}</p>
    <small>{memoryCandidate.checkpoint.code} · {memoryCandidate.checkpoint.reason}</small>
    {memoryCandidate.status==='PROPOSED'&&onMemoryDecision&&<div className="action-buttons"><button disabled={busy} onClick={()=>onMemoryDecision(memoryCandidate.id,true)}>Add to agent memory ({department??memoryCandidate.department} department)</button><button className="secondary" disabled={busy} onClick={()=>onMemoryDecision(memoryCandidate.id,false)}>Don't save</button></div>}
    {memoryCandidate.status==='APPROVED'&&<small>Shared only with the {memoryCandidate.department} department. Every future query is still checked by policy.</small>}
   </article>}
   <details className="run-inspector"><summary>Run details</summary><p>Session {run.sessionId} · {run.planner}</p><p>Run {run.id} · {run.status}</p>{run.workerSessionId&&<p>Worker {run.workerSessionId}</p>}</details>
  </div></> : <div className="conversation-empty"><span className="empty-prompt"><Icon name={governed?'shield':'terminal'}/></span><h3>What can I help you with?</h3><div className="starter-prompts">{starters.map(item=><button key={item.title} className="secondary" onClick={()=>choosePrompt(item.prompt,item.scope)}><Icon name={item.icon}/><span>{item.title}<small>{item.detail}</small></span><Icon name="arrow"/></button>)}</div></div>}
  </div>
  {/* Once a chat has started, the same shortcuts stay one click away above the composer. */}
  {(run||pendingPrompt)&&<div className="starter-chips" aria-label="Suggested prompts">{starters.map(item=><button key={item.title} type="button" className="secondary" aria-label={`Suggest: ${item.title}`} disabled={sending} onClick={()=>choosePrompt(item.prompt,item.scope)}><Icon name={item.icon}/>{item.title}</button>)}</div>}
  <form className="chat-composer" onSubmit={event=>{event.preventDefault();if(canSend&&draft.trim())onSend();}}>
   <div className="composer-surface"><label className="composer-label" htmlFor={`prompt-${mode}`}>Message {governed?'with':'without'} Precedent</label>
   <textarea ref={promptRef} id={`prompt-${mode}`} value={draft} maxLength={2000} onChange={event=>onDraft(event.target.value)} rows={2} placeholder={governed?'Message the governed agent…':'Message the baseline agent…'} onKeyDown={event=>{if(event.key==='Enter'&&!event.nativeEvent.isComposing&&(!event.shiftKey||event.metaKey||event.ctrlKey)){event.preventDefault();if(canSend&&draft.trim())onSend();}}}/>
   <div className="chat-send-row"><details><summary>Tools &amp; data<span className="scope-label">{scenario==='investigation'?'Customer logs':scenario==='sandbox'?'Sandbox logs':scenario==='sandbox-export'?'Sandbox export':scenario==='warehouse'?'Data warehouse':'Staging records'}</span></summary><label>Data scope<select aria-label={`${mode} data scope`} value={scenario} onChange={event=>onScenario(event.target.value)}><option value="investigation">Customer logs</option><option value="sandbox">Sandbox logs</option><option value="sandbox-export">Sandbox export</option><option value="staging">Staging records</option><option value="warehouse">Data warehouse (BigQuery-style)</option></select></label></details><button className="send-message" type="submit" aria-label={sending?'Sending…':'Send message'} title={sending?'Sending…':'Send message'} disabled={!canSend||!draft.trim()}><Icon name={sending?'clock':'arrowUp'}/></button></div></div>
  </form>
 </section>;
}
