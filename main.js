const { app, BrowserWindow, ipcMain, dialog, shell, Menu, Notification, Tray, net, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const updates = require('./updates');
const watch = require('./projectwatch');
const ports = require('./ports');
const netinfo = require('./netinfo');
const I18N = require('./src/i18n');
const T = (k, v) => I18N.make(db && db.settings.lang)(k, v);

const SRC = path.join(__dirname, 'src');
const RUNNABLE = ['dev', 'start', 'serve', 'develop', 'preview', 'watch'];
const ANSI = /\x1B\[[0-9;?]*[A-Za-z]/g;
const URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]|(?:\d{1,3}\.){3}\d{1,3}):(\d+)/i;
const { pathToFileURL } = require('url');

let win, tray = null, dbFile, db, quitting = false;
const projWins = new Map(); // id -> BrowserWindow of that project
const procs = new Map();   // id -> { child, status, url, stopping }
const revs = new Map();    // id -> { kind, rev, time, subject, behind, upstream, remoteRev, remoteSubject, fetchError }
const logs = new Map();    // id -> string[]

/* ---------- storage ---------- */
function load() {
  dbFile = path.join(app.getPath('userData'), 'ember.json');
  try { db = JSON.parse(fs.readFileSync(dbFile, 'utf8')); } catch { db = {}; }
  db.projects ??= [];
  db.settings ??= {};
  db.settings.lang ??= 'fa';
  // the phone remote and the update switches are gone: updates are always checked, downloaded and installed on exit
  for (const k of ['port', 'remote', 'pin', 'checkUpdates', 'autoDownload', 'installOnQuit']) delete db.settings[k];
  db.settings.watchProjects ??= true;  // "updated — test it" badge on projects
  db.settings.fetchRemote ??= true;    // git fetch to see commits that are not pulled yet
  db.settings.fetchMinutes ??= 15;
  db.settings.notify ??= true;         // Windows notifications
  db.settings.tray ??= false;          // closing the window keeps Ember in the tray
  db.settings.autostart ??= false;
  migrateCategories();
}

/* ---------- categories (user-defined groups, each with icon + name values) ---------- */
const DEFAULT_TYPES = [['web', '🌐'], ['game', '🎮'], ['mobile', '📱'], ['desktop', '🖥️'], ['api', '⚙️'], ['other', '📦']];
const defaultTypeCategory = () => ({ id: 'type', name: T('def.type'), icon: '🗂️', values: DEFAULT_TYPES.map(([id, icon]) => ({ id, icon, name: T('def.' + id) })) });
// after a language change: rename the default category and its values, unless the user renamed them
function translateDefaults(from, to) {
  const tf = I18N.make(from), tt = I18N.make(to);
  const c = db.categories.find((x) => x.id === 'type');
  if (!c) return;
  if (c.name === tf('def.type')) c.name = tt('def.type');
  for (const v of c.values) if (DEFAULT_TYPES.some(([id]) => id === v.id) && v.name === tf('def.' + v.id)) v.name = tt('def.' + v.id);
}
const newId = () => crypto.randomUUID().slice(0, 8);
function migrateCategories() {
  if (!db.categories) {
    db.categories = [defaultTypeCategory()];
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
  if (!db.categories.some((c) => c.id === 'type')) { db.categories.unshift(defaultTypeCategory()); save(); }
  for (const p of db.projects) p.cats ??= {};
}
const str = (v, max) => String(v ?? '').trim().slice(0, max);
function setCategories(list) {
  if (!Array.isArray(list)) return;
  const type = db.categories.find((c) => c.id === 'type');
  db.categories = list.map((c) => ({
    id: str(c.id, 40) || newId(), name: str(c.name, 40) || T('def.category'), icon: str(c.icon, 16) || '🗂️',
    values: (Array.isArray(c.values) ? c.values : []).map((v) => ({ id: str(v.id, 40) || newId(), icon: str(v.icon, 16) || '•', name: str(v.name, 40) || T('def.unnamed') })),
  }));
  // "Project type" is the default category and cannot be deleted
  if (!db.categories.some((c) => c.id === 'type')) db.categories.unshift(type || defaultTypeCategory());
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
async function pickLogo(id, sender) {
  const p = db.projects.find((x) => x.id === id);
  if (!p) return snapshot();
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(sender) || win, {
    title: T('dlg.logo'), properties: ['openFile'], defaultPath: p.path,
    filters: [{ name: T('dlg.images'), extensions: LOGO_EXT.map((e) => e.slice(1)) }],
  });
  if (r.canceled || !r.filePaths[0]) return snapshot();
  const src = r.filePaths[0], ext = path.extname(src).toLowerCase();
  if (!LOGO_EXT.includes(ext) || fs.statSync(src).size > 5e6) { dialog.showErrorBox('Ember', T('dlg.badImage')); return snapshot(); }
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
      status: st ? st.status : 'stopped', url: st ? st.url : null, port: st && st.port ? st.port : p.port || null,
      needsInstall: st ? false : needsInstall(p.path),
      ...projectUpdate(p),
      ...logoInfo(p),
    };
  });
}

