# Installing Fetchlane

Download the latest installer from the **[Releases page](https://github.com/jrulloda14/Fetchlane/releases/latest)**. Each release lists SHA-256 checksums in `SHA256SUMS.txt` so you can confirm your download is intact. You can also [build the installer yourself](BUILD_AND_RELEASE.md).

Fetchlane isn't code-signed yet, so Windows warns that the app comes from an unidentified developer the first time you open it. The steps below use the standard, built-in way to allow it. You never need to turn off a security feature.

## Windows 10 and 11

1. Download `Fetchlane_<version>_x64-setup.exe`.
2. Open it. If **"Windows protected your PC"** appears, click **More info**, then **Run anyway**.
3. The installer sets Fetchlane up for your user account; no administrator rights are needed. It may download Microsoft's WebView2 runtime if your PC doesn't have it, which Windows 11 and up-to-date Windows 10 already include.
4. Open **Fetchlane** from the Start menu.

The first time a torrent starts, Windows Firewall may ask whether Fetchlane can accept incoming connections. Allowing it on private networks helps torrents find more peers. Torrents still work if you decline.

**Updating:** download the newer installer and run it. Your download list, torrents and settings live in your user profile, which the installer doesn't touch. (Upgrading from one release to the next hasn't been tested yet, since 0.1.0 is the first.)

**Uninstalling:** go to **Settings → Apps → Installed apps**, find **Fetchlane** and choose **Uninstall**. Downloaded files are never touched. The uninstaller is set up to remove Fetchlane's registry entries (browser extension host, notification identity, Open with, and the magnet link handler if you turned it on); this hasn't been verified on a clean machine yet, see [project status](PROJECT_STATUS.md#not-yet-verified). Your list and settings stay in `%APPDATA%\dev.fetchlane.desktop` in case you reinstall; delete that folder, and `%LOCALAPPDATA%\dev.fetchlane.desktop`, if you want them gone too.

## Browser extension (Chrome, Edge, Brave)

The extension adds **Download with Fetchlane** to the right-click menu for links (including magnet links) and media. Fetchlane opens **Add download** with the link filled in, so you still choose the folder and confirm.

It can also catch downloads you start in the browser. That's **off by default**: when you turn it on in the popup, the browser stops its own download and hands only the link to Fetchlane. Your sign-in, form data and one-time links don't go with it, so some downloads can fail in Fetchlane, and if you choose **Cancel** in Add download, nothing is downloaded.

1. Install Fetchlane and open it once. It registers itself for the extension.
2. In Fetchlane, open **Settings → Browser** and click **Show extension folder**.
3. In your browser, open `chrome://extensions` (Chrome, Brave) or `edge://extensions` (Edge).
4. Turn on **Developer mode**, click **Load unpacked** and select the folder from step 2.
5. Pin **Fetchlane** to the toolbar. Its popup shows **Connected** when everything is set up, and has the **Catch browser downloads** switch.

To stop using it, remove the extension from the browser's extensions page. To keep only the right-click menu, leave **Catch browser downloads** off.

If the popup says **Not connected**, open Fetchlane once (it refreshes its registration every time it starts) and then reopen the popup.

## Magnet links and .torrent files

- **Magnet links:** turn on **Settings → Browser → Open magnet links with Fetchlane**. Your browser may ask once before opening Fetchlane. If you picked another app for magnet links in Windows settings, Windows keeps using it; choose Fetchlane under **Settings → Apps → Default apps** instead.
- **.torrent files:** Fetchlane is added to **Open with** for .torrent files without taking over your default app. You can also drop a .torrent file on the Fetchlane window.

## Privacy

Fetchlane has no account, telemetry, analytics or update checks. It only connects to the servers of the downloads you add and, for torrents, to BitTorrent trackers, the DHT network and peers. The browser extension only talks to the Fetchlane app on your computer.

## Build it yourself

See [Build from source](../README.md#build-from-source) in the README and [BUILD_AND_RELEASE.md](BUILD_AND_RELEASE.md) for packaging details.
