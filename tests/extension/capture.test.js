// Tests for the browser extension's capture logic (browser-extension/).
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureDownload, shouldCapture } from "../../browser-extension/capture.js";
import { DEFAULTS, getSettings } from "../../browser-extension/shared.js";

/** chrome.storage.local.get(defaults) as Chrome implements it: saved values win. */
function fakeStorage(saved) {
  globalThis.chrome = {
    storage: { local: { get: async (defaults) => ({ ...defaults, ...saved }) } },
  };
}

afterEach(() => {
  delete globalThis.chrome;
});

const item = (over = {}) => ({
  id: 7,
  url: "https://example.com/file.zip",
  finalUrl: "https://example.com/file.zip",
  state: "in_progress",
  referrer: "https://example.com/page",
  totalBytes: 50 * 1024 * 1024,
  fileSize: 0,
  byExtensionId: undefined,
  ...over,
});

const on = { ...DEFAULTS, catchDownloads: true };

describe("settings", () => {
  it("catching downloads is off for new users", async () => {
    expect(DEFAULTS.catchDownloads).toBe(false);
    fakeStorage({});
    const s = await getSettings();
    expect(s.catchDownloads).toBe(false);
    expect(shouldCapture(item(), s, "self")).toBe(false);
  });

  it("keeps a saved choice", async () => {
    fakeStorage({ catchDownloads: true, minSizeMb: 5, skipHosts: ["intranet.example"] });
    const s = await getSettings();
    expect(s).toEqual({ catchDownloads: true, minSizeMb: 5, skipHosts: ["intranet.example"] });
    expect(shouldCapture(item(), s, "self")).toBe(true);
    fakeStorage({ catchDownloads: false });
    expect((await getSettings()).catchDownloads).toBe(false);
  });
});

describe("shouldCapture", () => {
  it("only takes http(s) downloads in progress that the extension didn't start", () => {
    expect(shouldCapture(item(), on, "self")).toBe(true);
    expect(shouldCapture(item({ url: "blob:https://x/1", finalUrl: "" }), on, "self")).toBe(false);
    expect(shouldCapture(item({ finalUrl: "data:text/plain,hi" }), on, "self")).toBe(false);
    expect(shouldCapture(item({ state: "complete" }), on, "self")).toBe(false);
    expect(shouldCapture(item({ byExtensionId: "self" }), on, "self")).toBe(false);
  });

  it("respects skipped sites and the minimum size", () => {
    expect(shouldCapture(item(), { ...on, skipHosts: ["example.com"] }, "self")).toBe(false);
    expect(shouldCapture(item({ referrer: "https://cdn.other.org/" }), { ...on, skipHosts: ["example.com"] }, "self")).toBe(false);
    expect(shouldCapture(item({ totalBytes: 1024 }), { ...on, minSizeMb: 1 }, "self")).toBe(false);
    // Unknown size is still caught.
    expect(shouldCapture(item({ totalBytes: 0, fileSize: 0 }), { ...on, minSizeMb: 1 }, "self")).toBe(true);
  });
});

function api(handOver) {
  const calls = [];
  return {
    calls,
    cancel: vi.fn(async (id) => calls.push(["cancel", id])),
    erase: vi.fn(async (id) => calls.push(["erase", id])),
    wait: vi.fn(async () => calls.push(["wait"])),
    handOver: vi.fn(async (url) => {
      calls.push(["handOver", url]);
      return handOver(url);
    }),
    redownload: vi.fn(async (url) => calls.push(["redownload", url])),
  };
}

describe("captureDownload", () => {
  it("stops the browser's copy, then hands the link to Fetchlane", async () => {
    const a = api(async () => {});
    expect(await captureDownload(item(), a)).toBe("handed-over");
    expect(a.calls.map((c) => c[0])).toEqual(["cancel", "erase", "wait", "handOver"]);
    expect(a.redownload).not.toHaveBeenCalled();
  });

  it("gives the link back to the browser when Fetchlane can't be reached", async () => {
    const a = api(async () => {
      throw new Error("Fetchlane isn’t installed");
    });
    expect(await captureDownload(item({ finalUrl: "https://mirror.example/f.zip" }), a)).toBe("given-back");
    expect(a.redownload).toHaveBeenCalledWith("https://mirror.example/f.zip");
  });

  it("still reports given-back if the browser refuses to start it again", async () => {
    const a = api(async () => {
      throw new Error("no host");
    });
    a.redownload.mockRejectedValueOnce(new Error("blocked"));
    expect(await captureDownload(item(), a)).toBe("given-back");
  });

  it("continues when the browser's copy was already gone", async () => {
    const a = api(async () => {});
    a.cancel.mockRejectedValueOnce(new Error("already complete"));
    a.erase.mockRejectedValueOnce(new Error("not found"));
    expect(await captureDownload(item(), a)).toBe("handed-over");
  });
});
