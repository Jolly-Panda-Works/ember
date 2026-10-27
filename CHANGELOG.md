# Changelog

Release builds are published automatically from `main`. See the
[Releases page](https://github.com/Jolly-Panda-Works/ember/releases) for every build's notes.

## 1.0

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
