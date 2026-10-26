import { describe, expect, it } from "vitest";
import type { DownloadView, TorrentState } from "./api";
import { checkLink, counts, groups, selectionCounts, structureKey, toItem, visible } from "./model";
import { driveOf, fmtDur, fmtPair, fmtSize, fmtSpeed, esc, hostOf, when } from "./format";

const NOW = new Date(2026, 9, 26, 14, 30).getTime();
const HOUR = 3_600_000;

function view(over: Partial<DownloadView>): DownloadView {
  return {
    id: "x",
    kind: "direct",
    uploadSpeed: null,
    torrent: null,
    displayUrl: "https://example.com/a.zip",
    hiddenParams: 0,
    host: "example.com",
    fileName: "a.zip",
    destDir: "D:\\Downloads",
    status: "downloading",
    phase: "transferring",
    totalSize: 100,
    downloaded: 10,
    speed: 5,
    etaSecs: 18,
    resumable: true,
    canPause: true,
    connections: 1,
    queuePosition: null,
    retryInSecs: null,
    retryAttempt: null,
    retryLimit: 5,
    error: null,
    createdAt: NOW - HOUR,
    completedAt: null,
    ...over,
  };
}

describe("toItem", () => {
  it("maps retrying, cancelled and failure reasons", () => {
    expect(toItem(view({ phase: "retrying", retryAttempt: 2 })).status).toBe("retrying");
    expect(toItem(view({ status: "canceled", phase: null })).status).toBe("cancelled");
    const f = toItem(view({ status: "failed", phase: null, error: { kind: "diskFull", message: "m" } }));
    expect(f.reason).toBe("Disk full");
    expect(toItem(view({ status: "failed", error: { kind: "cannotResume", message: "" } })).reason).toBe("Can’t resume");
  });

  it("knows when nothing has arrived yet", () => {
    expect(toItem(view({ downloaded: 0, phase: "connecting" })).connecting).toBe(true);
    expect(toItem(view({ downloaded: 5 })).connecting).toBe(false);
  });
});

function torrent(id: string, state: TorrentState, over: Partial<DownloadView> = {}): DownloadView {
  return view({
    id,
    kind: "torrent",
    host: "3 files",
    phase: null,
    uploadSpeed: state === "seeding" ? 1000 : null,
    torrent: {
      state, peersConnected: 4, peersKnown: 20, uploaded: 50, ratio: 0.5,
      fileCount: 3, selectedCount: 2, seedLimitReached: false, infoHash: "abc",
    },
    ...over,
  });
}

describe("torrents", () => {
  it("maps every torrent state", () => {
    const map: Record<TorrentState, string> = {
      fetching: "fetching", queued: "queued", checking: "checking", connecting: "connecting",
      downloading: "downloading", stalled: "stalled", paused: "paused", seeding: "seeding",
      stopped: "stopped", error: "failed",
    };
    for (const [state, ui] of Object.entries(map)) expect(toItem(torrent("t", state as TorrentState)).status).toBe(ui);
    const t = toItem(torrent("t", "seeding"));
    expect(t.kind).toBe("torrent");
    expect(t.up).toBe(1000);
    expect([t.peers, t.peersKnown, t.selectedCount, t.fileCount]).toEqual([4, 20, 2, 3]);
  });

  it("puts torrents in the right lists", () => {
    const items = [
      torrent("seed", "seeding", { completedAt: NOW - HOUR }),
      torrent("stop", "stopped", { completedAt: NOW - HOUR }),
      torrent("stall", "stalled"),
      torrent("fetch", "fetching"),
      torrent("q", "queued", { queuePosition: 1 }),
      view({ id: "d" }),
    ].map(toItem);
    const c = counts(items);
    expect(c.seeding).toBe(1);
    expect(c.completed).toBe(2);
    expect(c.active).toBe(3);
    expect(c.queued).toBe(1);
    const g = groups(visible(items, "all", ""), "all", "", NOW);
    expect(g.map((x) => x.key)).toEqual(["progress", "seeding", "today"]);
    expect(g[0].items.map((d) => d.id)).toEqual(["d", "stall", "fetch", "q"]);
    expect(g[2].items.map((d) => d.id)).toEqual(["stop"]);
    // Direct downloads come before torrents in the queue view.
    const q = visible([toItem(torrent("tq", "queued", { queuePosition: 1 })), toItem(view({ id: "dq", status: "queued", phase: null, queuePosition: 2 }))], "queued", "");
    expect(q.map((d) => d.id)).toEqual(["dq", "tq"]);
  });

  it("selection actions account for torrents", () => {
    const items = [torrent("a", "stalled"), torrent("b", "seeding"), torrent("c", "queued")].map(toItem);
    const n = selectionCounts(items);
    expect(n.pause).toBe(1);
    expect(n.resume).toBe(1);
    expect(n.toTop).toBe(0);
  });
});

