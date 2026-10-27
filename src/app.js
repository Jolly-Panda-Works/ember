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
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clientsList = () => [...new Set(items.map((i) => i.client).filter(Boolean))].sort();

function visible() {
  const q = filter.q.toLowerCase();
  return items.filter((i) =>
    (filter.type === 'all' || i.type === filter.type) &&
    (filter.client === null || i.client === filter.client) &&
    (!q || (i.name + ' ' + i.client + ' ' + i.path).toLowerCase().includes(q)));
}

function renderSide() {
  const nav = (attr, val, label, n, on) => `<button class="nav ${on ? 'active' : ''}" ${attr}="${esc(val)}">${label}<span class="n">${n}</span></button>`;
  $('#types').innerHTML =
    nav('data-type', 'all', '📁 همه', items.length, filter.type === 'all') +
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
  return `<article class="card ${i.status}" data-id="${i.id}">
    <div class="top"><span class="dot"></span><h3>${esc(i.name)}</h3><span class="tag">${ICON[i.type]} ${TYPES[i.type]}</span></div>
    <div class="meta"><span>${i.client ? '🏢 ' + esc(i.client) : 'بدون کارفرما'}</span><span>${STATUS[i.status]}</span></div>
    <div class="path" title="${esc(i.path)}">${esc(i.path)}</div>
    <div class="row">
      <select ${busy ? 'disabled' : ''}>${i.scripts.map((s) => `<option ${s === i.script ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
      <span class="pm">${i.pm}</span>${pkgState}
    </div>
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
    if (i) { Object.assign(i, { status: e.status, url: e.url, needsInstall: e.needsInstall }); render(); }
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

/* ---- remote dialog ---- */
function fillRemote(s) {
  $('#rOn').checked = s.remote;
  $('#rInfo').innerHTML = s.remote
    ? `آدرس: ${s.ips.map((ip) => `<code>${ip}:${s.port}</code>`).join(' ')}<br>PIN: <code>${s.pin}</code>`
    : 'غیرفعال است.';
}
$('#remoteBtn').onclick = async () => { fillRemote(await api.settings()); $('#remoteDlg').showModal(); };
$('#rOn').onchange = async (e) => fillRemote(await api.setSettings({ remote: e.target.checked }));
$('#rPin').onclick = async () => fillRemote(await api.setSettings({ regenPin: true }));
$('#rClose').onclick = () => $('#remoteDlg').close();

reload();
if (isRemote) setInterval(reload, 15000);