/* ---------- events ---------- */
function broadcast(evt) {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('evt', evt);
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
    port: st && st.port ? st.port : p ? p.port || null : null,
    needsInstall: st || !p ? false : needsInstall(p.path),
    ...(p ? projectUpdate(p) : {}),
  });
}

/* ---------- run / stop ---------- */
/*
 * Running projects. The output of a run goes to a log file instead of a pipe, and the process is
 * started on its own (detached), so a dev server keeps running while Ember restarts for an update;
 * the next Ember reconnects to it (p.run remembers the pid, port and log file).
 */
const logsDir = () => path.join(app.getPath('userData'), 'logs');
const logFileOf = (id) => path.join(logsDir(), `${id}.log`);

// output found in the log file: show it, and learn the URL (port) from it
function onOutput(p, st, text) {
  text = text.replace(ANSI, '');
  addLog(p.id, text);
  if (!st.url) {
    const m = text.match(URL_RE);
    if (m) {
      st.url = `http://localhost:${m[1]}`;
      st.port = Number(m[1]);   // the server may pick its own port; this is the one it really uses
      if (p.run) { p.run.port = st.port; save(); }
      pushState(p.id);
    }
  }
}
// follows the log file of a run (works the same for runs Ember started and runs it reconnected to)
function tail(p, st, from = 0) {
  let pos = from, busy = false;
  st.tail = setInterval(() => {
    if (busy) return;
    busy = true;
    fs.stat(st.log, (err, s) => {
      if (err || s.size <= pos) { busy = false; return; }
      const len = s.size - pos, buf = Buffer.alloc(len);
      fs.open(st.log, 'r', (e1, fd) => {
        if (e1) { busy = false; return; }
        fs.read(fd, buf, 0, len, pos, (e2, n) => {
          fs.close(fd, () => {});
          pos += n || 0; busy = false;
          if (n) onOutput(p, st, buf.slice(0, n).toString());
        });
      });
    });
  }, 250);
}
const note = (st, text) => { try { fs.appendFileSync(st.log, text); } catch {} };

function exec(p, st, cmd, done, extraEnv = {}) {
  note(st, `$ ${cmd}\n`);
  let finished = false;
  const end = (code) => { if (finished) return; finished = true; st.child = null; st.pid = null; done(code); };
  let child, fd;
  try {
    fd = fs.openSync(st.log, 'a');
    child = spawn(cmd, {
      // Windows: not detached, or npm/node open a visible console window. The server still outlives
      // an Ember restart there (only the cmd.exe wrapper is closed with Ember) and is found again by its folder.
      cwd: p.path, shell: true, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', fd, fd],
      env: { ...process.env, BROWSER: 'none', FORCE_COLOR: '0', ...extraEnv },
    });
  } catch (e) { note(st, String(e) + '\n'); return end(1); }
  finally { if (fd !== undefined) fs.closeSync(fd); }
  st.child = child; st.pid = child.pid;
  child.on('error', (e) => { note(st, String(e) + '\n'); end(1); });
  child.on('exit', (code) => setTimeout(() => end(code), 400));   // let the last output reach the log first
}

// The address does not depend on the output: as soon as the run's port is listening, it is known.
function probeUrl(p, st) {
  const until = Date.now() + 5 * 60000;
  st.probe = setInterval(async () => {
    if (st.url || !st.port || Date.now() > until || !procs.has(p.id)) return clearInterval(st.probe);
    if (await ports.portInUse(st.port) && !st.url) { st.url = `http://localhost:${st.port}`; pushState(p.id); clearInterval(st.probe); }
  }, 1500);
}

