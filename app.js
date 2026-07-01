'use strict';

/* ============================================================
   CORE UTILITIES
   ============================================================ */
function uid(){ return crypto.randomUUID ? crypto.randomUUID() : 'r'+Math.random().toString(36).slice(2); }

function toast(msg, isError=false){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = isError ? 'show error' : 'show';
  clearTimeout(toast._h);
  toast._h = setTimeout(()=>{ t.className=''; }, 3200);
}

function escHtml(s){ const d=document.createElement('div'); d.textContent=String(s==null?'':s); return d.innerHTML; }

function fmtDateLong(dateStr){
  if(!dateStr) return '';
  const d = new Date(dateStr + (dateStr.length<=10 ? 'T00:00:00' : ''));
  return d.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric', year:'numeric' });
}

function fmtDateShort(dateStr){
  if(!dateStr) return '';
  const d = new Date(dateStr + (dateStr.length<=10 ? 'T00:00:00' : ''));
  return d.toLocaleDateString('en-US', { month:'short', day:'numeric' });
}

function fmtNum(n){
  if(n==null || n==='' || isNaN(n)) return '—';
  return Number(n).toLocaleString('en-US', {minimumFractionDigits:0, maximumFractionDigits:2});
}

function todayISO(){
  const d = new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}

function downloadJSON(obj, filename){
  const blob = new Blob([JSON.stringify(obj, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function readFileAsText(file){
  return new Promise((resolve,reject)=>{
    const r = new FileReader();
    r.onload = ()=>resolve(r.result);
    r.onerror = reject;
    r.readAsText(file);
  });
}

/* ============================================================
   TAB SWITCHING
   ============================================================ */
function initTabs(){
  document.querySelectorAll('.tab-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('panel-'+btn.dataset.tab).classList.add('active');
      onTabShown(btn.dataset.tab);
    });
  });
}

let tabsLoaded = { log:false, inventory:false, planner:false, archive:false, budget:false };
function onTabShown(tab){
  if(tab==='log' && !tabsLoaded.log){ tabsLoaded.log=true; loadLogEntries(); }
  if(tab==='inventory' && !tabsLoaded.inventory){ tabsLoaded.inventory=true; loadInventory(); }
  if(tab==='planner' && !tabsLoaded.planner){ tabsLoaded.planner=true; initPlanner(); }
  if(tab==='archive' && !tabsLoaded.archive){ tabsLoaded.archive=true; loadArchiveLog(); }
  if(tab==='budget' && !tabsLoaded.budget){ tabsLoaded.budget=true; loadBudget(); }
}

/* ============================================================
   BOOTSTRAP
   ============================================================ */
async function waitForSupabase(){
  return new Promise(resolve=>{
    const check = ()=>{ if(supabaseReady) resolve(); else setTimeout(check,100); };
    check();
  });
}

async function init(){
  initSupabase();
  initTabs();
  wireBudgetEvents();
  await waitForSupabase();
  await refreshRowCount();
  await loadLogEntries();
  tabsLoaded.log = true;
}

document.addEventListener('DOMContentLoaded', init);

async function refreshRowCount(){
  try{
    const { count } = await sb.from('log_entries').select('id', {count:'exact', head:true});
    document.getElementById('rowCountLine').textContent = (count==null?'—':count) + ' log entries';
    document.getElementById('lastSyncLine').textContent = 'Synced ' + new Date().toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
  }catch(e){
    document.getElementById('rowCountLine').textContent = 'Connection pending';
    document.getElementById('lastSyncLine').textContent = '—';
  }
}

/* ============================================================
   LOG TAB
   ============================================================ */
const DAY_TYPES = ['Home Workout','Stretching','Physical Therapy','Hair Wash','Off','Other'];
const CYCLE_PHASES = ['Follicular','Ovulation','Luteal','Late Luteal/Menstrual','Irregular'];
const COMMON_AREAS = ['Feet & Calves','Knees','Shoulders','Back & Core','Hips','Jaw'];

let logState = { rows: [], page: 0, pageSize: 20, filters:{dayType:'',cyclePhase:'',flareOnly:''}, inventoryCache:null };

async function fetchInventoryForLinking(){
  if(logState.inventoryCache) return logState.inventoryCache;
  const { data, error } = await sb.from('inventory_items').select('id,category,version_tag,name,active').order('category').order('display_order');
  if(error){ toast('Could not load inventory for linking', true); return []; }
  logState.inventoryCache = data || [];
  return logState.inventoryCache;
}

async function loadLogEntries(reset=true){
  const listEl = document.getElementById('logList');
  if(reset){ logState.page = 0; }
  if(reset) listEl.innerHTML = '<div class="empty-state">Loading entries…</div>';

  let query = sb.from('log_entries')
    .select(`id,entry_date,day_number,day_type,day_type_custom,cycle_phase,headline,journal,entry_date_uncertain,
      log_body_updates(id,area,note,display_order),
      log_flare_notes(id,symptom,suspected_causes,area_link,display_order),
      log_newly_introduced(id,inventory_id,inventory_label_snapshot,description,display_order),
      log_attachments(id,url,label,display_order)`)
    .order('entry_date', {ascending:false})
    .range(logState.page*logState.pageSize, logState.page*logState.pageSize + logState.pageSize - 1);

  if(logState.filters.dayType) query = query.eq('day_type', logState.filters.dayType);
  if(logState.filters.cyclePhase) query = query.eq('cycle_phase', logState.filters.cyclePhase);

  const { data, error } = await query;
  if(error){ listEl.innerHTML = '<div class="empty-state">Could not load entries. Check your Supabase URL/key are filled in.</div>'; toast('Load failed: '+error.message, true); return; }

  let rows = data || [];
  if(logState.filters.flareOnly==='flare'){
    rows = rows.filter(r=> (r.log_flare_notes||[]).length>0 );
  }

  logState.rows = reset ? rows : logState.rows.concat(rows);
  renderLogList();
  document.getElementById('loadMoreBtn').style.display = (data && data.length===logState.pageSize) ? 'inline-block' : 'none';
  document.getElementById('logCountSub').textContent = logState.rows.length + ' entr' + (logState.rows.length===1?'y':'ies') + ' shown';
}

function dayTypeLabel(row){
  if(row.day_type==='Other' && row.day_type_custom) return row.day_type_custom;
  return row.day_type || '';
}

function renderLogList(){
  const listEl = document.getElementById('logList');
  if(!logState.rows.length){ listEl.innerHTML = '<div class="empty-state"><div class="empty-icon">📖</div>No entries yet — start your first one above.</div>'; return; }
  listEl.innerHTML = '';
  logState.rows.forEach(row=> listEl.appendChild(renderLogCard(row)) );
}

function renderLogCard(row){
  const card = document.createElement('div');
  card.className = 'card log-entry-card' + (row.entry_date_uncertain ? ' date-uncertain' : '');

  const top = document.createElement('div'); top.className='log-entry-top';
  const dateBlock = document.createElement('div'); dateBlock.className='log-date-block';
  dateBlock.innerHTML = `<span class="log-date">${escHtml(fmtDateLong(row.entry_date))}</span>` + (row.day_number!=null ? `<span class="log-daynum">Day ${escHtml(row.day_number)}</span>` : '');
  const tags = document.createElement('div'); tags.className='log-tags';
  if(row.entry_date_uncertain) tags.innerHTML += `<span class="uncertain-badge" title="Date recorded ambiguously in original notes — shifted to next day to resolve conflict">date uncertain</span>`;
  if(dayTypeLabel(row)) tags.innerHTML += `<span class="pill lav">${escHtml(dayTypeLabel(row))}</span>`;
  if(row.cycle_phase) tags.innerHTML += `<span class="pill watch">${escHtml(row.cycle_phase)}</span>`;
  if((row.log_flare_notes||[]).length) tags.innerHTML += `<span class="pill flare">${row.log_flare_notes.length} flare note${row.log_flare_notes.length>1?'s':''}</span>`;
  dateBlock.appendChild(tags);
  top.appendChild(dateBlock);

  const actions = document.createElement('div'); actions.style.display='flex'; actions.style.gap='10px';
  const editBtn = document.createElement('button'); editBtn.className='text-btn'; editBtn.textContent='Edit';
  editBtn.addEventListener('click', ()=> openEntryEditor(row) );
  const delBtn = document.createElement('button'); delBtn.className='text-btn'; delBtn.textContent='Delete';
  delBtn.addEventListener('click', ()=> deleteLogEntry(row.id) );
  actions.appendChild(editBtn); actions.appendChild(delBtn);
  top.appendChild(actions);
  card.appendChild(top);

  if(row.headline){
    const hl = document.createElement('div'); hl.className='log-headline'; hl.textContent='→ '+row.headline;
    card.appendChild(hl);
  }

  const bodyUpdates = (row.log_body_updates||[]).sort((a,b)=>a.display_order-b.display_order);
  if(bodyUpdates.length){
    const lbl = document.createElement('div'); lbl.className='log-section-label'; lbl.textContent='Body updates';
    card.appendChild(lbl);
    bodyUpdates.forEach(bu=>{
      const r = document.createElement('div'); r.className='body-update-row';
      r.innerHTML = `<span class="area-tag">${escHtml(bu.area)}</span><span>${escHtml(bu.note)}</span>`;
      card.appendChild(r);
    });
  }

  const flares = (row.log_flare_notes||[]).sort((a,b)=>a.display_order-b.display_order);
  if(flares.length){
    const lbl = document.createElement('div'); lbl.className='log-section-label'; lbl.textContent='Flare notes';
    card.appendChild(lbl);
    flares.forEach(f=>{
      const r = document.createElement('div'); r.className='flare-row';
      r.innerHTML = `<div class="flare-symptom">${escHtml(f.symptom)}</div>` + (f.suspected_causes? `<div class="flare-cause">Suspected: ${escHtml(f.suspected_causes)}</div>` : '');
      card.appendChild(r);
    });
  }

  const intros = (row.log_newly_introduced||[]).sort((a,b)=>a.display_order-b.display_order);
  if(intros.length){
    const lbl = document.createElement('div'); lbl.className='log-section-label'; lbl.textContent='Newly introduced';
    card.appendChild(lbl);
    intros.forEach(it=>{
      const r = document.createElement('div'); r.className='intro-row';
      const linkLabel = it.inventory_label_snapshot || '(unlinked)';
      r.innerHTML = `<span class="intro-link">${escHtml(linkLabel)}</span><span>${escHtml(it.description)}</span>`;
      card.appendChild(r);
    });
  }

  if(row.journal && row.journal.trim()){
    const j = document.createElement('div'); j.className='log-journal'; j.textContent = row.journal;
    card.appendChild(j);
  }

  const atts = (row.log_attachments||[]).sort((a,b)=>a.display_order-b.display_order);
  if(atts.length){
    const a = document.createElement('div'); a.className='log-attachments';
    a.innerHTML = atts.map(at=>`<a href="${escHtml(at.url)}" target="_blank" rel="noopener">${escHtml(at.label||at.url)}</a>`).join(' · ');
    card.appendChild(a);
  }

  return card;
}

async function deleteLogEntry(id){
  if(!confirm('Delete this entry? This cannot be undone.')) return;
  const { error } = await sb.from('log_entries').delete().eq('id', id);
  if(error){ toast('Delete failed: '+error.message, true); return; }
  logState.rows = logState.rows.filter(r=>r.id!==id);
  renderLogList();
  refreshRowCount();
  toast('Entry deleted');
}

/* ---------- Entry editor (new + edit) ---------- */
async function openEntryEditor(existing){
  const slot = document.getElementById('newEntryFormSlot');
  slot.innerHTML = '';
  const inventory = await fetchInventoryForLinking();

  const isNew = !existing;
  const data = existing ? JSON.parse(JSON.stringify(existing)) : {
    id:null, entry_date: todayISO(), day_number:null, day_type:'', day_type_custom:'',
    cycle_phase:'', headline:'', journal:'', entry_date_uncertain: false,
    log_body_updates:[], log_flare_notes:[], log_newly_introduced:[], log_attachments:[]
  };
  // working copies for sub-lists (each item gets a temp client id if new)
  data.log_body_updates = (data.log_body_updates||[]).map(x=>({...x, _cid:x.id||uid()})).sort((a,b)=>a.display_order-b.display_order);
  data.log_flare_notes = (data.log_flare_notes||[]).map(x=>({...x, _cid:x.id||uid()})).sort((a,b)=>a.display_order-b.display_order);
  data.log_newly_introduced = (data.log_newly_introduced||[]).map(x=>({...x, _cid:x.id||uid()})).sort((a,b)=>a.display_order-b.display_order);
  data.log_attachments = (data.log_attachments||[]).map(x=>({...x, _cid:x.id||uid()})).sort((a,b)=>a.display_order-b.display_order);

  const wrap = document.createElement('div');
  wrap.className = 'card';
  wrap.style.borderColor = 'var(--accent)';

  wrap.innerHTML = `
    <div class="section-title" style="font-size:16px;margin-bottom:14px;">${isNew?'New Entry':'Edit Entry'}</div>
    <div class="f-grid cols-3">
      <div class="f-row"><label class="f-label">Date</label><input type="date" class="f-input" id="ef-date" value="${escHtml(data.entry_date)}"></div>
      <div class="f-row"><label class="f-label">Day #</label><input type="number" class="f-input" id="ef-daynum" value="${data.day_number!=null?data.day_number:''}" placeholder="auto"></div>
      <div class="f-row"><label class="f-label">Day type</label>
        <select class="f-input" id="ef-daytype">
          <option value="">—</option>
          ${DAY_TYPES.map(t=>`<option value="${t}" ${data.day_type===t?'selected':''}>${t}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="f-row" id="ef-daytype-custom-wrap" style="${data.day_type==='Other'?'':'display:none;'}">
      <label class="f-label">Custom day-type label</label>
      <input type="text" class="f-input" id="ef-daytype-custom" value="${escHtml(data.day_type_custom||'')}" placeholder="e.g. Travel Day">
    </div>
    <div class="f-row">
      <label class="f-label">Cycle phase (optional, manual)</label>
      <select class="f-input" id="ef-cycle">
        <option value="">—</option>
        ${CYCLE_PHASES.map(p=>`<option value="${p}" ${data.cycle_phase===p?'selected':''}>${p}</option>`).join('')}
      </select>
    </div>
    <div class="f-row" style="display:flex;align-items:center;gap:10px;">
      <input type="checkbox" id="ef-uncertain" ${data.entry_date_uncertain?'checked':''} style="accent-color:var(--watch);width:15px;height:15px;cursor:pointer;">
      <label for="ef-uncertain" style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--watch);cursor:pointer;text-transform:uppercase;letter-spacing:.05em;">Date uncertain (originally logged ambiguously)</label>
    </div>
    <div class="f-row">
      <label class="f-label">Headline (the short "→" summary line)</label>
      <input type="text" class="f-input" id="ef-headline" value="${escHtml(data.headline||'')}" placeholder="e.g. V8's Introduction">
    </div>

    <div class="log-section-label">Body-area updates</div>
    <div class="subform-list" id="ef-body-list"></div>
    <button class="subform-add" id="ef-body-add" type="button">+ Add body-area update</button>

    <div class="log-section-label" style="margin-top:18px;">Flare notes — symptom + suspected cause</div>
    <div class="subform-list" id="ef-flare-list"></div>
    <button class="subform-add" id="ef-flare-add" type="button">+ Add flare note</button>

    <div class="log-section-label" style="margin-top:18px;">Newly introduced (linked to inventory)</div>
    <div class="subform-list" id="ef-intro-list"></div>
    <button class="subform-add" id="ef-intro-add" type="button">+ Add newly introduced item</button>

    <div class="f-row" style="margin-top:18px;">
      <label class="f-label">Journal — free-text, unstructured</label>
      <textarea class="f-input" id="ef-journal" rows="6" placeholder="Write whatever you need to here.">${escHtml(data.journal||'')}</textarea>
    </div>

    <div class="log-section-label">Attachments</div>
    <div class="subform-list" id="ef-att-list"></div>
    <button class="subform-add" id="ef-att-add" type="button">+ Add attachment link</button>

    <div class="log-card-actions">
      <button class="text-btn" id="ef-cancel" type="button">Cancel</button>
      <button class="btn accent" id="ef-save" type="button">${isNew?'Save Entry':'Save Changes'}</button>
    </div>
  `;

  slot.appendChild(wrap);

  // day type -> custom field toggle
  wrap.querySelector('#ef-daytype').addEventListener('change', e=>{
    wrap.querySelector('#ef-daytype-custom-wrap').style.display = e.target.value==='Other' ? '' : 'none';
  });

  renderBodyUpdateRows(wrap, data);
  renderFlareNoteRows(wrap, data);
  renderIntroRows(wrap, data, inventory);
  renderAttachmentRows(wrap, data);

  wrap.querySelector('#ef-body-add').addEventListener('click', ()=>{
    data.log_body_updates.push({_cid:uid(), area:COMMON_AREAS[0], note:'', display_order:data.log_body_updates.length});
    renderBodyUpdateRows(wrap, data);
  });
  wrap.querySelector('#ef-flare-add').addEventListener('click', ()=>{
    data.log_flare_notes.push({_cid:uid(), symptom:'', suspected_causes:'', area_link:null, display_order:data.log_flare_notes.length});
    renderFlareNoteRows(wrap, data);
  });
  wrap.querySelector('#ef-intro-add').addEventListener('click', ()=>{
    data.log_newly_introduced.push({_cid:uid(), inventory_id:null, inventory_label_snapshot:'', description:'', display_order:data.log_newly_introduced.length});
    renderIntroRows(wrap, data, inventory);
  });
  wrap.querySelector('#ef-att-add').addEventListener('click', ()=>{
    data.log_attachments.push({_cid:uid(), url:'', label:'', display_order:data.log_attachments.length});
    renderAttachmentRows(wrap, data);
  });

  wrap.querySelector('#ef-cancel').addEventListener('click', ()=>{ slot.innerHTML=''; });
  wrap.querySelector('#ef-save').addEventListener('click', ()=> saveEntry(existing, data, wrap, slot) );

  wrap.scrollIntoView({behavior:'smooth', block:'start'});
}

function renderBodyUpdateRows(wrap, data){
  const list = wrap.querySelector('#ef-body-list'); list.innerHTML='';
  data.log_body_updates.forEach((item)=>{
    const row = document.createElement('div'); row.className='subform-row';
    row.innerHTML = `
      <div>
        <select class="f-input bu-area">
          ${COMMON_AREAS.map(a=>`<option ${item.area===a?'selected':''}>${a}</option>`).join('')}
          <option value="__custom__" ${!COMMON_AREAS.includes(item.area)?'selected':''}>Custom…</option>
        </select>
        <input type="text" class="f-input bu-area-custom" placeholder="Custom area name" style="margin-top:6px;${COMMON_AREAS.includes(item.area)?'display:none;':''}" value="${COMMON_AREAS.includes(item.area)?'':escHtml(item.area)}">
      </div>
      <textarea class="f-input bu-note" rows="2" placeholder="Note">${escHtml(item.note)}</textarea>
      <button class="row-del" type="button" title="Remove">✕</button>
    `;
    const areaSel = row.querySelector('.bu-area');
    const areaCustom = row.querySelector('.bu-area-custom');
    areaSel.addEventListener('change', ()=>{
      if(areaSel.value==='__custom__'){ areaCustom.style.display=''; item.area=areaCustom.value; }
      else { areaCustom.style.display='none'; item.area=areaSel.value; }
    });
    areaCustom.addEventListener('input', ()=>{ item.area = areaCustom.value; });
    row.querySelector('.bu-note').addEventListener('input', e=>{ item.note = e.target.value; });
    row.querySelector('.row-del').addEventListener('click', ()=>{
      data.log_body_updates = data.log_body_updates.filter(x=>x._cid!==item._cid);
      renderBodyUpdateRows(wrap, data);
    });
    list.appendChild(row);
  });
}

function renderFlareNoteRows(wrap, data){
  const list = wrap.querySelector('#ef-flare-list'); list.innerHTML='';
  data.log_flare_notes.forEach(item=>{
    const row = document.createElement('div'); row.className='subform-row';
    row.innerHTML = `
      <input type="text" class="f-input fl-symptom" placeholder="Symptom (e.g. right knee inflamed)" value="${escHtml(item.symptom)}">
      <input type="text" class="f-input fl-cause" placeholder="Suspected cause(s) — e.g. stress, new shoes, upped reps" value="${escHtml(item.suspected_causes)}">
      <button class="row-del" type="button" title="Remove">✕</button>
    `;
    row.querySelector('.fl-symptom').addEventListener('input', e=>{ item.symptom=e.target.value; });
    row.querySelector('.fl-cause').addEventListener('input', e=>{ item.suspected_causes=e.target.value; });
    row.querySelector('.row-del').addEventListener('click', ()=>{
      data.log_flare_notes = data.log_flare_notes.filter(x=>x._cid!==item._cid);
      renderFlareNoteRows(wrap, data);
    });
    list.appendChild(row);
  });
}

function renderIntroRows(wrap, data, inventory){
  const list = wrap.querySelector('#ef-intro-list'); list.innerHTML='';
  data.log_newly_introduced.forEach(item=>{
    const row = document.createElement('div'); row.className='subform-row intro-form-row';
    const activeInv = inventory.filter(i=>i.active);
    row.innerHTML = `
      <select class="f-input intro-link">
        <option value="">— pick inventory item —</option>
        ${activeInv.map(i=>`<option value="${i.id}" ${item.inventory_id===i.id?'selected':''}>${escHtml(i.version_tag?i.version_tag+' · ':'')}${escHtml(i.name)}</option>`).join('')}
      </select>
      <input type="text" class="f-input intro-desc" placeholder="Description / what you noticed" value="${escHtml(item.description)}">
      <button class="row-del" type="button" title="Remove">✕</button>
    `;
    row.querySelector('.intro-link').addEventListener('change', e=>{
      const inv = inventory.find(i=>i.id===e.target.value);
      item.inventory_id = inv ? inv.id : null;
      item.inventory_label_snapshot = inv ? (inv.version_tag?inv.version_tag+' · ':'')+inv.name : '';
    });
    row.querySelector('.intro-desc').addEventListener('input', e=>{ item.description=e.target.value; });
    row.querySelector('.row-del').addEventListener('click', ()=>{
      data.log_newly_introduced = data.log_newly_introduced.filter(x=>x._cid!==item._cid);
      renderIntroRows(wrap, data, inventory);
    });
    list.appendChild(row);
  });
}

function renderAttachmentRows(wrap, data){
  const list = wrap.querySelector('#ef-att-list'); list.innerHTML='';
  data.log_attachments.forEach(item=>{
    const row = document.createElement('div'); row.className='subform-row';
    row.innerHTML = `
      <input type="text" class="f-input att-url" placeholder="URL" value="${escHtml(item.url)}">
      <input type="text" class="f-input att-label" placeholder="Label (optional)" value="${escHtml(item.label||'')}">
      <button class="row-del" type="button" title="Remove">✕</button>
    `;
    row.querySelector('.att-url').addEventListener('input', e=>{ item.url=e.target.value; });
    row.querySelector('.att-label').addEventListener('input', e=>{ item.label=e.target.value; });
    row.querySelector('.row-del').addEventListener('click', ()=>{
      data.log_attachments = data.log_attachments.filter(x=>x._cid!==item._cid);
      renderAttachmentRows(wrap, data);
    });
    list.appendChild(row);
  });
}

async function suggestNextDayNumber(){
  const { data } = await sb.from('log_entries').select('day_number').order('day_number',{ascending:false}).limit(1);
  if(data && data.length && data[0].day_number!=null) return data[0].day_number+1;
  return null;
}

async function saveEntry(existing, data, wrap, slot){
  const saveBtn = wrap.querySelector('#ef-save');
  saveBtn.disabled = true; saveBtn.textContent = 'Saving…';

  const entryDate = wrap.querySelector('#ef-date').value;
  if(!entryDate){ toast('Date is required', true); saveBtn.disabled=false; saveBtn.textContent='Save Entry'; return; }

  let dayNumber = wrap.querySelector('#ef-daynum').value;
  dayNumber = dayNumber===''? null : parseInt(dayNumber);
  if(dayNumber===null && !existing){ dayNumber = await suggestNextDayNumber(); }

  const payload = {
    entry_date: entryDate,
    day_number: dayNumber,
    day_type: wrap.querySelector('#ef-daytype').value,
    day_type_custom: wrap.querySelector('#ef-daytype-custom').value.trim() || null,
    cycle_phase: wrap.querySelector('#ef-cycle').value || null,
    entry_date_uncertain: wrap.querySelector('#ef-uncertain').checked,
    headline: wrap.querySelector('#ef-headline').value.trim(),
    journal: wrap.querySelector('#ef-journal').value,
    updated_at: new Date().toISOString()
  };

  try{
    let logId;
    if(existing){
      logId = existing.id;
      const { error } = await sb.from('log_entries').update(payload).eq('id', logId);
      if(error) throw error;
      // wipe and re-insert child rows — simplest consistent approach for a personal-scale app
      await sb.from('log_body_updates').delete().eq('log_id', logId);
      await sb.from('log_flare_notes').delete().eq('log_id', logId);
      await sb.from('log_newly_introduced').delete().eq('log_id', logId);
      await sb.from('log_attachments').delete().eq('log_id', logId);
    } else {
      const { data: inserted, error } = await sb.from('log_entries').insert(payload).select().single();
      if(error) throw error;
      logId = inserted.id;
    }

    const bodyRows = data.log_body_updates.filter(x=>x.area && x.area.trim()).map((x,i)=>({log_id:logId, area:x.area, note:x.note||'', display_order:i}));
    if(bodyRows.length){ const {error} = await sb.from('log_body_updates').insert(bodyRows); if(error) throw error; }

    const flareRows = data.log_flare_notes.filter(x=>x.symptom && x.symptom.trim()).map((x,i)=>({log_id:logId, symptom:x.symptom, suspected_causes:x.suspected_causes||'', display_order:i}));
    if(flareRows.length){ const {error} = await sb.from('log_flare_notes').insert(flareRows); if(error) throw error; }

    const introRows = data.log_newly_introduced.filter(x=>x.description && x.description.trim()).map((x,i)=>({log_id:logId, inventory_id:x.inventory_id||null, inventory_label_snapshot:x.inventory_label_snapshot||null, description:x.description, display_order:i}));
    if(introRows.length){ const {error} = await sb.from('log_newly_introduced').insert(introRows); if(error) throw error; }

    const attRows = data.log_attachments.filter(x=>x.url && x.url.trim()).map((x,i)=>({log_id:logId, url:x.url, label:x.label||null, display_order:i}));
    if(attRows.length){ const {error} = await sb.from('log_attachments').insert(attRows); if(error) throw error; }

    slot.innerHTML = '';
    toast(existing ? 'Entry updated' : 'Entry saved');
    await loadLogEntries(true);
    await refreshRowCount();
  } catch(e){
    toast('Save failed: '+e.message, true);
    saveBtn.disabled = false; saveBtn.textContent = existing?'Save Changes':'Save Entry';
  }
}

/* ---------- filters & pagination wiring ---------- */
document.getElementById('newEntryBtn').addEventListener('click', ()=> openEntryEditor(null) );
document.getElementById('loadMoreBtn').addEventListener('click', ()=>{ logState.page++; loadLogEntries(false); });
document.getElementById('filterDayType').addEventListener('change', e=>{ logState.filters.dayType=e.target.value; loadLogEntries(true); });
document.getElementById('filterCyclePhase').addEventListener('change', e=>{ logState.filters.cyclePhase=e.target.value; loadLogEntries(true); });
document.getElementById('filterFlareOnly').addEventListener('change', e=>{ logState.filters.flareOnly=e.target.value; loadLogEntries(true); });

/* ============================================================
   INVENTORY TAB
   ============================================================ */
let invState = { items: [], categories: [], filterCategory:'', filterActive:'active' };

async function loadInventory(){
  const listEl = document.getElementById('inventoryList');
  listEl.innerHTML = '<div class="empty-state">Loading inventory…</div>';
  const { data, error } = await sb.from('inventory_items').select('*').order('category').order('display_order');
  if(error){ listEl.innerHTML = '<div class="empty-state">Could not load inventory.</div>'; toast('Load failed: '+error.message, true); return; }
  invState.items = data || [];
  invState.categories = [...new Set(invState.items.map(i=>i.category))];
  logState.inventoryCache = null; // bust the log tab's cache since inventory may have changed
  populateInvCategoryFilter();
  renderInventoryList();
}

function populateInvCategoryFilter(){
  const sel = document.getElementById('filterInvCategory');
  const current = sel.value;
  sel.innerHTML = '<option value="">All categories</option>' + invState.categories.map(c=>`<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('');
  sel.value = current;
}

