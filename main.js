const { app, BrowserWindow, ipcMain, dialog, shell, Menu, Notification, Tray, net } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const updates = require('./updates');
const watch = require('./projectwatch');

const SRC = path.join(__dirname, 'src');
const RUNNABLE = ['dev', 'start', 'serve', 'develop', 'preview', 'watch'];
const ANSI = /\x1B\[[0-9;?]*[A-Za-z]/g;
const URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]|(?:\d{1,3}\.){3}\d{1,3}):(\d+)/i;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
};
const { pathToFileURL } = require('url');

let win, tray = null, dbFile, db, remote = null, quitting = false;
const procs = new Map();   // id -> { child, status, url, stopping }
const revs = new Map();    // id -> { kind, rev, time, subject, behind, upstream, remoteRev, remoteSubject, fetchError }
const logs = new Map();    // id -> string[]
const sse = new Set();

/* ---------- storage ---------- */
function load() {
  dbFile = path.join(app.getPath('userData'), 'ember.json');
  try { db = JSON.parse(fs.readFileSync(dbFile, 'utf8')); } catch { db = {}; }
  db.projects ??= [];
  db.settings ??= {};
  db.settings.port ??= 7777;
  db.settings.remote ??= false;
  db.settings.pin ??= String(crypto.randomInt(100000, 999999));
  db.settings.checkUpdates ??= true;   // look for a new Ember release on GitHub
  db.settings.watchProjects ??= true;  // "updated — test it" badge on projects
  db.settings.fetchRemote ??= true;    // git fetch to see commits that are not pulled yet
  db.settings.fetchMinutes ??= 15;
  db.settings.notify ??= true;         // Windows notifications
  db.settings.tray ??= false;          // closing the window keeps Ember in the tray
  db.settings.autostart ??= false;
  migrateCategories();
}

/* ---------- categories (user-defined groups, each with icon + name values) ---------- */
const DEFAULT_TYPES = [
  ['web', '🌐', 'وب‌سایت'], ['game', '🎮', 'بازی'], ['mobile', '📱', 'موبایل'],
  ['desktop', '🖥️', 'دسکتاپ'], ['api', '⚙️', 'بک‌اند / API'], ['other', '📦', 'سایر'],
];
const newId = () => crypto.randomUUID().slice(0, 8);
function migrateCategories() {
  if (!db.categories) {
    db.categories = [{ id: 'type', name: 'نوع پروژه', icon: '🗂️', values: DEFAULT_TYPES.map(([id, icon, name]) => ({ id, icon, name })) }];
    // projects from older versions had a fixed "client" field: keep it as a category of its own
    const clients = [...new Set(db.projects.map((p) => p.client).filter(Boolean))];
    if (clients.length) db.categories.push({ id: 'client', name: 'کارفرما', icon: '🏢', values: clients.map((c) => ({ id: newId(), icon: '🏢', name: c })) });
    for (const p of db.projects) {
      p.cats ??= {};
      if (p.type) p.cats.type = p.type;
      if (p.client) p.cats.client = db.categories[1].values.find((v) => v.name === p.client).id;
      delete p.type; delete p.client;
    }
    save();
  }
  for (const p of db.projects) p.cats ??= {};
}
const str = (v, max) => String(v ?? '').trim().slice(0, max);
function setCategories(list) {
  if (!Array.isArray(list)) return;
  db.categories = list.map((c) => ({
    id: str(c.id, 40) || newId(), name: str(c.name, 40) || 'دسته‌بندی', icon: str(c.icon, 8) || '🗂️',
    values: (Array.isArray(c.values) ? c.values : []).map((v) => ({ id: str(v.id, 40) || newId(), icon: str(v.icon, 8) || '•', name: str(v.name, 40) || 'بدون نام' })),
  }));
  // drop assignments that point to deleted categories or values
  for (const p of db.projects) {
    const cats = {};
    for (const c of db.categories) if (c.values.some((v) => v.id === p.cats[c.id])) cats[c.id] = p.cats[c.id];
    p.cats = cats;
  }
  save();
}
// on add: put the project into the guessed "type" value, if that category and value still exist
function defaultCats(pkg) {
  const t = db.categories.find((c) => c.id === 'type');
  const g = guessType(pkg);
  return t && t.values.some((v) => v.id === g) ? { type: g } : {};
}
const save = () => fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));

