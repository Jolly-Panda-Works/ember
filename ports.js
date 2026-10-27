/*
 * Gives every project its own port and moves to the next one when that port is busy.
 * No Electron imports, so it can be unit-tested.
 */
const net = require('net');

// true when something answers on the port (IPv4 or IPv6), or we may not listen on it
function portInUse(port) {
  const answers = (host) => new Promise((ok) => {
    const s = net.connect({ port, host });
    const done = (v) => { s.destroy(); ok(v); };
    s.setTimeout(400, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
  const canListen = () => new Promise((ok) => {
    const srv = net.createServer();
    srv.once('error', () => ok(false));
    srv.listen(port, '127.0.0.1', () => srv.close(() => ok(true)));
  });
  return Promise.all([answers('127.0.0.1'), answers('::1'), canListen()]).then(([a, b, free]) => a || b || !free);
}

// The dev tool a script runs, the flag it takes for the port, and its usual default port.
// Scripts that chain commands (&&, concurrently, run-p) only get the PORT variable.
const TOOLS = [
  [/\bnext\s+(dev|start)\b/, '-p', 3000],
  [/\bastro\s+(dev|preview)\b/, '--port', 4321],
  [/\b(nuxt|nuxi)\s+(dev|preview)\b/, '--port', 3000],
  [/\bng\s+serve\b/, '--port', 4200],
  [/\bgatsby\s+develop\b/, '-p', 8000],
  [/\bremix\s+vite:dev\b/, '--port', 5173],
  [/\bwebpack(-dev-server|\s+serve)\b/, '--port', 8080],
  [/\bexpo\s+start\b/, '--port', 8081],
  [/\b(http-server|live-server)\b/, '--port', 8080],
  [/\bvite\b(?!\s+build)/, '--port', 5173],
  [/(^|\s)serve(\s|$)/, '-l', 3000],
];
function detectTool(cmd) {
  const c = String(cmd || '');
  const t = TOOLS.find(([re]) => re.test(c));
  const chained = /&&|\|\||;|\bconcurrently\b|\brun-p\b|\bnpm-run-all\b/.test(c);
  return { flag: t && !chained ? t[1] : null, defaultPort: t ? t[2] : 3000 };
}

// `npm run dev -- --port 3001`; pnpm, yarn and bun pass extra arguments without `--`
function runCommand(pm, script, flag, port) {
  if (!flag) return `${pm} run ${script}`;
  return pm === 'npm' ? `npm run ${script} -- ${flag} ${port}` : `${pm} run ${script} ${flag} ${port}`;
}

// First free port from `wanted` up, skipping the ports in `taken` (other projects, Ember itself).
async function findFreePort(wanted, taken = new Set(), isBusy = portInUse) {
  for (let p = wanted; p < wanted + 200 && p < 65536; p++) {
    if (taken.has(p)) continue;
    if (!(await isBusy(p))) return p;
  }
  return wanted;
}

module.exports = { portInUse, detectTool, runCommand, findFreePort };
