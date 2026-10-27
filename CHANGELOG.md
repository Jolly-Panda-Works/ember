# Changelog

Release builds are published automatically from `main`. See the
[Releases page](https://github.com/Jolly-Panda-Works/ember/releases) for every build's notes.

## 1.0

- A project that is already running (left over from before Ember restarted, or started outside Ember) is reconnected on its port instead of starting a second copy on the next port. Runs keep going while Ember restarts for an update and come back with their log.
- Ports are no longer reserved for stopped projects; a project's port is a preference and is not changed because it was busy once.
- Settings → Ports: every port in use, the program holding it, and which Ember project it belongs to (open, project window, end).
- English and Persian (Settings → General → Language); the layout turns left-to-right in English.
- Project window: click a project or 📜 Log; name and buttons on top, live log below (follow, copy, clear).
- Categories collapse, in the sidebar and in Settings; *Project type* cannot be deleted. The Done button in Settings always stays visible.
- Updates are always checked, downloaded and installed on exit (the switches are gone).
- The phone remote (APK and LAN server) was removed.
- Updates download in the background, are checked against the release's SHA256SUMS.txt and install silently (no setup wizard); Ember opens again by itself. Or they install when Ember closes. The portable exe swaps itself in place.
- Category editor: names and icons save as you type, and moving to the next field no longer loses the click. The icon picker has 8 groups (about 400 emoji) plus any emoji or text you type.
- Each project gets its own port; a busy port moves to the next free one (`--port` / `-p` for known dev servers, `PORT` for the rest). The port shows on the card and can be set in ✎.
- On Windows the top bar is the title bar, in the app's colours.
- Rename a project by double-clicking its name. ✎ moved to the card's corner, 📂 next to the path.
- New look, matching SnapshotAll and DeskPresence: top bar with the version, sidebar, page title, cards with orange section titles, pill switches, themed scrollbars.
- Every category has an automatic *All* item.
- Project logos: found automatically (favicon / logo in the project) or chosen by you.
- The Android remote APK gets the same automatic version as the Windows build.
- Categories are now yours: the fixed type and client fields are replaced by categories you create, rename and delete, each with values that have an icon and a name. *Project type* is the default category; existing clients move into a *کارفرما* category.
- Settings window: General, Project updates, Ember updates, Phone access, About.
- Update check against GitHub Releases (on start and every 6 hours), with *Download and install*.
- "🆕 Updated — test it" badge and Windows notification when a project changed since it was last run in Ember.
- New commits on the project's git remote are shown with a **Pull** button.
- Optional: stay in the system tray when the window is closed, start with Windows.
- Every push to `main` publishes a GitHub Release (installer, portable exe, Android remote APK, checksums).
- Open source: MIT license, contributing guide, issue templates.
