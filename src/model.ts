// Maps backend download views onto the design system's states, lists and
// groups, for direct downloads and torrents alike. Pure functions,
// unit-tested in model.test.ts.
import type { DownloadKind, DownloadView, ErrorKind, TorrentState } from "./api";
import { dayOf, type Day } from "./format";

export type UiStatus =
  | "downloading" | "retrying" | "queued" | "paused" | "failed" | "completed" | "cancelled"
  // torrent-only states
  | "fetching" | "checking" | "connecting" | "stalled" | "seeding" | "stopped";

export interface Item {
  id: string;
  kind: DownloadKind;
  name: string;
  host: string;
  displayUrl: string;
  hiddenParams: number;
  https: boolean;
  folder: string;
  status: UiStatus;
  /** Direct download that hasn't received any bytes yet. */
  connecting: boolean;
  done: number;
  total: number | null;
  speed: number | null;
  /** Upload speed (torrents). */
  up: number | null;
  eta: number | null;
  resumable: boolean;
  canPause: boolean;
  pos: number | null;
  retryIn: number | null;
  attempt: number | null;
  maxAttempts: number;
  errorKind: ErrorKind | null;
  errorMessage: string;
  /** Short failure reason for the status label, e.g. "Disk full". */
  reason: string | null;
  createdAt: number;
  completedAt: number | null;
  // torrents
  peers: number;
  peersKnown: number;
  uploaded: number;
  ratio: number;
  fileCount: number;
  selectedCount: number;
  seedLimit: boolean;
}

const REASONS: Record<ErrorKind, string> = {
  diskFull: "Disk full",
  cannotResume: "Can’t resume",
  network: "Connection lost",
  timeout: "Connection lost",
  notFound: "File not found",
  accessDenied: "Access denied",
  destination: "Folder unavailable",
  permission: "Can’t write to folder",
  tls: "Secure connection failed",
  redirect: "Redirect problem",
  server: "Server error",
  http: "Server error",
  fileSystem: "File error",
  resourceChanged: "File kept changing",
  rangeMismatch: "Server error",
  invalidInput: "Invalid link",
  internal: "Unexpected error",
};

const TORRENT_STATUS: Record<TorrentState, UiStatus> = {
  fetching: "fetching",
  queued: "queued",
  checking: "checking",
  connecting: "connecting",
  downloading: "downloading",
  stalled: "stalled",
  paused: "paused",
  seeding: "seeding",
  stopped: "stopped",
  error: "failed",
};

export function toItem(v: DownloadView): Item {
  const t = v.torrent;
  let status: UiStatus;
  if (t) status = TORRENT_STATUS[t.state];
  else if (v.status === "downloading") status = v.phase === "retrying" ? "retrying" : "downloading";
  else if (v.status === "canceled") status = "cancelled";
  else status = v.status;
  let reason = v.error ? REASONS[v.error.kind] ?? "Error" : null;
  if (t && v.error?.kind === "internal") reason = "Torrent error";
  return {
    id: v.id,
    kind: v.kind,
    name: v.fileName,
    host: v.host,
    displayUrl: v.displayUrl,
    hiddenParams: v.hiddenParams,
    https: v.displayUrl.startsWith("https:"),
    folder: v.destDir,
    status,
    connecting: !t && status === "downloading" && v.downloaded === 0 && (v.phase === "connecting" || v.phase == null),
    done: v.downloaded,
    total: v.totalSize,
    speed: v.speed,
    up: v.uploadSpeed,
    eta: v.etaSecs,
    resumable: v.resumable,
    canPause: v.canPause,
    pos: v.queuePosition,
    retryIn: v.retryInSecs,
    attempt: v.retryAttempt,
    maxAttempts: v.retryLimit,
    errorKind: v.error?.kind ?? null,
    errorMessage: v.error?.message ?? "",
    reason,
    createdAt: v.createdAt,
    completedAt: v.completedAt,
    peers: t?.peersConnected ?? 0,
    peersKnown: t?.peersKnown ?? 0,
    uploaded: t?.uploaded ?? 0,
    ratio: t?.ratio ?? 0,
    fileCount: t?.fileCount ?? 1,
    selectedCount: t?.selectedCount ?? 1,
    seedLimit: t?.seedLimitReached ?? false,
  };
}

export type ViewId = "all" | "active" | "queued" | "seeding" | "completed" | "failed";

export const VIEWS: { id: ViewId; label: string; icon: string; title?: string }[] = [
  { id: "all", label: "All downloads", icon: "all" },
  { id: "active", label: "Active", icon: "active" },
  { id: "queued", label: "Queued", icon: "queue" },
  { id: "seeding", label: "Seeding", icon: "arrowUp", title: "Torrents uploading to other people" },
  { id: "completed", label: "Completed", icon: "done" },
  { id: "failed", label: "Failed", icon: "failed" },
];

/** Downloading or about to: shown under "In progress" and "Active". */
const ACTIVE: UiStatus[] = ["downloading", "retrying", "paused", "fetching", "checking", "connecting", "stalled"];

export function inView(d: Item, v: ViewId): boolean {
  switch (v) {
    case "all":
      return true;
    case "active":
      return ACTIVE.includes(d.status);
    case "completed":
      return d.status === "completed" || d.status === "seeding" || d.status === "stopped";
    default:
      return d.status === v;
  }
}

export function counts(items: Item[]): Record<ViewId, number> {
  const c = { all: items.length } as Record<ViewId, number>;
  for (const v of VIEWS) if (v.id !== "all") c[v.id] = items.filter((d) => inView(d, v.id)).length;
  return c;
}

