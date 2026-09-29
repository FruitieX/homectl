/* Study 04: restore the approved flow/table structure around complex controls. */
const complex03Renderer=renderers['complex-routine'];
renderers['complex-routine']=function(){
  const root=document.createElement('div');root.innerHTML=complex03Renderer();
  const grid=root.querySelector('.complex-grid');
  const [when,condition,then]=grid.querySelectorAll('.flow-section03');
  const headings=['WHEN','ONLY IF','THEN'];
  const subtitles=['Either event','Must pass','First matching branch'];
  [when,condition,then].forEach((lane,i)=>{
    lane.className='routine-lane04';
    lane.querySelector('.flow-section-title').outerHTML=`<div class="lane-title"><span>${headings[i]}</span><small>${subtitles[i]}</small></div>`;
  });
  when.querySelectorAll('.start03').forEach((node,i)=>{
    node.classList.add('node');
    node.querySelector('.action03-head').classList.add('nodehead');
    node.querySelector('.action03-head').insertAdjacentHTML('afterbegin',`<span class="nodeicon">${i?'◷':'◉'}</span>`);
  });
  const group=condition.querySelector('.condition-group03');
  group.classList.add('node');
  group.insertAdjacentHTML('afterbegin','<div class="nodehead"><span class="nodeicon">⋔</span>Only if<span class="tag">ALL</span></div>');
  group.append(condition.querySelector('.hint'));
  const choose=document.createElement('div');choose.className='node choose-node04';
  choose.innerHTML='<div class="nodehead"><span class="nodeicon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M5 4v16m0-12h8l5-4M5 16h8l5 4"/></svg></span>Choose a branch<span class="tag">FIRST MATCH</span></div>';
  const explainer=then.querySelector('.branch-explainer');explainer.textContent='First match runs. Other branches are skipped.';
  choose.append(explainer,then.querySelector('.branch-list03'),then.querySelector('[data-add03="branch"]'),then.querySelector(':scope>.hint'));
  then.append(choose);
  const board=document.createElement('section');board.className='flow-board complex-flow04';
  board.innerHTML='<div class="flow-header"><span>Any starting event → check conditions → run actions in order</span><span class="tag">Auto layout</span></div><div class="flow-columns complex-columns04"></div>';
  board.querySelector('.flow-columns').append(when,condition,then);
  grid.replaceWith(board);
  board.insertAdjacentHTML('beforebegin','<div class="flow-tabs"><span class="selected">Flow</span><button class="subtle" data-demo="Activity shows recorded attempts and their actual evidence.">Activity ↗</button><button class="subtle" data-demo="Definition editing preserves stable node IDs and unknown fields.">Definition</button></div>');
  root.querySelector('.inline-jump').textContent='Open matching timer action ↗';
  const timerHint=root.querySelector('#timer-step .hint');timerHint.textContent='Replaces the countdown for this routine.';
  return root.innerHTML;
};
const scene03Renderer=renderers['scene-modes'];
function prepareModeRow04(card){
  card.classList.add('mode-row04');
  const content=card.querySelector('[data-mode-content03]');
  if(content){
    const value=card.querySelector('[data-target-mode03]')?.value||'Set values';
    content.dataset.kind=value;
    content.classList.toggle('explicit-values04',value==='Set values');
    content.classList.toggle('linked-values04',value!=='Set values');
  }
}
renderers['scene-modes']=function(){
  const root=document.createElement('div');root.innerHTML=scene03Renderer();
  root.querySelector('.pagehead p').textContent='Edit target values and linked sources in place.';
  const list=root.querySelector('.mode-targets03');
  list.classList.add('scene-table04');
  list.insertAdjacentHTML('beforebegin','<div class="scene-columns04" aria-hidden="true"><span>Target</span><span>State source</span><div><span>Power</span><span>Brightness · %</span><span>Color</span><span>Transition · s</span></div></div>');
  list.querySelectorAll('.mode-card03').forEach(prepareModeRow04);
  root.querySelector('.target-section .section-heading p').textContent='Explicit values align by column. Linked targets show their source and resolved state.';
  return root.innerHTML;
};
const after03=afterRender03;
afterRender03=function(){after03();if(page==='complex-routine')$('#crumb').innerHTML='<a href="#home">Settings</a><span>/</span><a href="#routine">Routines</a>';if(page==='scene-modes')$('#crumb').innerHTML='<a href="#home">Settings</a><span>/</span><a href="#scene">Scenes</a>';};
document.addEventListener('change',e=>{if(e.target.matches('[data-target-mode03]')){prepareModeRow04(e.target.closest('.mode-card03'));setDirty();}});
// Newly selected targets receive exactly the same responsive row treatment.
const mainObserver04=new MutationObserver(()=>{document.querySelectorAll('.scene-table04>.mode-card03:not(.mode-row04)').forEach(prepareModeRow04);document.querySelectorAll('.routine-lane04>.start03:not(.node)').forEach(node=>{node.classList.add('node');node.querySelector('.action03-head')?.classList.add('nodehead');});});
mainObserver04.observe(document.querySelector('#main'),{childList:true,subtree:true});
// Keep both older study URLs usable; the complex routes show this revision.
drafts.delete(page);page='';render();
