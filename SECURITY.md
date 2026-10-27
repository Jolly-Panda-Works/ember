# Security policy

## Supported versions

Only the latest release receives fixes.

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's
[private vulnerability reporting](https://github.com/Jolly-Panda-Works/ember/security/advisories/new)
instead. You will get an answer within a few days.

Areas that deserve particular care:

- the phone remote (LAN HTTP server with a PIN, `main.js` → `handle`)
- the self-update download (`main.js` → `installAppUpdate`, `updates.js`)
- running project scripts and `git` commands (`main.js` → `exec`, `projectwatch.js`)