function renderInventoryList(){
  const listEl = document.getElementById('inventoryList');
  let items = invState.items;
  if(invState.filterCategory) items = items.filter(i=>i.category===invState.filterCategory);
  if(invState.filterActive==='active') items = items.filter(i=>i.active);

  if(!items.length){ listEl.innerHTML = '<div class="empty-state"><div class="empty-icon">🗂️</div>Nothing here yet.</div>'; return; }

  const byCat = {};
  items.forEach(i=>{ (byCat[i.category]=byCat[i.category]||[]).push(i); });

  listEl.innerHTML = '';
  Object.keys(byCat).forEach(cat=>{
    const block = document.createElement('div'); block.className='inv-category-block';
    const title = document.createElement('div'); title.className='inv-category-title'; title.textContent=cat;
    block.appendChild(title);
    byCat[cat].sort((a,b)=>a.display_order-b.display_order).forEach(item=>{
      block.appendChild(renderInvRow(item));
    });
    listEl.appendChild(block);
  });
}

function renderInvRow(item){
  const row = document.createElement('div'); row.className='inv-item-row'+(item.active?'':' inactive');
  row.innerHTML = `
    <div class="inv-tag">${escHtml(item.version_tag||'')}</div>
    <div>
      <div class="inv-name">${escHtml(item.name)}</div>
      ${item.cues ? `<div class="inv-cues">${escHtml(item.cues)}</div>` : ''}
    </div>
    <div class="inv-setsreps">${escHtml(item.sets_reps||'')}</div>
    <div class="inv-row-actions">
      <button class="text-btn" data-act="edit">Edit</button>
      <button class="text-btn" data-act="toggle">${item.active?'Retire':'Restore'}</button>
    </div>
  `;
  row.querySelector('[data-act="edit"]').addEventListener('click', ()=> openInvEditor(item) );
  row.querySelector('[data-act="toggle"]').addEventListener('click', ()=> toggleInvActive(item) );
  return row;
}

