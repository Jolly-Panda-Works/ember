const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { localRev, remoteState, newestMtime } = require('../projectwatch');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ember-test-'));
const g = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();
function commit(dir, file, text, msg) {
  fs.writeFileSync(path.join(dir, file), text);
  g(dir, 'add', '-A');
  g(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', msg);
}

test('folder without git: revision follows file changes, ignores node_modules and lock files', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  const old = new Date(Date.now() - 60000);
  fs.utimesSync(path.join(dir, 'package.json'), old, old);
  const a = await localRev(dir);
  assert.strictEqual(a.kind, 'files');
  fs.mkdirSync(path.join(dir, 'node_modules'));
  fs.writeFileSync(path.join(dir, 'node_modules', 'x.js'), '');
  fs.writeFileSync(path.join(dir, 'package-lock.json'), '{}');
  assert.strictEqual((await localRev(dir)).rev, a.rev);
  fs.writeFileSync(path.join(dir, 'index.js'), 'new');
  assert.notStrictEqual((await localRev(dir)).rev, a.rev);
  assert.ok(newestMtime(dir) > 0);
});

test('git project: new commits change the revision; remote commits are counted', async () => {
  const origin = tmp();
  g(origin, 'init', '-q', '-b', 'main');
  commit(origin, 'package.json', '{}', 'first');
  const clone = path.join(tmp(), 'clone');
  g(path.dirname(clone), 'clone', '-q', origin, clone);

  const a = await localRev(clone);
  assert.strictEqual(a.kind, 'git');
  assert.strictEqual(a.subject, 'first');
  assert.strictEqual((await remoteState(clone)).behind, 0);

  commit(origin, 'index.js', 'x', 'second');
  const r = await remoteState(clone);
  assert.strictEqual(r.behind, 1);
  assert.strictEqual(r.remoteSubject, 'second');
  assert.strictEqual(r.upstream, 'origin/main');

  g(clone, 'pull', '-q', '--ff-only');
  const b = await localRev(clone);
  assert.notStrictEqual(b.rev, a.rev);
  assert.strictEqual(b.subject, 'second');
});