/* ---------- project logos ---------- */
// p.logo: undefined = find the project's own favicon/logo, '' = no logo, 'file.ext' = a picture the user chose
const LOGO_EXT = ['.png', '.svg', '.jpg', '.jpeg', '.webp', '.gif', '.ico'];
const AUTO_LOGOS = [
  'public/logo.svg', 'public/logo.png', 'public/icon.svg', 'public/icon.png', 'public/favicon.svg', 'public/favicon.png',
  'public/apple-touch-icon.png', 'static/favicon.svg', 'static/favicon.png', 'src/assets/logo.svg', 'src/assets/logo.png',
  'src/app/icon.png', 'src/app/icon.svg', 'app/icon.png', 'assets/logo.png', 'assets/icon.png', 'build/icon.png',
  'resources/icon.png', 'logo.svg', 'logo.png', 'icon.png', 'public/favicon.ico', 'src/app/favicon.ico', 'app/favicon.ico',
  'src/favicon.ico', 'favicon.ico',
];
const logosDir = () => path.join(app.getPath('userData'), 'logos');
function logoFile(p) {
  if (p.logo === '') return null;
  if (p.logo) { const f = path.join(logosDir(), path.basename(p.logo)); return fs.existsSync(f) ? f : null; }
  for (const rel of AUTO_LOGOS) {
    const f = path.join(p.path, rel);
    try { if (fs.statSync(f).size < 2e6) return f; } catch {}
  }
  return null;
}
function logoInfo(p) {
  const f = logoFile(p);
  if (!f) return { logoUrl: null, logoMode: p.logo === '' ? 'none' : p.logo ? 'custom' : 'auto' };
  let v = 0; try { v = Math.floor(fs.statSync(f).mtimeMs); } catch {}
  return { logoUrl: pathToFileURL(f).href + '?v=' + v, logoV: v, logoMode: p.logo ? 'custom' : 'auto' };
}
function dropCustomLogo(p) {
  if (p.logo) { try { fs.unlinkSync(path.join(logosDir(), path.basename(p.logo))); } catch {} }
}
async function pickLogo(id) {
  const p = db.projects.find((x) => x.id === id);
  if (!p) return snapshot();
  const r = await dialog.showOpenDialog(win, {
    title: 'Project logo', properties: ['openFile'], defaultPath: p.path,
    filters: [{ name: 'Images', extensions: LOGO_EXT.map((e) => e.slice(1)) }],
  });
  if (r.canceled || !r.filePaths[0]) return snapshot();
  const src = r.filePaths[0], ext = path.extname(src).toLowerCase();
  if (!LOGO_EXT.includes(ext) || fs.statSync(src).size > 5e6) { dialog.showErrorBox('Ember', 'تصویر باید png، svg، jpg، webp، gif یا ico و کمتر از ۵ مگابایت باشد.'); return snapshot(); }
  fs.mkdirSync(logosDir(), { recursive: true });
  dropCustomLogo(p);
  p.logo = `${p.id}-${Date.now()}${ext}`;           // new name each time, so the picture refreshes
  fs.copyFileSync(src, path.join(logosDir(), p.logo));
  save();
  return snapshot();
}

/* ---------- project inspection ---------- */
function readPkg(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); } catch { return null; }
}
function detectPM(dir) {
  const has = (f) => fs.existsSync(path.join(dir, f));
  if (has('pnpm-lock.yaml')) return 'pnpm';
  if (has('yarn.lock')) return 'yarn';
  if (has('bun.lockb') || has('bun.lock')) return 'bun';
  return 'npm';
}
function runnable(pkg) { return RUNNABLE.filter((s) => pkg && pkg.scripts && pkg.scripts[s]); }

