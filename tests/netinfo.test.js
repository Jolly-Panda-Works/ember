const test = require('node:test');
const assert = require('node:assert');
const net = require('net');
const { parseNetstat, parseLsof, ownerOf, report, pidAlive } = require('../netinfo');

test('parseNetstat reads Windows netstat output', () => {
  const text = `
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1012
  TCP    127.0.0.1:5176         0.0.0.0:0              LISTENING       8840
  TCP    192.168.1.2:52000      140.82.1.1:443         ESTABLISHED     4410
  TCP    [::1]:5176             [::]:0                 LISTENING       8840`;
  assert.deepStrictEqual(parseNetstat(text).map((x) => [x.port, x.pid]), [[135, 1012], [5176, 8840]]);
});

test('parseLsof reads lsof -F output', () => {
  assert.deepStrictEqual(parseLsof('p42\ncnode\nn*:5173\nn[::1]:5173\np7\ncpostgres\nn127.0.0.1:5432\n').map((x) => [x.port, x.pid]), [[5173, 42], [5432, 7]]);
});

test('ownerOf finds the project by Ember pid or by folder in the command line', () => {
  const procs = new Map([
    [1, { pid: 1, ppid: 0, cmd: 'explorer.exe' }],
    [10, { pid: 10, ppid: 1, cmd: 'C:\\Windows\\system32\\cmd.exe /d /s /c "npm run dev -- --port 5176"' }],
    [11, { pid: 11, ppid: 10, cmd: '"node" F:\\Rastaar\\metahome\\node_modules\\vite\\bin\\vite.js --port 5176' }],
    [20, { pid: 20, ppid: 1, cmd: 'node F:/Rastaar/metahome-2/server.js' }],
    [30, { pid: 30, ppid: 1, cmd: 'postgres -D data' }],
  ]);
  const projects = [{ id: 'm', path: 'F:\\Rastaar\\metahome' }, { id: 'm2', path: 'F:\\Rastaar\\metahome-2\\' }];
  assert.deepStrictEqual(ownerOf(11, procs, projects), { projectId: 'm', how: 'path' });
  assert.deepStrictEqual(ownerOf(20, procs, projects), { projectId: 'm2', how: 'path' });   // not "metahome"
  assert.deepStrictEqual(ownerOf(11, procs, projects, new Map([[10, 'x']])), { projectId: 'x', how: 'ember' });
  assert.strictEqual(ownerOf(30, procs, projects), null);
});

test('report lists a real listener of this process', async () => {
  const srv = net.createServer().listen(0, '127.0.0.1');
  await new Promise((ok) => srv.once('listening', ok));
  const port = srv.address().port;
  const rows = await report([{ id: 'me', path: __dirname }], new Map([[process.pid, 'me']]));
  const row = rows.find((r) => r.port === port);
  assert.ok(row, 'port listed');
  assert.strictEqual(row.pid, process.pid);
  assert.strictEqual(row.projectId, 'me');
  assert.strictEqual(pidAlive(process.pid), true);
  srv.close();
});