async function toggleInvActive(item){
  const { error } = await sb.from('inventory_items').update({active: !item.active, updated_at:new Date().toISOString()}).eq('id', item.id);
  if(error){ toast('Update failed: '+error.message, true); return; }
  item.active = !item.active;
  renderInventoryList();
  toast(item.active ? 'Restored' : 'Retired');
}

function openInvEditor(existing){
  const slot = document.getElementById('newInvFormSlot');
  slot.innerHTML = '';
  const isNew = !existing;
  const data = existing || { id:null, category: invState.categories[0]||'', version_tag:'', name:'', cues:'', sets_reps:'', active:true, display_order: invState.items.length };

  const wrap = document.createElement('div'); wrap.className='card'; wrap.style.borderColor='var(--accent)';
  wrap.innerHTML = `
    <div class="section-title" style="font-size:16px;margin-bottom:14px;">${isNew?'Add Inventory Item':'Edit Inventory Item'}</div>
    <div class="f-grid cols-2">
      <div class="f-row">
        <label class="f-label">Category</label>
        <select class="f-input" id="if-category">
          ${invState.categories.map(c=>`<option ${data.category===c?'selected':''}>${escHtml(c)}</option>`).join('')}
          <option value="__new__">+ New category…</option>
        </select>
        <input type="text" class="f-input" id="if-category-new" placeholder="New category name" style="margin-top:6px;display:none;">
      </div>
      <div class="f-row"><label class="f-label">Version tag</label><input type="text" class="f-input" id="if-tag" value="${escHtml(data.version_tag)}" placeholder="e.g. V9\`"></div>
    </div>
    <div class="f-row"><label class="f-label">Name</label><input type="text" class="f-input" id="if-name" value="${escHtml(data.name)}" placeholder="e.g. Isolated Locust Pose"></div>
    <div class="f-row"><label class="f-label">Cues / notes</label><textarea class="f-input" id="if-cues" rows="2">${escHtml(data.cues)}</textarea></div>
    <div class="f-row"><label class="f-label">Sets / reps</label><input type="text" class="f-input" id="if-setsreps" value="${escHtml(data.sets_reps)}" placeholder="e.g. 3x10 or 3x30 second-hold"></div>
    <div class="log-card-actions">
      <button class="text-btn" id="if-cancel" type="button">Cancel</button>
      <button class="btn accent" id="if-save" type="button">${isNew?'Add Item':'Save Changes'}</button>
    </div>
  `;
  slot.appendChild(wrap);

  wrap.querySelector('#if-category').addEventListener('change', e=>{
    wrap.querySelector('#if-category-new').style.display = e.target.value==='__new__' ? '' : 'none';
  });
  wrap.querySelector('#if-cancel').addEventListener('click', ()=>{ slot.innerHTML=''; });
  wrap.querySelector('#if-save').addEventListener('click', async ()=>{
    const saveBtn = wrap.querySelector('#if-save'); saveBtn.disabled=true; saveBtn.textContent='Saving…';
    let category = wrap.querySelector('#if-category').value;
    if(category==='__new__') category = wrap.querySelector('#if-category-new').value.trim();
    const name = wrap.querySelector('#if-name').value.trim();
    if(!category || !name){ toast('Category and name are required', true); saveBtn.disabled=false; saveBtn.textContent=isNew?'Add Item':'Save Changes'; return; }
    const payload = {
      category, version_tag: wrap.querySelector('#if-tag').value.trim(),
      name, cues: wrap.querySelector('#if-cues').value.trim(),
      sets_reps: wrap.querySelector('#if-setsreps').value.trim(),
      updated_at: new Date().toISOString()
    };
    try{
      if(existing){
        const { error } = await sb.from('inventory_items').update(payload).eq('id', existing.id);
        if(error) throw error;
      } else {
        payload.active = true; payload.display_order = invState.items.length;
        const { error } = await sb.from('inventory_items').insert(payload);
        if(error) throw error;
      }
      slot.innerHTML = '';
      toast(isNew?'Item added':'Item updated');
      await loadInventory();
    }catch(e){ toast('Save failed: '+e.message, true); saveBtn.disabled=false; saveBtn.textContent=isNew?'Add Item':'Save Changes'; }
  });
  wrap.scrollIntoView({behavior:'smooth', block:'start'});
}