describe("lists", () => {
  const items = [
    view({ id: "dl" }),
    view({ id: "q2", status: "queued", phase: null, queuePosition: 2 }),
    view({ id: "q1", status: "queued", phase: null, queuePosition: 1 }),
    view({ id: "p", status: "paused", phase: null }),
    view({ id: "f", status: "failed", phase: null, error: { kind: "network", message: "" } }),
    view({ id: "c-today", status: "completed", phase: null, completedAt: NOW - HOUR }),
    view({ id: "c-old", status: "completed", phase: null, completedAt: NOW - 72 * HOUR }),
    view({ id: "x", status: "canceled", phase: null, createdAt: NOW - 30 * HOUR, fileName: "other.iso", host: "mirror.org" }),
  ].map(toItem);

  it("counts every list", () => {
    expect(counts(items)).toEqual({ all: 8, active: 2, queued: 2, seeding: 0, completed: 2, failed: 1 });
  });

  it("orders the queue and the in-progress group", () => {
    expect(visible(items, "queued", "").map((d) => d.id)).toEqual(["q1", "q2"]);
    const g = groups(visible(items, "all", ""), "all", "", NOW);
    expect(g.map((x) => x.key)).toEqual(["progress", "failed", "today", "yesterday", "earlier"]);
    expect(g[0].items.map((d) => d.id)).toEqual(["dl", "p", "q1", "q2"]);
    expect(g.find((x) => x.key === "yesterday")!.items.map((d) => d.id)).toEqual(["x"]);
  });

  it("searches names and hosts and drops grouping", () => {
    const found = visible(items, "all", "MIRROR");
    expect(found.map((d) => d.id)).toEqual(["x"]);
    expect(groups(found, "all", "mirror")).toHaveLength(1);
  });

  it("counts selection actions", () => {
    const c = selectionCounts(items);
    expect(c).toEqual({ pause: 1, resume: 3, retry: 1, toTop: 2 });
    const noResume = toItem(view({ status: "failed", error: { kind: "cannotResume", message: "" } }));
    expect(selectionCounts([noResume]).retry).toBe(0);
  });

  it("structure key ignores pure progress", () => {
    const a = structureKey([toItem(view({ downloaded: 10 }))], false);
    expect(structureKey([toItem(view({ downloaded: 50, speed: 9 }))], false)).toBe(a);
    expect(structureKey([toItem(view({ status: "paused", phase: null }))], false)).not.toBe(a);
    expect(structureKey([toItem(view({ downloaded: 10 }))], true)).not.toBe(a);
  });
});

describe("links", () => {
  it("classifies typed links", () => {
    expect(checkLink("")).toBe("empty");
    expect(checkLink("htt")).toBe("typing");
    expect(checkLink("https://")).toBe("typing");
    expect(checkLink("https://example.com/f.zip")).toBe("ok");
    expect(checkLink("magnet:?xt=urn:btih:abc")).toBe("magnet");
    expect(checkLink("magnet:?dn=nothing")).toBe("invalid");
    expect(checkLink("magn")).toBe("typing");
    expect(checkLink("https://x.org/a.torrent")).toBe("ok");
    expect(checkLink("ftp://x.org/a")).toBe("invalid");
    expect(checkLink("just words")).toBe("invalid");
  });
});

describe("format", () => {
  it("formats sizes, pairs, speeds and durations", () => {
    expect(fmtSize(1.6 * 1024 * 1024)).toBe("1.6 MB");
    expect(fmtSize(5.91 * 1024 ** 3)).toBe("5.91 GB");
    expect(fmtPair(3.68 * 1024 ** 3, 5.91 * 1024 ** 3)).toBe("3.68 / 5.91 GB");
    expect(fmtPair(152 * 1024 ** 2, 1.2 * 1024 ** 3)).toBe("152 MB / 1.20 GB");
    expect(fmtPair(10, null)).toContain("unknown");
    expect(fmtSpeed(8.4 * 1024 * 1024)).toBe("8.4 MB/s");
    expect(fmtDur(42)).toBe("42 s");
    expect(fmtDur(125, true)).toBe("2 min 5 s");
    expect(fmtDur(3 * 3600 + 120)).toBe("3 h 2 min");
  });

  it("escapes markup in remote names", () => {
    expect(esc('<img src=x onerror="a">')).toBe("&lt;img src=x onerror=&quot;a&quot;&gt;");
  });

  it("formats times, drives and hosts", () => {
    expect(when(NOW - HOUR, NOW)).toBe("13:30");
    expect(when(NOW - 24 * HOUR, NOW)).toBe("Yesterday 14:30");
    expect(driveOf("d:\\Downloads")).toBe("D:");
    expect(driveOf("/home/me/Downloads")).toBe("Downloads");
    expect(hostOf("https://user:pw@files.example.com:8443/a")).toBe("files.example.com");
  });
});