function needsInstall(dir) {
  const pkg = readPkg(dir);
  if (!pkg) return false;
  const nm = path.join(dir, 'node_modules');
  if (!fs.existsSync(nm)) return true;
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const name of Object.keys(deps)) {
    if (!fs.existsSync(path.join(nm, name))) return true;      // a dependency is missing
  }
  const marks = ['.package-lock.json', '.yarn-integrity', '.modules.yaml']
    .map((f) => path.join(nm, f)).filter((f) => fs.existsSync(f));
  const ref = fs.statSync(marks[0] || nm).mtimeMs;
  return ['package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb']
    .some((f) => { const fp = path.join(dir, f); return fs.existsSync(fp) && fs.statSync(fp).mtimeMs > ref + 1000; });
}

function guessType(pkg) {
  const d = { ...pkg.dependencies, ...pkg.devDependencies };
  const has = (...n) => n.some((x) => d[x]);
  if (has('phaser', 'three', 'pixi.js', '@pixi/core', 'babylonjs', '@babylonjs/core', 'kaboom', 'excalibur', 'melonjs', 'playcanvas')) return 'game';
  if (has('expo', 'react-native')) return 'mobile';
  if (has('electron', '@tauri-apps/api')) return 'desktop';
  if (has('next', 'nuxt', 'vite', 'react', 'vue', 'svelte', '@sveltejs/kit', 'astro', '@angular/core', 'gatsby', 'solid-js', '@remix-run/react')) return 'web';
  if (has('express', 'fastify', 'koa', '@nestjs/core', 'hono')) return 'api';
  return 'other';
}

function scan(root) {
  if (readPkg(root)) return [root];
  const out = [];
  try {
    for (const d of fs.readdirSync(root, { withFileTypes: true })) {
      if (!d.isDirectory() || d.name.startsWith('.') || d.name === 'node_modules') continue;
      const dir = path.join(root, d.name);
      if (readPkg(dir)) out.push(dir);
    }
  } catch {}
  return out;
}

function snapshot() {
  return db.projects.map((p) => {
    const pkg = readPkg(p.path);
    const st = procs.get(p.id);
    const scripts = runnable(pkg);
    if (p.script && !scripts.includes(p.script) && pkg && pkg.scripts && pkg.scripts[p.script]) scripts.push(p.script);
    return {
      ...p, exists: !!pkg, scripts, pm: detectPM(p.path),
      status: st ? st.status : 'stopped', url: st ? st.url : null,
      needsInstall: st ? false : needsInstall(p.path),
      ...projectUpdate(p),
      ...logoInfo(p),
    };
  });
}

/* ---------- events ---------- */
function broadcast(evt) {
  if (win && !win.isDestroyed()) win.webContents.send('evt', evt);
  const data = 'data: ' + JSON.stringify(evt) + '\n\n';
  sse.forEach((r) => r.write(data));
}
function addLog(id, text) {
  const a = logs.get(id) || [];
  a.push(text);
  if (a.length > 3000) a.splice(0, 500);
  logs.set(id, a);
  broadcast({ type: 'log', id, text });
}
function pushState(id) {
  const st = procs.get(id);
  const p = db.projects.find((x) => x.id === id);
  broadcast({
    type: 'state', id,
    status: st ? st.status : 'stopped',
    url: st ? st.url : null,
    needsInstall: st || !p ? false : needsInstall(p.path),
    ...(p ? projectUpdate(p) : {}),
  });
}