document.getElementById('newInvItemBtn').addEventListener('click', ()=> openInvEditor(null) );
document.getElementById('filterInvCategory').addEventListener('change', e=>{ invState.filterCategory=e.target.value; renderInventoryList(); });
document.getElementById('filterInvActive').addEventListener('change', e=>{ invState.filterActive=e.target.value; renderInventoryList(); });

/* ============================================================
   PLANNER TAB
   ============================================================ */
let plannerState = { templates: [], selectedTemplateId: null, currentDate: null, dayRow: null, workingBlocks: [] };

async function initPlanner(){
  const dateInput = document.getElementById('plannerDate');
  dateInput.value = todayISO();
  plannerState.currentDate = todayISO();
  await loadPlannerTemplates();
  await loadPlannerDay(plannerState.currentDate);
  dateInput.addEventListener('change', async e=>{
    plannerState.currentDate = e.target.value;
    await loadPlannerDay(plannerState.currentDate);
  });
}

async function loadPlannerTemplates(){
  const { data, error } = await sb.from('planner_templates').select('*, planner_blocks(*)').order('display_order');
  if(error){ toast('Could not load templates: '+error.message, true); return; }
  plannerState.templates = data || [];
  renderTemplatePicker();
}

function renderTemplatePicker(){
  const picker = document.getElementById('templatePicker');
  picker.innerHTML = '';
  plannerState.templates.forEach(t=>{
    const chip = document.createElement('button');
    chip.className = 'template-chip' + (plannerState.selectedTemplateId===t.id ? ' active' : '');
    chip.textContent = t.name;
    chip.addEventListener('click', ()=> applyTemplateToDay(t) );
    picker.appendChild(chip);
  });
  const blankChip = document.createElement('button');
  blankChip.className = 'template-chip' + (plannerState.selectedTemplateId===null ? ' active' : '');
  blankChip.textContent = '+ Blank day';
  blankChip.addEventListener('click', ()=>{ plannerState.selectedTemplateId=null; plannerState.workingBlocks=[]; renderTemplatePicker(); renderPlannerDayEditor(); });
  picker.appendChild(blankChip);
}