export function matches(d: Item, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || (d.name + " " + d.host).toLowerCase().includes(q);
}

/** Items shown in a list, in display order. */
export function visible(items: Item[], view: ViewId, query: string): Item[] {
  const list = items.filter((d) => inView(d, view) && matches(d, query));
  if (view === "queued") list.sort((a, b) => kindRank(a) - kindRank(b) || (a.pos ?? 0) - (b.pos ?? 0));
  else if (view === "completed" || view === "seeding") list.sort((a, b) => finishedAt(b) - finishedAt(a));
  else list.sort(byListOrder);
  return list;
}

function kindRank(d: Item): number {
  return d.kind === "direct" ? 0 : 1;
}

const IN_PROGRESS_ORDER: Partial<Record<UiStatus, number>> = {
  downloading: 0, connecting: 0, retrying: 1, stalled: 1, checking: 1, fetching: 1, paused: 2, queued: 3,
};

function byListOrder(a: Item, b: Item): number {
  const ra = IN_PROGRESS_ORDER[a.status];
  const rb = IN_PROGRESS_ORDER[b.status];
  if (ra != null && rb != null)
    return ra - rb || kindRank(a) - kindRank(b) || (a.pos ?? 0) - (b.pos ?? 0) || b.createdAt - a.createdAt;
  return finishedAt(b) - finishedAt(a);
}

/** When a finished entry ended (cancelled entries use when they were added). */
export function finishedAt(d: Item): number {
  return d.completedAt ?? d.createdAt;
}

/** Complete or cancelled: grouped by day in "All downloads". */
export function isFinished(d: Item): boolean {
  return d.status === "completed" || d.status === "cancelled" || d.status === "seeding" || d.status === "stopped";
}

/** The download's data is complete (direct or torrent). */
export function isComplete(d: Item): boolean {
  return d.status === "completed" || d.status === "seeding" || d.status === "stopped";
}

export interface Group {
  key: string;
  label: string | null;
  items: Item[];
  collapsible?: boolean;
}

/** "All downloads" groups: In progress, Seeding, Failed, Today, Yesterday, Earlier. */
export function groups(list: Item[], view: ViewId, query: string, now = Date.now()): Group[] {
  if (view !== "all" || query.trim()) return [{ key: "flat", label: null, items: list }];
  const byDay = (day: Day) =>
    list.filter((d) => isFinished(d) && d.status !== "seeding" && dayOf(finishedAt(d), now) === day);
  return [
    { key: "progress", label: "In progress", items: list.filter((d) => !isFinished(d) && d.status !== "failed") },
    { key: "seeding", label: "Seeding", items: list.filter((d) => d.status === "seeding") },
    { key: "failed", label: "Failed", items: list.filter((d) => d.status === "failed") },
    { key: "today", label: "Today", items: byDay("today") },
    { key: "yesterday", label: "Yesterday", items: byDay("yesterday") },
    { key: "earlier", label: "Earlier", items: byDay("earlier"), collapsible: true },
  ].filter((g) => g.items.length > 0);
}

/**
 * Everything that changes the markup of a row (as opposed to numbers that
 * are patched in place). When this is unchanged, the list isn't re-rendered.
 */
export function structureKey(items: Item[], queueHeld: boolean): string {
  return (
    (queueHeld ? "H|" : "|") +
    items
      .map((d) =>
        [d.id, d.status, d.connecting ? 1 : 0, d.pos ?? "", d.name, d.canPause ? 1 : 0, d.resumable ? 1 : 0,
          d.errorKind ?? "", d.total == null ? "?" : "#", d.attempt ?? "", d.completedAt ?? "",
          d.speed == null ? "s" : "", d.eta == null ? "e" : "", d.up == null ? "u" : "", d.selectedCount,
          d.seedLimit ? 1 : 0].join(","),
      )
      .join(";")
  );
}

const PAUSABLE: UiStatus[] = ["downloading", "retrying", "fetching", "checking", "connecting", "stalled"];

/** What a set of selected downloads can do, for the selection toolbar. */
export function selectionCounts(sel: Item[]) {
  return {
    pause: sel.filter((d) => PAUSABLE.includes(d.status) && (d.canPause || d.status === "retrying")).length,
    resume: sel.filter((d) => d.status === "paused" || d.status === "queued").length,
    retry: sel.filter((d) => d.status === "failed" && d.errorKind !== "cannotResume").length,
    toTop: sel.filter((d) => d.status === "queued" && d.kind === "direct").length,
  };
}

/** Classify typed input before asking a server about it. */
export type LinkCheck = "empty" | "typing" | "magnet" | "invalid" | "ok";

export function checkLink(raw: string): LinkCheck {
  const u = raw.trim();
  if (!u) return "empty";
  if (/^magnet:\?/i.test(u)) return /xt=urn:bt(ih|mh):/i.test(u) ? "magnet" : "invalid";
  if (/^m(a(g(n(e(t(:)?)?)?)?)?)?$/i.test(u)) return "typing";
  if (/^https?:\/\/[^\s/?#]+[^\s]*$/i.test(u)) {
    try {
      const url = new URL(u);
      return url.hostname ? "ok" : "invalid";
    } catch {
      return "invalid";
    }
  }
  if (/^h(t(t(p(s?(:(\/(\/)?)?)?)?)?)?)?$/i.test(u)) return "typing";
  return "invalid";
}

/** "1.6" style ratio. */
export function fmtRatio(r: number): string {
  return r >= 10 ? r.toFixed(0) : r.toFixed(2);
}