function finishRun(id) {
  const st = procs.get(id);
  if (st && st.probe) clearInterval(st.probe);
  if (st && st.tail) clearInterval(st.tail);
  if (st && st.watch) clearInterval(st.watch);
  procs.delete(id);
  const p = db.projects.find((x) => x.id === id);
  if (p && p.run) { delete p.run; save(); }
  pushState(id);
}

// pid -> project id of every run Ember knows (to tell which ports are ours)
const runPids = () => new Map([...procs].filter(([, st]) => st.pid).map(([id, st]) => [st.pid, id]));

// Is this project already running (left over from before Ember restarted, or started outside Ember)?
// Then show it as running on its port instead of starting a second copy on the next port.
async function findRunning(p) {
  try {
    const rows = await netinfo.report(db.projects, runPids());
    return rows.find((r) => r.projectId === p.id) || null;
  } catch { return null; }
}
function adopt(p, { pid, port, log, from }) {
  const st = { child: null, pid, status: 'running', url: port ? `http://localhost:${port}` : null, port: port || null, stopping: false, adopted: true, log: log || logFileOf(p.id) };
  procs.set(p.id, st);
  logs.set(p.id, []);
  if (log && fs.existsSync(log)) {
    const old = fs.readFileSync(log, 'utf8').replace(ANSI, '');
    if (old) addLog(p.id, old);
  }
  addLog(p.id, '\n' + T('log.reattached', { pid, port: port || '?' }) + '\n');
  if (log) tail(p, st, from ?? (fs.existsSync(log) ? fs.statSync(log).size : 0));
  // a process Ember did not start sends no "exit": check now and then whether it is still there
  st.watch = setInterval(() => { if (!netinfo.pidAlive(st.pid)) { addLog(p.id, '\n' + T('log.ended') + '\n'); finishRun(p.id); } }, 2000);
  p.run = { pid, port: port || null, log: st.log, cmd: p.run && p.run.cmd };
  save();
  pushState(p.id);
}

// after Ember starts: reconnect to the runs that are still going
async function reattach() {
  if (!db.projects.length) return;
  let rows = [], table = new Map();
  try { [rows, table] = await Promise.all([netinfo.report(db.projects, new Map()), netinfo.processes()]); } catch {}
  for (const p of db.projects) {
    if (procs.has(p.id)) continue;
    const r = p.run;
    // a run Ember started: its pid must still be alive and still be that command (pids are reused)
    if (r && r.pid && netinfo.pidAlive(r.pid) && (!r.cmd || (table.get(r.pid) || {}).cmd?.includes(r.cmd))) {
      const row = rows.find((x) => x.projectId === p.id);
      adopt(p, { pid: r.pid, port: (row && row.port) || r.port, log: r.log });   // earlier output + follow new output
      continue;
    }
    // the wrapper is gone but the server lives on (Windows, after an update), or it was started some
    // other way (an older Ember, a terminal): known by its folder; keep following its log if it has one
    const row = rows.find((x) => x.projectId === p.id);
    const log = r && r.log && fs.existsSync(r.log) ? r.log : null;
    if (r) { delete p.run; save(); }
    if (row) adopt(p, { pid: row.pid, port: row.port, log });
  }
}