async function loadPlannerDay(dateStr){
  document.getElementById('plannerDayLabel').textContent = fmtDateLong(dateStr);
  const { data, error } = await sb.from('planner_days').select('*').eq('plan_date', dateStr).maybeSingle();
  if(error){ toast('Could not load day plan: '+error.message, true); return; }
  plannerState.dayRow = data || null;
  plannerState.selectedTemplateId = data ? data.template_id : null;
  plannerState.workingBlocks = data ? (data.blocks_snapshot||[]) : [];
  renderTemplatePicker();
  renderPlannerDayEditor();
}

function applyTemplateToDay(template){
  plannerState.selectedTemplateId = template.id;
  plannerState.workingBlocks = (template.planner_blocks||[]).slice().sort((a,b)=>a.display_order-b.display_order)
    .map(b=>({_cid:uid(), start_time:b.start_time, end_time:b.end_time, label:b.label}));
  renderTemplatePicker();
  renderPlannerDayEditor();
}

function renderPlannerDayEditor(){
  const wrap = document.getElementById('plannerDayEditor');
  wrap.innerHTML = '';

  const card = document.createElement('div'); card.className='card';
  const head = document.createElement('div'); head.className='section-head';
  head.innerHTML = `<div class="section-title" style="font-size:16px;">Blocks for ${escHtml(fmtDateShort(plannerState.currentDate))}</div>`;
  const saveBtn = document.createElement('button'); saveBtn.className='btn accent'; saveBtn.textContent='Save Day Plan';
  saveBtn.addEventListener('click', savePlannerDay);
  head.appendChild(saveBtn);
  card.appendChild(head);

  const list = document.createElement('div'); list.id='plannerBlockList';
  card.appendChild(list);
  renderPlannerBlockRows(list);

  const addBtn = document.createElement('button'); addBtn.className='subform-add'; addBtn.style.marginTop='10px'; addBtn.textContent='+ Add block';
  addBtn.addEventListener('click', ()=>{
    plannerState.workingBlocks.push({_cid:uid(), start_time:'', end_time:'', label:''});
    renderPlannerBlockRows(list);
  });
  card.appendChild(addBtn);
  wrap.appendChild(card);
}

function renderPlannerBlockRows(list){
  list.innerHTML='';
  if(!plannerState.workingBlocks.length){ list.innerHTML = '<div class="empty-state" style="margin-top:10px;">No blocks yet — pick a template above or add one manually.</div>'; return; }
  plannerState.workingBlocks.forEach(b=>{
    const row = document.createElement('div'); row.className='block-row';
    row.innerHTML = `
      <input type="text" class="f-input pb-start" value="${escHtml(b.start_time)}" placeholder="8:00 AM" style="width:110px;">
      <span>–</span>
      <input type="text" class="f-input pb-end" value="${escHtml(b.end_time)}" placeholder="9:00 AM" style="width:110px;">
      <input type="text" class="f-input block-label pb-label" value="${escHtml(b.label)}" placeholder="What's happening">
      <button class="block-del" type="button" title="Remove">✕</button>
    `;
    row.querySelector('.pb-start').addEventListener('input', e=>{ b.start_time=e.target.value; });
    row.querySelector('.pb-end').addEventListener('input', e=>{ b.end_time=e.target.value; });
    row.querySelector('.pb-label').addEventListener('input', e=>{ b.label=e.target.value; });
    row.querySelector('.block-del').addEventListener('click', ()=>{
      plannerState.workingBlocks = plannerState.workingBlocks.filter(x=>x._cid!==b._cid);
      renderPlannerBlockRows(list);
    });
    list.appendChild(row);
  });
}

async function savePlannerDay(){
  const blocksToSave = plannerState.workingBlocks.map(({_cid, ...rest})=>rest);
  const payload = {
    plan_date: plannerState.currentDate,
    template_id: plannerState.selectedTemplateId,
    blocks_snapshot: blocksToSave,
    updated_at: new Date().toISOString()
  };
  try{
    const { error } = await sb.from('planner_days').upsert(payload, { onConflict: 'plan_date' });
    if(error) throw error;
    toast('Day plan saved');
  }catch(e){ toast('Save failed: '+e.message, true); }
}

/* ---------- New template creation ---------- */
document.getElementById('newTemplateBtn').addEventListener('click', ()=>{
  const slot = document.getElementById('newTemplateFormSlot');
  slot.innerHTML = '';
  const workingBlocks = [];
  const wrap = document.createElement('div'); wrap.className='card'; wrap.style.borderColor='var(--accent)';
  wrap.innerHTML = `
    <div class="section-title" style="font-size:16px;margin-bottom:14px;">New Template</div>
    <div class="f-row"><label class="f-label">Name</label><input type="text" class="f-input" id="tf-name" placeholder="e.g. Session Day — Wake 6"></div>
    <div class="f-row"><label class="f-label">Description (optional)</label><input type="text" class="f-input" id="tf-desc"></div>
    <div class="log-section-label">Blocks</div>
    <div id="tf-block-list"></div>
    <button class="subform-add" id="tf-block-add" type="button">+ Add block</button>
    <div class="log-card-actions">
      <button class="text-btn" id="tf-cancel" type="button">Cancel</button>
      <button class="btn accent" id="tf-save" type="button">Save Template</button>
    </div>
  `;
  slot.appendChild(wrap);

  function renderTfBlocks(){
    const list = wrap.querySelector('#tf-block-list'); list.innerHTML='';
    workingBlocks.forEach(b=>{
      const row = document.createElement('div'); row.className='block-row';
      row.innerHTML = `
        <input type="text" class="f-input" value="${escHtml(b.start_time)}" placeholder="8:00 AM" style="width:110px;">
        <span>–</span>
        <input type="text" class="f-input" value="${escHtml(b.end_time)}" placeholder="9:00 AM" style="width:110px;">
        <input type="text" class="f-input block-label" value="${escHtml(b.label)}" placeholder="What's happening">
        <button class="block-del" type="button">✕</button>
      `;
      const inputs = row.querySelectorAll('input');
      inputs[0].addEventListener('input', e=>{ b.start_time=e.target.value; });
      inputs[1].addEventListener('input', e=>{ b.end_time=e.target.value; });
      inputs[2].addEventListener('input', e=>{ b.label=e.target.value; });
      row.querySelector('.block-del').addEventListener('click', ()=>{
        const idx = workingBlocks.indexOf(b); workingBlocks.splice(idx,1); renderTfBlocks();
      });
      list.appendChild(row);
    });
  }
  wrap.querySelector('#tf-block-add').addEventListener('click', ()=>{ workingBlocks.push({start_time:'',end_time:'',label:''}); renderTfBlocks(); });
  wrap.querySelector('#tf-cancel').addEventListener('click', ()=>{ slot.innerHTML=''; });
  wrap.querySelector('#tf-save').addEventListener('click', async ()=>{
    const name = wrap.querySelector('#tf-name').value.trim();
    if(!name){ toast('Template name is required', true); return; }
    const saveBtn = wrap.querySelector('#tf-save'); saveBtn.disabled=true; saveBtn.textContent='Saving…';
    try{
      const { data: tpl, error } = await sb.from('planner_templates').insert({
        name, description: wrap.querySelector('#tf-desc').value.trim()||null, display_order: plannerState.templates.length
      }).select().single();
      if(error) throw error;
      const blockRows = workingBlocks.filter(b=>b.label.trim()).map((b,i)=>({template_id:tpl.id, start_time:b.start_time, end_time:b.end_time, label:b.label, display_order:i}));
      if(blockRows.length){ const {error:e2} = await sb.from('planner_blocks').insert(blockRows); if(e2) throw e2; }
      slot.innerHTML = '';
      toast('Template saved');
      await loadPlannerTemplates();
    }catch(e){ toast('Save failed: '+e.message, true); saveBtn.disabled=false; saveBtn.textContent='Save Template'; }
  });
  wrap.scrollIntoView({behavior:'smooth', block:'start'});
});

/* ============================================================
   ARCHIVE TAB — export / import / clear-range
   ============================================================ */
let archiveState = { lastExportedRange: null, importedData: null };

async function fetchAllLogEntriesFull(fromDate, toDate){
  let query = sb.from('log_entries').select(`*,
    log_body_updates(*), log_flare_notes(*), log_newly_introduced(*), log_attachments(*)`);
  if(fromDate) query = query.gte('entry_date', fromDate);
  if(toDate) query = query.lte('entry_date', toDate);
  const { data, error } = await query.order('entry_date');
  if(error) throw error;
  return data || [];
}

async function loadArchiveLog(){
  const { data, error } = await sb.from('archive_log').select('*').order('created_at',{ascending:false});
  const wrap = document.getElementById('archiveLogList');
  if(error){ wrap.innerHTML=''; return; }
  if(!data || !data.length){ wrap.innerHTML=''; return; }
  wrap.innerHTML = '<div class="log-section-label" style="margin-top:6px;">Previous archive events</div>';
  data.forEach(a=>{
    const row = document.createElement('div'); row.className='card'; row.style.padding='12px 16px';
    row.innerHTML = `<div style="font-size:13px;"><strong>${escHtml(fmtDateShort(a.archived_from))} → ${escHtml(fmtDateShort(a.archived_to))}</strong> · ${a.row_count} rows</div>${a.note?`<div style="font-size:12px;color:var(--ink-soft);margin-top:2px;">${escHtml(a.note)}</div>`:''}`;
    wrap.appendChild(row);
  });
}