/* ---------- run / stop ---------- */
function exec(p, st, cmd, done) {
  addLog(p.id, `$ ${cmd}\n`);
  let finished = false;
  const end = (code) => { if (finished) return; finished = true; st.child = null; done(code); };
  let child;
  try {
    child = spawn(cmd, {
      cwd: p.path, shell: true, windowsHide: true, detached: process.platform !== 'win32',
      env: { ...process.env, BROWSER: 'none', FORCE_COLOR: '0' },
    });
  } catch (e) { addLog(p.id, String(e) + '\n'); return end(1); }
  st.child = child;
  const onData = (d) => {
    const t = d.toString().replace(ANSI, '');
    addLog(p.id, t);
    if (!st.url) {
      const m = t.match(URL_RE);
      if (m) { st.url = `http://localhost:${m[1]}`; pushState(p.id); }
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('error', (e) => { addLog(p.id, String(e) + '\n'); end(1); });
  child.on('close', (code) => end(code));
}

function start(id, script) {
  const p = db.projects.find((x) => x.id === id);
  if (!p || procs.has(id)) return;
  if (script && script !== p.script) { p.script = script; save(); }
  markTested(p);
  const pm = detectPM(p.path);
  const st = { child: null, status: 'installing', url: null, stopping: false };
  procs.set(id, st);
  logs.set(id, []);
  const finish = () => { procs.delete(id); pushState(id); };
  const runIt = () => {
    st.status = 'running'; pushState(id);
    exec(p, st, `${pm} run ${p.script}`, () => finish());
  };
  if (needsInstall(p.path)) {
    pushState(id);
    exec(p, st, `${pm} install`, (code) => {
      if (st.stopping) return finish();
      if (code === 0) return runIt();
      addLog(id, '\n✖ Install failed.\n');
      finish();
    });
  } else runIt();
}

function killTree(pid) {
  if (process.platform === 'win32') execFile('taskkill', ['/pid', String(pid), '/T', '/F'], () => {});
  else { try { process.kill(-pid, 'SIGTERM'); } catch {} }
}
function stop(id) {
  const st = procs.get(id);
  if (!st) return;
  st.stopping = true;
  if (st.child) killTree(st.child.pid);
}

/* ---------- LAN remote (for the phone app) ---------- */
function lanIPs() {
  return Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
}
const readBody = (req) => new Promise((ok) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch { ok({}); } });
});
const json = (res, data, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };

async function handle(req, res) {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/')) {
    const pin = req.headers['x-pin'] || u.searchParams.get('pin');
    if (pin !== db.settings.pin) return json(res, { error: 'pin' }, 401);
    if (u.pathname === '/api/projects') return json(res, snapshot());
    if (u.pathname === '/api/categories') return json(res, db.categories);
    if (u.pathname === '/api/info') return json(res, { version: app.getVersion() });
    if (u.pathname === '/api/logo') {
      const p = db.projects.find((x) => x.id === u.searchParams.get('id'));
      const f = p && logoFile(p);
      if (!f) return json(res, { error: 'not found' }, 404);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'max-age=86400' });
      return fs.createReadStream(f).pipe(res);
    }
    if (u.pathname === '/api/logs') return json(res, logs.get(u.searchParams.get('id')) || []);
    if (u.pathname === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write('\n'); sse.add(res); req.on('close', () => sse.delete(res));
      return;
    }
    if (req.method === 'POST') {
      const b = await readBody(req);
      if (u.pathname === '/api/start') start(b.id, b.script);
      else if (u.pathname === '/api/stop') stop(b.id);
      return json(res, { ok: true });
    }
    return json(res, { error: 'not found' }, 404);
  }
  const f = u.pathname === '/' ? 'index.html' : u.pathname.slice(1);
  const fp = path.join(SRC, f);
  if (!fp.startsWith(SRC)) { res.writeHead(403); return res.end(); }
  fs.readFile(fp, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
    res.end(buf);
  });
}
function applyRemote() {
  if (db.settings.remote && !remote) {
    remote = http.createServer(handle);
    remote.on('error', (e) => console.error('remote:', e.message));
    remote.listen(db.settings.port, '0.0.0.0');
  } else if (!db.settings.remote && remote) {
    remote.close(); remote = null;
    sse.forEach((r) => r.end()); sse.clear();
  }
}
const settingsOut = () => ({
  ...db.settings, ips: lanIPs(), version: app.getVersion(), repo: updates.REPO_URL,
  portable: !!process.env.PORTABLE_EXECUTABLE_FILE, appUpdate, justUpdated,
});

/* ---------- notifications & tray ---------- */
function showWindow() {
  if (!win || win.isDestroyed()) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}
