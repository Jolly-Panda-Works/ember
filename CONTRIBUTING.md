# Contributing to Ember

Thanks for taking the time to contribute! By participating you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to contribute

- **Report a bug** — use the [bug report form](../../issues/new?template=bug_report.yml).
- **Suggest a feature** — use the [feature request form](../../issues/new?template=feature_request.yml).
- **Send a pull request** — for larger changes, please open an issue first.

## Development setup

Requirements: Node.js 20+, git, Windows for the installer build.

```bash
git clone https://github.com/Jolly-Panda-Works/ember.git
cd ember
npm install
npm start        # run the app
npm test         # unit tests (node:test)
npm run check    # syntax check
npm run dist     # build dist/Ember-Setup.exe and dist/Ember-Portable.exe
```

## Code layout

- `main.js` — Electron main process: projects, running scripts, ports, project windows, settings, notifications, tray, self-update
- `projectwatch.js` — "updated — test it": local revision of a project and commits on its git remote
- `updates.js` — Ember's own update check against GitHub Releases
- `preload.js` — the `window.ember` API for the UI
- `ports.js` — one port per project, moving to the next free one
- `src/i18n.js` — every text in Persian and English (also used by the main process)
- `src/index.html`, `src/app.js` — main window; `src/project.html`, `src/project.js` — project window; `src/common.js` — shared helpers
- `tools/set-version.js` — version number for CI builds

## Guidelines

- **Language:** every UI text goes into `src/i18n.js` in Persian and English; README and code comments are English.
- **Theme:** dark with an orange accent — reuse the CSS variables in `src/style.css`.
- **Dependencies:** avoid new runtime dependencies; Ember has none besides Electron.
- **Scope:** keep pull requests focused — one logical change per PR.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:` …).

## Releases

Merging to `main` publishes a release automatically (see the README). Bump `version` in `package.json` only to change the major or minor number.