document.getElementById('exportAllBtn').addEventListener('click', async ()=>{
  const btn = document.getElementById('exportAllBtn'); btn.disabled=true; btn.textContent='Exporting…';
  try{
    const [logEntries, inventory, templates, plannerDays] = await Promise.all([
      fetchAllLogEntriesFull(null,null),
      sb.from('inventory_items').select('*').order('category').order('display_order').then(r=>r.data||[]),
      sb.from('planner_templates').select('*, planner_blocks(*)').order('display_order').then(r=>r.data||[]),
      sb.from('planner_days').select('*').order('plan_date').then(r=>r.data||[])
    ]);
    const exportObj = { exported_at: new Date().toISOString(), type:'full_export', log_entries: logEntries, inventory_items: inventory, planner_templates: templates, planner_days: plannerDays };
    downloadJSON(exportObj, `princess-os-full-export-${todayISO()}.json`);
    toast('Export downloaded');
  }catch(e){ toast('Export failed: '+e.message, true); }
  btn.disabled=false; btn.textContent='Export Everything';
});

document.getElementById('archiveRangeBtn').addEventListener('click', async ()=>{
  const from = document.getElementById('archiveFrom').value;
  const to = document.getElementById('archiveTo').value;
  if(!from || !to){ toast('Pick both a from and to date', true); return; }
  const btn = document.getElementById('archiveRangeBtn'); btn.disabled=true; btn.textContent='Exporting…';
  try{
    const rows = await fetchAllLogEntriesFull(from, to);
    if(!rows.length){ toast('No entries in that range', true); btn.disabled=false; btn.textContent='Export Range'; return; }
    downloadJSON({ exported_at: new Date().toISOString(), type:'range_export', from, to, log_entries: rows }, `princess-os-range-${from}_to_${to}.json`);
    archiveState.lastExportedRange = { from, to, count: rows.length };
    document.getElementById('clearRangeBtn').disabled = false;
    toast(`Exported ${rows.length} entries — review the file, then you can clear this range`);
  }catch(e){ toast('Export failed: '+e.message, true); }
  btn.disabled=false; btn.textContent='Export Range';
});

document.getElementById('clearRangeBtn').addEventListener('click', async ()=>{
  const r = archiveState.lastExportedRange;
  if(!r){ toast('Export the range first', true); return; }
  if(!confirm(`Delete ${r.count} log entries from ${r.from} to ${r.to} from the LIVE database? Make sure the exported JSON file downloaded successfully first. This cannot be undone.`)) return;
  const btn = document.getElementById('clearRangeBtn'); btn.disabled=true; btn.textContent='Clearing…';
  try{
    const { error } = await sb.from('log_entries').delete().gte('entry_date', r.from).lte('entry_date', r.to);
    if(error) throw error;
    await sb.from('archive_log').insert({ archived_from: r.from, archived_to: r.to, row_count: r.count, note: 'Exported then cleared from live DB' });
    toast(`Cleared ${r.count} entries from the database`);
    archiveState.lastExportedRange = null;
    btn.textContent = 'Clear Exported Range From Database';
    await refreshRowCount();
    await loadArchiveLog();
    tabsLoaded.log = false; // force a fresh reload next time Log tab is viewed
  }catch(e){ toast('Clear failed: '+e.message, true); btn.disabled=false; btn.textContent='Clear Exported Range From Database'; }
});

/* ---------- Import ---------- */
document.getElementById('importFile').addEventListener('change', async e=>{
  const file = e.target.files[0];
  const viewBtn = document.getElementById('importViewBtn');
  const restoreBtn = document.getElementById('importRestoreBtn');
  if(!file){ viewBtn.disabled=true; restoreBtn.disabled=true; return; }
  try{
    const text = await readFileAsText(file);
    archiveState.importedData = JSON.parse(text);
    viewBtn.disabled = false; restoreBtn.disabled = false;
    toast('File loaded — choose how to use it');
  }catch(e){ toast('Could not parse that file as JSON', true); archiveState.importedData=null; viewBtn.disabled=true; restoreBtn.disabled=true; }
});

document.getElementById('importViewBtn').addEventListener('click', ()=>{
  const d = archiveState.importedData;
  if(!d){ return; }
  const wrap = document.getElementById('offlineViewer');
  wrap.innerHTML = '';
  const header = document.createElement('div'); header.className='card';
  header.innerHTML = `<div class="section-title" style="font-size:15px;">Offline view — ${escHtml(d.type||'export')}</div><div class="section-sub">Exported ${escHtml(d.exported_at||'')}. This is read-only; nothing here is connected to the live database.</div>`;
  wrap.appendChild(header);
  const entries = d.log_entries || [];
  if(!entries.length){ wrap.appendChild(Object.assign(document.createElement('div'),{className:'empty-state',textContent:'No log entries in this file.'})); return; }
  entries.forEach(row=>{
    row.log_body_updates = row.log_body_updates||[]; row.log_flare_notes = row.log_flare_notes||[];
    row.log_newly_introduced = row.log_newly_introduced||[]; row.log_attachments = row.log_attachments||[];
    wrap.appendChild(renderLogCard(row));
  });
  // strip edit/delete affordances since these rows aren't live
  wrap.querySelectorAll('.log-entry-card .text-btn').forEach(b=>b.style.display='none');
  wrap.scrollIntoView({behavior:'smooth'});
});

document.getElementById('importRestoreBtn').addEventListener('click', async ()=>{
  const d = archiveState.importedData;
  if(!d){ return; }
  if(!confirm('Restore this file into the LIVE database? Only do this on a fresh/empty project — restoring into a database that already has data will create duplicates.')) return;
  const btn = document.getElementById('importRestoreBtn'); btn.disabled=true; btn.textContent='Restoring…';
  try{
    let restoredCount = 0;
    if(d.inventory_items && d.inventory_items.length){
      const rows = d.inventory_items.map(({id, created_at, updated_at, ...rest})=>rest);
      const { error } = await sb.from('inventory_items').insert(rows);
      if(error) throw error;
    }
    if(d.log_entries && d.log_entries.length){
      for(const entry of d.log_entries){
        const { log_body_updates, log_flare_notes, log_newly_introduced, log_attachments, id, created_at, updated_at, ...entryRest } = entry;
        const { data: inserted, error } = await sb.from('log_entries').insert(entryRest).select().single();
        if(error) throw error;
        const logId = inserted.id;
        if(log_body_updates && log_body_updates.length){
          await sb.from('log_body_updates').insert(log_body_updates.map(({id,...r})=>({...r, log_id:logId})));
        }
        if(log_flare_notes && log_flare_notes.length){
          await sb.from('log_flare_notes').insert(log_flare_notes.map(({id,...r})=>({...r, log_id:logId})));
        }
        if(log_newly_introduced && log_newly_introduced.length){
          await sb.from('log_newly_introduced').insert(log_newly_introduced.map(({id,...r})=>({...r, log_id:logId})));
        }
        if(log_attachments && log_attachments.length){
          await sb.from('log_attachments').insert(log_attachments.map(({id,...r})=>({...r, log_id:logId})));
        }
        restoredCount++;
      }
    }
    if(d.planner_templates && d.planner_templates.length){
      for(const tpl of d.planner_templates){
        const { planner_blocks, id, created_at, updated_at, ...tplRest } = tpl;
        const { data: inserted, error } = await sb.from('planner_templates').insert(tplRest).select().single();
        if(error) throw error;
        if(planner_blocks && planner_blocks.length){
          await sb.from('planner_blocks').insert(planner_blocks.map(({id,...r})=>({...r, template_id:inserted.id})));
        }
      }
    }
    if(d.planner_days && d.planner_days.length){
      const rows = d.planner_days.map(({id, created_at, updated_at, ...rest})=>rest);
      await sb.from('planner_days').upsert(rows, {onConflict:'plan_date'});
    }
    toast(`Restored ${restoredCount} log entries and related data`);
    await refreshRowCount();
    tabsLoaded.log = false; tabsLoaded.inventory = false; tabsLoaded.planner = false;
  }catch(e){ toast('Restore failed: '+e.message, true); }
  btn.disabled=false; btn.textContent='Restore Into Database';
});

/* ============================================================
   BUDGET TAB
   Three category shapes:
   - itemized  (A: Teeth, G: Self-Care) — items + a payment log per item
   - pool      (F: Savings)             — goal + running balance from contributions
   - reference (B/C/D/E)                — manual placeholder until each gets its own page
   ============================================================ */
let budgetState = { categories:[], items:[], payments:[], savings:{goal_amount:null}, contributions:[], references:[] };

async function loadBudget(){
  const wrap = document.getElementById('budgetCategories');
  wrap.innerHTML = '<div class="empty-state">Loading budget…</div>';
  try{
    const [catRes, itemRes, payRes, savRes, contRes, refRes] = await Promise.all([
      sb.from('budget_categories').select('*').order('display_order'),
      sb.from('budget_items').select('*').order('display_order').order('item_date'),
      sb.from('budget_payments').select('*').order('payment_date'),
      sb.from('budget_savings').select('*').eq('id',1).maybeSingle(),
      sb.from('budget_savings_contributions').select('*').order('contribution_date',{ascending:false}),
      sb.from('budget_references').select('*')
    ]);
    const firstError = [catRes,itemRes,payRes,savRes,contRes,refRes].map(r=>r.error).find(Boolean);
    if(firstError) throw firstError;

    budgetState.categories = catRes.data || [];
    budgetState.items = itemRes.data || [];
    budgetState.payments = payRes.data || [];
    budgetState.savings = savRes.data || {goal_amount:null};
    budgetState.contributions = contRes.data || [];
    budgetState.references = refRes.data || [];
    renderBudget();
  }catch(e){
    wrap.innerHTML = '<div class="empty-state">Could not load budget. Have you run budget-schema.sql yet?</div>';
    toast('Budget load failed: '+e.message, true);
  }
}

