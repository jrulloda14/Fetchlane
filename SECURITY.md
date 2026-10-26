# Security policy

Fetchlane runs on your computer. It has no servers or accounts and sends no telemetry. It connects only to the servers and BitTorrent peers of the downloads you add.

What it can touch:

- **Files:** it writes downloads only into the folders you choose, never overwrites an existing file, and deletes downloaded files only after you confirm (to the Recycle Bin).
- **The web view** can't open files or links by path; it asks the backend by download ID.
- **Network:** TLS certificates are verified through Windows; HTTPS→HTTP redirects are refused. Torrents open a listening port once the first torrent is added.
- **Registry (current user only):** its notification identity, the browser extension's native messaging host, an "Open with" entry for .torrent files, and the magnet link handler only if you turn it on. The uninstaller removes them.
- **Browser extension:** it can see downloads and the links you right-click, and only talks to the Fetchlane app on your computer through native messaging. Only the Fetchlane extension's ID may connect to the app, and the app only accepts http, https and magnet links from it. Every link opens Add download for you to confirm.

The download list stores full links, including any tokens in them, in plain JSON in your user profile. Logs and the UI show redacted links only.

## Supported versions

Security fixes go into the latest release.

## Reporting a vulnerability

Please **don't open a public issue**. Instead, use GitHub's private reporting: open the repository's **Security** tab and choose **Report a vulnerability**. Include the steps to reproduce, the affected version, and the impact you see.

You'll get an acknowledgement as soon as possible. Fixes are released with a note in the [changelog](CHANGELOG.md).
