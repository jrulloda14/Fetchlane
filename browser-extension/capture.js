// Deciding whether to hand a browser download to Fetchlane, and doing it.
// Kept free of `chrome.*` calls at import time so it can be tested.
import { hostOf, isSkipped } from "./shared.js";

/** Whether a newly created browser download should go to Fetchlane. */
export function shouldCapture(item, settings, selfId) {
  const url = item.finalUrl || item.url;
  // blob:, data: and file: downloads only exist inside the browser.
  if (!/^https?:\/\//i.test(url) || item.state !== "in_progress") return false;
  if (item.byExtensionId === selfId) return false;
  if (!settings.catchDownloads) return false;
  if (isSkipped(hostOf(item.referrer || url), settings.skipHosts) || isSkipped(hostOf(url), settings.skipHosts)) return false;
  const size = item.totalBytes > 0 ? item.totalBytes : item.fileSize;
  if (settings.minSizeMb > 0 && size > 0 && size < settings.minSizeMb * 1024 * 1024) return false;
  return true;
}

/**
 * Stop the browser's copy and hand only its link to Fetchlane.
 *
 * The browser's copy is cancelled first so its placeholder file doesn't clash
 * with the name Fetchlane picks. Only the link travels: cookies, form data and
 * one-time tokens of the original request don't. If Fetchlane can't be
 * reached, the browser starts the link again, which may not work for links
 * that only worked once.
 *
 * `api` provides cancel(id), erase(id), wait(ms), handOver(url) and
 * redownload(url). Returns "handed-over" or "given-back".
 */
export async function captureDownload(item, api) {
  const url = item.finalUrl || item.url;
  await api.cancel(item.id).catch(() => {});
  await api.erase(item.id).catch(() => {});
  // The browser removes its empty placeholder file just after cancelling.
  await api.wait(500);
  try {
    await api.handOver(url);
    return "handed-over";
  } catch {
    await api.redownload(url).catch(() => {});
    return "given-back";
  }
}
