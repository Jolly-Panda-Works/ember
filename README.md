<p align="center">
  <img src="build/icon.png" alt="Ember logo" width="120">
</p>

# 🔥 Ember (اخگر)

**A Windows launcher for your Node projects. Add a folder → Ember finds every project with a `dev` / `start` / `serve` / `preview` script, installs packages only when needed, and runs it with one click. When a project's code changes, Ember marks it "updated — test it".**

[![Build](https://github.com/Jolly-Panda-Works/ember/actions/workflows/build.yml/badge.svg)](https://github.com/Jolly-Panda-Works/ember/actions/workflows/build.yml)
[![Latest release](https://img.shields.io/github/v/release/Jolly-Panda-Works/ember?display_name=tag&color=F97316)](https://github.com/Jolly-Panda-Works/ember/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/Jolly-Panda-Works/ember/total?color=F97316)](https://github.com/Jolly-Panda-Works/ember/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-lightgrey)](#download)

[Download](https://github.com/Jolly-Panda-Works/ember/releases/latest/download/Ember-Setup.exe) · [فارسی](README.fa.md) · [Report a bug](https://github.com/Jolly-Panda-Works/ember/issues/new?template=bug_report.yml) · [Request a feature](https://github.com/Jolly-Panda-Works/ember/issues/new?template=feature_request.yml)

---

## Features

| | |
|---|---|
| **Find projects** | Add one project folder, or a folder full of projects. Every `package.json` with a runnable script shows up as a card. |
| **Install only when needed** | Ember runs `npm` / `pnpm` / `yarn` / `bun install` only when `node_modules` is missing or older than the lock file. |
| **One click to run** | Pick the script, press ▶. The local URL is detected from the output and opens with 🔗. Live log in the bottom panel. |
| **Your own categories** | Out of the box there is one category, *Project type* (website, game, mobile, desktop, API, other). Add, rename or delete categories (client, status, …) and their values, each with an icon and a name, in ⚙️ Settings → *Categories*. Filter by any of them in the sidebar; search matches them too. |
| **"Updated — test it" badge** | When a project changed since you last ran it in Ember (a new commit, or newer files for folders without git), its card gets a 🆕 badge and a Windows notification. Running it (or *✓ Tested*) clears the badge. |
| **New commits on GitHub** | Ember runs `git fetch` every few minutes (default 15). Commits you have not pulled yet show as *⬇ N new commits* with a **Pull** button (`git pull --ff-only`). |
| **Settings** | General (notifications, stay in tray, start with Windows), categories, project updates, Ember updates, phone access, About. |
| **Updates itself** | Checks GitHub Releases on start and every 6 hours. *Download and install* fetches the new installer and runs it. After an update, a banner says what changed. |
| **Phone remote** | The *Ember Remote* APK starts and stops projects from your phone over Wi-Fi (PIN protected, local network only). |

## Download

1. Download **[Ember-Setup.exe](https://github.com/Jolly-Panda-Works/ember/releases/latest/download/Ember-Setup.exe)** and run it.
   Prefer no installer? **[Ember-Portable.exe](https://github.com/Jolly-Panda-Works/ember/releases/latest/download/Ember-Portable.exe)** runs without installing.
2. Press **＋ Add project folder**.
3. Optional, for the phone: install **[Ember-Remote.apk](https://github.com/Jolly-Panda-Works/ember/releases/latest/download/Ember-Remote.apk)**, then in Ember → ⚙️ Settings → *Phone access* turn it on and type the IP and PIN into the app.

> Windows SmartScreen may warn about an unsigned app the first time: *More info → Run anyway*. The SHA-256 checksums of every release are in `SHA256SUMS.txt`.

Dev servers must listen on the LAN to be opened from the phone (`vite --host`, `next dev -H 0.0.0.0`, …).

## How "updated" works

- **Git projects:** Ember remembers the last commit that touched the project folder when you ran it. A different commit (you pulled, switched branch, or another tool committed) → 🆕 *Updated — test it*.
- **Folders without git:** the newest file time (ignoring `node_modules`, `dist`, `build`, lock files and dot folders) is used instead.
- **Remote:** with *Check GitHub for new commits* on, Ember fetches the upstream branch (it never changes your files unless you press **Pull**). Ember never asks for passwords: if `git fetch` needs a login, the card shows a warning instead.
- Turn any of this off in ⚙️ Settings → *Project updates*.

## Releases

Every push to `main` builds Ember on GitHub Actions and publishes a **GitHub Release** automatically:

| Push to | Version | Result |
|---|---|---|
| `main` | `1.0.<run number>` | tag + public release with `Ember-Setup.exe`, `Ember-Portable.exe`, `Ember-Remote.apk`, `SHA256SUMS.txt` |
| a tag `vX.Y.Z` | `X.Y.Z` | release with that version |
| any other branch / pull request | `1.0.0-dev.<run>` | build only (Actions → run → Artifacts, kept 14 days) |

The major/minor part comes from `version` in `package.json` (see `tools/set-version.js`). The in-app update check reads the latest release.

## Build from source

    git clone https://github.com/Jolly-Panda-Works/ember.git
    cd ember
    npm install
    npm start          # run
    npm test           # unit tests
    npm run dist       # Windows installer + portable exe in dist/

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Privacy

No accounts, no telemetry. The only internet traffic is the update check against GitHub and `git fetch` of your own projects. See [PRIVACY.md](PRIVACY.md).

## License

[MIT](LICENSE) © Usef Farahmand · Jolly Panda Works
