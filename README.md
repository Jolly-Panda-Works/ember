# 🔥 Ember (اخگر)

Windows launcher for your Node projects. Add a folder → Ember finds projects with `dev` / `start` / `serve` / `preview` scripts,
installs packages only when needed, then runs them. Group by type (website, game, …) and by client.

## Run locally
    npm install
    npm start

## Build the .exe on GitHub
Push this repo to GitHub. The **Build Ember** workflow produces
`Ember-Setup-x.y.z.exe` and `Ember-Portable-x.y.z.exe` (Actions → run → Artifacts) and
`Ember-Remote.apk` for Android. Push a tag like `v1.0.0` to also publish them as a GitHub Release.

## Phone (APK)
Ember Remote is a small Capacitor app that connects to Ember on your PC over Wi-Fi.
Windows app → "دسترسی از موبایل" → enable → enter the IP + PIN in the APK.
Dev servers must listen on the LAN (`vite --host`, `next dev -H 0.0.0.0`, …).
