/*
 * Which TCP ports are listening, which process holds each one, and which project that process
 * belongs to. Used to reconnect to a project that is still running and for Settings → Ports.
 * No Electron imports, so it can be unit-tested.
 */
const { execFile } = require('child_process');
const path = require('path');

const run = (cmd, args, timeout = 15000) => new Promise((ok) => {
  execFile(cmd, args, { windowsHide: true, timeout, maxBuffer: 32 << 20 }, (err, stdout) => ok(err && !stdout ? '' : String(stdout || '')));
});

// "  TCP    0.0.0.0:5176    0.0.0.0:0    LISTENING    1234"  (Windows netstat -ano)
function parseNetstat(text) {
  const out = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = line.trim().match(/^TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)$/i);
    if (m && !out.has(+m[2])) out.set(+m[2], { port: +m[2], pid: +m[3], addr: m[1] });
  }
  return [...out.values()];
}
// lsof -nP -iTCP -sTCP:LISTEN -Fpcn: "p1234" / "cnode" / "n*:5173"
function parseLsof(text) {
  const out = new Map();
  let pid = 0;
  for (const line of text.split('\n')) {
    if (line[0] === 'p') pid = +line.slice(1);
    else if (line[0] === 'n') {
      const m = line.match(/:(\d+)$/);
      if (m && !out.has(+m[1])) out.set(+m[1], { port: +m[1], pid, addr: line.slice(1, line.lastIndexOf(':')) });
    }
  }
  return [...out.values()];
}
async function listening() {
  if (process.platform === 'win32') return parseNetstat(await run('netstat', ['-ano', '-p', 'TCP'])).concat(parseNetstat(await run('netstat', ['-ano', '-p', 'TCPv6'])))
    .filter((x, i, a) => a.findIndex((y) => y.port === x.port) === i);
  return parseLsof(await run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpcn']));
}

// pid -> { pid, ppid, name, cmd }
async function processes() {
  const map = new Map();
  if (process.platform === 'win32') {
    const json = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress'], 30000);
    let list = [];
    try { list = JSON.parse(json || '[]'); } catch {}
    for (const p of [].concat(list)) map.set(p.ProcessId, { pid: p.ProcessId, ppid: p.ParentProcessId, name: p.Name || '', cmd: p.CommandLine || '' });
  } else {
    for (const line of (await run('ps', ['-axo', 'pid=,ppid=,args='])).split('\n')) {
      const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
      if (!m) continue;
      // the working folder too (Linux), for processes started with a relative path like "node server.js"
      let cwd = '';
      try { cwd = require('fs').readlinkSync(`/proc/${m[1]}/cwd`); } catch {}
      map.set(+m[1], { pid: +m[1], ppid: +m[2], name: path.basename(m[3].split(' ')[0]), cmd: m[3], cwd });
    }
  }
  return map;
}

function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

const norm = (s) => String(s || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
/*
 * The project a process belongs to:
 *   'ember' - it (or a parent) is a process Ember started for that project (runPids: pid -> project id)
 *   'path'  - its command line (or a parent's) contains the project folder, e.g. .../my-game/node_modules/vite/bin/vite.js
 * The longest matching folder wins, so a project inside another project's folder is told apart.
 */
function ownerOf(pid, procs, projects, runPids = new Map()) {
  let best = null;
  for (let cur = procs.get(pid), depth = 0; cur && depth < 25; cur = procs.get(cur.ppid), depth++) {
    if (runPids.has(cur.pid)) return { projectId: runPids.get(cur.pid), how: 'ember' };
    const cmd = norm(cur.cmd) + (cur.cwd ? ' ' + norm(cur.cwd) + '/' : '');
    for (const p of projects) {
      const dir = norm(p.path);
      const at = dir ? cmd.indexOf(dir) : -1;
      // the folder must end there: "/game" must not match "/game-2"
      if (at >= 0 && !/[a-z0-9_.-]/.test(cmd[at + dir.length] || '') && (!best || dir.length > best.len)) best = { projectId: p.id, how: 'path', len: dir.length };
    }
    if (cur.ppid === cur.pid) break;
  }
  return best ? { projectId: best.projectId, how: best.how } : null;
}

// every listening port with its process and, if any, the project it belongs to
async function report(projects, runPids) {
  const [ports, procs] = await Promise.all([listening(), processes()]);
  return ports.map((l) => {
    const pr = procs.get(l.pid) || {};
    const own = ownerOf(l.pid, procs, projects, runPids);
    return { port: l.port, addr: l.addr, pid: l.pid, name: pr.name || '', cmd: pr.cmd || '', projectId: own ? own.projectId : null, how: own ? own.how : null };
  }).sort((a, b) => (!!b.projectId - !!a.projectId) || a.port - b.port);
}

module.exports = { parseNetstat, parseLsof, listening, processes, pidAlive, ownerOf, report };
