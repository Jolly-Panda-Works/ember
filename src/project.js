/* Project window: name and buttons on top, the live log below. */
const ID = new URLSearchParams(location.search).get('id');
let p = null, cats = [];

function renderHead() {
  if (!p) { $('#head').innerHTML = ''; $('#info').innerHTML = `<p class="empty">${t('proj.gone')}</p>`; return; }
  document.title = `${p.name} — Ember`;
  const busy = p.status !== 'stopped' || pending.has(p.id);
  $('#head').className = `topbar projHead ${p.status}`;
  $('#head').innerHTML = `${logoHtml(p, cats)}
    <div class="ttl"><h1 class="name" title="${t('card.renameTip')}">${esc(p.name)}</h1>
      <div class="state"><span class="dot"></span><span>${statusText(p.status)}</span>${portHtml(p)}</div></div>
    ${p.updated ? `<span class="tag new">${t('card.updated')}</span>` : ''}
    <nav class="tools">
      ${runBtn(p)}
      ${p.url ? `<button class="btn" data-act="open">${ico('external')}${t('card.open')}</button>` : ''}
      <button class="icon" data-act="folder" title="${t('card.folder')}" aria-label="${t('card.folder')}">${ico('folderOpen')}</button>
      <button class="icon" data-act="edit" title="${t('card.edit')}" aria-label="${t('card.edit')}">${ico('pencil')}</button>
    </nav>`;
  const tags = tagsHtml(p, cats);
  $('#info').innerHTML = `
    <div class="row">
      ${tags ? `<div class="tags">${tags}</div>` : ''}
      <label class="scriptSel">${t('proj.script')}
        <span class="sel"><select ${busy ? 'disabled' : ''}>${p.scripts.map((s) => `<option ${s === p.script ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>${ico('chevron')}</span></label>
      <span class="chip pm">${esc(p.pm)}</span>${pkgHtml(p)}
      <div class="pathRow">${ico('folder', 'pathIco')}<div class="path" title="${esc(p.path)}">${esc(p.path)}</div>
        <button class="icon sm" data-act="copy" title="${t('card.copyPath')}" aria-label="${t('card.copyPath')}">${ico('copy')}</button></div>
    </div>${updHtml(p)}`;
}

const logEl = $('#log');
function showEmpty() { if (!logEl.textContent) logEl.dataset.empty = t('proj.emptyLog'); }
function append(text) {
  const atEnd = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;
  logEl.textContent += text;
  delete logEl.dataset.empty;
  if ($('#follow').checked || atEnd) logEl.scrollTop = 1e9;
}

async function load() {
  const [list, c, lines] = await Promise.all([api.list(), api.categories(), api.logs(ID)]);
  cats = c; p = list.find((x) => x.id === ID) || null;
  renderHead();
  logEl.textContent = lines.join(''); logEl.scrollTop = 1e9; showEmpty();
}

api.onEvent(async (e) => {
  if (e.type === 'log' && e.id === ID) append(e.text);
  else if (e.type === 'logClear' && e.id === ID) { logEl.textContent = ''; showEmpty(); }
  else if (e.type === 'state' && e.id === ID && p) { const { type, id, ...rest } = e; settlePending(e); Object.assign(p, rest); renderHead(); }
  else if (e.type === 'categories' || e.type === 'projects') {
    [cats, p] = await Promise.all([api.categories(), api.list().then((l) => l.find((x) => x.id === ID) || null)]);
    renderHead();
  }
});

ui.rerender = () => renderHead();
document.body.onclick = async (e) => {
  const b = e.target.closest('[data-act]'); if (!b || !p || b.disabled) return;
  if (b.dataset.act === 'edit') return api.editProject(p.id);
  const r = await projectAction(b.dataset.act, p, b, $('#info select') && $('#info select').value);
  if (Array.isArray(r)) { p = r.find((x) => x.id === ID) || null; renderHead(); }
};
$('#info').onchange = (e) => {
  if (e.target.tagName !== 'SELECT' || !p) return;
  p.script = e.target.value; api.update(p.id, { script: p.script });
};
// double-click the name to rename
$('#head').ondblclick = (e) => {
  const h = e.target.closest('h1.name'); if (!h || !p) return;
  const inp = document.createElement('input');
  inp.className = 'rename big'; inp.value = p.name; inp.maxLength = 80;
  h.replaceWith(inp); inp.focus(); inp.select();
  let done = false;
  const finish = async (ok) => {
    if (done) return; done = true;
    const name = inp.value.trim();
    if (ok && name && name !== p.name) { const l = await api.update(p.id, { name }); p = l.find((x) => x.id === ID) || p; }
    renderHead();
  };
  inp.onkeydown = (k) => { if (k.key === 'Enter') finish(true); else if (k.key === 'Escape') finish(false); };
  inp.onblur = () => finish(true);
};
$('#clear').onclick = () => api.clearLog(ID);
$('#copy').onclick = async (e) => {
  try { await navigator.clipboard.writeText(logEl.textContent); } catch {}
  const lbl = e.currentTarget.querySelector('span:last-child'); lbl.textContent = t('proj.copied'); setTimeout(() => (lbl.textContent = t('proj.copy')), 1200);
};

load();
