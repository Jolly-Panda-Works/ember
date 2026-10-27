const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

const SRC = path.join(__dirname, 'src');
const RUNNABLE = ['dev', 'start', 'serve', 'develop', 'preview', 'watch'];
const ANSI = /\x1B\[[0-9;?]*[A-Za-z]/g;
const URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]|(?:\d{1,3}\.){3}\d{1,3}):(\d+)/i;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

let win, dbFile, db, remote = null;
const procs = new Map();   // id -> { child, status, url, stopping }
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
}
const save = () => fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));

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
const settingsOut = () => ({ ...db.settings, ips: lanIPs() });

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
    db.projects.push({ id: crypto.randomUUID(), name: path.basename(dir), path: dir, type: guessType(pkg), client: '', script: sc[0] });
  }
  save();
  return snapshot();
});
ipcMain.handle('update', (_, id, patch) => {
  const p = db.projects.find((x) => x.id === id);
  if (p) { for (const k of ['name', 'type', 'client', 'script']) if (k in patch) p[k] = patch[k]; save(); }
  return snapshot();
});
ipcMain.handle('remove', (_, id) => { stop(id); db.projects = db.projects.filter((p) => p.id !== id); save(); return snapshot(); });
ipcMain.handle('start', (_, id, script) => start(id, script));
ipcMain.handle('stop', (_, id) => stop(id));
ipcMain.handle('logs', (_, id) => logs.get(id) || []);
ipcMain.handle('openUrl', (_, url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); });
ipcMain.handle('openFolder', (_, id) => { const p = db.projects.find((x) => x.id === id); if (p) shell.openPath(p.path); });
ipcMain.handle('settings', () => settingsOut());
ipcMain.handle('setSettings', (_, s) => {
  if (typeof s.remote === 'boolean') db.settings.remote = s.remote;
  if (s.regenPin) db.settings.pin = String(crypto.randomInt(100000, 999999));
  save(); applyRemote();
  return settingsOut();
});

/* ---------- window ---------- */
function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 900, minHeight: 600, title: 'Ember', backgroundColor: '#14100d',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(SRC, 'index.html'));
}
app.whenReady().then(() => { load(); createWindow(); applyRemote(); });
app.on('before-quit', () => procs.forEach((st) => st.child && killTree(st.child.pid)));
app.on('window-all-closed', () => app.quit());