function start(id, script) {
  const p = db.projects.find((x) => x.id === id);
  if (!p || procs.has(id)) return;
  if (script && script !== p.script) { p.script = script; save(); }
  markTested(p);
  const pm = detectPM(p.path);
  fs.mkdirSync(logsDir(), { recursive: true });
  const st = { child: null, pid: null, status: 'installing', url: null, stopping: false, port: null, log: logFileOf(id) };
  fs.writeFileSync(st.log, '');
  procs.set(id, st);
  logs.set(id, []);
  broadcast({ type: 'logClear', id });
  tail(p, st, 0);
  const finish = () => finishRun(id);
  const runIt = async () => {
    // already running on its port (e.g. left over from before an update)? Use that one.
    const running = await findRunning(p);
    if (st.stopping) return finish();
    if (running) {
      clearInterval(st.tail); procs.delete(id);
      return adopt(p, { pid: running.pid, port: running.port, log: null });
    }
    // only ports of projects running right now are off limits; a project's port is a preference
    const pkg = readPkg(p.path);
    const tool = ports.detectTool(pkg && pkg.scripts ? pkg.scripts[p.script] : '');
    const taken = new Set();
    for (const [oid, o] of procs) if (oid !== id && o.port) taken.add(o.port);
    const wanted = p.port || tool.defaultPort;
    const port = await ports.findFreePort(wanted, taken);
    if (st.stopping) return finish();
    if (port !== wanted) note(st, T('log.portBusy', { a: wanted, b: port }) + '\n');
    if (!p.port) { p.port = port; save(); }   // first run: remember it; later runs keep the preference
    st.port = port;
    st.status = 'running'; pushState(id);
    const cmd = ports.runCommand(pm, p.script, tool.flag, port);
    exec(p, st, cmd, () => finish(), { PORT: String(port) });
    if (st.pid) { p.run = { pid: st.pid, port, log: st.log, cmd }; save(); }
    probeUrl(p, st);
  };
  if (needsInstall(p.path)) {
    pushState(id);
    exec(p, st, `${pm} install`, (code) => {
      if (st.stopping) return finish();
      if (code === 0) return runIt();
      note(st, '\n' + T('log.installFailed') + '\n');
      setTimeout(finish, 400);
    });
  } else runIt();
}

function killTree(pid, wait = false) {
  if (!pid) return;
  if (process.platform === 'win32') {
    const args = ['/pid', String(pid), '/T', '/F'];
    // when Ember is closing, wait for it, or the dev server outlives Ember
    if (wait) { try { require('child_process').execFileSync('taskkill', args, { windowsHide: true, timeout: 8000, stdio: 'ignore' }); } catch {} }
    else execFile('taskkill', args, { windowsHide: true }, () => {});
  } else {
    try { process.kill(-pid, 'SIGTERM'); } catch { try { process.kill(pid, 'SIGTERM'); } catch {} }
  }
}
function stop(id) {
  const st = procs.get(id);
  if (!st) return;
  st.stopping = true;
  killTree(st.pid);
}

