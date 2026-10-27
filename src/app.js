/* Main window: the project list, the edit dialog and Settings. Shared helpers are in common.js. */

/* ---- state ---- */
let items = [], cats = [], editing = null, settings = null;
let filter = { updated: false, cats: {}, q: '' };   // cats: categoryId -> valueId ('' = not set)
let collapsed = new Set(store.get('ember.collapsed', []));       // sidebar groups that are closed
let collapsedEdit = new Set(store.get('ember.collapsedEdit', [])); // categories closed in Settings

function visible() {
  const q = filter.q.toLowerCase();
  return items.filter((i) =>
    (!filter.updated || i.updated || i.behind > 0) &&
    Object.entries(filter.cats).every(([cid, vid]) => ((i.cats || {})[cid] || '') === vid) &&
    (!q || [i.name, i.path, ...cats.map((c) => (valueOf(i, c) || {}).name || '')].join(' ').toLowerCase().includes(q)));
}

/* ---- sidebar ---- */
function renderSide() {
  const nav = (attrs, label, n, on) => `<button class="nav ${on ? 'active' : ''}" ${attrs}>${label}<span class="n">${n}</span></button>`;
  const upd = items.filter((i) => i.updated || i.behind > 0).length;
  const noFilter = !filter.updated && !Object.keys(filter.cats).length;
  const group = (key, title, body, extra = '') => {
    const closed = collapsed.has(key);
    return `<div class="group ${closed ? 'closed' : ''}"><h4 data-toggle="${esc(key)}" title="${t('side.collapse')}"><span class="chev">▾</span>${title}${extra}</h4><div class="gBody">${body}</div></div>`;
  };
  let h = group('__projects', t('side.projects'),
    nav('data-all', '📁 ' + t('side.allProjects'), items.length, noFilter) + nav('data-updated', '🆕 ' + t('side.updated'), upd, filter.updated));
  for (const c of cats) {
    const none = items.filter((i) => !valueOf(i, c)).length;
    h += group(c.id, `${esc(c.icon)} ${esc(c.name)}`,
      // "All" is automatic in every category: it clears that category's filter
      nav(`data-cat="${esc(c.id)}" data-val="*"`, '✦ ' + t('side.all'), items.length, !(c.id in filter.cats)) +
      c.values.map((v) => nav(`data-cat="${esc(c.id)}" data-val="${esc(v.id)}"`, `${esc(v.icon)} ${esc(v.name)}`,
        items.filter((i) => (i.cats || {})[c.id] === v.id).length, filter.cats[c.id] === v.id)).join('') +
      (none && c.values.length ? nav(`data-cat="${esc(c.id)}" data-val=""`, '— ' + t('side.none', { name: esc(c.name) }), none, filter.cats[c.id] === '') : ''),
      `<button class="mini" data-manage title="${t('side.manage')}">✎</button>`);
  }
  h += `<button class="btn ghost" style="width:100%" data-manage>＋ ${t('side.newCat')}</button>`;
  $('#groups').innerHTML = h;
}