function paidForItem(itemId){
  return budgetState.payments.filter(p=>p.item_id===itemId).reduce((s,p)=>s+Number(p.amount),0);
}

function savingsBalance(){
  return budgetState.contributions.reduce((s,c)=> s + (c.direction==='deposit'? Number(c.amount) : -Number(c.amount)), 0);
}

function renderBudget(){
  renderBudgetSummary();
  const wrap = document.getElementById('budgetCategories');
  wrap.innerHTML = '';
  if(!budgetState.categories.length){
    wrap.innerHTML = '<div class="empty-state">No budget categories found. Run budget-schema.sql once in the Supabase SQL editor.</div>';
    return;
  }
  budgetState.categories.forEach(cat=>{
    const card = document.createElement('div');
    card.className = 'card budget-category-card';
    card.dataset.catKey = cat.key;
    if(cat.type === 'itemized') card.innerHTML = renderItemizedCategory(cat);
    else if(cat.type === 'pool') card.innerHTML = renderPoolCategory(cat);
    else card.innerHTML = renderReferenceCategory(cat);
    wrap.appendChild(card);
  });
}

function renderBudgetSummary(){
  const el = document.getElementById('budgetSummary');
  let oneOffRemaining = 0, monthlyTotal = 0;

  budgetState.categories.forEach(cat=>{
    if(cat.type === 'itemized'){
      const items = budgetState.items.filter(i=>i.category_key===cat.key);
      const catRemaining = items.reduce((s,i)=>{
        if(i.total_cost==null) return s;
        return s + Math.max(0, Number(i.total_cost) - paidForItem(i.id));
      }, 0);
      if(cat.cadence === 'monthly') monthlyTotal += catRemaining; else oneOffRemaining += catRemaining;
    } else if(cat.type === 'reference'){
      const ref = budgetState.references.find(r=>r.category_key===cat.key);
      const val = ref && ref.manual_total!=null ? Number(ref.manual_total) : 0;
      if(cat.cadence === 'monthly') monthlyTotal += val; else oneOffRemaining += val;
    }
  });

  const balance = savingsBalance();
  const totalCommitted = oneOffRemaining + monthlyTotal;

  el.innerHTML = `
    <div class="budget-stat"><div class="stat-label">Total Committed</div><div class="stat-value">${fmtNum(totalCommitted)}</div></div>
    <div class="budget-stat"><div class="stat-label">One-off Remaining</div><div class="stat-value">${fmtNum(oneOffRemaining)}</div></div>
    <div class="budget-stat"><div class="stat-label">Monthly Recurring</div><div class="stat-value">${fmtNum(monthlyTotal)}</div></div>
    <div class="budget-stat savings"><div class="stat-label">Savings Balance</div><div class="stat-value">${fmtNum(balance)}</div></div>
  `;
}

/* ---------- itemized category (Teeth, Self-Care) ---------- */
function renderItemizedCategory(cat){
  const items = budgetState.items.filter(i=>i.category_key===cat.key)
    .sort((a,b)=> (a.display_order-b.display_order) || (a.item_date||'').localeCompare(b.item_date||''));
  const cadencePill = cat.cadence ? `<span class="pill neutral">${escHtml(cat.cadence)}</span>` : '';
  const itemsHtml = items.length
    ? items.map(renderBudgetItemRow).join('')
    : `<div class="empty-state" style="padding:16px;">No items yet.</div>`;
  return `
    <div class="budget-cat-head">
      <div class="budget-cat-title"><span class="cat-key">${cat.key}</span>${escHtml(cat.name)}</div>
      <div style="display:flex;gap:8px;align-items:center;">
        ${cadencePill}
        <button class="btn small accent" data-action="add-item" data-cat="${cat.key}">+ Add Item</button>
      </div>
    </div>
    <div class="budget-inline-form-slot" data-form-slot="${cat.key}"></div>
    <div class="budget-item-list">${itemsHtml}</div>
  `;
}

function renderBudgetItemRow(item){
  const paid = paidForItem(item.id);
  const hasTotalCost = item.total_cost != null;
  const remaining = hasTotalCost ? (Number(item.total_cost) - paid) : null;
  let badge = '';
  if(hasTotalCost){
    badge = remaining <= 0
      ? `<span class="pill good">Paid in full</span>`
      : `<span class="pill flare">${fmtNum(remaining)} left</span>`;
  }
  const payments = budgetState.payments.filter(p=>p.item_id===item.id)
    .sort((a,b)=> (a.payment_date||'').localeCompare(b.payment_date||''));
  const paymentsHtml = payments.map(p=>`
    <div class="budget-payment-row">
      <span>${fmtDateShort(p.payment_date)}${p.label ? ' · '+escHtml(p.label) : ''}</span>
      <span>${fmtNum(p.amount)}<button class="row-del" data-action="del-payment" data-id="${p.id}" title="Remove">✕</button></span>
    </div>`).join('');
  return `
    <div class="budget-item" data-item-id="${item.id}">
      <div class="budget-item-top">
        <div class="budget-item-title">${escHtml(item.title)}${item.item_date ? ` <span class="log-daynum">${fmtDateShort(item.item_date)}</span>` : ''}</div>
        <div style="display:flex;gap:8px;align-items:center;">
          ${hasTotalCost ? `<span class="budget-item-cost">${fmtNum(item.total_cost)} total</span>` : ''}
          ${badge}
        </div>
      </div>
      ${item.notes ? `<div class="log-attachments">${escHtml(item.notes)}</div>` : ''}
      ${paymentsHtml}
      <div class="budget-inline-form-slot" data-item-form-slot="${item.id}"></div>
      <div class="budget-item-actions">
        <button class="text-btn" data-action="add-payment" data-item="${item.id}" style="color:var(--accent);">+ Log Payment</button>
        <button class="text-btn" data-action="del-item" data-item="${item.id}">Delete Item</button>
      </div>
    </div>
  `;
}

function openAddItemForm(catKey){
  const slot = document.querySelector(`[data-form-slot="${catKey}"]`);
  if(!slot) return;
  slot.innerHTML = `
    <div class="subform-row" style="grid-template-columns:1fr 120px 130px auto;">
      <input type="text" class="f-input bi-title" placeholder="Item title (e.g. X-Rays)">
      <input type="number" step="0.01" class="f-input bi-cost" placeholder="Total cost (optional)">
      <input type="date" class="f-input bi-date" value="${todayISO()}">
      <button class="row-del" data-action="cancel-inline-form" title="Cancel">✕</button>
    </div>
    <textarea class="f-input bi-notes" placeholder="Notes (optional)" style="margin-bottom:8px;"></textarea>
    <button class="btn accent small" data-action="save-item" data-cat="${catKey}">Save Item</button>
  `;
}

async function saveNewItem(catKey, btn){
  const slot = btn.closest('.budget-inline-form-slot');
  const title = slot.querySelector('.bi-title').value.trim();
  if(!title){ toast('Item title is required', true); return; }
  const costVal = slot.querySelector('.bi-cost').value;
  const payload = {
    category_key: catKey,
    title,
    total_cost: costVal===''? null : parseFloat(costVal),
    item_date: slot.querySelector('.bi-date').value || null,
    notes: slot.querySelector('.bi-notes').value.trim() || null,
    display_order: budgetState.items.filter(i=>i.category_key===catKey).length
  };
  btn.disabled = true; btn.textContent = 'Saving…';
  try{
    const { error } = await sb.from('budget_items').insert(payload);
    if(error) throw error;
    toast('Item added');
    await loadBudget();
  }catch(e){ toast('Save failed: '+e.message, true); btn.disabled=false; btn.textContent='Save Item'; }
}

async function deleteItem(itemId){
  if(!confirm('Delete this item and its payment log?')) return;
  try{
    const { error } = await sb.from('budget_items').delete().eq('id', itemId);
    if(error) throw error;
    toast('Item deleted');
    await loadBudget();
  }catch(e){ toast('Delete failed: '+e.message, true); }
}

function openAddPaymentForm(itemId){
  const slot = document.querySelector(`[data-item-form-slot="${itemId}"]`);
  if(!slot) return;
  slot.innerHTML = `
    <div class="subform-row" style="grid-template-columns:110px 1fr 130px auto;">
      <input type="number" step="0.01" class="f-input bp-amount" placeholder="Amount">
      <input type="text" class="f-input bp-label" placeholder="Label (e.g. 50% TBA)">
      <input type="date" class="f-input bp-date" value="${todayISO()}">
      <button class="row-del" data-action="cancel-inline-form" title="Cancel">✕</button>
    </div>
    <button class="btn accent small" data-action="save-payment" data-item="${itemId}">Log Payment</button>
  `;
}