const settingsOut = () => ({
  ...db.settings, version: app.getVersion(), repo: updates.REPO_URL,
  portable: !!process.env.PORTABLE_EXECUTABLE_FILE, updateMode: updateMode(), appUpdate, justUpdated,
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
  n.on('click', () => {
    if (evt && evt.type === 'focus') return openProject(evt.id);   // a project notification opens that project
    showWindow(); if (evt) broadcast(evt);
  });
  n.show();
}
function applyTray() {
  if (db.settings.tray && !tray) {
    tray = new Tray(path.join(__dirname, 'build', 'icon.png'));
    tray.setToolTip('Ember');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: T('tray.open'), click: showWindow },
      { label: T('tray.check'), click: () => checkProjects(true) },
      { type: 'separator' },
      { label: T('tray.quit'), click: () => { quitting = true; app.quit(); } },
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
        notify(T('n.updated', { name: p.name }), (r.subject ? r.subject + '\n' : '') + T('n.updatedBody'), { type: 'focus', id: p.id });
      }
      if (r.behind > 0 && r.remoteRev && p.notifiedRemote !== r.remoteRev) {
        p.notifiedRemote = r.remoteRev; dirty = true;
        notify(T('n.behind', { name: p.name, n: r.behind }), (r.remoteSubject ? r.remoteSubject + '\n' : '') + T('n.behindBody'), { type: 'focus', id: p.id });
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
  addLog(id, (r.out || r.err || '') + '\n' + T(r.ok ? 'log.pulled' : 'log.pullFailed') + '\n');
  lastFetch = 0;
  await checkProjects(true);
  return { ok: r.ok, err: r.ok ? null : r.err };
}

/* ---------- Ember's own updates (GitHub Releases) ---------- */
let appUpdate = { checking: false, checkedAt: null, latest: null, available: false, error: null, downloading: false, progress: 0, ready: false, mode: null };
let justUpdated = null;   // version we just updated to, shown once as "updated" in the UI
function setAppUpdate(patch) { appUpdate = { ...appUpdate, ...patch }; broadcast({ type: 'appUpdate', appUpdate }); }

async function checkAppUpdate(manual = false) {
  if (appUpdate.checking || appUpdate.downloading) return appUpdate;
  setAppUpdate({ checking: true, error: null });
  try {
    const r = await updates.fetchLatest(net.fetch, app.getVersion());
    setAppUpdate({ checking: false, checkedAt: Date.now(), latest: r.latest, available: r.available, mode: updateMode() });
    if (r.available && updateMode() !== 'page') downloadAppUpdate();   // always: download in the background
  } catch (e) {
    setAppUpdate({ checking: false, checkedAt: Date.now(), error: e.message || String(e) });
  }
  return appUpdate;
}

// How this copy of Ember can update itself:
//   setup    - installed with Ember-Setup.exe: silent install (no wizard), then Ember opens again
//   portable - Ember-Portable.exe: the exe is swapped in place, then Ember opens again
//   page     - development run or another OS: open the release page
const portableExe = () => process.env.PORTABLE_EXECUTABLE_FILE || null;
function updateMode() {
  if (process.platform !== 'win32' || !app.isPackaged) return 'page';
  return portableExe() ? 'portable' : 'setup';
}
const updatesDir = () => path.join(app.getPath('userData'), 'updates');

async function downloadAppUpdate() {
  const l = appUpdate.latest, mode = updateMode();
  if (!l || !appUpdate.available || appUpdate.downloading) return appUpdate;
  if (appUpdate.ready && appUpdate.readyVersion === l.version) return appUpdate;
  const url = mode === 'portable' ? l.portableUrl : mode === 'setup' ? l.setupUrl : null;
  if (!url) return appUpdate;
  setAppUpdate({ downloading: true, progress: 0, error: null });
  try {
    const res = await net.fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const total = Number(res.headers.get('content-length')) || 0;
    fs.mkdirSync(updatesDir(), { recursive: true });
    const file = path.join(updatesDir(), `Ember-${mode}-${l.version}.exe`);
    const part = file + '.part';
    const out = fs.createWriteStream(part);
    const hash = crypto.createHash('sha256');
    const reader = res.body.getReader();
    let got = 0, lastSent = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const buf = Buffer.from(value);
      got += buf.length; hash.update(buf);
      if (!out.write(buf)) await new Promise((ok) => out.once('drain', ok));
      if (total && got - lastSent > total / 50) { lastSent = got; setAppUpdate({ progress: got / total }); }
    }
    await new Promise((ok, fail) => out.end((e) => (e ? fail(e) : ok())));
    // compare with SHA256SUMS.txt of the release, so a broken or swapped download is never run
    if (l.sumsUrl) {
      const sums = await (await net.fetch(l.sumsUrl)).text();
      const want = updates.expectedHash(sums, decodeURIComponent(url.split('/').pop()));
      if (want && want !== hash.digest('hex')) { fs.rmSync(part, { force: true }); throw new Error('checksum mismatch'); }
    }
    fs.renameSync(part, file);
    setAppUpdate({ downloading: false, progress: 1, ready: true, readyVersion: l.version, readyFile: file });
    if (db.settings.notifiedVersion !== l.version) {
      db.settings.notifiedVersion = l.version; save();
      notify(T('n.ready', { v: l.version }), T('n.readyBody'), { type: 'openSettings', tab: 'updates' });
    }
  } catch (e) {
    setAppUpdate({ downloading: false, error: T('up.dlFailed', { e: e.message || e }) });
  }
  return appUpdate;
}