function notify(title, body, evt) {
  if (!db.settings.notify || !Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: path.join(__dirname, 'build', 'icon.png') });
  n.on('click', () => { showWindow(); if (evt) broadcast(evt); });
  n.show();
}
function applyTray() {
  if (db.settings.tray && !tray) {
    tray = new Tray(path.join(__dirname, 'build', 'icon.png'));
    tray.setToolTip('Ember');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'باز کردن Ember', click: showWindow },
      { label: 'بررسی بروزرسانی پروژه‌ها', click: () => checkProjects(true) },
      { type: 'separator' },
      { label: 'خروج', click: () => { quitting = true; app.quit(); } },
    ]));
    tray.on('click', showWindow);
  } else if (!db.settings.tray && tray) {
    tray.destroy(); tray = null;
  }
}
function applyAutostart() {
  if (!app.isPackaged || process.platform !== 'win32') return;
  const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  app.setLoginItemSettings({ openAtLogin: !!db.settings.autostart, path: exe });
}

/* ---------- project updates ("updated — test it") ---------- */
function projectUpdate(p) {
  const r = revs.get(p.id);
  if (!db.settings.watchProjects || !r) return { updated: false, behind: 0 };
  return {
    updated: !!(r.rev && p.seenRev && r.rev !== p.seenRev),
    updateKind: r.kind, updateTime: r.time, updateSubject: r.subject,
    behind: db.settings.fetchRemote ? r.behind || 0 : 0,
    upstream: r.upstream || null, remoteSubject: r.remoteSubject || '', fetchError: r.fetchError || null,
  };
}
function markTested(p) {
  const r = revs.get(p.id);
  if (r && r.rev && p.seenRev !== r.rev) { p.seenRev = r.rev; save(); }
}

let checking = false, lastFetch = 0;
async function checkProjects(withRemote = false) {
  if (checking || !db.settings.watchProjects) return;
  checking = true;
  const fetchNow = db.settings.fetchRemote && (withRemote || Date.now() - lastFetch >= db.settings.fetchMinutes * 60000);
  if (fetchNow) lastFetch = Date.now();
  const fetched = new Set();
  let dirty = false;
  try {
    for (const p of [...db.projects]) {
      const local = await watch.localRev(p.path);
      if (!db.projects.includes(p)) continue;                // removed meanwhile
      const prev = revs.get(p.id) || {};
      const r = { ...prev, ...(local || { kind: null, rev: null, time: null, subject: '' }) };
      if (fetchNow) Object.assign(r, (await watch.remoteState(p.path, fetched)) || { behind: 0, upstream: null, remoteRev: null, fetchError: null });
      revs.set(p.id, r);
      if (r.rev && !p.seenRev) { p.seenRev = r.rev; dirty = true; }   // first look: nothing to test yet
      if (r.rev && r.rev !== p.seenRev && p.notifiedRev !== r.rev) {
        p.notifiedRev = r.rev; dirty = true;
        notify(`🆕 ${p.name} بروز شد`, (r.subject ? r.subject + '\n' : '') + 'تغییرات جدید را اجرا و تست کنید.', { type: 'focus', id: p.id });
      }
      if (r.behind > 0 && r.remoteRev && p.notifiedRemote !== r.remoteRev) {
        p.notifiedRemote = r.remoteRev; dirty = true;
        notify(`⬇ ${p.name}: ${r.behind} کامیت جدید`, (r.remoteSubject ? r.remoteSubject + '\n' : '') + 'دریافت (pull) کنید و تست کنید.', { type: 'focus', id: p.id });
      }
      if (prev.rev !== r.rev || prev.behind !== r.behind || prev.fetchError !== r.fetchError) pushState(p.id);
    }
  } finally {
    if (dirty) save();
    checking = false;
  }
}
async function pullProject(id) {
  const p = db.projects.find((x) => x.id === id);
  if (!p) return { ok: false, err: 'not found' };
  addLog(id, `$ git pull --ff-only\n`);
  const r = await watch.pull(p.path);
  addLog(id, (r.out || r.err || '') + '\n' + (r.ok ? '✔ Pulled.\n' : '✖ Pull failed.\n'));
  lastFetch = 0;
  await checkProjects(true);
  return { ok: r.ok, err: r.ok ? null : r.err };
}

