/* Shared by the main window (app.js) and the project windows (project.js). Needs i18n.js first. */
const $ = (s, root = document) => root.querySelector(s);
const api = window.ember;
const LANG = api.lang === 'en' ? 'en' : 'fa';
const t = I18N.make(LANG);
document.documentElement.lang = LANG;
document.documentElement.dir = LANG === 'en' ? 'ltr' : 'rtl';
document.body.classList.toggle('win', api.platform === 'win32');   // page top bar = window title bar


/* ---- icons: one consistent set (24px grid, 2px stroke, rounded caps — Lucide style) ---- */
const ICONS = {
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3" fill="currentColor"/>',
  stop: '<rect width="14" height="14" x="5" y="5" rx="2" fill="currentColor"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  folderOpen: '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
  pencil: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  circleCheck: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  circleX: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  loader: '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  grid: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  sparkles: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>',
  tag: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  arrowDown: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  plug: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
  sliders: '<line x1="4" x2="4" y1="21" y2="14"/><line x1="4" x2="4" y1="10" y2="3"/><line x1="12" x2="12" y1="21" y2="12"/><line x1="12" x2="12" y1="8" y2="3"/><line x1="20" x2="20" y1="21" y2="16"/><line x1="20" x2="20" y1="12" y2="3"/><line x1="2" x2="6" y1="14" y2="14"/><line x1="10" x2="14" y1="8" y2="8"/><line x1="18" x2="22" y1="16" y2="16"/>',
  upCircle: '<circle cx="12" cy="12" r="10"/><path d="m16 12-4-4-4 4"/><path d="M12 16V8"/>',
  window: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  layers: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  searchX: '<path d="m13.5 8.5-5 5"/><path d="m8.5 8.5 5 5"/><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
};
const ico = (name, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`;
function applyIcons(root = document) {
  root.querySelectorAll('[data-ico]:not([data-ico-done])').forEach((el) => {
    el.insertAdjacentHTML(el.hasAttribute('data-ico-end') ? 'beforeend' : 'afterbegin', ico(el.dataset.ico));
    el.setAttribute('data-ico-done', '');
  });
}

// static texts: data-i18n (text), data-i18n-ph (placeholder), data-i18n-title (tooltip)
function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); el.setAttribute('aria-label', el.title); });
}
applyI18n();
applyIcons();

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rtf = new Intl.RelativeTimeFormat(LANG, { numeric: 'auto' });
function ago(ms) {
  if (!ms) return '';
  const sec = (ms - Date.now()) / 1000;
  for (const [u, n] of [['day', 86400], ['hour', 3600], ['minute', 60]]) if (Math.abs(sec) >= n) return rtf.format(Math.round(sec / n), u);
  return rtf.format(0, 'minute');
}
const statusText = (s) => t('status.' + s);
const valueOf = (i, c) => c.values.find((v) => v.id === (i.cats || {})[c.id]);
const initial = (i) => ([...(i.name || '?').replace(/[^\p{L}\p{N}]/gu, '')][0] || '?').toUpperCase();

// project logo: the picture, else the icon of its first category value, else its first letter
function logoHtml(i, cats, cls = '') {
  if (i.logoUrl) return `<div class="logo ${cls}"><img src="${esc(i.logoUrl)}" alt="" onerror="this.parentNode.textContent='${esc(initial(i))}'"></div>`;
  const v = cats.map((c) => valueOf(i, c)).find(Boolean);
  return `<div class="logo ${cls}">${esc(v ? v.icon : initial(i))}</div>`;
}
const tagsHtml = (i, cats) => cats.map((c) => valueOf(i, c)).filter(Boolean)
  .map((v) => `<span class="tag"><span class="tagIco" aria-hidden="true">${esc(v.icon)}</span>${esc(v.name)}</span>`).join('');

// package readiness: icon + text, never colour alone
function pkgHtml(i) {
  if (!i.exists) return `<span class="chip bad">${ico('circleX')}${t('pkg.missing')}</span>`;
  if (i.status === 'installing') return `<span class="chip warn">${ico('loader', 'spin')}${t('card.pkgInstalling')}</span>`;
  if (i.needsInstall) return `<span class="chip warn">${ico('alert')}${t('pkg.install')}</span>`;
  return `<span class="chip ok">${ico('circleCheck')}${t('pkg.ok')}</span>`;
}
const portHtml = (i) => (i.port ? `<span class="port" title="${t('card.port')}">:${i.port}</span>` : '');

// "updated — test it" and "N new commits" boxes
function updHtml(i) {
  const when = i.updateTime ? ` · ${ago(i.updateTime)}` : '';
  return (i.updated ? `<div class="upd">
      <span class="updIco">${ico('sparkles')}</span>
      <div><b>${t('card.updatedTest')}</b><small>${i.updateSubject ? esc(i.updateSubject) : i.updateKind === 'files' ? t('card.filesChanged') : ''}${when}</small></div>
      <button class="btn sm ghost" data-act="tested" title="${t('card.testedTip')}">${ico('check')}${t('card.tested')}</button></div>` : '') +
    (i.behind > 0 ? `<div class="upd git">
      <span class="updIco">${ico('arrowDown')}</span>
      <div><b>${t('card.behind', { n: i.behind })} <code>${esc(i.upstream)}</code></b><small>${esc(i.remoteSubject)}</small></div>
      <button class="btn sm" data-act="pull">${t('card.pull')}</button></div>` : '') +
    (i.fetchError ? `<div class="hint bad inl" title="${esc(i.fetchError)}">${ico("alert")}${t("card.fetchFailed")}</div>` : '');
}

/* ---- loading state of Run / Stop: "starting" until the first state event, "stopping" until it has stopped ---- */
const pending = new Map();   // id -> 'starting' | 'stopping'
const ui = { rerender() {} };   // each window plugs its own render in
function setPending(id, kind) {
  pending.set(id, kind); ui.rerender();
  setTimeout(() => { if (pending.get(id) === kind) { pending.delete(id); ui.rerender(); } }, 20000);   // never stuck
}
function settlePending(e) {
  const k = pending.get(e.id); if (!k) return;
  if (k === 'starting' || e.status === 'stopped') { pending.delete(e.id); }
}

// the Run / Stop button, in sync with the real process state
function runBtn(i) {
  const k = pending.get(i.id), busy = i.status !== 'stopped';
  if (k) return `<button class="btn ${k === 'starting' ? 'primary' : 'danger'} grow" disabled aria-busy="true">${ico('loader', 'spin')}${t(k === 'starting' ? 'card.starting' : 'card.stopping')}</button>`;
  return busy ? `<button class="btn danger grow" data-act="stop">${ico('stop')}${t('card.stop')}</button>`
    : `<button class="btn primary grow" data-act="start" ${i.exists ? '' : 'disabled'}>${ico('play')}${t('card.run')}</button>`;
}

/* ---- toasts ---- */
function toast(msg, kind = 'info') {
  let box = $('#toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `${ico(kind === 'error' ? 'circleX' : kind === 'ok' ? 'circleCheck' : 'info')}<span></span><button class="icon sm" aria-label="${t('toast.close')}">${ico('x')}</button>`;
  el.querySelector('span').textContent = msg;
  const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 160); };
  el.querySelector('button').onclick = close;
  box.appendChild(el);
  setTimeout(close, kind === 'error' ? 7000 : 3200);
}

/* ---- confirmation dialog (replaces the native confirm) ---- */
function confirmDlg(message, { ok = t('dlg.confirm'), danger = false } = {}) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'confirm';
    d.innerHTML = `<p></p><div class="dlgActions"><span class="grow"></span><button class="btn ghost" value="no">${t('dlg.cancel')}</button><button class="btn ${danger ? 'danger solid' : 'primary'}" value="yes"></button></div>`;
    d.querySelector('p').textContent = message;
    d.querySelector('[value=yes]').textContent = ok;
    let result = false;
    d.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { result = b.value === 'yes'; d.close(); } });
    d.addEventListener('close', () => { d.remove(); resolve(result); });
    document.body.appendChild(d); d.showModal();
    d.querySelector('[value=no]').focus();
  });
}

// actions both windows share; returns the new project list when it changed
async function projectAction(act, i, btn, scriptValue) {
  switch (act) {
    case 'start': {
      setPending(i.id, 'starting');
      const r = await api.start(i.id, scriptValue || i.script);
      setTimeout(() => { if (pending.get(i.id) === 'starting') { pending.delete(i.id); ui.rerender(); } }, 1500);   // the state event normally clears it first
      return r;
    }
    case 'stop': setPending(i.id, 'stopping'); return api.stop(i.id);
    case 'open': return api.openUrl(i.url);
    case 'folder': return api.openFolder(i.id);
    case 'copy':
      try { await navigator.clipboard.writeText(i.path); toast(t('card.pathCopied'), 'ok'); } catch {}
      return;
    case 'tested': return api.markTested(i.id);
    case 'pull': {
      if (btn) { btn.disabled = true; btn.innerHTML = `${ico('loader', 'spin')}${t('card.pulling')}`; }
      const r = await api.pull(i.id);
      if (!r.ok) toast(`${t('card.pullFailed')} ${r.err || ''}`.trim(), 'error'); else toast(t('card.pulledOk'), 'ok');
      return api.list();
    }
  }
}

// per-viewer conveniences (collapsed groups); never required for the page to work
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

api.onEvent((e) => { if (e.type === 'lang') location.reload(); });