let applyingUpdate = false;
// restart = true: open Ember again right after; false: just install (Ember is closing anyway)
function runUpdate(restart) {
  const file = appUpdate.readyFile;
  if (!file || !fs.existsSync(file) || applyingUpdate) return false;
  applyingUpdate = true;
  try {
    if (updateMode() === 'portable') {
      const exe = portableExe();
      // Windows lets a running exe be renamed, so: move the old one aside, put the new one in its place
      fs.rmSync(exe + '.old', { force: true });
      fs.renameSync(exe, exe + '.old');
      fs.copyFileSync(file, exe);
      if (restart) spawn(exe, [], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
    } else {
      // electron-builder's installer: /S = no wizard, --force-run = start Ember when done
      spawn(file, ['/S', '--updated', ...(restart ? ['--force-run'] : [])], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
    }
    return true;
  } catch (e) {
    applyingUpdate = false;
    setAppUpdate({ error: T('up.installFailed', { e: e.message || e }) });
    return false;
  }
}

async function installAppUpdate() {
  if (updateMode() === 'page') {
    if (appUpdate.latest) shell.openExternal(appUpdate.latest.url);
    return appUpdate;
  }
  if (!appUpdate.ready) await downloadAppUpdate();
  if (appUpdate.ready && runUpdate(true)) { quitting = true; keepRuns = true; setTimeout(() => app.quit(), 300); }
  return appUpdate;
}

function cleanUpdates() {
  const exe = portableExe();
  if (exe) fs.rm(exe + '.old', { force: true }, () => {});
  fs.readdir(updatesDir(), (err, files) => {
    if (err) return;
    for (const f of files) {
      const v = (f.match(/-(\d+\.\d+\.\d+(?:-[A-Za-z]+\.\d+)?)\.exe(\.part)?$/) || [])[1];
      if (!v || f.endsWith('.part') || updates.compareVersions(v, app.getVersion()) <= 0) fs.rm(path.join(updatesDir(), f), { force: true }, () => {});
    }
  });
}

function scheduleChecks() {
  setTimeout(() => checkProjects(true), 3000);
  setInterval(() => checkProjects(false), 60000);           // local check every minute, fetch every N minutes
  setTimeout(() => checkAppUpdate(), 8000);
  setInterval(() => checkAppUpdate(), 6 * 3600000);
}
function noteVersion() {
  const v = app.getVersion();
  if (db.settings.lastVersion && db.settings.lastVersion !== v && updates.compareVersions(v, db.settings.lastVersion) > 0) justUpdated = v;
  if (db.settings.lastVersion !== v) { db.settings.lastVersion = v; save(); }
}

/* ---------- IPC ---------- */
ipcMain.handle('list', () => snapshot());
ipcMain.handle('add', async () => {
  const r = await dialog.showOpenDialog(win, { title: T('dlg.addFolder'), properties: ['openDirectory'] });
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
    if (typeof patch.name === 'string' && patch.name.trim()) p.name = patch.name.trim().slice(0, 80);
    if (typeof patch.script === 'string') p.script = patch.script;
    if ('port' in patch) {
      const n = Number(patch.port);
      if (patch.port === null || patch.port === '') delete p.port;
      else if (Number.isInteger(n) && n > 0 && n < 65536) p.port = n;
    }
    if (patch.cats && typeof patch.cats === 'object') {
      p.cats = {};
      for (const c of db.categories) if (c.values.some((v) => v.id === patch.cats[c.id])) p.cats[c.id] = patch.cats[c.id];
    }
    save();
    broadcast({ type: 'projects' });
  }
  return snapshot();
});
ipcMain.handle('pickLogo', async (e, id) => { const r = await pickLogo(id, e.sender); broadcast({ type: 'projects' }); return r; });
ipcMain.handle('setLogoMode', (_, id, mode) => {
  const p = db.projects.find((x) => x.id === id);
  if (p && (mode === 'auto' || mode === 'none')) { dropCustomLogo(p); if (mode === 'auto') delete p.logo; else p.logo = ''; save(); broadcast({ type: 'projects' }); }
  return snapshot();
});
ipcMain.handle('remove', (_, id) => {
  const rp = db.projects.find((x) => x.id === id);
  if (rp) dropCustomLogo(rp);
  stop(id); revs.delete(id);
  db.projects = db.projects.filter((p) => p.id !== id); save();
  const pw = projWins.get(id); if (pw && !pw.isDestroyed()) pw.close();
  return snapshot();
});
ipcMain.handle('openProject', (_, id) => openProject(id));
ipcMain.handle('editProject', (_, id) => { showWindow(); broadcast({ type: 'edit', id }); });
ipcMain.handle('clearLog', (_, id) => { logs.set(id, []); broadcast({ type: 'logClear', id }); });
ipcMain.handle('ports', async () => {
  const rows = await netinfo.report(db.projects, runPids());
  return rows.map((r) => ({ ...r, projectName: (db.projects.find((p) => p.id === r.projectId) || {}).name || null, running: procs.has(r.projectId) }));
});
ipcMain.handle('killPid', (_, pid) => { if (Number.isInteger(pid) && pid > 4 && pid !== process.pid) killTree(pid); });
ipcMain.on('lang', (e) => { e.returnValue = db ? db.settings.lang : 'fa'; });
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
  for (const k of ['watchProjects', 'fetchRemote', 'notify', 'tray', 'autostart']) {
    if (typeof s[k] === 'boolean') db.settings[k] = s[k];
  }
  if (Number.isFinite(s.fetchMinutes)) db.settings.fetchMinutes = Math.min(240, Math.max(5, Math.round(s.fetchMinutes)));
  if ((s.lang === 'fa' || s.lang === 'en') && s.lang !== db.settings.lang) {
    translateDefaults(db.settings.lang, s.lang);
    db.settings.lang = s.lang;
    if (tray) { tray.destroy(); tray = null; }       // rebuilt with the new texts below
    setImmediate(() => broadcast({ type: 'lang', lang: s.lang }));
  }
  save(); applyTray(); applyAutostart();
  if (s.watchProjects || s.fetchRemote) checkProjects(true);
  if (s.watchProjects === false || s.fetchRemote === false) db.projects.forEach((p) => pushState(p.id));
  return settingsOut();
});
ipcMain.handle('checkProjects', (_, withRemote) => checkProjects(!!withRemote).then(snapshot));
ipcMain.handle('markTested', (_, id) => { const p = db.projects.find((x) => x.id === id); if (p) { markTested(p); pushState(id); } return snapshot(); });
ipcMain.handle('pull', (_, id) => pullProject(id));
ipcMain.handle('checkAppUpdate', () => checkAppUpdate(true));
ipcMain.handle('installAppUpdate', () => installAppUpdate());
ipcMain.handle('downloadAppUpdate', () => downloadAppUpdate());
ipcMain.handle('dismissJustUpdated', () => { justUpdated = null; });

