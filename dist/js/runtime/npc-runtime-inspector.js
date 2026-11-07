import {NpcInspectionSelection,inspectionConnection,recordedTimestamp} from './inspection-model.js';
/** @import {NpcRuntimeBinding} from './npc-binding.contracts' */
/** @import {RuntimeSnapshot} from './contracts' */
const escapeText=(/** @type {unknown} */value)=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]??''));
/** @param {readonly [string,unknown][]} rows */
const fields=rows=>`<dl>${rows.map(([label,value])=>`<dt>${escapeText(label)}</dt><dd>${escapeText(value??'Not available')}</dd>`).join('')}</dl>`;
/** Only explicit projection fields are serialized. No diagnostics or payload spreading.
 * @param {NpcRuntimeBinding|undefined} binding
 * @param {ReturnType<import('./npc-status.js').visualForBinding>} visual
 * @param {NpcInspectionSelection} [selection]
 * @param {RuntimeSnapshot} [runtime] */
export function runtimeInspectorHtml(binding,visual,selection=new NpcInspectionSelection(),runtime){
 if(runtime?.phase==='AUTH_REQUIRED'||runtime?.phase==='DISCONNECTED'||['AUTH_REQUIRED','FORBIDDEN','NOT_FOUND'].includes(runtime?.error?.code??'')){
  const known=selection.hadAssociation();selection.clearProtected();
  return known?`<p role="status" class="runtime-access-status">${runtime?.phase==='DISCONNECTED'?'Runtime disconnected.':runtime?.error?.code==='NOT_FOUND'?'Runtime scope unavailable.':'Runtime authorization unavailable.'} Protected Agent details have been cleared.</p>`:'';
 }
 if(!binding||binding.state==='UNBOUND'||!visual){selection.clear();return '';}
 const a=binding.state==='RESOLVED'?binding.activity:null,model=selection.read(binding);
 /** @type {[string,unknown][]} */const rows=[['Runtime status',visual.label],['Binding',binding.state],['Freshness',binding.freshness],['NPC identity',binding.npcId]];
 if(a){rows.push(['Registered Agent',a.name],['Agent ID',a.agentId],['Agent type',a.agentType],['Availability',a.availability],['Current activity',a.activityStatus]);
  if(a.currentTask)rows.push(['Current Task',a.currentTask.id],['Task status',a.currentTask.status]);
  if(a.currentExecution)rows.push(['Execution',a.currentExecution.id]);
  if(a.recentOutcome){rows.push(['Last outcome',a.recentOutcome.status],['Outcome time',recordedTimestamp(a.recentOutcome.finishedAt)]);if(a.recentOutcome.executionStatus)rows.push(['Last execution status',a.recentOutcome.executionStatus]);}
  rows.push(['Last activity',recordedTimestamp(a.lastActivityAt)],['Observed by backend',recordedTimestamp(a.observedAt)]);
 }
 rows.push(['Last synchronized',recordedTimestamp(binding.lastSuccessfulSyncAt)]);
 const selected=model.selected;
 const details=selected?`${fields([['Record',selected.current?'Current execution reference':'Historical/latest execution reference'],['Execution ID',selected.id],['Task ID',selected.taskId],
  ['Execution status',selected.status],['Task status',selected.taskStatus],['Attempt number',selected.attemptNumber],['Completed at',selected.finishedAt]])}
  <p>Created/start timestamps, elapsed time, completed duration, strategy/provider, task summary and result text are not disclosed by the city activity API.</p>
  <p>${selected.status==='FAILED'?'Recorded execution failed. No diagnostic message is disclosed.':selected.status==='TIMED_OUT'?'Recorded execution timed out. No diagnostic message is disclosed.':selected.status==='CANCELLED'?'Recorded execution was cancelled.':selected.status==='SUCCEEDED'?'Recorded execution succeeded. Result content is not disclosed.':'This is a recorded execution state, not a live progress feed.'}</p>`:
  '<p>No execution reference is available in the authorized activity projection.</p>';
 const history=model.executions.length?`<ul class="runtime-reference-list">${model.executions.map(e=>`<li><button type="button" data-runtime-execution="${escapeText(e.id)}" aria-pressed="${e.id===selected?.id}">${e.current?'Current':e.latest?'Latest':'Recent outcome'}: ${escapeText(e.status)}<small>${escapeText(e.id)}</small></button></li>`).join('')}</ul>`:'<p>No recent execution reference is available.</p>';
 const timeline=model.timeline.length?`<ol>${model.timeline.map(e=>`<li><strong>${escapeText(e.label)}</strong> <time datetime="${escapeText(e.time)}">${escapeText(e.time)}</time><p>Task ${escapeText(e.taskId)}${e.executionId?` · Execution ${escapeText(e.executionId)}`:''}</p></li>`).join('')}</ol>`:'<p>No timestamped outcome is available.</p>';
 return `<section aria-label="Agent runtime" class="runtime-inspection" data-inspection-scope="${escapeText(model.scope)}"><h3>Agent Details</h3><p>Recorded backend activity; separate from local simulation.</p>
  <p role="status">${escapeText(inspectionConnection(runtime,binding))}</p>${fields(rows)}
  <details data-runtime-details="execution" open><summary>Execution details</summary>${details}</details>
  <details data-runtime-details="references"><summary>Recent execution references</summary><p>Partial projection, at most three references; current first, then latest. This is not full execution history or timestamp-sorted history.</p>${history}</details>
  <details data-runtime-details="timeline"><summary>Latest recorded outcome</summary><p>One lifecycle outcome from the activity projection; full audit history and tool events are not available to this city credential.</p>${timeline}</details></section>`;
}

/** DOM ownership stays with the existing inspector. Preserve expansion, focus and scroll only within one authorized binding scope. */
const rendered=new WeakMap();
/** @param {HTMLElement} element @param {string} html */
export function replaceInspectorContent(element,html){
 const cached=rendered.get(element);if(cached?.html===html&&cached.node===element.firstChild)return;
 const oldScope=element.querySelector('[data-inspection-scope]')?.getAttribute('data-inspection-scope');
 const opened=new Map(Array.from(element.querySelectorAll('details[data-runtime-details]')).map(node=>[node.getAttribute('data-runtime-details'),node.hasAttribute('open')]));
 const focused=element.contains(element.ownerDocument.activeElement)?element.ownerDocument.activeElement:null;
 const execution=focused?.closest('[data-runtime-execution]')?.getAttribute('data-runtime-execution');
 const summary=focused?.tagName==='SUMMARY'?focused.parentElement?.getAttribute('data-runtime-details'):null;
 const scroll=element.parentElement?.scrollTop??0;
 element.innerHTML=html;rendered.set(element,{html,node:element.firstChild});
 const sameScope=oldScope&&oldScope===element.querySelector('[data-inspection-scope]')?.getAttribute('data-inspection-scope');
 if(!sameScope)return;
 for(const node of Array.from(element.querySelectorAll('details[data-runtime-details]'))){
  const state=opened.get(node.getAttribute('data-runtime-details'));if(state!==undefined)node.toggleAttribute('open',state);
 }
 const target=execution?Array.from(element.querySelectorAll('[data-runtime-execution]')).find(node=>node.getAttribute('data-runtime-execution')===execution):
  summary?Array.from(element.querySelectorAll('details[data-runtime-details]')).find(node=>node.getAttribute('data-runtime-details')===summary)?.querySelector('summary'):null;
 if(target instanceof HTMLElement)target.focus({preventScroll:true});
 if(element.parentElement)element.parentElement.scrollTop=scroll;
}