/* ---------- Ember's own updates (GitHub Releases) ---------- */
let appUpdate = { checking: false, checkedAt: null, latest: null, available: false, error: null, downloading: false, progress: 0 };
let justUpdated = null;   // version we just updated to, shown once as "updated" in the UI
function setAppUpdate(patch) { appUpdate = { ...appUpdate, ...patch }; broadcast({ type: 'appUpdate', appUpdate }); }

async function checkAppUpdate(manual = false) {
  if (appUpdate.checking || appUpdate.downloading) return appUpdate;
  setAppUpdate({ checking: true, error: null });
  try {
    const r = await updates.fetchLatest(net.fetch, app.getVersion());
    setAppUpdate({ checking: false, checkedAt: Date.now(), latest: r.latest, available: r.available });
    if (r.available && !manual && db.settings.notifiedVersion !== r.latest.version) {
      db.settings.notifiedVersion = r.latest.version; save();
      notify(`نسخه‌ی جدید Ember: ${r.latest.version}`, 'برای دانلود و نصب، تنظیمات ← بروزرسانی را باز کنید.', { type: 'openSettings', tab: 'updates' });
    }
  } catch (e) {
    setAppUpdate({ checking: false, checkedAt: Date.now(), error: e.message || String(e) });
  }
  return appUpdate;
}

async function installAppUpdate() {
  const l = appUpdate.latest;
  if (!l || appUpdate.downloading) return appUpdate;
  // portable builds, dev runs and other platforms: just open the download page
  if (process.platform !== 'win32' || !app.isPackaged || process.env.PORTABLE_EXECUTABLE_FILE || !l.setupUrl) {
    shell.openExternal(process.env.PORTABLE_EXECUTABLE_FILE && l.portableUrl ? l.portableUrl : l.url);
    return appUpdate;
  }
  setAppUpdate({ downloading: true, progress: 0, error: null });
  try {
    const res = await net.fetch(l.setupUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const total = Number(res.headers.get('content-length')) || 0;
    const file = path.join(app.getPath('temp'), `Ember-Setup-${l.version}.exe`);
    const out = fs.createWriteStream(file);
    const reader = res.body.getReader();
    let got = 0, lastSent = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.length;
      if (!out.write(Buffer.from(value))) await new Promise((ok) => out.once('drain', ok));
      if (total && got - lastSent > total / 50) { lastSent = got; setAppUpdate({ progress: got / total }); }
    }
    await new Promise((ok, fail) => out.end((e) => (e ? fail(e) : ok())));
    setAppUpdate({ progress: 1 });
    spawn(file, [], { detached: true, stdio: 'ignore' }).unref();
    quitting = true;
    setTimeout(() => app.quit(), 500);
  } catch (e) {
    setAppUpdate({ downloading: false, error: 'دانلود ناموفق بود: ' + (e.message || e) });
  }
  return appUpdate;
}

function scheduleChecks() {
  setTimeout(() => checkProjects(true), 3000);
  setInterval(() => checkProjects(false), 60000);           // local check every minute, fetch every N minutes
  setTimeout(() => db.settings.checkUpdates && checkAppUpdate(), 8000);
  setInterval(() => db.settings.checkUpdates && checkAppUpdate(), 6 * 3600000);
}
function noteVersion() {
  const v = app.getVersion();
  if (db.settings.lastVersion && db.settings.lastVersion !== v && updates.compareVersions(v, db.settings.lastVersion) > 0) justUpdated = v;
  if (db.settings.lastVersion !== v) { db.settings.lastVersion = v; save(); }
}

