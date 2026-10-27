# Privacy

- **No accounts, no telemetry, no ads.**
- **Internet access** is limited to:
  - the update check: one request to `api.github.com` for Ember's latest release (turn off in Settings → Ember updates), and the installer download when you press *Download and install*;
  - `git fetch` / `git pull` of **your own** projects against their own remotes (turn off in Settings → Project updates).
- **Phone access** (off by default) opens an HTTP server on your local network, protected by a 6-digit PIN.
- **What is stored:** `%APPDATA%\Ember\ember.json` — the list of your projects (name, path, type, client, last tested revision) and your settings. Logs of running projects are kept in memory only.

The source code is public. You can check all of this yourself.
