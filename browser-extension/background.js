// Fetchlane extension: hands browser downloads and links to the Fetchlane
// app through its native messaging host. Fetchlane then shows Add download,
// prefilled, so the person still chooses the folder and confirms.
import { getSettings, hostOf, isSkipped, isSupported, sendToApp } from "./shared.js";

const MENU_LINK = "fetchlane-link";
const MENU_MEDIA = "fetchlane-media";
/** Links given back to the browser because Fetchlane couldn't take them. */
const givenBack = new Set();

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_LINK, title: "Download with Fetchlane", contexts: ["link"] });
    chrome.contextMenus.create({ id: MENU_MEDIA, title: "Download with Fetchlane", contexts: ["video", "audio", "image"] });
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  const url = info.menuItemId === MENU_MEDIA ? info.srcUrl : info.linkUrl;
  if (!isSupported(url)) return showProblem("Fetchlane can only download http, https and magnet links.");
  handOver(url).catch(() => {});
});

chrome.downloads.onCreated.addListener(async (item) => {
  const url = item.finalUrl || item.url;
  // blob:, data: and file: downloads only exist inside the browser.
  if (!/^https?:\/\//i.test(url) || item.state !== "in_progress") return;
  if (item.byExtensionId === chrome.runtime.id) return;
  if (givenBack.delete(url) || givenBack.delete(item.url)) return;
  const s = await getSettings();
  if (!s.catchDownloads) return;
  if (isSkipped(hostOf(item.referrer || url), s.skipHosts) || isSkipped(hostOf(url), s.skipHosts)) return;
  const size = item.totalBytes > 0 ? item.totalBytes : item.fileSize;
  if (s.minSizeMb > 0 && size > 0 && size < s.minSizeMb * 1024 * 1024) return;

  // Stop the browser's copy first, so its placeholder file doesn't clash with
  // the name Fetchlane picks. If Fetchlane can't take the link, the browser
  // downloads it again, so nothing is lost.
  await chrome.downloads.cancel(item.id).catch(() => {});
  await chrome.downloads.erase({ id: item.id }).catch(() => {});
  // The browser removes its empty placeholder file just after cancelling.
  await new Promise((r) => setTimeout(r, 500));
  try {
    await handOver(url);
  } catch {
    givenBack.add(url);
    await chrome.downloads.download({ url }).catch(() => givenBack.delete(url));
  }
});

async function handOver(url) {
  try {
    await sendToApp({ type: "add", url });
    await chrome.storage.session.set({ lastProblem: null });
    flashBadge("✓", "#0d7f75");
  } catch (e) {
    await showProblem(e.message);
    throw e;
  }
}

async function showProblem(message) {
  await chrome.storage.session.set({ lastProblem: { message, at: Date.now() } });
  await chrome.action.setBadgeBackgroundColor({ color: "#b3262f" });
  await chrome.action.setBadgeText({ text: "!" });
  await chrome.action.setTitle({ title: `Fetchlane: ${message}` });
}

function flashBadge(text, color) {
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
  chrome.action.setTitle({ title: "Fetchlane" });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 2500);
}
