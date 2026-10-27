/* Shared by the main window (app.js) and the project windows (project.js). Needs i18n.js first. */
const $ = (s, root = document) => root.querySelector(s);
const api = window.ember;
const LANG = api.lang === 'en' ? 'en' : 'fa';
const t = I18N.make(LANG);
document.documentElement.lang = LANG;
document.documentElement.dir = LANG === 'en' ? 'ltr' : 'rtl';
document.body.classList.toggle('win', api.platform === 'win32');   // page top bar = window title bar

// static texts: data-i18n (text), data-i18n-ph (placeholder), data-i18n-title (tooltip)
function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
}
applyI18n();

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
  .map((v) => `<span class="tag">${esc(v.icon)} ${esc(v.name)}</span>`).join('');
const pkgHtml = (i) => !i.exists ? `<span class="bad">${t('pkg.missing')}</span>`
  : i.needsInstall ? `<span class="warn">${t('pkg.install')}</span>` : `<span class="ok">${t('pkg.ok')}</span>`;
const portHtml = (i) => (i.port ? `<span class="port" title="${t('card.port')}">:${i.port}</span>` : '');

// "updated — test it" and "N new commits" boxes
function updHtml(i) {
  const when = i.updateTime ? ` · ${ago(i.updateTime)}` : '';
  return (i.updated ? `<div class="upd">
      <div><b>${t('card.updatedTest')}</b><small>${i.updateSubject ? esc(i.updateSubject) : i.updateKind === 'files' ? t('card.filesChanged') : ''}${when}</small></div>
      <button class="btn ghost" data-act="tested" title="${t('card.testedTip')}">${t('card.tested')}</button></div>` : '') +
    (i.behind > 0 ? `<div class="upd git">
      <div><b>${t('card.behind', { n: i.behind })} <code>${esc(i.upstream)}</code></b><small>${esc(i.remoteSubject)}</small></div>
      <button class="btn" data-act="pull">${t('card.pull')}</button></div>` : '') +
    (i.fetchError ? `<div class="hint bad" title="${esc(i.fetchError)}">${t('card.fetchFailed')}</div>` : '');
}

// actions both windows share; returns the new project list when it changed
async function projectAction(act, i, btn, scriptValue) {
  switch (act) {
    case 'start': return api.start(i.id, scriptValue || i.script);
    case 'stop': return api.stop(i.id);
    case 'open': return api.openUrl(i.url);
    case 'folder': return api.openFolder(i.id);
    case 'tested': return api.markTested(i.id);
    case 'pull': {
      if (btn) { btn.disabled = true; btn.textContent = t('card.pulling'); }
      const r = await api.pull(i.id);
      if (!r.ok) alert(t('card.pullFailed') + '\n' + r.err);
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
