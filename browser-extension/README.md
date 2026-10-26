# Fetchlane browser extension

Sends downloads and links from Chrome, Edge, Brave and other Chromium browsers
to the Fetchlane app. Fetchlane opens **Add download** with the link filled in,
so you still choose the folder and confirm.

- **Catch browser downloads** (off by default): a download you start in the
  browser is stopped and its link handed to Fetchlane. Only the link goes:
  cookies, sign-in, form data and one-time tokens don't, so such downloads can
  fail in Fetchlane. If you cancel Add download in Fetchlane, nothing is
  downloaded. If Fetchlane can't be reached, the browser is asked to download
  the link again, which may fail for links that only work once.
- Per-site switch, for sites whose downloads need your browser sign-in
  (Fetchlane doesn't get the browser's cookies).
- **Skip small files**: leave files under a size to the browser.
- **Download with Fetchlane** on the right-click menu for links (including
  magnet links), videos, audio and images.

## Install

1. Install and start Fetchlane once. It registers its native messaging host
   (`dev.fetchlane.host`) for the current user.
2. Open `chrome://extensions` (or `edge://extensions`), turn on **Developer
   mode**, choose **Load unpacked** and select this folder. In the installed
   app, Settings › Browser › **Show extension folder** opens it.

The extension ID is fixed by the `key` in `manifest.json`
(`loeipedomkbakhnhoannlanfnfnimdni`); the native host only accepts that ID.

## How it talks to Fetchlane

The extension calls `chrome.runtime.sendNativeMessage("dev.fetchlane.host", …)`.
The browser starts `fetchlane.exe` as the host, which answers `{"type":"ping"}`
and, for `{"type":"add","url":…}`, launches `fetchlane.exe --add <url>`. A
running Fetchlane receives the link (single instance) and shows Add download.
Only http, https and magnet links are accepted.