async function saveNewPayment(itemId, btn){
  const slot = btn.closest('.budget-inline-form-slot');
  const amount = parseFloat(slot.querySelector('.bp-amount').value);
  if(!amount || isNaN(amount)){ toast('Amount is required', true); return; }
  const payload = {
    item_id: itemId,
    amount,
    label: slot.querySelector('.bp-label').value.trim() || null,
    payment_date: slot.querySelector('.bp-date').value || todayISO()
  };
  btn.disabled = true; btn.textContent = 'Saving…';
  try{
    const { error } = await sb.from('budget_payments').insert(payload);
    if(error) throw error;
    toast('Payment logged');
    await loadBudget();
  }catch(e){ toast('Save failed: '+e.message, true); btn.disabled=false; btn.textContent='Log Payment'; }
}

async function deletePayment(id){
  if(!confirm('Remove this payment?')) return;
  try{
    const { error } = await sb.from('budget_payments').delete().eq('id', id);
    if(error) throw error;
    toast('Payment removed');
    await loadBudget();
  }catch(e){ toast('Delete failed: '+e.message, true); }
}

/* ---------- pool category (Savings) ---------- */
function renderPoolCategory(cat){
  const goal = budgetState.savings.goal_amount;
  const balance = savingsBalance();
  const pct = goal ? Math.max(0, Math.min(100, Math.round(balance/goal*100))) : null;
  const rows = budgetState.contributions;
  const contributionsHtml = rows.length
    ? rows.map(c=>`
      <div class="budget-contribution-row ${c.direction}">
        <span>${fmtDateShort(c.contribution_date)}${c.note ? ' · '+escHtml(c.note) : ''}</span>
        <span class="amt">${c.direction==='withdrawal'?'-':'+'}${fmtNum(c.amount)}<button class="row-del" data-action="del-contribution" data-id="${c.id}" title="Remove">✕</button></span>
      </div>`).join('')
    : `<div class="empty-state" style="padding:16px;">No contributions yet.</div>`;

  return `
    <div class="budget-cat-head">
      <div class="budget-cat-title"><span class="cat-key">${cat.key}</span>${escHtml(cat.name)}</div>
      <div style="display:flex;gap:8px;">
        <button class="btn small accent" data-action="add-contribution" data-dir="deposit">+ Deposit</button>
        <button class="btn small ghost" data-action="add-contribution" data-dir="withdrawal">+ Withdraw</button>
      </div>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin:8px 0 4px;">
      <div class="budget-item-title" style="font-size:20px;">${fmtNum(balance)}</div>
      ${goal!=null
        ? `<button class="text-btn" data-action="set-goal">of ${fmtNum(goal)} goal · edit</button>`
        : `<button class="text-btn" data-action="set-goal">Set a goal</button>`}
    </div>
    ${goal!=null ? `<div class="budget-progress-track"><div class="budget-progress-fill" style="width:${pct}%;"></div></div>` : ''}
    <div class="budget-inline-form-slot" data-form-slot="${cat.key}"></div>
    <div class="budget-contribution-list">${contributionsHtml}</div>
  `;
}

function openContributionForm(dir, catKey){
  const slot = document.querySelector(`[data-form-slot="${catKey}"]`);
  if(!slot) return;
  slot.innerHTML = `
    <div class="subform-row" style="grid-template-columns:120px 1fr 130px auto;">
      <input type="number" step="0.01" class="f-input bc-amount" placeholder="Amount">
      <input type="text" class="f-input bc-note" placeholder="Note (optional)">
      <input type="date" class="f-input bc-date" value="${todayISO()}">
      <button class="row-del" data-action="cancel-inline-form" title="Cancel">✕</button>
    </div>
    <button class="btn accent small" data-action="save-contribution" data-dir="${dir}">${dir==='deposit'?'Add Deposit':'Add Withdrawal'}</button>
  `;
}

async function saveContribution(btn){
  const slot = btn.closest('.budget-inline-form-slot');
  const amount = parseFloat(slot.querySelector('.bc-amount').value);
  if(!amount || isNaN(amount)){ toast('Amount is required', true); return; }
  const payload = {
    amount,
    direction: btn.dataset.dir,
    note: slot.querySelector('.bc-note').value.trim() || null,
    contribution_date: slot.querySelector('.bc-date').value || todayISO()
  };
  btn.disabled = true; btn.textContent = 'Saving…';
  try{
    const { error } = await sb.from('budget_savings_contributions').insert(payload);
    if(error) throw error;
    toast(payload.direction==='deposit' ? 'Deposit added' : 'Withdrawal added');
    await loadBudget();
  }catch(e){ toast('Save failed: '+e.message, true); btn.disabled=false; }
}

async function deleteContribution(id){
  if(!confirm('Remove this contribution?')) return;
  try{
    const { error } = await sb.from('budget_savings_contributions').delete().eq('id', id);
    if(error) throw error;
    toast('Removed');
    await loadBudget();
  }catch(e){ toast('Delete failed: '+e.message, true); }
}

function openGoalForm(catKey){
  const slot = document.querySelector(`[data-form-slot="${catKey}"]`);
  if(!slot) return;
  slot.innerHTML = `
    <div class="subform-row" style="grid-template-columns:1fr auto;">
      <input type="number" step="0.01" class="f-input bg-goal" placeholder="Goal amount" value="${budgetState.savings.goal_amount ?? ''}">
      <button class="row-del" data-action="cancel-inline-form" title="Cancel">✕</button>
    </div>
    <button class="btn accent small" data-action="save-goal">Save Goal</button>
  `;
}

async function saveGoal(btn){
  const slot = btn.closest('.budget-inline-form-slot');
  const val = slot.querySelector('.bg-goal').value;
  btn.disabled = true; btn.textContent = 'Saving…';
  try{
    const { error } = await sb.from('budget_savings').update({goal_amount: val===''? null : parseFloat(val)}).eq('id',1);
    if(error) throw error;
    toast('Goal updated');
    await loadBudget();
  }catch(e){ toast('Save failed: '+e.message, true); btn.disabled=false; }
}

/* ---------- reference stub category (Shopping, Gifts, Doctor, Transportation) ---------- */
function renderReferenceCategory(cat){
  const ref = budgetState.references.find(r=>r.category_key===cat.key) || {manual_total:null, manual_note:''};
  const cadencePill = cat.cadence ? `<span class="pill neutral">${escHtml(cat.cadence)}</span>` : '';
  return `
    <div class="budget-cat-head">
      <div class="budget-cat-title"><span class="cat-key">${cat.key}</span>${escHtml(cat.name)}</div>
      <div style="display:flex;gap:8px;align-items:center;">
        ${cadencePill}
        <span class="pill watch">No dedicated page yet</span>
      </div>
    </div>
    <div class="budget-ref-stub" data-ref="${cat.key}">
      <div class="f-grid cols-2">
        <div><label class="f-label">Manual total</label><input type="number" step="0.01" class="f-input ref-total" value="${ref.manual_total ?? ''}" placeholder="0.00"></div>
        <div><label class="f-label">Note</label><input type="text" class="f-input ref-note" value="${escHtml(ref.manual_note || '')}" placeholder="Optional note"></div>
      </div>
      <button class="btn small" style="margin-top:10px;" data-action="save-ref" data-cat="${cat.key}">Save</button>
    </div>
  `;
}

async function saveReference(catKey, btn){
  const card = btn.closest('[data-ref]');
  const totalVal = card.querySelector('.ref-total').value;
  const payload = {
    category_key: catKey,
    manual_total: totalVal===''? null : parseFloat(totalVal),
    manual_note: card.querySelector('.ref-note').value.trim() || null,
    updated_at: new Date().toISOString()
  };
  btn.disabled = true; btn.textContent = 'Saving…';
  try{
    const { error } = await sb.from('budget_references').upsert(payload, {onConflict:'category_key'});
    if(error) throw error;
    toast('Saved');
    await loadBudget();
  }catch(e){ toast('Save failed: '+e.message, true); btn.disabled=false; btn.textContent='Save'; }
}

/* ---------- event delegation (attached once — inner HTML is replaced on every re-render) ---------- */
function wireBudgetEvents(){
  document.getElementById('budgetCategories').addEventListener('click', async (e)=>{
    const btn = e.target.closest('[data-action]');
    if(!btn) return;
    const action = btn.dataset.action;

    if(action === 'add-item') openAddItemForm(btn.dataset.cat);
    else if(action === 'save-item') await saveNewItem(btn.dataset.cat, btn);
    else if(action === 'del-item') await deleteItem(btn.dataset.item);
    else if(action === 'add-payment') openAddPaymentForm(btn.dataset.item);
    else if(action === 'save-payment') await saveNewPayment(btn.dataset.item, btn);
    else if(action === 'del-payment') await deletePayment(btn.dataset.id);
    else if(action === 'save-ref') await saveReference(btn.dataset.cat, btn);
    else if(action === 'add-contribution') openContributionForm(btn.dataset.dir, btn.closest('.budget-category-card').dataset.catKey);
    else if(action === 'save-contribution') await saveContribution(btn);
    else if(action === 'del-contribution') await deleteContribution(btn.dataset.id);
    else if(action === 'set-goal') openGoalForm(btn.closest('.budget-category-card').dataset.catKey);
    else if(action === 'save-goal') await saveGoal(btn);
    else if(action === 'cancel-inline-form'){ const slot = btn.closest('.budget-inline-form-slot'); if(slot) slot.innerHTML=''; }
  });
}
