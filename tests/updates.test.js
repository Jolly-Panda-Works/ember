const test = require('node:test');
const assert = require('node:assert');
const { compareVersions, pickRelease, fetchLatest, expectedHash } = require('../updates');

test('compareVersions orders releases and dev builds', () => {
  assert.ok(compareVersions('1.0.42', '1.0.41') > 0);
  assert.ok(compareVersions('v1.1.0', '1.0.99') > 0);
  assert.ok(compareVersions('1.0.0', '1.0.0-dev.5') > 0);
  assert.ok(compareVersions('1.0.0-dev.6', '1.0.0-dev.5') > 0);
  assert.ok(compareVersions('1.0.3', '1.0.0-dev.99') > 0);
  assert.strictEqual(compareVersions('1.0.3', 'v1.0.3'), 0);
  assert.strictEqual(compareVersions('garbage', '1.0.0'), 0);
});

test('pickRelease finds the installer, portable exe and apk', () => {
  const r = pickRelease({
    tag_name: 'v1.0.7', html_url: 'https://example/r', body: 'notes',
    assets: [
      { name: 'Ember-Setup.exe', browser_download_url: 'https://example/setup' },
      { name: 'Ember-Portable.exe', browser_download_url: 'https://example/portable' },
      { name: 'Ember-Remote.apk', browser_download_url: 'https://example/apk' },
    ],
  });
  assert.strictEqual(r.version, '1.0.7');
  assert.strictEqual(r.setupUrl, 'https://example/setup');
  assert.strictEqual(r.portableUrl, 'https://example/portable');
  assert.strictEqual(r.apkUrl, 'https://example/apk');
});

test('fetchLatest reports an available update', async () => {
  const fake = async () => ({ ok: true, status: 200, json: async () => ({ tag_name: 'v1.0.9', assets: [] }) });
  assert.strictEqual((await fetchLatest(fake, '1.0.8')).available, true);
  assert.strictEqual((await fetchLatest(fake, '1.0.9')).available, false);
  const none = async () => ({ ok: false, status: 404 });
  assert.deepStrictEqual(await fetchLatest(none, '1.0.0'), { latest: null, available: false });
});

test('expectedHash reads SHA256SUMS.txt', () => {
  const h = 'a'.repeat(64), g = 'b'.repeat(64);
  const sums = `${h}  Ember-Setup.exe\r\n${g}  Ember-Portable.exe\n`;
  assert.strictEqual(expectedHash(sums, 'Ember-Portable.exe'), g);
  assert.strictEqual(expectedHash(sums, 'Ember-Setup.exe'), h);
  assert.strictEqual(expectedHash(sums, 'other.exe'), null);
});
