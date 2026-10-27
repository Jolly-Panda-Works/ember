/*
 * Notices when a project changed since you last ran it in Ember ("updated — test it"),
 * and when its git remote has commits you have not pulled yet.
 * No Electron imports, so it can be unit-tested.
 */
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

// never let git wait for a password prompt in the background
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', 'android', 'ios']);
const SKIP_FILES = /(^package-lock\.json|^yarn\.lock|^pnpm-lock\.yaml|^bun\.lockb?|\.log|\.tsbuildinfo)$/;

function git(cwd, args, timeout = 20000) {
  return new Promise((ok) => {
    execFile('git', args, { cwd, windowsHide: true, timeout, env: GIT_ENV, maxBuffer: 1 << 20 }, (err, stdout, stderr) => {
      ok({ ok: !err, out: String(stdout || '').trim(), err: String(stderr || (err && err.message) || '').trim() });
    });
  });
}

// newest modification time of the project's own files (for folders that are not in git)
function newestMtime(dir, depth = 3, budget = { n: 3000 }) {
  let newest = 0;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    if (--budget.n < 0) break;
    if (e.name.startsWith('.')) continue;
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (depth > 0 && !SKIP_DIRS.has(e.name)) newest = Math.max(newest, newestMtime(fp, depth - 1, budget));
    } else if (e.isFile() && !SKIP_FILES.test(e.name)) {
      try { newest = Math.max(newest, fs.statSync(fp).mtimeMs); } catch {}
    }
  }
  return newest;
}

// The current revision of the project: the last commit that touched its folder, or the newest file time.
async function localRev(dir) {
  if (!fs.existsSync(dir)) return null;
  const r = await git(dir, ['log', '-1', '--format=%H%x1f%ct%x1f%s', '--', '.']);
  if (r.ok && r.out) {
    const [hash, ct, subject] = r.out.split('\x1f');
    return { kind: 'git', rev: hash, time: Number(ct) * 1000, subject };
  }
  const t = newestMtime(dir);
  return t ? { kind: 'files', rev: 'mtime:' + Math.floor(t), time: Math.floor(t), subject: '' } : null;
}

// Fetches the upstream branch and counts commits (touching this folder) that are not pulled yet.
// `fetched` (a Set of repo roots) avoids fetching the same repo twice in one round.
async function remoteState(dir, fetched = new Set()) {
  const up = await git(dir, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  if (!up.ok || !up.out) return null;                       // not git, or no upstream branch
  const top = (await git(dir, ['rev-parse', '--show-toplevel'])).out || dir;
  let fetchError = null;
  if (!fetched.has(top)) {
    fetched.add(top);
    const f = await git(dir, ['fetch', '--quiet', '--no-tags', up.out.split('/')[0]], 60000);
    if (!f.ok) fetchError = f.err.split('\n').pop() || 'git fetch failed';
  }
  const count = await git(dir, ['rev-list', '--count', 'HEAD..@{u}', '--', '.']);
  const head = await git(dir, ['log', '-1', '--format=%H%x1f%s', '@{u}', '--', '.']);
  const [remoteRev, remoteSubject] = (head.out || '').split('\x1f');
  return { upstream: up.out, behind: Number(count.out) || 0, remoteRev: remoteRev || null, remoteSubject: remoteSubject || '', fetchError };
}

const pull = (dir) => git(dir, ['pull', '--ff-only'], 120000);

module.exports = { git, newestMtime, localRev, remoteState, pull };
