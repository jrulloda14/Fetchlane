# Roadmap

Fetchlane is shaped by feedback. Nothing here is a promise or a date. Ideas move up when people ask for them; [open a feature request](https://github.com/jrulloda14/Fetchlane/issues/new/choose) to vote with your use case.

## Now: v0.1 preview

- First published Windows release with checksums
- Browser extension in the Chrome Web Store and Edge Add-ons, so it no longer needs Developer mode
- Code signing, so Windows stops warning on first run
- Long real-world torrent testing in the installed app

## Candidates

### Downloads that need your browser sign-in

Some downloads only work with the browser's cookies (for example, files behind a sign-in). Fetchlane could receive the cookies for that one link from the extension, use them only for that download and never store them.

**Status:** candidate; needs a careful privacy design.

### Scheduling

Start the queue at a set time, stop at another, and optionally shut down or sleep when everything is done.

### Speed limit for direct downloads

A global limit for direct downloads, like the one torrents already have, plus a quick "slow down" switch in the status bar.

### Automatic updates

Check for a new release (opt-in), download it with a checksum and install on restart.

### Torrent networking options

Listening port, UPnP port forwarding, encryption preference and a proxy for peer connections. Separate seed and peer counts in the details panel.

### Smaller ideas

- Change the folder of a failed download without removing it
- Move finished torrents to another folder
- Reorder torrents by dragging
- Verify a finished file against a SHA-256 you paste
- Tray icon, start minimized and keep running when the window closes
- Firefox extension

## Ideas

Suggestions from users will be collected here.
