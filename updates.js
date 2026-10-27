/* App update check against GitHub Releases. No Electron imports, so it can be unit-tested. */
const REPO = 'Jolly-Panda-Works/ember';
const REPO_URL = `https://github.com/${REPO}`;
const LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`;

// '1.2.3' -> { nums: [1,2,3], pre: null };  'v1.2.0-dev.7' -> { nums: [1,2,0], pre: 7 }
function parseVersion(v) {
  const m = String(v || '').trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)(?:-[A-Za-z]+\.(\d+))?/);
  return m ? { nums: [+m[1], +m[2], +m[3]], pre: m[4] === undefined ? null : +m[4] } : null;
}

// < 0 when a is older than b, 0 when equal (or unparsable), > 0 when a is newer.
function compareVersions(a, b) {
  const pa = parseVersion(a), pb = parseVersion(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] - pb.nums[i];
  if (pa.pre === pb.pre) return 0;
  if (pa.pre === null) return 1;            // a release is newer than its own dev builds
  if (pb.pre === null) return -1;
  return pa.pre - pb.pre;
}

function pickRelease(json) {
  if (!json || !json.tag_name) return null;
  const assets = json.assets || [];
  const find = (re) => (assets.find((a) => re.test(a.name)) || {}).browser_download_url || null;
  return {
    version: json.tag_name.replace(/^v/i, ''),
    tag: json.tag_name,
    name: json.name || json.tag_name,
    url: json.html_url || `${REPO_URL}/releases/latest`,
    notes: json.body || '',
    publishedAt: json.published_at || null,
    setupUrl: find(/setup.*\.exe$/i),
    portableUrl: find(/portable.*\.exe$/i),
    sumsUrl: find(/^SHA256SUMS\.txt$/i),
  };
}

// the hash of `name` in a SHA256SUMS.txt ("<hash>  <name>" per line), or null
function expectedHash(sums, name) {
  for (const line of String(sums).split(/\r?\n/)) {
    const m = line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/i);
    if (m && m[2].trim() === name) return m[1].toLowerCase();
  }
  return null;
}

async function fetchLatest(fetchFn, current) {
  const r = await fetchFn(LATEST_API, { headers: { Accept: 'application/vnd.github+json' } });
  if (r.status === 404) return { latest: null, available: false };   // no release published yet
  if (!r.ok) throw new Error(`GitHub: HTTP ${r.status}`);
  const latest = pickRelease(await r.json());
  return { latest, available: !!latest && compareVersions(latest.version, current) > 0 };
}

module.exports = { REPO, REPO_URL, parseVersion, compareVersions, pickRelease, fetchLatest, expectedHash };
