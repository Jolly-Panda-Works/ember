const $ = (s) => document.querySelector(s);
const STATUS = { stopped: 'متوقف', installing: 'در حال نصب پکیج…', running: 'در حال اجرا' };

/* ---- API: Electron (IPC) or phone/browser (HTTP) ---- */
const isRemote = !window.ember;
const PIN = new URLSearchParams(location.search).get('pin') || sessionStorage.getItem('pin') || '';
if (PIN) sessionStorage.setItem('pin', PIN);
async function rq(method, url, body) {
  const r = await fetch(url, { method, headers: { 'x-pin': PIN, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401) { document.body.innerHTML = '<p style="padding:40px">PIN اشتباه است یا دسترسی موبایل در برنامه‌ی ویندوز خاموش است.</p>'; throw new Error('pin'); }
  return r.json();
}
const api = window.ember || {
  list: () => rq('GET', '/api/projects'),
  categories: () => rq('GET', '/api/categories'),
  settings: () => rq('GET', '/api/info'),
  start: (id, script) => rq('POST', '/api/start', { id, script }),
  stop: (id) => rq('POST', '/api/stop', { id }),
  logs: (id) => rq('GET', '/api/logs?id=' + id),
  onEvent: (cb) => { const es = new EventSource('/api/events?pin=' + encodeURIComponent(PIN)); es.onmessage = (e) => cb(JSON.parse(e.data)); },
};
document.body.classList.toggle('remote', isRemote);
document.body.classList.toggle('win', !isRemote && api.platform === 'win32');   // page top bar = window title bar

/* ---- state ---- */
let items = [], cats = [], logId = null, editing = null;
let filter = { updated: false, cats: {}, q: '' };   // cats: categoryId -> valueId ('' = not set)
const fa = new Intl.RelativeTimeFormat('fa', { numeric: 'auto' });
function ago(ms) {
  if (!ms) return '';
  const sec = (ms - Date.now()) / 1000;
  for (const [u, n] of [['day', 86400], ['hour', 3600], ['minute', 60]]) if (Math.abs(sec) >= n) return fa.format(Math.round(sec / n), u);
  return fa.format(0, 'minute');
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const valueOf = (i, c) => c.values.find((v) => v.id === (i.cats || {})[c.id]);

function visible() {
  const q = filter.q.toLowerCase();
  return items.filter((i) =>
    (!filter.updated || i.updated || i.behind > 0) &&
    Object.entries(filter.cats).every(([cid, vid]) => ((i.cats || {})[cid] || '') === vid) &&
    (!q || [i.name, i.path, ...cats.map((c) => (valueOf(i, c) || {}).name || '')].join(' ').toLowerCase().includes(q)));
}

function renderSide() {
  const nav = (attrs, label, n, on) => `<button class="nav ${on ? 'active' : ''}" ${attrs}>${label}<span class="n">${n}</span></button>`;
  const upd = items.filter((i) => i.updated || i.behind > 0).length;
  const noFilter = !filter.updated && !Object.keys(filter.cats).length;
  let h = `<div class="group"><h4>پروژه‌ها</h4>${nav('data-all', '📁 همه پروژه‌ها', items.length, noFilter)}` +
    nav('data-updated', '🆕 بروز شده‌ها', upd, filter.updated) + '</div>';
  for (const c of cats) {
    const none = items.filter((i) => !valueOf(i, c)).length;
    h += `<div class="group"><h4>${esc(c.icon)} ${esc(c.name)}<button class="mini local" data-manage title="مدیریت دسته‌بندی‌ها">✎</button></h4>` +
      // "All" is automatic in every category: it clears that category's filter
      nav(`data-cat="${esc(c.id)}" data-val="*"`, '✦ همه', items.length, !(c.id in filter.cats)) +
      c.values.map((v) => nav(`data-cat="${esc(c.id)}" data-val="${esc(v.id)}"`, `${esc(v.icon)} ${esc(v.name)}`,
        items.filter((i) => (i.cats || {})[c.id] === v.id).length, filter.cats[c.id] === v.id)).join('') +
      (none && c.values.length ? nav(`data-cat="${esc(c.id)}" data-val=""`, `— بدون ${esc(c.name)}`, none, filter.cats[c.id] === '') : '') +
      '</div>';
  }
  h += '<button class="btn ghost local" style="width:100%" data-manage>＋ دسته‌بندی جدید</button>';
  $('#groups').innerHTML = h;
}

// project logo: the picture, else the icon of its first category value, else its first letter
function logoHtml(i, big) {
  const cls = `logo${big ? ' big' : ''}`;
  if (i.logoUrl) {
    const src = isRemote ? `/api/logo?id=${encodeURIComponent(i.id)}&pin=${encodeURIComponent(PIN)}&v=${i.logoV || 0}` : i.logoUrl;
    return `<div class="${cls}"><img src="${esc(src)}" alt="" onerror="this.parentNode.textContent='${esc(initial(i))}'"></div>`;
  }
  const v = cats.map((c) => valueOf(i, c)).find(Boolean);
  return `<div class="${cls}">${esc(v ? v.icon : initial(i))}</div>`;
}
const initial = (i) => ([...(i.name || '?').replace(/[^\p{L}\p{N}]/gu, '')][0] || '?').toUpperCase();

function card(i) {
  const busy = i.status !== 'stopped';
  const pkgState = !i.exists ? '<span class="bad">⚠ پوشه یا package.json پیدا نشد</span>'
    : i.needsInstall ? '<span class="warn">⚠ نیاز به نصب پکیج (خودکار)</span>' : '<span class="ok">✓ پکیج‌ها آماده است</span>';
  const when = i.updateTime ? ` · ${ago(i.updateTime)}` : '';
  const upd = (i.updated ? `<div class="upd">
      <div><b>🆕 بروز شده — تست کنید</b><small>${i.updateSubject ? esc(i.updateSubject) : i.updateKind === 'files' ? 'فایل‌های پروژه تغییر کرده‌اند' : ''}${when}</small></div>
      <button class="btn ghost local" data-act="tested" title="علامت را بردار">✓ تست شد</button></div>` : '') +
    (i.behind > 0 ? `<div class="upd git">
      <div><b>⬇ ${i.behind} کامیت جدید در <code>${esc(i.upstream)}</code></b><small>${esc(i.remoteSubject)}</small></div>
      <button class="btn local" data-act="pull">دریافت (pull)</button></div>` : '') +
    (i.fetchError ? `<div class="hint bad" title="${esc(i.fetchError)}">⚠ git fetch ناموفق بود</div>` : '');
  const tags = cats.map((c) => valueOf(i, c)).filter(Boolean);
  return `<article class="card ${i.status} ${i.updated || i.behind > 0 ? 'updated' : ''}" data-id="${i.id}">
    <div class="top">${logoHtml(i)}
      <div class="ttl"><h3 class="name" title="${isRemote ? esc(i.name) : 'برای تغییر نام دوبار کلیک کنید'}">${esc(i.name)}</h3>
        <div class="state"><span class="dot"></span>${STATUS[i.status]}${i.port ? `<span class="port" title="پورت">:${i.port}</span>` : ''}</div></div>
      ${i.updated ? '<span class="tag new">🆕 بروز شده</span>' : ''}
      <button class="icon local" data-act="edit" title="ویرایش (نام، لوگو، دسته‌بندی، پورت)">✎</button></div>
    ${tags.length ? `<div class="tags">${tags.map((v) => `<span class="tag">${esc(v.icon)} ${esc(v.name)}</span>`).join('')}</div>` : ''}
    <div class="pathRow"><div class="path" title="${esc(i.path)}">${esc(i.path)}</div>
      <button class="icon local" data-act="folder" title="باز کردن پوشه">📂</button></div>
    <div class="row">
      <select ${busy ? 'disabled' : ''}>${i.scripts.map((s) => `<option ${s === i.script ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
      <span class="pm">${i.pm}</span>${pkgState}
    </div>${upd}
    <div class="actions">
      ${busy ? '<button class="btn danger" data-act="stop">■ توقف</button>'
             : `<button class="btn primary" data-act="start" ${i.exists ? '' : 'disabled'}>▶ اجرا</button>`}
      ${i.url ? '<button class="btn" data-act="open">🔗 باز کردن</button>' : ''}
      <button class="btn ghost" data-act="logs">📜 لاگ</button>
    </div></article>`;
}

function render() {
  renderSide();
  const v = visible();
  $('#grid').innerHTML = v.length ? v.map(card).join('')
    : `<div class="empty">${items.length ? 'پروژه‌ای با این فیلتر پیدا نشد.' : 'هنوز پروژه‌ای اضافه نشده. از نوار بالا «افزودن پروژه» را بزنید و یک پوشه‌ی پروژه (یا پوشه‌ای که چند پروژه دارد) را انتخاب کنید.'}</div>`;
  // page title = the active filters, e.g. "بازی · Jolly Panda"
  const parts = cats.filter((c) => c.id in filter.cats).map((c) => {
    const val = c.values.find((x) => x.id === filter.cats[c.id]);
    return val ? `${val.icon} ${val.name}` : `بدون ${c.name}`;
  });
  if (filter.updated) parts.unshift('🆕 بروز شده‌ها');
  $('#pageTitle').textContent = parts.length ? parts.join(' · ') : 'همه پروژه‌ها';
  const run = items.filter((i) => i.status === 'running').length;
  $('#stats').textContent = `${v.length === items.length ? items.length : `${v.length} از ${items.length}`} پروژه · ${run} در حال اجرا`;
}

async function reload() { [items, cats] = await Promise.all([api.list(), api.categories()]); render(); }

/* ---- logs ---- */
async function showLog(i) {
  logId = i.id; $('#logTitle').textContent = i.name; $('#logPanel').hidden = false;
  $('#log').textContent = (await api.logs(i.id)).join('');
  $('#log').scrollTop = 1e9;
}
$('#logClose').onclick = () => { logId = null; $('#logPanel').hidden = true; };

/* ---- events ---- */
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
  } else if (e.type === 'categories') {
    reload();
  } else if (e.type === 'openSettings') {
    openSettings(e.tab);
  } else if (e.type === 'log' && e.id === logId) {
    const el = $('#log'); const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    el.textContent += e.text; if (atEnd) el.scrollTop = 1e9;
  }
});

/* ---- clicks ---- */
$('#groups').onclick = (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.hasAttribute('data-manage')) return openSettings('cats');
  if (b.hasAttribute('data-all')) filter = { ...filter, updated: false, cats: {} };
  else if (b.hasAttribute('data-updated')) filter.updated = !filter.updated;
  else if (b.dataset.cat) {
    const { cat, val } = b.dataset;
    if (val === '*' || filter.cats[cat] === val) delete filter.cats[cat]; else filter.cats[cat] = val;   // "All" or a second click clears
  }
  render();
};
$('#q').oninput = (e) => { filter.q = e.target.value; render(); };
$('#grid').onclick = (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const c = b.closest('.card'); const i = items.find((x) => x.id === c.dataset.id);
  switch (b.dataset.act) {
    case 'start': api.start(i.id, c.querySelector('select').value); break;
    case 'stop': api.stop(i.id); break;
    case 'open': isRemote ? window.open(`http://${location.hostname}:${new URL(i.url).port}`) : api.openUrl(i.url); break;
    case 'logs': showLog(i); break;
    case 'folder': api.openFolder(i.id); break;
    case 'edit': openEdit(i); break;
    case 'tested': api.markTested(i.id).then((l) => { items = l; render(); }); break;
    case 'pull':
      b.disabled = true; b.textContent = 'در حال دریافت…';
      api.pull(i.id).then((r) => { if (!r.ok) { alert('pull ناموفق بود:\n' + r.err); showLog(i); } reload(); });
      break;
  }
};
// double-click a project name to rename it in place
$('#grid').ondblclick = (e) => {
  const h = e.target.closest('h3.name'); if (!h || isRemote) return;
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
};
$('#grid').onchange = (e) => {
  if (e.target.classList.contains('rename')) return;
  if (e.target.tagName !== 'SELECT' || isRemote) return;
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
    '<p class="hint">دسته‌بندی‌ای تعریف نشده. از تنظیمات ← دسته‌بندی‌ها بسازید.</p>';
  $('#editDlg').showModal();
}
const LOGO_HINT = {
  auto: 'خودکار: favicon یا لوگوی خود پروژه (مثلاً public/favicon.svg) اگر پیدا شود.',
  custom: 'تصویری که خودتان انتخاب کرده‌اید (یک کپی نگه داشته می‌شود).',
  none: 'بدون تصویر: آیکون دسته‌بندی یا حرف اول نام نشان داده می‌شود.',
};
function fillLogo(i) {
  $('#eLogo').outerHTML = logoHtml(i, true).replace('<div class="logo big"', '<div class="logo big" id="eLogo"');
  $('#eLogoHint').textContent = LOGO_HINT[i.logoMode] + (i.logoMode === 'auto' && !i.logoUrl ? ' (چیزی پیدا نشد)' : '');
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
  if (!confirm('این پروژه از لیست حذف شود؟ (فایل‌ها پاک نمی‌شوند)')) return;
  items = await api.remove(editing.id); $('#editDlg').close(); render();
};

/* ---- category manager (settings → categories) ---- */
// Typing only changes the data and saves a moment later; the editor is rebuilt only when rows
// are added or removed, so a click into the next field is never lost.
const EMOJI_GROUPS = [
  ['😀', 'چهره و آدم‌ها', '😀😃😄😁😆😅😂🤣😊😇🙂😉😍🥰😘😎🤓🧐🤔🤩🥳😏😴🤯😱🤠🥸😈👻💀🤖👽👾💩🙈👋👍👎👏🙌🤝💪🧠👀👤👥🧑‍💻👨‍💻👩‍💻🧑‍🎨🧑‍🏫🧑‍💼🧑‍🔬🧑‍🚀🧙🦸🥷👑'],
  ['🐼', 'حیوانات و طبیعت', '🐼🐶🐱🦊🐻🐨🐯🦁🐮🐷🐸🐵🐔🐧🐦🦉🦄🐝🦋🐢🐍🦖🐉🐙🦀🐠🐬🐳🦈🌵🌲🌳🌴🌱🍀🍁🌸🌹🌻🌈☀️🌙⭐🌟✨⚡🔥💧🌊❄️☁️🌍'],
  ['🍕', 'غذا', '🍎🍊🍋🍌🍉🍇🍓🍒🍑🥑🥕🌽🍞🧀🍔🍟🍕🌭🌮🍣🍜🍩🍪🎂🍰🍫🍿☕🍵🧃🍺🍷'],
  ['🎮', 'بازی و سرگرمی', '🎮🕹️🎲♟️🧩🎯🎳🏆🥇🏅⚽🏀🏈⚾🎾🏐🏓🥊⛳🏁🎨🎭🎬🎤🎧🎵🎹🎸🥁🎻📷🎥🪄🃏'],
  ['🏠', 'مکان و سفر', '🏠🏡🏢🏬🏭🏫🏥🏦🏪🏛️⛪🕌🏰🗼🗽🌆🏙️🌉🚗🚕🚌🚀✈️🚁🚢⛵🚲🛴🚦🗺️🧭⛺🏖️🏔️🌋'],
  ['💼', 'کار و اشیا', '💼📁📂🗂️📊📈📉📋📌📎✏️🖊️📝📚📖🔖🏷️💡🔦🔧🔨⚙️🛠️🧪🔬🔭💻🖥️⌨️🖱️📱☎️📡🔋🔌💾💿📦🛒💳💰💎🔑🔒🔓🔔📣✉️📅⏰⌛🧲🧰🌐🔗🗄️🧾'],
  ['❤️', 'نماد و رنگ', '❤️🧡💛💚💙💜🖤🤍🤎💔✅☑️✔️❌⭕❗❓⚠️🚫⛔🔴🟠🟡🟢🔵🟣🟤⚫⚪🟥🟧🟨🟩🟦🟪⬛⬜🔶🔷🔺🔻💠🔘♻️⚜️🆕🆗🆙🆒🆓🔝🔜💯🔤#️⃣1️⃣2️⃣3️⃣4️⃣5️⃣🅰️🅱️'],
  ['🏳️', 'پرچم', '🇮🇷🇺🇸🇬🇧🇩🇪🇫🇷🇹🇷🇦🇪🇨🇦🇯🇵🇨🇳🇮🇳🇷🇺🇮🇹🇪🇸🇳🇱🇸🇪🇦🇺🇧🇷🇰🇷🇦🇫🇮🇶🇸🇦🏳️🏴🏁🚩'],
].map(([tab, name, list]) => ({ tab, name, list: [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(list)].map((x) => x.segment) }));

function renderCats() {
  const used = (cid, vid) => items.filter((i) => (i.cats || {})[cid] === vid).length;
  $('#catList').innerHTML = cats.map((c, ci) => `<div class="catBox" data-ci="${ci}">
      <div class="catHead">
        <button type="button" class="icoBtn" data-f="icon" title="انتخاب آیکون">${esc(c.icon)}</button>
        <input data-f="name" value="${esc(c.name)}" placeholder="نام دسته‌بندی" maxlength="40">
        <button class="btn ghost" data-c="delCat" title="حذف دسته‌بندی">🗑</button>
      </div>
      <div class="catAll">✦ همه — خودکار، همیشه اول لیست</div>
      ${c.values.map((v, vi) => `<div class="valRow" data-vi="${vi}">
        <button type="button" class="icoBtn" data-vf="icon" title="انتخاب آیکون">${esc(v.icon)}</button>
        <input data-vf="name" value="${esc(v.name)}" placeholder="نام" maxlength="40">
        <span class="n" title="تعداد پروژه">${used(c.id, v.id)}</span>
        <button class="btn ghost" data-c="delVal" title="حذف">✕</button></div>`).join('')}
      <button class="btn ghost" data-c="addVal">＋ مقدار جدید</button>
    </div>`).join('') || '<p class="hint">هیچ دسته‌بندی‌ای نیست.</p>';
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
  const t = catTarget(e.target); if (!t) return;
  t.obj[t.key] = e.target.value;
  queueCatSave();
});
$('#catList').onclick = (e) => {
  const ib = e.target.closest('.icoBtn');
  if (ib) return openPicker(ib);
  const b = e.target.closest('[data-c]'); if (!b) return;
  const ci = Number(b.closest('.catBox').dataset.ci), c = cats[ci];
  if (b.dataset.c === 'addVal') {
    c.values.push({ icon: '🔹', name: 'مقدار جدید' });
    saveCats(true, `.catBox[data-ci="${ci}"] .valRow:last-of-type [data-vf=name]`);
  } else if (b.dataset.c === 'delVal') {
    const v = c.values[b.closest('.valRow').dataset.vi];
    const n = items.filter((i) => (i.cats || {})[c.id] === v.id).length;
    if (n && !confirm(`«${v.name}» به ${n} پروژه داده شده. حذف شود؟`)) return;
    c.values = c.values.filter((x) => x !== v); saveCats(true);
  } else if (b.dataset.c === 'delCat') {
    if (!confirm(`دسته‌بندی «${c.name}» و همه‌ی مقادیرش حذف شود؟ (پروژه‌ها حذف نمی‌شوند)`)) return;
    cats.splice(ci, 1); delete filter.cats[c.id]; saveCats(true);
  }
};
$('#addCat').onclick = () => {
  cats.push({ icon: '🏷️', name: 'دسته‌بندی جدید', values: [] });
  saveCats(true, '.catBox:last-of-type [data-f=name]');
};

// emoji picker: groups as tabs, plus any emoji or text you type yourself
const pick = $('#emojiPick');
let pickFor = null, pickGroup = 0;
function renderPicker() {
  pick.innerHTML = `<div class="epTabs">${EMOJI_GROUPS.map((g, i) => `<button type="button" data-g="${i}" class="${i === pickGroup ? 'on' : ''}" title="${g.name}">${g.tab}</button>`).join('')}</div>
    <div class="epName">${EMOJI_GROUPS[pickGroup].name}</div>
    <div class="epGrid">${EMOJI_GROUPS[pickGroup].list.map((x) => `<button type="button" data-e="${esc(x)}">${x}</button>`).join('')}</div>
    <form class="epCustom"><input placeholder="یا ایموجی یا حرف دلخواه (Win + .)" maxlength="16"><button class="btn" type="submit">✓</button></form>`;
}
function openPicker(btn) {
  pickFor = btn; renderPicker(); pick.hidden = false;
  const r = btn.getBoundingClientRect(), h = pick.offsetHeight, w = pick.offsetWidth;
  pick.style.top = `${Math.max(8, r.bottom + h + 8 > innerHeight ? r.top - h - 4 : r.bottom + 4)}px`;   // above when no room below
  pick.style.left = `${Math.min(innerWidth - w - 8, Math.max(8, r.right - w))}px`;
}
function applyIcon(icon) {
  icon = String(icon || '').trim(); if (!icon || !pickFor) return;
  const t = catTarget(pickFor); if (!t) return;
  t.obj[t.key] = icon; pickFor.textContent = icon; pick.hidden = true;
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
let settings = null;
const fmtDate = (t) => (t ? new Date(t).toLocaleString('fa-IR') : '');
function showTab(tab) {
  document.querySelectorAll('#setTabs [data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('#setDlg [data-pane]').forEach((p) => (p.hidden = p.dataset.pane !== tab));
}
function fillSettings(s) {
  settings = s;
  document.querySelectorAll('[data-set]').forEach((el) => (el.checked = !!s[el.dataset.set]));
  $('#sFetchMin').value = String(s.fetchMinutes);
  $('#sFetchMin').disabled = !s.watchProjects || !s.fetchRemote;
  $('[data-set=fetchRemote]').disabled = !s.watchProjects;
  $('#uCur').textContent = s.version; $('#aVer').textContent = s.version;
  $('#ver').textContent = 'v' + s.version; $('#ver').hidden = false;
  $('#rOn').checked = s.remote;
  $('#rInfo').innerHTML = s.remote
    ? `آدرس: ${s.ips.map((ip) => `<code>${ip}:${s.port}</code>`).join(' ')}<br>PIN: <code>${s.pin}</code>`
    : 'غیرفعال است.';
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
  if (u.downloading) st = `در حال دانلود نسخه‌ی ${esc(u.latest.version)} در پس‌زمینه… ${Math.round((u.progress || 0) * 100)}٪`;
  else if (u.checking) st = 'در حال بررسی…';
  else if (u.error) st = `<span class="bad">⚠ ${esc(u.error)}</span>`;
  else if (ready) st = `<span class="ok">✓ نسخه‌ی <code>${esc(u.readyVersion)}</code> دانلود و بررسی شد و آماده‌ی نصب است.</span>`;
  else if (avail) st = `<span class="warn">نسخه‌ی جدید <code>${esc(u.latest.version)}</code> موجود است</span> <small class="hint">(${fmtDate(u.latest.publishedAt)})</small>`;
  else if (u.checkedAt) st = `<span class="ok">✓ آخرین نسخه را دارید.</span> <small class="hint">آخرین بررسی: ${ago(u.checkedAt)}</small>`;
  else st = 'هنوز بررسی نشده.';
  $('#uStatus').innerHTML = st;
  $('#uProgress').hidden = !u.downloading;
  $('#uProgress i').style.width = `${Math.round((u.progress || 0) * 100)}%`;
  $('#uInstall').hidden = !avail || u.downloading;
  $('#uInstall').textContent = page ? '⬇ صفحه‌ی دانلود' : ready ? '🔄 نصب و راه‌اندازی مجدد' : '⬇ دانلود و نصب';
  $('#uHow').hidden = !avail || page;
  $('#uCheck').disabled = u.checking || u.downloading;
  $('#uNotes').hidden = !avail || !u.latest.notes;
  if (avail) $('#uNotes').textContent = u.latest.notes;
  renderBanners();
}
function renderBanners() {
  if (isRemote || !settings) return;
  const u = settings.appUpdate || {};
  let h = '';
  if (settings.justUpdated) h += `<div class="banner ok">✨ Ember به نسخه‌ی <code>${esc(settings.justUpdated)}</code> بروز شد — امتحانش کنید! <button class="btn ghost" data-banner="notes">تغییرات</button><button class="btn ghost" data-banner="dismiss">✕</button></div>`;
  if (u.available && u.latest && u.ready) h += `<div class="banner">⬆️ نسخه‌ی <code>${esc(u.readyVersion)}</code> آماده‌ی نصب است. چند ثانیه طول می‌کشد؛ یا خودکار هنگام بستن Ember نصب می‌شود. <button class="btn primary" data-banner="restart">راه‌اندازی مجدد و بروزرسانی</button></div>`;
  else if (u.available && u.latest && !u.downloading) h += `<div class="banner">⬆️ نسخه‌ی جدید Ember (<code>${esc(u.latest.version)}</code>) موجود است. <button class="btn primary" data-banner="update">مشاهده و نصب</button></div>`;
  $('#banners').innerHTML = h;
}
async function restartForUpdate() {
  const run = items.filter((i) => i.status !== 'stopped').length;
  if (run && !confirm(`${run} پروژه در حال اجراست و با راه‌اندازی مجدد متوقف می‌شود. ادامه؟`)) return;
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
$('#remoteBtn').onclick = () => openSettings('remote');
$('#setTabs').onclick = (e) => { const b = e.target.closest('[data-tab]'); if (!b) return; if (b.dataset.tab === 'cats') renderCats(); showTab(b.dataset.tab); };
$('#setDlg').onchange = (e) => {
  const k = e.target.dataset.set;
  if (k) saveSettings({ [k]: e.target.checked });
  else if (e.target.id === 'sFetchMin') saveSettings({ fetchMinutes: Number(e.target.value) });
  else if (e.target.id === 'rOn') saveSettings({ remote: e.target.checked });
};
$('#setClose').onclick = () => $('#setDlg').close();
$('#sData').onclick = () => api.openData();
$('#sCheckProjects').onclick = async (e) => {
  e.target.disabled = true; $('#sProjMsg').textContent = 'در حال بررسی…';
  items = await api.checkProjects(true); render();
  const n = items.filter((i) => i.updated || i.behind > 0).length;
  $('#sProjMsg').textContent = n ? `${n} پروژه بروز شده` : 'همه‌چیز همان است که بود.';
  e.target.disabled = false;
};
$('#uCheck').onclick = async () => { settings.appUpdate = await api.checkAppUpdate(); renderAppUpdate(); };
$('#uInstall').onclick = () => restartForUpdate();
$('#uPage').onclick = () => api.openUrl(`${settings.repo}/releases`);
$('#rPin').onclick = () => saveSettings({ regenPin: true });
$('#rApk').onclick = () => api.openUrl(`${settings.repo}/releases/latest/download/Ember-Remote.apk`);
document.querySelectorAll('[data-link]').forEach((b) => (b.onclick = () => api.openUrl(settings.repo + b.dataset.link)));
document.querySelectorAll('[data-link-abs]').forEach((b) => (b.onclick = (e) => { e.preventDefault(); api.openUrl(b.dataset.linkAbs); }));

reload();
if (isRemote) setInterval(reload, 15000);
if (isRemote) api.settings().then((s) => { $('#ver').textContent = 'v' + s.version; $('#ver').hidden = false; }).catch(() => {});
else api.settings().then(fillSettings);
