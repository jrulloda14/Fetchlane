// Shared by the background worker and the popup.

/** Native messaging host registered by the Fetchlane app. */
export const HOST = "dev.fetchlane.host";

export const DEFAULTS = {
  /** Hand downloads started in the browser to Fetchlane. */
  catchDownloads: true,
  /** Leave files smaller than this (MB) to the browser; 0 catches everything. */
  minSizeMb: 0,
  /** Sites whose downloads stay in the browser (host names). */
  skipHosts: [],
};

export async function getSettings() {
  return { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) };
}

/** Whether Fetchlane can take this link. */
export function isSupported(url) {
  return typeof url === "string" && url.length <= 16 * 1024 && /^(https?:\/\/|magnet:\?)/i.test(url);
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** A host is skipped when it, or a parent domain, is in the list. */
export function isSkipped(host, skipHosts) {
  return !!host && skipHosts.some((h) => host === h || host.endsWith("." + h));
}

/** Send a message to the Fetchlane app. Rejects with a readable message. */
export async function sendToApp(message) {
  let reply;
  try {
    reply = await chrome.runtime.sendNativeMessage(HOST, message);
  } catch {
    throw new Error("Fetchlane isn’t installed, or it hasn’t been started since it was installed.");
  }
  if (!reply?.ok) throw new Error(reply?.error || "Fetchlane didn’t accept the link.");
  return reply;
}
