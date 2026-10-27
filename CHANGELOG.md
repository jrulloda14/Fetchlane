# Changelog

All notable changes are listed here. Versions follow [Semantic Versioning](https://semver.org).

## [0.1.1] - First public preview

0.1.0 was built as a draft release and never published; 0.1.1 replaces it. Compared with that draft, partial downloads are kept until you confirm a restart, catching browser downloads is opt-in, license texts ship with the installer, and a slow disk can no longer stall downloads.

### Features
- **Direct downloads:** HTTP and HTTPS with validated resume (`If-Range` and exact `Content-Range`); when a partial file can't be continued, it's kept until you confirm a restart; automatic retries with a visible countdown, optional segmented downloads, crash recovery that only trusts fsync'd data, safe file names that never overwrite existing files, and redacted links.
- **Queue:** simultaneous download limit, queue positions and drag to reorder, Start now, Pause all / Resume all.
- **BitTorrent:** magnet links (with a cancellable "Fetching torrent details" step and an optional automatic start), .torrent files (picker, drag and drop, or a link to one), a contents preview with file selection, all torrent states including Stalled and Seeding, and a details panel with files, peers, ratio, seeding limits, trackers and **Recheck files**. Progress is saved, so a restart spot-checks data instead of reading every file again.
- **One list** for direct downloads and torrents with Direct/Torrent tags, a Seeding list, and upload speed in the status bar.
- **Clear actions:** Stop seeding, Remove from list (keeps files) and Delete downloaded files (Recycle Bin, with a confirmation that shows exactly what goes).
- **Browser extension** for Chrome, Edge and Brave: **Download with Fetchlane** on the right-click menu for links (including magnet links) and media, and optional catching of browser downloads (off by default; only the link is handed over) with a per-site switch and a minimum size.
- **Links from Windows:** one running Fetchlane receives `fetchlane.exe --add <link>`, magnet links (optional) and .torrent files opened with Fetchlane. Several arrivals wait their turn; nothing starts without your confirmation.
- **Notifications from Fetchlane** (its own name and icon) when downloads finish, with the name, size and folder and **Open** / **Show in folder** buttons. Several at once are summed up; clicking selects the download.
- **Settings:** folders, limits, retries, torrent speed and seeding limits, browser integration, theme and density, history, notifications.
- **Accessibility:** status always shown with an icon and words, full keyboard control, visible focus, reduced-motion support.

### Platforms
- **Windows 10/11 (x64):** per-user installer, no admin rights needed.

### Known issues
- The installer isn't code-signed, so Windows SmartScreen shows a first-run warning ([how to install](docs/INSTALL.md)).
- The browser extension is installed with **Load unpacked** until it's in the browser stores.
- See [project status](docs/PROJECT_STATUS.md#known-limitations) for the full list.

[0.1.1]: https://github.com/jrulloda14/Fetchlane/releases/tag/v0.1.1
