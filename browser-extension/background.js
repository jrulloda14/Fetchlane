// Fetchlane extension: hands browser downloads and links to the Fetchlane
// app through its native messaging host. Fetchlane then shows Add download,
// prefilled, so the person still chooses the folder and confirms.
import { captureDownload, shouldCapture } from "./capture.js";
import { getSettings, isSupported, sendToApp } from "./shared.js";

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

// Right-click "Download with Fetchlane" works whether or not catching
// downloads is on; the browser never started a download of its own.
chrome.contextMenus.onClicked.addListener((info) => {
  const url = info.menuItemId === MENU_MEDIA ? info.srcUrl : info.linkUrl;
  if (!isSupported(url)) return showProblem("Fetchlane can only download http, https and magnet links.");
  handOver(url).catch(() => {});
});

chrome.downloads.onCreated.addListener(async (item) => {
  if (givenBack.delete(item.finalUrl || item.url) || givenBack.delete(item.url)) return;
  if (!shouldCapture(item, await getSettings(), chrome.runtime.id)) return;
  await captureDownload(item, {
    cancel: (id) => chrome.downloads.cancel(id),
    erase: (id) => chrome.downloads.erase({ id }),
    wait: (ms) => new Promise((r) => setTimeout(r, ms)),
    handOver,
    redownload: (url) => {
      givenBack.add(url);
      return chrome.downloads.download({ url }).catch((e) => {
        givenBack.delete(url);
        throw e;
      });
    },
  });
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