/* ---- project cards ---- */
function card(i) {
  const busy = i.status !== 'stopped';
  const tags = tagsHtml(i, cats);
  return `<article class="card ${i.status} ${i.updated || i.behind > 0 ? 'updated' : ''}" data-id="${i.id}" title="${t('card.openTip')}">
    <div class="top">${logoHtml(i, cats)}
      <div class="ttl"><h3 class="name" title="${t('card.renameTip')}">${esc(i.name)}</h3>
        <div class="state"><span class="dot"></span>${statusText(i.status)}${portHtml(i)}</div></div>
      ${i.updated ? `<span class="tag new">${t('card.updated')}</span>` : ''}
      <button class="icon" data-act="edit" title="${t('card.edit')}">✎</button></div>
    ${tags ? `<div class="tags">${tags}</div>` : ''}
    <div class="pathRow"><div class="path" title="${esc(i.path)}">${esc(i.path)}</div>
      <button class="icon" data-act="folder" title="${t('card.folder')}">📂</button></div>
    <div class="row">
      <select ${busy ? 'disabled' : ''}>${i.scripts.map((s) => `<option ${s === i.script ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
      <span class="pm">${i.pm}</span>${pkgHtml(i)}
    </div>${updHtml(i)}
    <div class="actions">
      ${busy ? `<button class="btn danger" data-act="stop">${t('card.stop')}</button>`
             : `<button class="btn primary" data-act="start" ${i.exists ? '' : 'disabled'}>${t('card.run')}</button>`}
      ${i.url ? `<button class="btn" data-act="open">${t('card.open')}</button>` : ''}
      <button class="btn ghost" data-act="window">${t('card.log')}</button>
    </div></article>`;
}

function render() {
  renderSide();
  const v = visible();
  $('#grid').innerHTML = v.length ? v.map(card).join('') : `<div class="empty">${t(items.length ? 'page.noMatch' : 'page.empty')}</div>`;
  // page title = the active filters, e.g. "Game · Jolly Panda"
  const parts = cats.filter((c) => c.id in filter.cats).map((c) => {
    const val = c.values.find((x) => x.id === filter.cats[c.id]);
    return val ? `${val.icon} ${val.name}` : t('side.none', { name: c.name });
  });
  if (filter.updated) parts.unshift('🆕 ' + t('side.updated'));
  $('#pageTitle').textContent = parts.length ? parts.join(' · ') : t('page.all');
  const run = items.filter((i) => i.status === 'running').length;
  $('#stats').textContent = v.length === items.length ? t('page.stats', { n: items.length, run }) : t('page.statsOf', { v: v.length, n: items.length, run });
}

async function reload() { [items, cats] = await Promise.all([api.list(), api.categories()]); render(); }

/* ---- events from the app ---- */
api.onEvent((e) => {
  if (e.type === 'state') {
    const i = items.find((x) => x.id === e.id);
    if (i) { const { type, id, ...rest } = e; Object.assign(i, rest); render(); }
  } else if (e.type === 'appUpdate') {
    if (settings) settings.appUpdate = e.appUpdate;
    renderAppUpdate();
  } else if (e.type === 'focus') {
    filter = { updated: false, cats: {}, q: '' }; $('#q').value = ''; render();
    const el = document.querySelector(`.card[data-id="${e.id}"]`);
    if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1600); }
  } else if (e.type === 'categories' || e.type === 'projects') {
    reload();
  } else if (e.type === 'edit') {
    const i = items.find((x) => x.id === e.id); if (i) openEdit(i);
  } else if (e.type === 'openSettings') {
    openSettings(e.tab);
  }
});

/* ---- clicks ---- */
$('#groups').onclick = (e) => {
  const b = e.target.closest('button, h4'); if (!b) return;
  if (b.hasAttribute('data-manage')) return openSettings('cats');
  if (b.dataset.toggle) {
    const k = b.dataset.toggle;
    collapsed.has(k) ? collapsed.delete(k) : collapsed.add(k);
    store.set('ember.collapsed', [...collapsed]);
    return renderSide();
  }
  if (b.hasAttribute('data-all')) filter = { ...filter, updated: false, cats: {} };
  else if (b.hasAttribute('data-updated')) filter.updated = !filter.updated;
  else if (b.dataset.cat) {
    const { cat, val } = b.dataset;
    if (val === '*' || filter.cats[cat] === val) delete filter.cats[cat]; else filter.cats[cat] = val;   // "All" or a second click clears
  }
  render();
};
$('#q').oninput = (e) => { filter.q = e.target.value; render(); };
$('#grid').onclick = async (e) => {
  const c = e.target.closest('.card'); if (!c) return;
  const i = items.find((x) => x.id === c.dataset.id);
  const b = e.target.closest('[data-act]');
  if (!b) {
    // a click anywhere else on the card opens its window (not on the script list or while renaming)
    if (!e.target.closest('select, input, h3.name')) api.openProject(i.id);
    return;
  }
  if (b.dataset.act === 'edit') return openEdit(i);
  if (b.dataset.act === 'window') return api.openProject(i.id);
  const r = await projectAction(b.dataset.act, i, b, c.querySelector('select').value);
  if (Array.isArray(r)) { items = r; render(); }
};
// double-click a project name to rename it in place
$('#grid').ondblclick = (e) => {
  const h = e.target.closest('h3.name'); if (!h) return;
  const i = items.find((x) => x.id === h.closest('.card').dataset.id);
  const inp = document.createElement('input');
  inp.className = 'rename'; inp.value = i.name; inp.maxLength = 80;
  h.replaceWith(inp); inp.focus(); inp.select();
  let done = false;
  const finish = async (ok) => {
    if (done) return; done = true;
    const name = inp.value.trim();
    if (ok && name && name !== i.name) items = await api.update(i.id, { name });
    render();
  };
  inp.onkeydown = (k) => { if (k.key === 'Enter') finish(true); else if (k.key === 'Escape') finish(false); };
  inp.onblur = () => finish(true);
  inp.onclick = (k) => k.stopPropagation();
};
$('#grid').onchange = (e) => {
  if (e.target.tagName !== 'SELECT') return;
  const i = items.find((x) => x.id === e.target.closest('.card').dataset.id);
  i.script = e.target.value; api.update(i.id, { script: i.script });
};
$('#add').onclick = async () => { items = await api.add(); render(); };

/* ---- edit dialog ---- */
function openEdit(i) {
  editing = i;
  $('#eName').value = i.name;
  $('#ePort').value = i.port || '';
  fillLogo(i);
  $('#eCats').innerHTML = cats.map((c) => `<label>${esc(c.icon)} ${esc(c.name)}
    <select data-cid="${esc(c.id)}"><option value="">—</option>${c.values.map((v) =>
      `<option value="${esc(v.id)}" ${(i.cats || {})[c.id] === v.id ? 'selected' : ''}>${esc(v.icon)} ${esc(v.name)}</option>`).join('')}</select></label>`).join('') ||
    `<p class="hint">${t('edit.noCats')}</p>`;
  if (!$('#editDlg').open) $('#editDlg').showModal();
}
function fillLogo(i) {
  $('#eLogo').outerHTML = logoHtml(i, cats, 'big').replace('<div class="logo big"', '<div class="logo big" id="eLogo"');
  $('#eLogoHint').textContent = t('edit.hint.' + i.logoMode) + (i.logoMode === 'auto' && !i.logoUrl ? t('edit.hint.autoNone') : '');
  $('#eLogoAuto').hidden = i.logoMode === 'auto';
  $('#eLogoNone').hidden = i.logoMode === 'none';
}
async function logoAction(fn) {
  items = await fn(editing.id);
  editing = items.find((x) => x.id === editing.id);
  fillLogo(editing); render();
}
$('#eLogoPick').onclick = () => logoAction(api.pickLogo);
$('#eLogoAuto').onclick = () => logoAction((id) => api.setLogoMode(id, 'auto'));
$('#eLogoNone').onclick = () => logoAction((id) => api.setLogoMode(id, 'none'));
$('#eCancel').onclick = () => $('#editDlg').close();
$('#eSave').onclick = async () => {
  const sel = {};
  document.querySelectorAll('#eCats select').forEach((el) => { if (el.value) sel[el.dataset.cid] = el.value; });
  items = await api.update(editing.id, { name: $('#eName').value.trim() || editing.name, cats: sel, port: $('#ePort').value.trim() });
  $('#editDlg').close(); render();
};
$('#eRemove').onclick = async () => {
  if (!confirm(t('edit.removeQ'))) return;
  items = await api.remove(editing.id); $('#editDlg').close(); render();
};

/* ---- category manager (settings → categories) ---- */
// Typing only changes the data and saves a moment later; the editor is rebuilt only when rows
// are added or removed, so a click into the next field is never lost.
const EMOJI_GROUPS = [
  ['😀', '😀😃😄😁😆😅😂🤣😊😇🙂😉😍🥰😘😎🤓🧐🤔🤩🥳😏😴🤯😱🤠🥸😈👻💀🤖👽👾💩🙈👋👍👎👏🙌🤝💪🧠👀👤👥🧑‍💻👨‍💻👩‍💻🧑‍🎨🧑‍🏫🧑‍💼🧑‍🔬🧑‍🚀🧙🦸🥷👑'],
  ['🐼', '🐼🐶🐱🦊🐻🐨🐯🦁🐮🐷🐸🐵🐔🐧🐦🦉🦄🐝🦋🐢🐍🦖🐉🐙🦀🐠🐬🐳🦈🌵🌲🌳🌴🌱🍀🍁🌸🌹🌻🌈☀️🌙⭐🌟✨⚡🔥💧🌊❄️☁️🌍'],
  ['🍕', '🍎🍊🍋🍌🍉🍇🍓🍒🍑🥑🥕🌽🍞🧀🍔🍟🍕🌭🌮🍣🍜🍩🍪🎂🍰🍫🍿☕🍵🧃🍺🍷'],
  ['🎮', '🎮🕹️🎲♟️🧩🎯🎳🏆🥇🏅⚽🏀🏈⚾🎾🏐🏓🥊⛳🏁🎨🎭🎬🎤🎧🎵🎹🎸🥁🎻📷🎥🪄🃏'],
  ['🏠', '🏠🏡🏢🏬🏭🏫🏥🏦🏪🏛️⛪🕌🏰🗼🗽🌆🏙️🌉🚗🚕🚌🚀✈️🚁🚢⛵🚲🛴🚦🗺️🧭⛺🏖️🏔️🌋'],
  ['💼', '💼📁📂🗂️📊📈📉📋📌📎✏️🖊️📝📚📖🔖🏷️💡🔦🔧🔨⚙️🛠️🧪🔬🔭💻🖥️⌨️🖱️📱☎️📡🔋🔌💾💿📦🛒💳💰💎🔑🔒🔓🔔📣✉️📅⏰⌛🧲🧰🌐🔗🗄️🧾'],
  ['❤️', '❤️🧡💛💚💙💜🖤🤍🤎💔✅☑️✔️❌⭕❗❓⚠️🚫⛔🔴🟠🟡🟢🔵🟣🟤⚫⚪🟥🟧🟨🟩🟦🟪⬛⬜🔶🔷🔺🔻💠🔘♻️⚜️🆕🆗🆙🆒🆓🔝🔜💯🔤#️⃣1️⃣2️⃣3️⃣4️⃣5️⃣🅰️🅱️'],
  ['🏳️', '🇮🇷🇺🇸🇬🇧🇩🇪🇫🇷🇹🇷🇦🇪🇨🇦🇯🇵🇨🇳🇮🇳🇷🇺🇮🇹🇪🇸🇳🇱🇸🇪🇦🇺🇧🇷🇰🇷🇦🇫🇮🇶🇸🇦🏳️🏴🏁🚩'],
].map(([tab, list], gi) => ({ tab, name: t('emoji.g' + gi), list: [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(list)].map((x) => x.segment) }));

function renderCats() {
  const used = (cid, vid) => items.filter((i) => (i.cats || {})[cid] === vid).length;
  $('#catList').innerHTML = cats.map((c, ci) => {
    const closed = collapsedEdit.has(c.id);
    const locked = c.id === 'type';   // the default category cannot be deleted
    return `<div class="catBox ${closed ? 'closed' : ''}" data-ci="${ci}">
      <div class="catHead">
        <button type="button" class="chevBtn" data-c="toggle" title="${t('side.collapse')}">▾</button>
        <button type="button" class="icoBtn" data-f="icon" title="${t('cat.pickIcon')}">${esc(c.icon)}</button>
        <input data-f="name" value="${esc(c.name)}" data-i18n-ph="cat.namePh" placeholder="${t('cat.namePh')}" maxlength="40">
        ${closed ? `<span class="n">${t('cat.noValues', { n: c.values.length })}</span>` : ''}
        ${locked ? `<span class="lock" title="${t('cat.locked')}">🔒</span>`
                 : `<button class="btn ghost" data-c="delCat" title="${t('cat.delete')}">🗑</button>`}
      </div>
      <div class="catVals">
        <div class="catAll">${t('cat.allAuto')}</div>
        ${c.values.map((v, vi) => `<div class="valRow" data-vi="${vi}">
          <button type="button" class="icoBtn" data-vf="icon" title="${t('cat.pickIcon')}">${esc(v.icon)}</button>
          <input data-vf="name" value="${esc(v.name)}" placeholder="${t('cat.valuePh')}" maxlength="40">
          <span class="n" title="${t('cat.count')}">${used(c.id, v.id)}</span>
          <button class="btn ghost" data-c="delVal" title="${t('cat.deleteVal')}">✕</button></div>`).join('')}
        <button class="btn ghost" data-c="addVal">${t('cat.addValue')}</button>
      </div>
    </div>`;
  }).join('') || `<p class="hint">${t('cat.empty')}</p>`;
}
// the object (category or value) an input/icon button in the editor belongs to
function catTarget(el) {
  const box = el.closest('.catBox'); if (!box) return null;
  const c = cats[box.dataset.ci];
  if (el.dataset.f) return { obj: c, key: el.dataset.f };
  const row = el.closest('.valRow');
  return row ? { obj: c.values[row.dataset.vi], key: el.dataset.vf } : null;
}
let catTimer = null;
function queueCatSave() { clearTimeout(catTimer); catTimer = setTimeout(() => saveCats(false), 500); }
async function saveCats(rebuild, focus) {
  clearTimeout(catTimer); catTimer = null;
  const saved = await api.setCategories(cats);
  // keep the objects being edited, just take the ids the app assigned
  saved.forEach((c, i) => { if (cats[i]) { cats[i].id = c.id; c.values.forEach((v, j) => { if (cats[i].values[j]) cats[i].values[j].id = v.id; }); } });
  items = await api.list();
  render();
  if (rebuild) renderCats();
  if (focus) { const el = document.querySelector(focus); if (el) { el.focus(); el.select(); } }
}
$('#catList').addEventListener('input', (e) => {
  const tg = catTarget(e.target); if (!tg) return;
  tg.obj[tg.key] = e.target.value;
  queueCatSave();
});
$('#catList').onclick = (e) => {
  const ib = e.target.closest('.icoBtn');
  if (ib) return openPicker(ib);
  const b = e.target.closest('[data-c]'); if (!b) return;
  const ci = Number(b.closest('.catBox').dataset.ci), c = cats[ci];
  if (b.dataset.c === 'toggle') {
    collapsedEdit.has(c.id) ? collapsedEdit.delete(c.id) : collapsedEdit.add(c.id);
    store.set('ember.collapsedEdit', [...collapsedEdit]);
    renderCats();
  } else if (b.dataset.c === 'addVal') {
    c.values.push({ icon: '🔹', name: t('cat.newValue') });
    saveCats(true, `.catBox[data-ci="${ci}"] .valRow:last-of-type [data-vf=name]`);
  } else if (b.dataset.c === 'delVal') {
    const v = c.values[b.closest('.valRow').dataset.vi];
    const n = items.filter((i) => (i.cats || {})[c.id] === v.id).length;
    if (n && !confirm(t('cat.delValQ', { name: v.name, n }))) return;
    c.values = c.values.filter((x) => x !== v); saveCats(true);
  } else if (b.dataset.c === 'delCat' && c.id !== 'type') {
    if (!confirm(t('cat.delCatQ', { name: c.name }))) return;
    cats.splice(ci, 1); delete filter.cats[c.id]; saveCats(true);
  }
};
$('#addCat').onclick = () => {
  cats.push({ icon: '🏷️', name: t('cat.newCat'), values: [] });
  saveCats(true, '.catBox:last-of-type [data-f=name]');
};

// emoji picker: groups as tabs, plus any emoji or text you type yourself
const pick = $('#emojiPick');
let pickFor = null, pickGroup = 0;
function renderPicker() {
  pick.innerHTML = `<div class="epTabs">${EMOJI_GROUPS.map((g, i) => `<button type="button" data-g="${i}" class="${i === pickGroup ? 'on' : ''}" title="${g.name}">${g.tab}</button>`).join('')}</div>
    <div class="epName">${EMOJI_GROUPS[pickGroup].name}</div>
    <div class="epGrid">${EMOJI_GROUPS[pickGroup].list.map((x) => `<button type="button" data-e="${esc(x)}">${x}</button>`).join('')}</div>
    <form class="epCustom"><input placeholder="${t('emoji.custom')}" maxlength="16"><button class="btn" type="submit">✓</button></form>`;
}
function openPicker(btn) {
  pickFor = btn; renderPicker(); pick.hidden = false;
  const r = btn.getBoundingClientRect(), h = pick.offsetHeight, w = pick.offsetWidth;
  pick.style.top = `${Math.max(8, r.bottom + h + 8 > innerHeight ? r.top - h - 4 : r.bottom + 4)}px`;   // above when no room below
  pick.style.left = `${Math.min(innerWidth - w - 8, Math.max(8, LANG === 'en' ? r.left : r.right - w))}px`;
}
function applyIcon(icon) {
  icon = String(icon || '').trim(); if (!icon || !pickFor) return;
  const tg = catTarget(pickFor); if (!tg) return;
  tg.obj[tg.key] = icon; pickFor.textContent = icon; pick.hidden = true;
  saveCats(false);
}
pick.onclick = (e) => {
  const g = e.target.closest('[data-g]');
  if (g) { pickGroup = Number(g.dataset.g); renderPicker(); return; }
  const em = e.target.closest('[data-e]');
  if (em) applyIcon(em.dataset.e);
};
pick.onsubmit = (e) => { e.preventDefault(); applyIcon(pick.querySelector('.epCustom input').value); };
document.addEventListener('mousedown', (e) => { if (!pick.hidden && !pick.contains(e.target) && !e.target.closest('.icoBtn')) pick.hidden = true; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pick.hidden) { e.preventDefault(); e.stopPropagation(); pick.hidden = true; } }, true);
$('#setDlg').addEventListener('close', () => { if (catTimer) saveCats(false); pick.hidden = true; });

/* ---- settings dialog ---- */
const fmtDate = (ts) => (ts ? new Date(ts).toLocaleString(LANG === 'en' ? 'en-GB' : 'fa-IR') : '');
$('#sFetchMin').innerHTML = [5, 15, 30].map((n) => `<option value="${n}">${t('set.min', { n })}</option>`).join('') +
  [1, 3].map((n) => `<option value="${n * 60}">${t('set.hour', { n })}</option>`).join('');
function showTab(tab) {
  document.querySelectorAll('#setTabs [data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('#setDlg [data-pane]').forEach((p) => (p.hidden = p.dataset.pane !== tab));
  $('.paneBody').scrollTop = 0;
}
function fillSettings(s) {
  settings = s;
  document.querySelectorAll('[data-set]').forEach((el) => (el.checked = !!s[el.dataset.set]));
  $('#sLang').value = s.lang;
  $('#sFetchMin').value = String(s.fetchMinutes);
  $('#sFetchMin').disabled = !s.watchProjects || !s.fetchRemote;
  $('[data-set=fetchRemote]').disabled = !s.watchProjects;
  $('#uCur').textContent = s.version; $('#aVer').textContent = s.version;
  $('#ver').textContent = 'v' + s.version; $('#ver').hidden = false;
  renderAppUpdate();
}
function renderAppUpdate() {
  if (!settings) return;
  const u = settings.appUpdate || {};
  const avail = !!(u.available && u.latest);
  const ready = avail && u.ready;
  const page = settings.updateMode === 'page';
  $('#settingsDot').hidden = !avail; $('#tabDot').hidden = !avail;
  let st;
  if (u.downloading) st = t('up.downloading', { v: `<code>${esc(u.latest.version)}</code>`, p: Math.round((u.progress || 0) * 100) });
  else if (u.checking) st = t('up.checking');
  else if (u.error) st = `<span class="bad">⚠ ${esc(u.error)}</span>`;
  else if (ready) st = `<span class="ok">${t('up.ready', { v: `<code>${esc(u.readyVersion)}</code>` })}</span>`;
  else if (avail) st = `<span class="warn">${t('up.available', { v: `<code>${esc(u.latest.version)}</code>` })}</span> <small class="hint">(${fmtDate(u.latest.publishedAt)})</small>`;
  else if (u.checkedAt) st = `<span class="ok">${t('up.latest')}</span> <small class="hint">${t('up.lastCheck', { t: ago(u.checkedAt) })}</small>`;
  else st = t('up.never');
  $('#uStatus').innerHTML = st;
  $('#uProgress').hidden = !u.downloading;
  $('#uProgress i').style.width = `${Math.round((u.progress || 0) * 100)}%`;
  $('#uInstall').hidden = !avail || u.downloading;
  $('#uInstall').textContent = t(page ? 'up.page' : ready ? 'up.install' : 'up.download');
  $('#uCheck').disabled = u.checking || u.downloading;
  $('#uNotes').hidden = !avail || !u.latest.notes;
  if (avail) $('#uNotes').textContent = u.latest.notes;
  renderBanners();
}
function renderBanners() {
  if (!settings) return;
  const u = settings.appUpdate || {};
  const code = (v) => `<code>${esc(v)}</code>`;
  let h = '';
  if (settings.justUpdated) h += `<div class="banner ok">${t('banner.updated', { v: code(settings.justUpdated) })} <button class="btn ghost" data-banner="notes">${t('banner.notes')}</button><button class="btn ghost" data-banner="dismiss">✕</button></div>`;
  if (u.available && u.latest && u.ready) h += `<div class="banner">${t('banner.ready', { v: code(u.readyVersion) })} <button class="btn primary" data-banner="restart">${t('banner.restart')}</button></div>`;
  else if (u.available && u.latest && !u.downloading) h += `<div class="banner">${t('banner.available', { v: code(u.latest.version) })} <button class="btn primary" data-banner="update">${t('banner.view')}</button></div>`;
  $('#banners').innerHTML = h;
}
async function restartForUpdate() {
  const run = items.filter((i) => i.status !== 'stopped').length;
  if (run && !confirm(t('up.runningQ', { n: run }))) return;
  settings.appUpdate = await api.installAppUpdate(); renderAppUpdate();
}
$('#banners').onclick = (e) => {
  const b = e.target.closest('[data-banner]'); if (!b) return;
  if (b.dataset.banner === 'update') openSettings('updates');
  else if (b.dataset.banner === 'restart') restartForUpdate();
  else if (b.dataset.banner === 'notes') api.openUrl(`${settings.repo}/releases/tag/v${settings.justUpdated}`);
  else if (b.dataset.banner === 'dismiss') { settings.justUpdated = null; api.dismissJustUpdated(); renderBanners(); }
};
async function openSettings(tab = 'general') {
  fillSettings(await api.settings());
  if (tab === 'cats') renderCats();
  showTab(tab);
  if (!$('#setDlg').open) $('#setDlg').showModal();
}
const saveSettings = async (patch) => fillSettings(await api.setSettings(patch));
$('#settingsBtn').onclick = () => openSettings(settings && settings.appUpdate && settings.appUpdate.available ? 'updates' : 'general');
$('#setTabs').onclick = (e) => { const b = e.target.closest('[data-tab]'); if (!b) return; if (b.dataset.tab === 'cats') renderCats(); showTab(b.dataset.tab); };
$('#setDlg').onchange = (e) => {
  const k = e.target.dataset.set;
  if (k) saveSettings({ [k]: e.target.checked });
  else if (e.target.id === 'sFetchMin') saveSettings({ fetchMinutes: Number(e.target.value) });
  else if (e.target.id === 'sLang') { store.set('ember.reopenSettings', true); api.setSettings({ lang: e.target.value }); }   // windows reload in the new language
};
$('#setClose').onclick = () => $('#setDlg').close();
$('#sData').onclick = () => api.openData();
$('#sCheckProjects').onclick = async (e) => {
  e.target.disabled = true; $('#sProjMsg').textContent = t('set.checking');
  items = await api.checkProjects(true); render();
  const n = items.filter((i) => i.updated || i.behind > 0).length;
  $('#sProjMsg').textContent = n ? t('set.nUpdated', { n }) : t('set.noneUpdated');
  e.target.disabled = false;
};
$('#uCheck').onclick = async () => { settings.appUpdate = await api.checkAppUpdate(); renderAppUpdate(); };
$('#uInstall').onclick = () => restartForUpdate();
$('#uPage').onclick = () => api.openUrl(`${settings.repo}/releases`);
document.querySelectorAll('[data-link]').forEach((b) => (b.onclick = () => api.openUrl(settings.repo + b.dataset.link)));
document.querySelectorAll('[data-link-abs]').forEach((b) => (b.onclick = (e) => { e.preventDefault(); api.openUrl(b.dataset.linkAbs); }));

reload();
api.settings().then((s) => {
  fillSettings(s);
  // after switching the language, come back to the settings page you were on
  if (store.get('ember.reopenSettings', false)) { store.set('ember.reopenSettings', false); openSettings('general'); }
});
