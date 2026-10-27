#!/usr/bin/env node
/*
 * Single source of truth for the version number (same scheme as DeskPresence / SnapshotAll).
 * The default version lives in package.json ("version"). For a CI build this script decides
 * the final version, writes it back into package.json (so the exe, the About page and the
 * release all show the same string) and prints it.
 *
 *   node tools/set-version.js                         print the current version
 *   node tools/set-version.js 1.2.0                   set an explicit version
 *   node tools/set-version.js --ci REF REF_NAME RUN   version of a GitHub Actions build:
 *                                                       tag vX.Y.Z   -> X.Y.Z
 *                                                       main branch  -> MAJOR.MINOR.RUN
 *                                                       other        -> MAJOR.MINOR.0-dev.RUN
 */
const fs = require('fs');
const path = require('path');

const PKG = path.join(__dirname, '..', 'package.json');
const VALID = /^\d+\.\d+\.\d+(-[A-Za-z]+\.\d+)?$/;

function computeVersion(ref, refName, run, def) {
  const majorMinor = def.split('.').slice(0, 2).join('.');
  if (ref.startsWith('refs/tags/v')) return refName.slice(1);
  if (ref === 'refs/heads/main' || ref === 'refs/heads/master') return `${majorMinor}.${run}`;
  return `${majorMinor}.0-dev.${run}`;
}

function main(argv) {
  const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8'));
  let version = pkg.version;
  if (argv[0] === '--ci') version = computeVersion(argv[1] || '', argv[2] || '', argv[3] || '0', pkg.version);
  else if (argv[0]) version = argv[0];
  if (!VALID.test(version)) { console.error(`Invalid version: ${version}`); process.exit(1); }
  if (version !== pkg.version) {
    pkg.version = version;
    fs.writeFileSync(PKG, JSON.stringify(pkg, null, 2) + '\n');
  }
  console.log(version);
}

if (require.main === module) main(process.argv.slice(2));
module.exports = { computeVersion };
