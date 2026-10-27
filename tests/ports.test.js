const test = require('node:test');
const assert = require('node:assert');
const net = require('net');
const { detectTool, runCommand, findFreePort, portInUse } = require('../ports');

test('detectTool knows the common dev servers', () => {
  assert.deepStrictEqual(detectTool('vite'), { flag: '--port', defaultPort: 5173 });
  assert.deepStrictEqual(detectTool('next dev --turbo'), { flag: '-p', defaultPort: 3000 });
  assert.strictEqual(detectTool('astro dev').flag, '--port');
  assert.strictEqual(detectTool('vite build && vite preview').flag, null);   // chained: PORT only
  assert.strictEqual(detectTool('vite serve').flag, '--port');
  assert.strictEqual(detectTool('serve -s dist').flag, '-l');
  assert.strictEqual(detectTool('node server.js').flag, null);
  assert.strictEqual(detectTool('react-scripts start').flag, null);
});

test('runCommand passes the port the way each package manager expects', () => {
  assert.strictEqual(runCommand('npm', 'dev', '--port', 5174), 'npm run dev -- --port 5174');
  assert.strictEqual(runCommand('pnpm', 'dev', '-p', 3001), 'pnpm run dev -p 3001');
  assert.strictEqual(runCommand('npm', 'start', null, 3001), 'npm run start');
});

test('findFreePort skips taken and busy ports', async () => {
  const busy = new Set([3001]);
  assert.strictEqual(await findFreePort(3000, new Set([3000]), async (p) => busy.has(p)), 3002);
});

test('portInUse sees a real listener', async () => {
  const srv = net.createServer().listen(0, '127.0.0.1');
  await new Promise((ok) => srv.once('listening', ok));
  const port = srv.address().port;
  assert.strictEqual(await portInUse(port), true);
  await new Promise((ok) => srv.close(ok));
  assert.strictEqual(await portInUse(port), false);
});