/* ---------- IPC ---------- */
ipcMain.handle('list', () => snapshot());
ipcMain.handle('add', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Select project folder', properties: ['openDirectory'] });
  if (r.canceled) return snapshot();
  for (const dir of scan(r.filePaths[0])) {
    if (db.projects.some((p) => p.path.toLowerCase() === dir.toLowerCase())) continue;
    const pkg = readPkg(dir);
    const sc = runnable(pkg);
    if (!sc.length) continue;
    db.projects.push({ id: crypto.randomUUID(), name: path.basename(dir), path: dir, cats: defaultCats(pkg), script: sc[0] });
  }
  save();
  checkProjects();
  return snapshot();
});
ipcMain.handle('update', (_, id, patch) => {
  const p = db.projects.find((x) => x.id === id);
  if (p) {
    for (const k of ['name', 'script']) if (k in patch) p[k] = patch[k];
    if (patch.cats && typeof patch.cats === 'object') {
      p.cats = {};
      for (const c of db.categories) if (c.values.some((v) => v.id === patch.cats[c.id])) p.cats[c.id] = patch.cats[c.id];
    }
    save();
  }
  return snapshot();
});
ipcMain.handle('pickLogo', (_, id) => pickLogo(id));
ipcMain.handle('setLogoMode', (_, id, mode) => {
  const p = db.projects.find((x) => x.id === id);
  if (p && (mode === 'auto' || mode === 'none')) { dropCustomLogo(p); if (mode === 'auto') delete p.logo; else p.logo = ''; save(); }
  return snapshot();
});
ipcMain.handle('remove', (_, id) => { const rp = db.projects.find((x) => x.id === id); if (rp) dropCustomLogo(rp); stop(id); revs.delete(id); db.projects = db.projects.filter((p) => p.id !== id); save(); return snapshot(); });
ipcMain.handle('start', (_, id, script) => start(id, script));
ipcMain.handle('stop', (_, id) => stop(id));
ipcMain.handle('logs', (_, id) => logs.get(id) || []);
ipcMain.handle('categories', () => db.categories);
ipcMain.handle('setCategories', (_, list) => { setCategories(list); broadcast({ type: 'categories' }); return db.categories; });
ipcMain.handle('openUrl', (_, url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); });
ipcMain.handle('openData', () => shell.openPath(app.getPath('userData')));
ipcMain.handle('openFolder', (_, id) => { const p = db.projects.find((x) => x.id === id); if (p) shell.openPath(p.path); });
ipcMain.handle('settings', () => settingsOut());
ipcMain.handle('setSettings', (_, s) => {
  for (const k of ['remote', 'checkUpdates', 'watchProjects', 'fetchRemote', 'notify', 'tray', 'autostart']) {
    if (typeof s[k] === 'boolean') db.settings[k] = s[k];
  }
  if (Number.isFinite(s.fetchMinutes)) db.settings.fetchMinutes = Math.min(240, Math.max(5, Math.round(s.fetchMinutes)));
  if (s.regenPin) db.settings.pin = String(crypto.randomInt(100000, 999999));
  save(); applyRemote(); applyTray(); applyAutostart();
  if (s.watchProjects || s.fetchRemote) checkProjects(true);
  if (s.watchProjects === false || s.fetchRemote === false) db.projects.forEach((p) => pushState(p.id));
  return settingsOut();
});
ipcMain.handle('checkProjects', (_, withRemote) => checkProjects(!!withRemote).then(snapshot));
ipcMain.handle('markTested', (_, id) => { const p = db.projects.find((x) => x.id === id); if (p) markTested(p); return snapshot(); });
ipcMain.handle('pull', (_, id) => pullProject(id));
ipcMain.handle('checkAppUpdate', () => checkAppUpdate(true));
ipcMain.handle('installAppUpdate', () => installAppUpdate());
ipcMain.handle('dismissJustUpdated', () => { justUpdated = null; });

/* ---------- window ---------- */
function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 900, minHeight: 600, title: 'Ember', backgroundColor: '#14100d',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(SRC, 'index.html'));
  win.on('close', (e) => { if (tray && !quitting) { e.preventDefault(); win.hide(); } });
  win.on('focus', () => checkProjects(false));
}
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
app.on('second-instance', () => showWindow());
app.setAppUserModelId('app.ember.launcher');   // Windows notifications need it
app.whenReady().then(() => { if (!gotLock) return; load(); noteVersion(); createWindow(); applyRemote(); applyTray(); applyAutostart(); scheduleChecks(); });
app.on('before-quit', () => { quitting = true; procs.forEach((st) => st.child && killTree(st.child.pid)); });
app.on('window-all-closed', () => { if (!tray) app.quit(); });
