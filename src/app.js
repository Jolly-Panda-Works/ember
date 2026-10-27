const $ = (s) => document.querySelector(s);
const TYPES = { web: 'وب‌سایت', game: 'بازی', mobile: 'موبایل', desktop: 'دسکتاپ', api: 'بک‌اند / API', other: 'سایر' };
const ICON = { web: '🌐', game: '🎮', mobile: '📱', desktop: '🖥️', api: '⚙️', other: '📦' };
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
  start: (id, script) => rq('POST', '/api/start', { id, script }),
  stop: (id) => rq('POST', '/api/stop', { id }),
  logs: (id) => rq('GET', '/api/logs?id=' + id),
  onEvent: (cb) => { const es = new EventSource('/api/events?pin=' + encodeURIComponent(PIN)); es.onmessage = (e) => cb(JSON.parse(e.data)); },
};
document.body.classList.toggle('remote', isRemote);

/* ---- state ---- */
let items = [], filter = { type: 'all', client: null, q: '' }, logId = null, editing = null;
const fa = new Intl.RelativeTimeFormat('fa', { numeric: 'auto' });
function ago(ms) {
  if (!ms) return '';
  const sec = (ms - Date.now()) / 1000;
  for (const [u, n] of [['day', 86400], ['hour', 3600], ['minute', 60]]) if (Math.abs(sec) >= n) return fa.format(Math.round(sec / n), u);
  return fa.format(0, 'minute');
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clientsList = () => [...new Set(items.map((i) => i.client).filter(Boolean))].sort();

function visible() {
  const q = filter.q.toLowerCase();
  return items.filter((i) =>
    (filter.type === 'all' || (filter.type === 'updated' ? i.updated || i.behind > 0 : i.type === filter.type)) &&
    (filter.client === null || i.client === filter.client) &&
    (!q || (i.name + ' ' + i.client + ' ' + i.path).toLowerCase().includes(q)));
}

function renderSide() {
  const nav = (attr, val, label, n, on) => `<button class="nav ${on ? 'active' : ''}" ${attr}="${esc(val)}">${label}<span class="n">${n}</span></button>`;
  const upd = items.filter((i) => i.updated || i.behind > 0).length;
  $('#types').innerHTML =
    nav('data-type', 'all', '📁 همه', items.length, filter.type === 'all') +
    (upd || filter.type === 'updated' ? nav('data-type', 'updated', '🆕 بروز شده‌ها', upd, filter.type === 'updated') : '') +
    Object.keys(TYPES).filter((t) => items.some((i) => i.type === t))
      .map((t) => nav('data-type', t, `${ICON[t]} ${TYPES[t]}`, items.filter((i) => i.type === t).length, filter.type === t)).join('');
  const cl = clientsList();
  const none = items.filter((i) => !i.client).length;
  $('#clients').innerHTML =
    nav('data-client', '*', '🗂️ همه کارفرماها', items.length, filter.client === null) +
    cl.map((c) => nav('data-client', c, '🏢 ' + esc(c), items.filter((i) => i.client === c).length, filter.client === c)).join('') +
    (none && cl.length ? nav('data-client', '', '— بدون کارفرما', none, filter.client === '') : '');
}

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
  return `<article class="card ${i.status} ${i.updated || i.behind > 0 ? 'updated' : ''}" data-id="${i.id}">
    <div class="top"><span class="dot"></span><h3>${esc(i.name)}</h3>${i.updated ? '<span class="tag new">🆕 بروز شده</span>' : ''}<span class="tag">${ICON[i.type]} ${TYPES[i.type]}</span></div>
    <div class="meta"><span>${i.client ? '🏢 ' + esc(i.client) : 'بدون کارفرما'}</span><span>${STATUS[i.status]}</span></div>
    <div class="path" title="${esc(i.path)}">${esc(i.path)}</div>
    <div class="row">
      <select ${busy ? 'disabled' : ''}>${i.scripts.map((s) => `<option ${s === i.script ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
      <span class="pm">${i.pm}</span>${pkgState}
    </div>${upd}
    <div class="actions">
      ${busy ? '<button class="btn danger" data-act="stop">■ توقف</button>'
             : `<button class="btn primary" data-act="start" ${i.exists ? '' : 'disabled'}>▶ اجرا</button>`}
      ${i.url ? '<button class="btn" data-act="open">🔗 باز کردن</button>' : ''}
      <button class="btn ghost" data-act="logs">📜 لاگ</button>
      <button class="btn ghost local" data-act="folder" title="باز کردن پوشه">📂</button>
      <button class="btn ghost local" data-act="edit" title="ویرایش">✎</button>
    </div></article>`;
}

function render() {
  renderSide();
  const v = visible();
  $('#grid').innerHTML = v.length ? v.map(card).join('')
    : `<div class="empty">${items.length ? 'پروژه‌ای با این فیلتر پیدا نشد.' : 'هنوز پروژه‌ای اضافه نشده. یک پوشه‌ی پروژه (یا پوشه‌ای که چند پروژه دارد) را اضافه کنید.'}</div>`;
  const run = items.filter((i) => i.status === 'running').length;
  $('#stats').textContent = `${items.length} پروژه · ${run} در حال اجرا`;
}

async function reload() { items = await api.list(); render(); }

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
    filter = { type: 'all', client: null, q: '' }; $('#q').value = ''; render();
    const el = document.querySelector(`.card[data-id="${e.id}"]`);
    if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1600); }
  } else if (e.type === 'openSettings') {
    openSettings(e.tab);
  } else if (e.type === 'log' && e.id === logId) {
    const el = $('#log'); const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    el.textContent += e.text; if (atEnd) el.scrollTop = 1e9;
  }
});

/* ---- clicks ---- */
$('#types').onclick = (e) => { const b = e.target.closest('[data-type]'); if (b) { filter.type = b.dataset.type; render(); } };
$('#clients').onclick = (e) => {
  const b = e.target.closest('[data-client]'); if (!b) return;
  filter.client = b.dataset.client === '*' ? null : b.dataset.client; render();
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
$('#grid').onchange = (e) => {
  if (e.target.tagName !== 'SELECT' || isRemote) return;
  const i = items.find((x) => x.id === e.target.closest('.card').dataset.id);
  i.script = e.target.value; api.update(i.id, { script: i.script });
};
$('#add').onclick = async () => { items = await api.add(); render(); };

/* ---- edit dialog ---- */
function openEdit(i) {
  editing = i;
  $('#eName').value = i.name; $('#eType').value = i.type; $('#eClient').value = i.client;
  $('#clientList').innerHTML = clientsList().map((c) => `<option value="${esc(c)}">`).join('');
  $('#editDlg').showModal();
}
$('#eCancel').onclick = () => $('#editDlg').close();
$('#eSave').onclick = async () => {
  items = await api.update(editing.id, { name: $('#eName').value.trim() || editing.name, type: $('#eType').value, client: $('#eClient').value.trim() });
  $('#editDlg').close(); render();
};
$('#eRemove').onclick = async () => {
  if (!confirm('این پروژه از لیست حذف شود؟ (فایل‌ها پاک نمی‌شوند)')) return;
  items = await api.remove(editing.id); $('#editDlg').close(); render();
};

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
  $('#settingsDot').hidden = !avail; $('#tabDot').hidden = !avail;
  let st;
  if (u.downloading) st = `در حال دانلود نسخه‌ی ${u.latest.version}… ${Math.round((u.progress || 0) * 100)}٪`;
  else if (u.checking) st = 'در حال بررسی…';
  else if (u.error) st = `<span class="bad">⚠ ${esc(u.error)}</span>`;
  else if (avail) st = `<span class="warn">نسخه‌ی جدید <code>${esc(u.latest.version)}</code> آماده است</span> <small class="hint">(${fmtDate(u.latest.publishedAt)})</small>`;
  else if (u.checkedAt) st = `<span class="ok">✓ آخرین نسخه را دارید.</span> <small class="hint">آخرین بررسی: ${ago(u.checkedAt)}</small>`;
  else st = 'هنوز بررسی نشده.';
  $('#uStatus').innerHTML = st;
  $('#uProgress').hidden = !u.downloading;
  $('#uProgress i').style.width = `${Math.round((u.progress || 0) * 100)}%`;
  $('#uInstall').hidden = !avail || u.downloading;
  $('#uInstall').textContent = settings.portable ? '⬇ دانلود نسخه‌ی پرتابل' : '⬇ دانلود و نصب';
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
  if (u.available && u.latest && !u.downloading) h += `<div class="banner">⬆️ نسخه‌ی جدید Ember (<code>${esc(u.latest.version)}</code>) آماده است. <button class="btn primary" data-banner="update">مشاهده و نصب</button></div>`;
  $('#banners').innerHTML = h;
}
$('#banners').onclick = (e) => {
  const b = e.target.closest('[data-banner]'); if (!b) return;
  if (b.dataset.banner === 'update') openSettings('updates');
  else if (b.dataset.banner === 'notes') api.openUrl(`${settings.repo}/releases/tag/v${settings.justUpdated}`);
  else if (b.dataset.banner === 'dismiss') { settings.justUpdated = null; api.dismissJustUpdated(); renderBanners(); }
};
async function openSettings(tab = 'general') {
  fillSettings(await api.settings());
  showTab(tab);
  if (!$('#setDlg').open) $('#setDlg').showModal();
}
const saveSettings = async (patch) => fillSettings(await api.setSettings(patch));
$('#settingsBtn').onclick = () => openSettings(settings && settings.appUpdate && settings.appUpdate.available ? 'updates' : 'general');
$('#remoteBtn').onclick = () => openSettings('remote');
$('#setTabs').onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab); };
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
$('#uInstall').onclick = async () => { settings.appUpdate = await api.installAppUpdate(); renderAppUpdate(); };
$('#uPage').onclick = () => api.openUrl(`${settings.repo}/releases`);
$('#rPin').onclick = () => saveSettings({ regenPin: true });
$('#rApk').onclick = () => api.openUrl(`${settings.repo}/releases/latest/download/Ember-Remote.apk`);
document.querySelectorAll('[data-link]').forEach((b) => (b.onclick = () => api.openUrl(settings.repo + b.dataset.link)));

reload();
if (isRemote) setInterval(reload, 15000);
else api.settings().then(fillSettings);