/* ---------- window ---------- */
function createWindow() {
  win = new BrowserWindow(windowOptions({ width: 1280, height: 800, minWidth: 900, minHeight: 600, title: 'Ember' }));
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(SRC, 'index.html'));
  win.on('close', (e) => { if (tray && !quitting) { e.preventDefault(); win.hide(); } });
  win.on('focus', () => checkProjects(false));
  // without the tray, closing the main window closes Ember, project windows included
  win.on('closed', () => { if (!tray) projWins.forEach((w) => !w.isDestroyed() && w.close()); });
}
const windowOptions = (extra) => ({
  backgroundColor: '#0B0B0D', icon: path.join(__dirname, 'build', 'icon.png'),
  // the top bar of the page is the title bar, in the app's colours (like SnapshotAll / DeskPresence)
  ...(process.platform === 'win32' ? { titleBarStyle: 'hidden', titleBarOverlay: { color: '#0B0B0D', symbolColor: '#F5F5F7', height: 52 } } : {}),
  webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  ...extra,
});
// one window per project: name and buttons on top, its log below
function openProject(id) {
  const p = db.projects.find((x) => x.id === id);
  if (!p) return;
  let w = projWins.get(id);
  if (w && !w.isDestroyed()) { if (w.isMinimized()) w.restore(); w.show(); w.focus(); return; }
  w = new BrowserWindow(windowOptions({ width: 1000, height: 700, minWidth: 640, minHeight: 420, title: p.name }));
  w.loadFile(path.join(SRC, 'project.html'), { query: { id } });
  w.on('closed', () => projWins.delete(id));
  projWins.set(id, w);
}
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
app.on('second-instance', () => showWindow());
app.setAppUserModelId('app.ember.launcher');   // Windows notifications need it
app.whenReady().then(() => { if (!gotLock) return; nativeTheme.themeSource = 'dark'; load(); noteVersion(); cleanUpdates(); createWindow(); applyTray(); applyAutostart(); scheduleChecks(); reattach(); });
let keepRuns = false;   // true while restarting for an update: running projects go on, the new Ember reconnects
app.on('before-quit', () => {
  quitting = true;
  if (!keepRuns) {
    procs.forEach((st) => killTree(st.pid, true));
    db.projects.forEach((p) => delete p.run);
    save();
  }
  if (appUpdate.ready) runUpdate(false);   // a downloaded update installs quietly on exit
});
app.on('window-all-closed', () => { if (!tray) app.quit(); });
