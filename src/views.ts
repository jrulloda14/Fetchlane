// HTML builders for every component. Markup and classes follow the design
// system's class contract (assets/fetchlane/design-system/components/bundle.css).
// Every value that comes from a server or the user goes through esc().
import type { DeleteScope, Settings, TorrentDetails, TorrentPreview } from "./api";
import {
  driveOf, esc, fmtDur, fmtPair, fmtSize, fmtSpeed, hostOf, pct, plural, when, whenLong,
} from "./format";
import { EMPTY_ART, fileIcon, icon, mark } from "./icons";
import { fmtRatio, type Group, isComplete, type Item, type UiStatus, type ViewId, VIEWS, selectionCounts } from "./model";

/* ---------------- status + progress ---------------- */

const ST: Record<UiStatus, { label: string; icon: string }> = {
  downloading: { label: "Downloading", icon: "down" },
  queued: { label: "Queued", icon: "clock" },
  paused: { label: "Paused", icon: "pause" },
  retrying: { label: "Retrying", icon: "retry" },
  failed: { label: "Failed", icon: "alert" },
  completed: { label: "Completed", icon: "checkCircle" },
  cancelled: { label: "Cancelled", icon: "stop" },
  fetching: { label: "Fetching details", icon: "spinner" },
  checking: { label: "Checking files", icon: "search" },
  connecting: { label: "Connecting to peers", icon: "globe" },
  stalled: { label: "Stalled", icon: "warn" },
  seeding: { label: "Seeding", icon: "arrowUp" },
  stopped: { label: "Completed", icon: "checkCircle" },
};

const SEP = '<span class="fl-sep"> · </span>';

function statusText(d: Item): string {
  const torrent = d.kind === "torrent";
  switch (d.status) {
    case "downloading":
      if (d.connecting) return `<b>Downloading</b>${SEP}<span class="fl-detail">connecting…</span>`;
      return d.total == null ? `<b>Downloading</b>${SEP}<span class="fl-detail">size unknown</span>` : "<b>Downloading</b>";
    case "retrying":
      return (
        `<b>Retrying in <span class="fl-num" data-m="retry-${d.id}">${d.retryIn ?? 0}</span> s</b>` +
        (d.attempt ? `${SEP}<span class="fl-detail fl-num" title="Attempt ${d.attempt} of ${d.maxAttempts}">${d.attempt} of ${d.maxAttempts}</span>` : "")
      );
    case "queued":
      return torrent ? `<b>Queued</b>${SEP}<span class="fl-detail">waiting for a torrent slot</span>` : "<b>Queued</b>";
    case "paused":
      return "<b>Paused</b>";
    case "failed":
      return `<b>Failed</b>${SEP}<span>${esc(d.reason ?? "Error")}</span>`;
    case "completed":
      return "<b>Completed</b>" + (d.completedAt ? `${SEP}<span class="fl-detail fl-num">${when(d.completedAt)}</span>` : "");
    case "cancelled":
      return `<b>Cancelled</b>${SEP}<span class="fl-detail">partial file deleted</span>`;
    case "fetching":
      return "<b>Fetching details</b>";
    case "checking":
      return "<b>Checking files</b>";
    case "connecting":
      return "<b>Connecting to peers</b>";
    case "stalled":
      return `<b>Stalled</b>${SEP}<span class="fl-detail">waiting for peers</span>`;
    case "seeding":
      return `<b>Seeding</b>${SEP}<span class="fl-detail">complete</span>`;
    case "stopped":
      return (
        "<b>Completed</b>" +
        `${SEP}<span class="fl-detail">${d.seedLimit ? "seeding limit reached" : "not seeding"}</span>`
      );
  }
}

export function statusHTML(d: Item, extra = ""): string {
  const s = ST[d.status];
  return `<span class="fl-status fl-st-${d.status}">${icon(s.icon, 14)}<span>${statusText(d)}${extra}</span></span>`;
}

/** Bar style per state: paused keeps its position, stalled is dashed amber. */
const BAR_CLASS: Partial<Record<UiStatus, string>> = {
  downloading: "is-downloading",
  connecting: "is-downloading",
  checking: "is-downloading",
  retrying: "is-retrying",
  stalled: "is-retrying",
  paused: "is-paused",
  failed: "is-failed",
};

export function barHTML(d: Item, lg = false): string {
  if (isComplete(d) || d.status === "cancelled" || d.status === "queued") return "";
  const big = lg ? " fl-bar-lg" : "";
  if (d.status === "fetching")
    return `<div class="fl-bar fl-bar-ind${big}" role="progressbar" aria-label="Fetching torrent details"><i></i></div>`;
  const p = pct(d.done, d.total);
  if (p == null || (d.status === "downloading" && d.connecting && !d.total)) {
    if (d.status !== "downloading") return "";
    return `<div class="fl-bar fl-bar-ind${big}" role="progressbar" aria-label="Downloading, size unknown"><i></i></div>`;
  }
  const w = d.total ? ((d.done / d.total) * 100).toFixed(2) : "0";
  return (
    `<div class="fl-bar ${BAR_CLASS[d.status] ?? ""}${big}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p}">` +
    `<i data-m="bar-${d.id}" style="width:${w}%"></i></div>`
  );
}

const TRANSFERRING: UiStatus[] = ["downloading", "connecting", "stalled"];

function speedCell(d: Item): string {
  if (d.kind === "torrent") {
    const downLine = TRANSFERRING.includes(d.status)
      ? `<span class="fl-metric is-strong" title="Download speed"><span class="fl-dir" aria-hidden="true">${icon("arrowDown", 11)}</span><span data-m="speed-${d.id}">${d.speed == null ? "—" : fmtSpeed(d.speed)}</span></span>`
      : "";
    const upLine =
      d.up != null && (TRANSFERRING.includes(d.status) || d.status === "seeding")
        ? `<span class="fl-metric" title="Upload speed"><span class="fl-dir" aria-hidden="true">${icon("arrowUp", 11)}</span><span data-m="up-${d.id}">${fmtSpeed(d.up) || "0 KB/s"}</span></span>`
        : "";
    return downLine || upLine ? `<span class="fl-speeds">${downLine}${upLine}</span>` : "";
  }
  if (d.status === "downloading")
    return d.speed == null
      ? '<span class="fl-metric fl-na" title="Measuring speed">—</span>'
      : `<span class="fl-metric is-strong" data-m="speed-${d.id}">${fmtSpeed(d.speed)}</span>`;
  if (d.status === "retrying") return '<span class="fl-metric fl-na" title="Waiting to reconnect">—</span>';
  return "";
}

function etaCell(d: Item): string {
  if (d.status === "stalled") return '<span class="fl-metric fl-na" title="Waiting for peers" aria-label="Time left unavailable while waiting for peers">—</span>';
  if (d.status === "connecting" || d.status === "checking" || d.status === "fetching")
    return '<span class="fl-metric fl-na" aria-label="Time left not known yet">—</span>';
  if (d.status === "downloading") {
    if (d.total == null)
      return '<span class="fl-metric fl-na" title="Can’t estimate: the server didn’t report a file size" aria-label="Time left unavailable">—</span>';
    if (d.eta == null) return `<span class="fl-metric fl-na" data-m="eta-${d.id}" title="Measuring speed">—</span>`;
    return `<span class="fl-metric" data-m="eta-${d.id}">${fmtDur(d.eta)}</span>`;
  }
  if (d.status === "retrying") return '<span class="fl-metric fl-na" aria-label="Time left unavailable while reconnecting">—</span>';
  return "";
}

function sizeCell(d: Item): string {
  if (isComplete(d)) return `<span class="fl-metric">${fmtSize(d.total ?? d.done)}</span>`;
  if (d.status === "cancelled")
    return d.total == null ? "" : `<span class="fl-metric fl-na">${fmtSize(d.total)}</span>`;
  if (d.status === "fetching") return '<span class="fl-metric fl-na" title="Known once the details arrive">Unknown</span>';
  if (d.status === "queued" && d.done === 0)
    return d.total == null
      ? '<span class="fl-metric fl-na" title="Known when the download starts">Unknown</span>'
      : `<span class="fl-metric">${fmtSize(d.total)}</span>`;
  return `<span class="fl-metric" data-m="size-${d.id}">${fmtPair(d.done, d.total)}</span>`;
}

/** Speed and time left folded into the status cell on narrow windows. */
function inlineMetrics(d: Item): string {
  const parts: string[] = [];
  if ((d.status === "downloading" || d.status === "stalled") && d.speed != null) {
    parts.push(`${d.kind === "torrent" ? "↓ " : ""}<span data-m="speed-${d.id}">${fmtSpeed(d.speed)}</span>`);
    if (d.total != null && d.eta != null) parts.push(`<span data-m="eta-${d.id}">${fmtDur(d.eta)}</span> left`);
  }
  if (d.kind === "torrent" && d.up != null && (TRANSFERRING.includes(d.status) || d.status === "seeding"))
    parts.push(`↑ <span data-m="up-${d.id}">${fmtSpeed(d.up) || "0 KB/s"}</span>`);
  return parts.length ? `${SEP}<span class="fl-detail fl-num">${parts.join(" · ")}</span>` : "";
}

/* ---------------- row actions ---------------- */

interface Action {
  a: string;
  icon: string;
  label: string;
  text?: boolean;
}

function primaryAction(d: Item): Action {
  switch (d.status) {
    case "downloading":
    case "connecting":
    case "stalled":
    case "checking":
    case "fetching":
      return d.canPause ? { a: "pause", icon: "pause", label: "Pause" } : { a: "cancel", icon: "stop", label: "Cancel…" };
    case "paused":
      return { a: "resume", icon: "play", label: "Resume" };
    case "queued":
      return { a: "start", icon: "play", label: "Start now" };
    case "retrying":
      return { a: "retrynow", icon: "retry", label: "Retry now" };
    case "failed":
      return d.errorKind === "cannotResume"
        ? { a: "restart", icon: "restart", label: "Restart…", text: true }
        : { a: "retry", icon: "retry", label: "Retry", text: true };
    case "seeding":
      return { a: "pause", icon: "stop", label: "Stop seeding" };
    case "completed":
    case "stopped":
      return { a: "openfolder", icon: "folderOpen", label: "Show in folder" };
    case "cancelled":
      return { a: "again", icon: "retry", label: "Download again" };
  }
}

function actionsHTML(d: Item, iconOnly: boolean): string {
  const p = primaryAction(d);
  const nm = esc(d.name);
  const plain = p.label.replace("…", "");
  let h = '<div class="fl-actions">';
  if (p.text && iconOnly)
    h += `<button class="fl-ibtn fl-ibtn-sm" data-a="${p.a}" data-id="${d.id}" tabindex="-1" title="${p.label}" aria-label="${plain} ${nm}">${icon(p.icon)}</button>`;
  else if (p.text)
    h += `<button class="fl-btn fl-btn-sm" data-a="${p.a}" data-id="${d.id}" tabindex="-1" aria-label="${plain} ${nm}">${icon(p.icon, 14)}${p.label}</button>`;
  else {
    if (isComplete(d))
      h += `<button class="fl-ibtn fl-ibtn-sm fl-hover-only" data-a="openfile" data-id="${d.id}" tabindex="-1" title="${d.fileCount > 1 ? "Open folder" : "Open file"}" aria-label="Open ${nm}">${icon("open")}</button>`;
    h += `<button class="fl-ibtn fl-ibtn-sm fl-hover-only" data-a="${p.a}" data-id="${d.id}" tabindex="-1" title="${p.label}" aria-label="${plain} ${nm}">${icon(p.icon)}</button>`;
  }
  h += `<button class="fl-ibtn fl-ibtn-sm fl-hover-only" data-a="menu" data-id="${d.id}" tabindex="-1" title="More actions" aria-haspopup="menu" aria-label="More actions for ${nm}">${icon("more")}</button>`;
  return h + "</div>";
}

/* ---------------- table ---------------- */

export interface TableOpts {
  wide: boolean;
  /** Torrents in the list need room for download and upload speed. */
  torrents: boolean;
  queueView: boolean;
  compact: boolean;
  hasTextAction: boolean;
}

export function colsFor(o: TableOpts): string {
  const c = ["18px", "minmax(220px,1fr)"];
  if (o.queueView) c.splice(1, 0, "28px");
  c.push(o.wide ? "248px" : "minmax(220px,280px)");
  c.push(o.wide ? "128px" : "116px");
  if (o.wide) c.push(o.torrents ? "96px" : "76px", "68px");
  c.push(o.hasTextAction ? "100px" : "92px");
  return c.join(" ");
}

export function theadHTML(o: TableOpts): string {
  let h = '<div class="fl-thead" role="row"><div class="fl-th" role="columnheader"><span class="fl-sr">Select</span></div>';
  if (o.queueView) h += '<div class="fl-th r" role="columnheader">#</div>';
  h += o.queueView
    ? '<div class="fl-th" role="columnheader" aria-sort="none">Name — in start order</div>'
    : '<div class="fl-th is-sorted" role="columnheader" aria-sort="descending">Name</div>';
  h += '<div class="fl-th" role="columnheader">Status</div><div class="fl-th r" role="columnheader">Size</div>';
  if (o.wide) h += '<div class="fl-th r" role="columnheader">Speed</div><div class="fl-th r" role="columnheader">Time left</div>';
  return h + '<div class="fl-th r" role="columnheader"><span class="fl-sr">Actions</span></div></div>';
}

export interface RowOpts extends TableOpts {
  selected: boolean;
  anySel: boolean;
  tab: boolean;
  open: boolean;
  inline: boolean;
}

/** Subtle "Direct" / "Torrent" indicator in the second line of a row. */
export function kindTag(d: Item): string {
  return `<span class="fl-kind" title="${d.kind === "torrent" ? "BitTorrent download" : "Direct HTTP(S) download"}">${d.kind === "torrent" ? "Torrent" : "Direct"}</span>`;
}

function folderIcon(size?: number): string {
  const style = size ? ` style="width:${size}px;height:${size}px"` : "";
  return `<span class="fl-ftype-folder"${style}>${icon("folder", size ?? 20)}</span>`;
}

export function rowHTML(d: Item, o: RowOpts): string {
  const cls = "fl-row" + (o.selected ? " is-selected" : "") + (o.open ? " is-open" : "");
  let h = `<div class="${cls}" role="row" aria-selected="${o.selected}" data-row="${d.id}" tabindex="${o.tab ? 0 : -1}"${o.compact ? ` title="${esc(d.host)}"` : ""}>`;
  h += `<div class="fl-cell" role="gridcell"><button class="fl-check${o.selected || o.anySel ? "" : " fl-hover-only"}" role="checkbox" aria-checked="${o.selected}" aria-label="Select ${esc(d.name)}" data-a="check" data-id="${d.id}" tabindex="-1">${icon("check", 12)}</button></div>`;
  if (o.queueView) h += `<div class="fl-cell r" role="gridcell"><span class="fl-qpos">${d.pos ?? ""}</span></div>`;
  h +=
    '<div class="fl-cell" role="gridcell">' +
    (o.queueView
      ? d.kind === "direct"
        ? `<span class="fl-grip" data-grip="${d.id}" title="Drag to reorder">${icon("grip", 14)}</span>`
        : '<span class="fl-grip" aria-hidden="true" style="visibility:hidden">' + icon("grip", 14) + "</span>"
      : "") +
    (d.kind === "torrent" && d.fileCount > 1 ? folderIcon() : fileIcon(d.name)) +
    `<div class="fl-name"><span class="fl-fn" title="${esc(d.name)}">${esc(d.name)}</span>` +
    `<span class="fl-host">${kindTag(d)}${esc(d.host)}</span></div></div>`;
  let extra = "";
  if (!o.wide && o.inline) extra += inlineMetrics(d);
  if (d.status === "queued" && !o.queueView && d.pos && d.kind === "direct") extra += `${SEP}<span class="fl-detail fl-num">#${d.pos} in line</span>`;
  const p = pct(d.done, d.total);
  const showPct = !isComplete(d) && d.status !== "queued" && d.status !== "cancelled" && d.status !== "fetching" && p != null;
  h +=
    '<div class="fl-cell" role="gridcell"><div class="fl-statcell" style="flex:1;min-width:0">' +
    '<div style="display:flex;align-items:center;gap:8px;min-width:0">' +
    statusHTML(d, extra) +
    (showPct && !o.compact ? `<span class="fl-metric" style="margin-left:auto" data-m="pct-${d.id}">${p}%</span>` : "") +
    "</div>" +
    barHTML(d) +
    "</div></div>";
  h += `<div class="fl-cell r" role="gridcell">${sizeCell(d)}</div>`;
  if (o.wide) h += `<div class="fl-cell r" role="gridcell">${speedCell(d)}</div><div class="fl-cell r" role="gridcell">${etaCell(d)}</div>`;
  h += `<div class="fl-cell r" role="gridcell">${actionsHTML(d, !o.wide)}</div>`;
  return h + "</div>";
}

export function tableHTML(grouped: Group[], o: TableOpts, rowState: (d: Item) => Omit<RowOpts, keyof TableOpts>, showEarlier: boolean): string {
  let h = `<div class="fl-table${o.compact ? " fl-compact" : ""}" role="grid" aria-label="Downloads" aria-multiselectable="true" style="--fl-cols:${colsFor(o)}">${theadHTML(o)}`;
  for (const g of grouped) {
    if (g.label) {
      h += `<div class="fl-group" role="presentation">${g.label} <span class="fl-subtle fl-num">${g.items.length}</span>`;
      if (g.collapsible)
        h += `<button class="fl-btn fl-btn-subtle fl-btn-sm" style="margin-left:auto" data-a="older" aria-expanded="${showEarlier}">${icon(showEarlier ? "chevUp" : "chevDown", 14)}${showEarlier ? "Hide" : "Show"}</button>`;
      h += "</div>";
    }
    if (g.collapsible && !showEarlier) continue;
    for (const d of g.items) h += rowHTML(d, { ...o, ...rowState(d) });
  }
  return h + "</div>";
}

/* ---------------- details panel ---------------- */

export interface DetailsOpts {
  overlay: boolean;
  /** Full link when the person revealed hidden parameters. */
  revealed: string | null;
  spark: boolean;
  sparkData: number[];
  free: number | null;
  maxConcurrent: number;
  queueHeld: boolean;
  torrent: TorrentDetails | null;
  trackersOpen: boolean;
  maxActiveTorrents: number;
}

function sourceHTML(d: Item, revealed: string | null): string {
  const base = esc(d.displayUrl).replace(/^(https?:\/\/)/, '<span class="fl-subtle">$1</span>');
  if (revealed) {
    const q = revealed.indexOf("?");
    return base + (q >= 0 ? `<span class="fl-subtle">${esc(revealed.slice(q))}</span>` : "");
  }
  if (!d.hiddenParams) return base;
  return base + `<span class="fl-redact">?${d.hiddenParams} hidden ${plural(d.hiddenParams, "parameter")}</span>`;
}

export function sparkHTML(id: string, data: number[]): string {
  if (data.length < 2) return `<div data-m="spark-${id}" class="fl-hint">Collecting speed samples…</div>`;
  const w = 300;
  const hgt = 48;
  const peak = Math.max(...data, 1);
  const mx = peak * 1.1;
  const path = data
    .map((v, i) => (i ? "L" : "M") + ((i * w) / (data.length - 1)).toFixed(1) + " " + (hgt - (v / mx) * hgt).toFixed(1))
    .join(" ");
  const span = data.length;
  const ago = span >= 60 ? `${Math.round(span / 60)} min ago` : `${span} s ago`;
  return (
    `<div data-m="spark-${id}"><svg class="fl-spark" viewBox="0 0 300 48" preserveAspectRatio="none" role="img" aria-label="Speed over the last ${esc(ago.replace(" ago", ""))}, peak ${fmtSpeed(peak)}">` +
    '<line class="gd" x1="0" x2="300" y1="0.5" y2="0.5"/><line class="gd" x1="0" x2="300" y1="24" y2="24"/>' +
    `<path class="ar" d="${path} L300 48 L0 48 Z"/><path class="ln" d="${path}" vector-effect="non-scaling-stroke"/></svg>` +
    `<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--ink-subtle)" class="fl-num"><span>${ago}</span><span>peak ${fmtSpeed(peak)}</span><span>now</span></div></div>`
  );
}

function explainHTML(d: Item, o: DetailsOpts): string {
  const kept = d.done > 0 ? ` The ${fmtSize(d.done)} already downloaded is kept.` : "";
  switch (d.status) {
    case "retrying":
      return (
        `<div class="fl-explain is-retry" role="status">${icon("retry")}<div><p class="fl-etitle">Connection problem — retrying automatically</p>` +
        `<p>Fetchlane will reconnect in <span class="fl-num" data-m="retry2-${d.id}">${d.retryIn ?? 0}</span> s` +
        (d.attempt ? ` (attempt ${d.attempt} of ${d.maxAttempts})` : "") +
        `.${kept}</p></div></div>`
      );
    case "failed":
      return failureHTML(d, o);
    case "paused":
      return `<div class="fl-explain">${icon("pause", 16, "fl-muted")}<div><p>Paused. The partial file is kept; resuming continues from ${fmtSize(d.done)}.</p></div></div>`;
    case "queued":
      return (
        `<div class="fl-explain">${icon("clock", 16, "fl-muted")}<div><p><strong>#${d.pos} in line.</strong> ` +
        (o.queueHeld
          ? "The queue is on hold. Choose Resume all to continue, or Start now to start this one.</p>"
          : `Starts when one of the ${o.maxConcurrent} download ${plural(o.maxConcurrent, "slot")} frees up.</p>`) +
        "</div></div>"
      );
    case "downloading": {
      const notes: string[] = [];
      if (d.total == null) notes.push("The server didn’t report a file size, so progress and time left can’t be estimated.");
      if (!d.canPause) notes.push("This server can’t resume downloads, so pausing isn’t available. Cancelling deletes the partial file.");
      if (!notes.length) return "";
      return `<div class="fl-explain">${icon("info", 16, "fl-muted")}<div>${notes.map((n) => `<p>${n}</p>`).join("")}</div></div>`;
    }
    case "completed":
      return (
        `<div class="fl-explain is-done" role="status">${icon("checkCircle")}<div><p class="fl-etitle">Downloaded ${d.completedAt ? esc(whenLong(d.completedAt).replace(",", " at").replace(/^Today/, "today").replace(/^Yesterday/, "yesterday")) : ""}</p>` +
        `<p>${fmtSize(d.total ?? d.done)}</p></div></div>`
      );
    case "cancelled":
      return `<div class="fl-explain">${icon("stop", 16, "fl-muted")}<div><p>You cancelled this download and its partial file was deleted. Download again to start over.</p></div></div>`;
     default:
      return "";
  }
}

function failureHTML(d: Item, o: DetailsOpts): string {
  const box = (title: string, body: string) =>
    `<div class="fl-explain is-error" role="alert">${icon("alert")}<div><p class="fl-etitle">${title}</p><p>${body}</p></div></div>`;
  const host = esc(d.host);
  const kept = d.done > 0 ? ` The ${fmtSize(d.done)} already downloaded is kept.` : "";
  switch (d.errorKind) {
    case "network":
    case "timeout":
      return box(
        d.maxAttempts ? `Connection lost — stopped after ${d.maxAttempts} ${plural(d.maxAttempts, "attempt")}` : "Connection lost",
        `Fetchlane couldn’t reach ${host}. Check your connection, then retry.` +
          (d.done > 0 && d.resumable ? ` It continues from ${fmtSize(d.done)}.` : ""),
      );
    case "diskFull": {
      const drive = esc(driveOf(d.folder));
      const need = d.total != null ? d.total - d.done : null;
      const numbers =
        need != null && o.free != null
          ? `This file needs ${fmtSize(need)} more, but only ${fmtSize(o.free)} is free. `
          : "";
      return box(`Not enough space on drive ${drive}`, `${numbers}Free up space, then retry.${kept}`);
    }
    case "cannotResume":
      return box(
        "The server can’t continue this download",
        `${host} doesn’t support resuming, so the ${fmtSize(d.done)} already downloaded can’t be reused. Restarting downloads the whole file again.`,
      );
    default:
      return box(esc(d.reason ?? "Download failed"), esc(d.errorMessage) + kept);
  }
}

function detailActions(d: Item): string {
  const B = (a: string, ic: string, t: string, cls = "") =>
    `<button class="fl-btn ${cls}" data-a="${a}" data-id="${d.id}">${icon(ic)}${t}</button>`;
  const more = `<button class="fl-ibtn" data-a="menu" data-id="${d.id}" title="More actions" aria-haspopup="menu" aria-label="More actions">${icon("more")}</button>`;
  switch (d.status) {
    case "downloading":
      return (d.canPause ? B("pause", "pause", "Pause") : "") + B("cancel", "stop", "Cancel…") + more;
    case "paused":
      return B("resume", "play", "Resume", "fl-btn-primary") + B("cancel", "stop", "Cancel…") + more;
    case "queued":
      return B("start", "play", "Start now", "fl-btn-primary") + B("cancel", "stop", "Cancel…") + more;
    case "retrying":
      return B("retrynow", "retry", "Retry now") + (d.canPause ? B("pause", "pause", "Pause") : "") + more;
    case "failed":
      return d.errorKind === "cannotResume"
        ? B("restart", "restart", "Restart download…", "fl-btn-primary") + more
        : B("retry", "retry", "Retry", "fl-btn-primary") + more;
    case "completed":
      return B("openfile", "open", "Open file", "fl-btn-primary") + B("openfolder", "folderOpen", "Show in folder") + more;
    case "cancelled":
      return B("again", "retry", "Download again", "fl-btn-primary") + more;
     default:
      return more;
  }
}

export function detailsHTML(d: Item, o: DetailsOpts): string {
  if (d.kind === "torrent") return torrentDetailsHTML(d, o);
  const p = pct(d.done, d.total);
  let h = `<aside class="fl-details${o.overlay ? " is-overlay" : ""}" aria-label="Download details">`;
  h +=
    `<div class="fl-dhead">${fileIcon(d.name, 32)}<div style="flex:1;min-width:0"><h2>${esc(d.name)}</h2>` +
    `<div class="fl-host">${icon(d.https ? "lock" : "globe", 12)}${esc(d.host)}</div></div>` +
    `<button class="fl-ibtn fl-ibtn-sm" data-a="closepanel" title="Close details (Esc)" aria-label="Close details">${icon("x")}</button></div>`;
  h += '<div class="fl-dbody">';
  h += `<div style="display:flex;align-items:center;justify-content:space-between">${statusHTML(d)}</div>`;
  if (d.status !== "completed" && d.status !== "cancelled" && d.status !== "queued") {
    h +=
      '<div class="fl-dprogress"><div class="fl-big">' +
      `<span class="fl-pct" data-m="pctbig-${d.id}">${p == null ? fmtSize(d.done) : p + "%"}</span>` +
      `<span class="fl-of" data-m="of-${d.id}">${d.total == null ? "of unknown size" : fmtSize(d.done) + " of " + fmtSize(d.total)}</span>` +
      `</div>${barHTML(d, true)}</div>`;
  }
  h += explainHTML(d, o);

  const rows: [string, string][] = [];
  const na = (t: string, why = "") => `<dd class="fl-na"${why ? ` title="${why}"` : ""}>— <small>${t}</small></dd>`;
  if (d.status === "downloading") {
    rows.push(["Speed", d.speed == null ? na("measuring") : `<dd data-m="speedd-${d.id}">${fmtSpeed(d.speed)}</dd>`]);
    rows.push([
      "Time left",
      d.total == null
        ? na("needs file size", "The server didn’t report a size")
        : d.eta == null
          ? `<dd class="fl-na" data-m="etad-${d.id}">—</dd>`
          : `<dd data-m="etad-${d.id}">${fmtDur(d.eta, true)}</dd>`,
    ]);
  } else if (d.status === "retrying" || d.status === "failed") {
    rows.push(["Speed", na(d.status === "retrying" ? "reconnecting" : "stopped")]);
    rows.push(["Time left", na("not available")]);
  }
  rows.push([
    "Size",
    d.total == null
      ? d.status === "queued" || d.done === 0
        ? na("known when started")
        : `<dd>${fmtSize(d.done)} so far<small>total unknown</small></dd>`
      : `<dd>${fmtSize(d.total)}</dd>`,
  ]);
  rows.push(["Added", `<dd>${whenLong(d.createdAt)}</dd>`]);
  if (d.completedAt) rows.push(["Completed", `<dd>${whenLong(d.completedAt)}</dd>`]);
  if (d.status !== "completed" && d.status !== "cancelled" && d.status !== "queued" && !d.connecting)
    rows.push([
      "Resumable",
      `<dd>${d.resumable ? "Yes" : "No"}<small>${d.resumable ? "pause keeps progress" : "server doesn’t allow it"}</small></dd>`,
    ]);
  h += `<dl class="fl-dl">${rows.map((r) => `<div><dt>${r[0]}</dt>${r[1]}</div>`).join("")}</dl>`;

  const sep = d.folder.includes("/") && !d.folder.includes("\\") ? "/" : "\\";
  h +=
    `<div class="fl-dsec"><h3>Saved to</h3><div class="fl-path"><span class="fl-mono" title="${esc(d.folder + sep + d.name)}">${esc(d.folder)}${sep}</span>` +
    `<button class="fl-ibtn fl-ibtn-sm" data-a="openfolder" data-id="${d.id}" title="Show in folder" aria-label="Show in folder">${icon("folderOpen")}</button></div></div>`;
  h +=
    `<div class="fl-dsec"><h3>Source</h3><div class="fl-path${o.revealed ? " is-wrap" : ""}"><span class="fl-mono">${sourceHTML(d, o.revealed)}</span>` +
    (d.hiddenParams
      ? `<button class="fl-ibtn fl-ibtn-sm" data-a="reveal" data-id="${d.id}" title="${o.revealed ? "Hide" : "Show"} parameters" aria-pressed="${!!o.revealed}" aria-label="${o.revealed ? "Hide" : "Show"} link parameters">${icon("eye")}</button>`
      : "") +
    `<button class="fl-ibtn fl-ibtn-sm" data-a="copylink" data-id="${d.id}" title="Copy full link" aria-label="Copy full link">${icon("copy")}</button></div>` +
    (d.hiddenParams && !o.revealed
      ? `<div class="fl-hint">${icon("lock", 12)}Parameters can contain access tokens, so they’re hidden. Copy still copies the full link.</div>`
      : "") +
    "</div>";
  if (d.status === "downloading" && d.total != null) {
    h +=
      `<div class="fl-dsec"><button class="fl-disclosure" data-a="spark" aria-expanded="${o.spark}">${icon(o.spark ? "chevDown" : "chevRight", 12)}Speed history <span class="fl-subtle" style="font-weight:400">· optional</span></button>` +
      (o.spark ? sparkHTML(d.id, o.sparkData) : "") +
      "</div>";
  }
  h += "</div>";
  h += `<div class="fl-dactions">${detailActions(d)}</div>`;
  return h + "</aside>";
}

/* ---------------- torrent details ---------------- */

function torrentExplain(d: Item, o: DetailsOpts): string {
  const box = (cls: string, ic: string, title: string, body: string) =>
    `<div class="fl-explain ${cls}" role="status">${icon(ic, 16, cls ? "" : "fl-muted")}<div>${title ? `<p class="fl-etitle">${title}</p>` : ""}<p>${body}</p></div></div>`;
  const t = o.torrent;
  switch (d.status) {
    case "fetching":
      return box("", "spinner", "", "Fetching the torrent’s details from peers. Its files appear here when they arrive.");
    case "connecting":
      return box("", "globe", "", "Looking for peers that have this torrent.");
    case "checking":
      return box("", "search", "", "Checking the data already on disk. Only missing or damaged pieces will be downloaded.");
    case "stalled":
      return box("is-retry", "warn", "Stalled — waiting for peers",
        "No data has arrived for a while. The download continues when someone with the missing pieces connects. Downloaded pieces are kept.");
    case "paused":
      return box("", "pause", "", `Paused. The ${fmtSize(d.done)} already downloaded is kept; resuming continues from there.`);
    case "queued":
      return box("", "clock", "",
        `<strong>Waiting for a torrent slot.</strong> Up to ${o.maxActiveTorrents} ${plural(o.maxActiveTorrents, "torrent")} download at once; seeding doesn’t count. Change this in Settings.`);
    case "seeding":
      return box("is-done", "arrowUp", "Complete — seeding",
        `Fetchlane uploads the pieces you have to other people downloading this torrent. ${seedLimitText(t)}`);
    case "stopped":
      return box("is-done", "checkCircle", d.seedLimit ? "Complete — seeding limit reached" : "Complete",
        d.seedLimit ? "Seeding stopped automatically. Start seeding to upload again." : "Not seeding. Start seeding to upload to other people.");
    case "failed":
      return `<div class="fl-explain is-error" role="alert">${icon("alert")}<div><p class="fl-etitle">${esc(d.reason ?? "Torrent error")}</p><p>${esc(d.errorMessage)}</p></div></div>`;
    default:
      return "";
  }
}

function seedLimitText(t: TorrentDetails | null): string {
  if (!t) return "";
  const parts: string[] = [];
  if (t.ratioLimit != null) parts.push(`at share ratio ${t.ratioLimit.toFixed(2)}`);
  if (t.timeLimitMinutes != null) parts.push(`after ${fmtDur(t.timeLimitMinutes * 60)} of seeding`);
  return parts.length ? `It stops ${parts.join(" or ")}.` : "It keeps seeding until you stop it.";
}

function torrentDetailActions(d: Item): string {
  const B = (a: string, ic: string, t: string, cls = "") =>
    `<button class="fl-btn ${cls}" data-a="${a}" data-id="${d.id}">${icon(ic)}${t}</button>`;
  const more = `<button class="fl-ibtn" data-a="menu" data-id="${d.id}" title="More actions" aria-haspopup="menu" aria-label="More actions">${icon("more")}</button>`;
  switch (d.status) {
    case "downloading":
    case "connecting":
    case "stalled":
    case "checking":
    case "fetching":
      return B("pause", "pause", "Pause") + more;
    case "paused":
      return B("resume", "play", "Resume", "fl-btn-primary") + more;
    case "queued":
      return B("start", "play", "Start now", "fl-btn-primary") + more;
    case "failed":
      return B("retry", "retry", "Retry", "fl-btn-primary") + B("recheck", "search", "Recheck files") + more;
    case "seeding":
      return B("pause", "stop", "Stop seeding") + B("openfile", "open", d.fileCount > 1 ? "Open folder" : "Open file") + more;
    default:
      return B("resume", "arrowUp", "Start seeding") + B("openfile", "open", d.fileCount > 1 ? "Open folder" : "Open file", "fl-btn-primary") + more;
  }
}

function filesHTML(d: Item, t: TorrentDetails): string {
  const shown = t.files.slice(0, 300);
  const selected = t.files.filter((f) => f.selected);
  const editable = d.status !== "fetching" && d.status !== "checking";
  let h =
    `<div class="fl-dsec"><h3>Files · <span class="fl-num">${selected.length} of ${t.files.length} selected · ${fmtSize(selected.reduce((a, f) => a + f.size, 0))}</span></h3>` +
    '<div class="fl-tfiles" role="group" aria-label="Files in this torrent">';
  for (const f of shown) {
    const p = f.size ? Math.floor((f.have / f.size) * 100) : 100;
    h +=
      `<div class="fl-tfile${f.selected ? "" : " is-off"}">` +
      `<button class="fl-check" role="checkbox" aria-checked="${f.selected}" data-a="tfile" data-id="${d.id}" data-i="${f.index}"` +
      `${editable ? "" : " disabled"} aria-label="Download ${esc(f.path)}" title="${f.selected ? "Skip this file" : "Download this file"}">${icon("check", 12)}</button>` +
      `<span class="fl-tpath" title="${esc(f.path)}">${esc(f.path)}</span>` +
      `<span class="fl-num fl-subtle">${fmtSize(f.size)}</span>` +
      `<span class="fl-num fl-tpct">${f.selected ? p + "%" : "skipped"}</span></div>`;
  }
  if (t.files.length > shown.length) h += `<div class="fl-hint">and ${t.files.length - shown.length} more files</div>`;
  return h + "</div></div>";
}

function torrentDetailsHTML(d: Item, o: DetailsOpts): string {
  const t = o.torrent;
  const p = pct(d.done, d.total);
  let h = `<aside class="fl-details${o.overlay ? " is-overlay" : ""}" aria-label="Torrent details">`;
  h +=
    `<div class="fl-dhead">${d.fileCount > 1 ? folderIcon(32) : fileIcon(d.name, 32)}<div style="flex:1;min-width:0"><h2>${esc(d.name)}</h2>` +
    `<div class="fl-host">${kindTag(d)}${esc(d.fileCount > 1 ? `${d.fileCount} files` : "Single file")}</div></div>` +
    `<button class="fl-ibtn fl-ibtn-sm" data-a="closepanel" title="Close details (Esc)" aria-label="Close details">${icon("x")}</button></div>`;
  h += '<div class="fl-dbody">';
  h += `<div style="display:flex;align-items:center;justify-content:space-between">${statusHTML(d)}</div>`;
  if (!isComplete(d) && d.status !== "queued" && d.status !== "fetching") {
    h +=
      '<div class="fl-dprogress"><div class="fl-big">' +
      `<span class="fl-pct" data-m="pctbig-${d.id}">${p == null ? fmtSize(d.done) : p + "%"}</span>` +
      `<span class="fl-of" data-m="of-${d.id}">${d.total == null ? "" : fmtSize(d.done) + " of " + fmtSize(d.total)}</span>` +
      `</div>${barHTML(d, true)}</div>`;
  }
  h += torrentExplain(d, o);

  const na = (txt: string) => `<dd class="fl-na">— <small>${txt}</small></dd>`;
  const live = TRANSFERRING.includes(d.status) || d.status === "seeding";
  const rows: [string, string][] = [];
  rows.push(["Download speed", TRANSFERRING.includes(d.status) && d.speed != null ? `<dd data-m="speedd-${d.id}">${fmtSpeed(d.speed)}</dd>` : na(isComplete(d) ? "complete" : "not downloading")]);
  rows.push(["Upload speed", live && d.up != null ? `<dd data-m="upd-${d.id}">${fmtSpeed(d.up) || "0 KB/s"}</dd>` : na("not connected")]);
  if (!isComplete(d))
    rows.push(["Time left", d.status === "downloading" && d.eta != null ? `<dd data-m="etad-${d.id}">${fmtDur(d.eta, true)}</dd>` : na(d.status === "stalled" ? "waiting for peers" : "not available")]);
  rows.push(["Size", d.total != null ? `<dd>${fmtSize(d.total)}${d.selectedCount < d.fileCount ? `<small>${d.selectedCount} of ${d.fileCount} files</small>` : ""}</dd>` : na("known after fetching")]);
  rows.push(["Downloaded", `<dd data-m="dld-${d.id}">${fmtSize(t?.downloaded ?? d.done)}</dd>`]);
  rows.push(["Uploaded", `<dd data-m="upl-${d.id}">${fmtSize(t?.uploaded ?? d.uploaded) || "0 B"}</dd>`]);
  rows.push(["Share ratio", `<dd data-m="ratio-${d.id}" title="Uploaded divided by size">${fmtRatio(t?.ratio ?? d.ratio)}</dd>`]);
  rows.push([
    "Peers",
    live || t?.peersConnected
      ? `<dd data-m="peers-${d.id}">${t?.peersConnected ?? d.peers} connected<small>${t?.peersKnown ?? d.peersKnown} known</small></dd>`
      : na("not connected"),
  ]);
  rows.push(["Added", `<dd>${whenLong(d.createdAt)}</dd>`]);
  if (d.completedAt) rows.push(["Completed", `<dd>${whenLong(d.completedAt)}</dd>`]);
  h += `<dl class="fl-dl">${rows.map((r) => `<div><dt>${r[0]}</dt>${r[1]}</div>`).join("")}</dl>`;

  if (isComplete(d) && t) {
    const seeding = d.status === "seeding";
    h +=
      `<div class="fl-dsec"><h3>Seeding</h3><div class="fl-explain">${icon(seeding ? "arrowUp" : "stop", 16, "fl-muted")}<div>` +
      `<p>${seeding ? `Seeding for ${fmtDur(t.seededSecs, true)}.` : t.seededSecs ? `Seeded for ${fmtDur(t.seededSecs, true)}.` : "Not seeding."} ${seedLimitText(t)}</p>` +
      '<p>Seeding uploads completed pieces to other people. Limits are in Settings.</p></div></div></div>';
  }

  if (t && t.files.length) h += filesHTML(d, t);
  else if (d.status === "fetching") h += '<div class="fl-dsec"><h3>Files</h3><div class="fl-hint">Shown once the torrent’s details arrive.</div></div>';

  const sep = d.folder.includes("/") && !d.folder.includes("\\") ? "/" : "\\";
  const savePath = t?.savePath ?? d.folder;
  h +=
    `<div class="fl-dsec"><h3>Saved to</h3><div class="fl-path"><span class="fl-mono" title="${esc(savePath)}">${esc(savePath)}${d.fileCount > 1 ? sep : ""}</span>` +
    `<button class="fl-ibtn fl-ibtn-sm" data-a="openfolder" data-id="${d.id}" title="Show in folder" aria-label="Show in folder">${icon("folderOpen")}</button></div></div>`;

  if (t) {
    h +=
      `<div class="fl-dsec"><button class="fl-disclosure" data-a="trackers" aria-expanded="${o.trackersOpen}">${icon(o.trackersOpen ? "chevDown" : "chevRight", 12)}Trackers <span class="fl-subtle fl-num" style="font-weight:400">· ${t.trackers.length}</span></button>` +
      (o.trackersOpen
        ? t.trackers.length
          ? `<ul class="fl-trackers">${t.trackers.map((u) => `<li class="fl-mono" title="${esc(u)}">${esc(u)}</li>`).join("")}</ul>`
          : '<div class="fl-hint">No trackers: peers are found through the DHT network and other peers.</div>'
        : "") +
      "</div>";
    h +=
      `<div class="fl-dsec"><h3>Source</h3><div class="fl-path"><span class="fl-mono" title="Info hash">${esc(t.infoHash)}</span>` +
      `<button class="fl-ibtn fl-ibtn-sm" data-a="copylink" data-id="${d.id}" title="Copy magnet link" aria-label="Copy magnet link">${icon("copy")}</button></div></div>`;
  }
  if (d.status !== "fetching" && d.status !== "checking")
    h += `<div class="fl-dsec"><button class="fl-btn fl-btn-sm" data-a="recheck" data-id="${d.id}" style="align-self:flex-start">${icon("search", 14)}Recheck files</button><div class="fl-hint">Verifies every piece on disk. Missing or damaged pieces are downloaded again.</div></div>`;
  h += "</div>";
  h += `<div class="fl-dactions">${torrentDetailActions(d)}</div>`;
  return h + "</aside>";
}

/* ---------------- torrent menu ---------------- */

function torrentMenu(d: Item): string {
  const I = (a: string, ic: string, t: string, opt: { danger?: boolean; disabled?: boolean; sc?: string } = {}) =>
    `<button class="fl-mi${opt.danger ? " is-danger" : ""}" role="menuitem" data-a="${a}" data-id="${d.id}"${opt.disabled ? " disabled" : ""} tabindex="-1">` +
    `${icon(ic)}<span>${t}</span>${opt.sc ? `<span class="fl-sc">${opt.sc}</span>` : ""}</button>`;
  const S = '<div class="fl-msep" role="separator"></div>';
  let h = "";
  if (TRANSFERRING.includes(d.status) || d.status === "checking" || d.status === "fetching") h += I("pause", "pause", "Pause");
  if (d.status === "paused") h += I("resume", "play", "Resume");
  if (d.status === "queued") h += I("start", "play", "Start now");
  if (d.status === "failed") h += I("retry", "retry", "Retry");
  if (d.status === "seeding") h += I("pause", "stop", "Stop seeding");
  if (d.status === "stopped") h += I("resume", "arrowUp", "Start seeding");
  if (isComplete(d))
    h += I("openfile", "open", d.fileCount > 1 ? "Open folder" : "Open file", { sc: "Enter" }) + I("openfolder", "folderOpen", "Show in folder");
  h += S + I("details", "info", "Details", { sc: "Ctrl+I" }) + I("copylink", "link", "Copy magnet link");
  if (d.status !== "fetching") h += I("recheck", "search", "Recheck files", { disabled: d.status === "checking" });
  if (!isComplete(d)) h += I("openfolder", "folder", "Open destination folder");
  h += S + I("remove", "remove", "Remove from list…", { sc: "Del" });
  h += I("delete", "trash", "Delete downloaded files…", { danger: true, disabled: d.status === "fetching" });
  return h;
}

/* ---------------- overflow menu ---------------- */

export function menuItems(d: Item, queuedCount: number): string {
  if (d.kind === "torrent") return torrentMenu(d);
  const I = (a: string, ic: string, t: string, opt: { danger?: boolean; disabled?: boolean; sc?: string } = {}) =>
    `<button class="fl-mi${opt.danger ? " is-danger" : ""}" role="menuitem" data-a="${a}" data-id="${d.id}"${opt.disabled ? " disabled" : ""} tabindex="-1">` +
    `${icon(ic)}<span>${t}</span>${opt.sc ? `<span class="fl-sc">${opt.sc}</span>` : ""}</button>`;
  const S = '<div class="fl-msep" role="separator"></div>';
  let h = "";
  if (d.status === "downloading")
    h += I("pause", "pause", d.canPause ? "Pause" : "Pause (server can’t resume)", { disabled: !d.canPause });
  if (d.status === "paused") h += I("resume", "play", "Resume");
  if (d.status === "retrying") h += I("retrynow", "retry", "Retry now") + I("pause", "pause", "Pause", { disabled: !d.canPause });
  if (d.status === "queued")
    h +=
      I("start", "play", "Start now") +
      S +
      I("top", "toTop", "Move to top", { disabled: d.pos === 1 }) +
      I("up", "arrowUp", "Move up", { disabled: d.pos === 1, sc: "Alt+↑" }) +
      I("downq", "arrowDown", "Move down", { disabled: d.pos === queuedCount, sc: "Alt+↓" });
  if (d.status === "failed")
    h += d.errorKind === "cannotResume" ? I("restart", "restart", "Restart download…") : I("retry", "retry", "Retry");
  if (d.status === "completed") h += I("openfile", "open", "Open file", { sc: "Enter" }) + I("openfolder", "folderOpen", "Show in folder");
  h +=
    S +
    I("details", "info", "Details", { sc: "Ctrl+I" }) +
    I("copylink", "link", "Copy link") +
    (d.status !== "completed" && d.status !== "cancelled"
      ? I("openfolder", "folder", "Open destination folder")
      : I("again", "retry", "Download again", { disabled: d.status === "completed" }));
  if ((d.status === "paused" || d.status === "downloading" || d.status === "retrying") && d.done > 0 && d.errorKind !== "cannotResume")
    h += I("restart", "restart", "Restart from the beginning…");
  h += S;
  if (d.status === "downloading" || d.status === "paused" || d.status === "retrying" || d.status === "queued" || d.status === "failed")
    h += I("cancel", "stop", "Cancel download…", { danger: true });
  h += I("remove", "remove", "Remove from list…", { sc: "Del" });
  if (d.status === "completed") h += I("delete", "trash", "Delete downloaded file…", { danger: true });
  return h;
}

/* ---------------- window chrome ---------------- */

export function titlebarHTML(maximized: boolean): string {
  return (
    '<header class="fl-titlebar" data-tauri-drag-region>' +
    `<div class="fl-brand" data-tauri-drag-region>${mark(16)}<span data-tauri-drag-region>Fetchlane</span></div>` +
    '<div class="fl-caption">' +
    `<button data-win="minimize" aria-label="Minimize" tabindex="-1">${icon("minimize")}</button>` +
    `<button data-win="maximize" aria-label="${maximized ? "Restore" : "Maximize"}" tabindex="-1">${icon(maximized ? "restoreWin" : "maximize")}</button>` +
    `<button class="close" data-win="close" aria-label="Close" tabindex="-1">${icon("close")}</button>` +
    "</div></header>"
  );
}

export function sidebarHTML(c: Record<ViewId, number>, current: string, rail: boolean): string {
  let h = `<nav class="fl-sidebar${rail ? " is-rail" : ""}" aria-label="Download lists">`;
  for (const v of VIEWS) {
    const cur = current === v.id;
    h +=
      `<button class="fl-nav" data-view="${v.id}"${cur ? ' aria-current="page"' : ""} title="${v.title ?? v.label} (${c[v.id]})">` +
      `${icon(v.icon)}<span class="fl-nav-label">${v.label}</span>` +
      `<span class="fl-count${v.id === "failed" && c.failed ? " is-alert" : ""}" aria-label="${c[v.id]} items">${c[v.id]}</span></button>`;
  }
  h += '<div class="fl-spacer"></div><div class="fl-sidebar-sep"></div>';
  h += `<button class="fl-nav" data-view="settings"${current === "settings" ? ' aria-current="page"' : ""} title="Settings">${icon("sliders")}<span class="fl-nav-label">Settings</span></button>`;
  return h + "</nav>";
}

export function toolbarHTML(o: { query: string; narrow: boolean; pauseLabel: "Pause all" | "Resume all"; pauseDisabled: boolean }): string {
  return (
    '<div class="fl-toolbar" role="toolbar" aria-label="Downloads">' +
    `<button class="fl-btn fl-btn-primary" data-a="add" title="Add download (Ctrl+N)">${icon("plus")}Add download</button>` +
    `<div class="fl-input fl-search"${o.narrow ? ' style="flex-basis:200px;width:200px"' : ""}>${icon("search")}` +
    `<input type="search" placeholder="${o.narrow ? "Search" : "Search downloads"}" aria-label="Search downloads" value="${esc(o.query)}" data-q>` +
    (o.query
      ? `<button class="fl-ibtn fl-ibtn-sm" style="width:22px;height:22px;margin-right:-6px" data-a="clearq" aria-label="Clear search">${icon("x", 14)}</button>`
      : '<span class="fl-kbd">Ctrl+F</span>') +
    "</div>" +
    '<div class="fl-grow"></div>' +
    `<button class="fl-btn" data-a="pauseall"${o.pauseDisabled ? " disabled" : ""} title="${o.pauseLabel === "Pause all" ? "Pause every active download that can resume, and hold the queue" : "Resume all paused downloads and the queue"}">` +
    `${icon(o.pauseLabel === "Pause all" ? "pause" : "play")}${o.pauseLabel}</button>` +
    "</div>"
  );
}

export function listHeadHTML(o: { title: string; sub: string }): string {
  return `<div class="fl-listhead"><h1>${o.title}</h1><span class="fl-muted fl-num">${o.sub}</span></div>`;
}

export function selbarHTML(sel: Item[], allSelected: boolean, narrow: boolean): string {
  const n = selectionCounts(sel);
  const B = (a: string, ic: string, t: string, c: number) =>
    `<button class="fl-btn" data-a="${a}"${c ? "" : " disabled"}>${icon(ic)}${t} <span class="fl-n">${c}</span></button>`;
  return (
    `<div class="fl-selbar" role="toolbar" aria-label="Actions for ${sel.length} selected downloads">` +
    `<button class="fl-check" role="checkbox" aria-checked="${allSelected ? "true" : "mixed"}" data-a="selall" aria-label="${allSelected ? "Clear selection" : "Select all in this list"}">${icon(allSelected ? "check" : "minus", 12)}</button>` +
    `<span class="fl-selcount" aria-live="polite">${sel.length} selected</span>` +
    B("selpause", "pause", "Pause", n.pause) +
    B("selresume", "play", "Resume", n.resume) +
    B("selretry", "retry", "Retry", n.retry) +
    (n.toTop ? B("seltop", "toTop", "Move to top", n.toTop) : "") +
    '<div class="fl-vsep"></div>' +
    B("selremove", "remove", "Remove from list…", sel.length) +
    `<div class="fl-grow" style="flex:1"></div><button class="fl-btn fl-btn-subtle" data-a="clearsel" title="Clear selection (Esc)">${icon("x")}${narrow ? '<span class="fl-sr">Clear selection</span>' : "Clear selection"}</button></div>`
  );
}

export function emptyHTML(view: ViewId, query: string, hasAny: boolean): string {
  if (query.trim())
    return (
      `<div class="fl-empty">${icon("search", 32, "fl-subtle")}<h2>No downloads match “${esc(query.trim())}”</h2>` +
      '<p>Search looks at file names and website names in every list.</p><div class="fl-row-btns"><button class="fl-btn" data-a="clearq">Clear search</button></div></div>'
    );
  if (view === "failed")
    return `<div class="fl-empty">${icon("checkCircle", 32, "fl-subtle")}<h2>Nothing has failed</h2><p>Downloads that stop with an error appear here, with what went wrong and how to fix it.</p></div>`;
  if (view === "seeding")
    return `<div class="fl-empty">${icon("arrowUp", 32, "fl-subtle")}<h2>Nothing is seeding</h2><p>Completed torrents upload to other people here until a seeding limit is reached or you stop them.</p></div>`;
  if (view === "queued")
    return `<div class="fl-empty">${icon("queue", 32, "fl-subtle")}<h2>The queue is empty</h2><p>Choose <strong>Add to queue</strong> when adding a download to have it start after the current ones.</p></div>`;
  if (view !== "all" || hasAny) return `<div class="fl-empty">${icon("all", 32, "fl-subtle")}<h2>Nothing here right now</h2></div>`;
  return (
    `<div class="fl-empty">${EMPTY_ART}<h2>Your downloads will line up here</h2>` +
    '<p>Copy a download or magnet link, then press <span class="fl-kbd">Ctrl</span> <span class="fl-kbd">V</span> anywhere in Fetchlane — or choose Add download. You can also drop a .torrent file onto the window.</p>' +
    `<div class="fl-row-btns"><button class="fl-btn fl-btn-primary" data-a="add">${icon("plus")}Add download</button><button class="fl-btn" data-a="pastenew">${icon("paste")}Paste link</button></div>` +
    '<div class="fl-steps"><div><b>1</b><span>Copy an http://, https:// or magnet: link</span></div><div><b>2</b><span>Paste it — Fetchlane checks the name, size and files</span></div><div><b>3</b><span>Download now or add it to the queue</span></div></div></div>'
  );
}

export function statusbarHTML(o: {
  downloading: number; retrying: number; queued: number; totalSpeed: number; seeding: number; upSpeed: number | null;
  held: boolean; drive: string; free: number | null; max: number;
}): string {
  return (
    '<div class="fl-statusbar" role="status" aria-live="off">' +
    (o.held
      ? `<span class="fl-sb">${icon("pause", 12)}<b>All paused</b> · queue on hold</span>`
      : `<span class="fl-sb">${icon("down", 12)}<b>${o.downloading}</b> downloading${o.retrying ? ` · <b>${o.retrying}</b> retrying` : ""}</span>` +
        `<span class="fl-sb"><b data-m="total-speed">${fmtSpeed(o.totalSpeed) || "0 KB/s"}</b> total</span>`) +
    (o.upSpeed != null
      ? `<span class="fl-sb" title="Uploading to other people">${icon("arrowUp", 12)}${o.seeding ? `<b>${o.seeding}</b> seeding · ` : ""}<b data-m="total-up">${fmtSpeed(o.upSpeed) || "0 KB/s"}</b> up</span>`
      : "") +
    `<span class="fl-sb">${icon("clock", 12)}<b>${o.queued}</b> queued</span><span class="fl-grow"></span>` +
    (o.free != null ? `<span class="fl-sb">${icon("drive", 12)}${esc(o.drive)} ${fmtSize(o.free)} free</span>` : "") +
    `<button class="fl-link fl-num" data-view="settings" title="Change in Settings">${o.max} at a time</button></div>`
  );
}

/* ---------------- settings ---------------- */

export function settingsHTML(s: Settings, completed: number, version: string): string {
  const tog = (k: keyof Settings, on: boolean, lbl: string, disabled = false) =>
    `<button class="fl-toggle" role="switch" aria-checked="${on}" data-set="${k}" aria-label="${lbl}"${disabled ? " disabled" : ""}></button><span style="width:28px;font-size:13px">${on ? "On" : "Off"}</span>`;
  const radio = (k: keyof Settings, v: string, t: string) =>
    `<button role="radio" aria-checked="${s[k] === v}" data-setv="${k}:${v}">${t}</button>`;
  // `scale` shows stored values divided by it (ratio 100 = 1.00); `step` is in stored units.
  const numbox = (k: keyof Settings, value: number, min: number, max: number, label: string, enabled = true, step = 1, scale = 1, unit = "") =>
    `<div class="fl-num-box${unit ? " has-unit" : ""}"${enabled ? "" : ' aria-disabled="true" style="opacity:.5"'}>` +
    `<button data-a="num" data-k="${k}" data-d="${-step}" data-min="${min}" data-max="${max}" aria-label="Less"${enabled && value > min ? "" : " disabled"}>${icon("minus", 14)}</button>` +
    `<input value="${scale === 1 ? value : (value / scale).toFixed(2)}" data-numk="${k}" data-min="${min}" data-max="${max}" data-scale="${scale}" aria-label="${label}" inputmode="decimal"${enabled ? "" : " disabled"}>` +
    `<button data-a="num" data-k="${k}" data-d="${step}" data-min="${min}" data-max="${max}" aria-label="More"${enabled && value < max ? "" : " disabled"}>${icon("plus", 14)}</button></div>` +
    (unit ? `<span class="fl-subtle" style="font-size:12px;width:36px">${unit}</span>` : "");
  const row = (ic: string | null, title: string, sub: string, ctl: string, extra = "") =>
    `<div class="fl-srow${ic ? "" : " is-sub"}${extra}">${ic ? `<span class="fl-sicon">${icon(ic, 20)}</span>` : ""}` +
    `<div class="fl-stext"><div>${title}</div>${sub ? `<div>${sub}</div>` : ""}</div>${ctl ? `<div class="fl-sctl">${ctl}</div>` : ""}</div>`;
  return (
    '<div class="fl-settings"><div class="fl-listhead" style="padding:0;height:56px"><h1 style="font-size:20px;line-height:28px">Settings</h1><span class="fl-muted">Changes apply right away</span></div><div class="fl-settings-inner">' +
    '<section class="fl-sgroup"><h2>Downloads</h2><div class="fl-scard">' +
    row("folder", "Default download folder", "New downloads are saved here unless you pick another folder.",
      `<div class="fl-path" style="width:220px;background:var(--surface-100)"><span class="fl-mono" title="${esc(s.downloadDir)}">${esc(s.downloadDir)}</span></div><button class="fl-btn" data-a="browsedefault">Browse…</button>`) +
    row(null, "Ask where to save each download", "Shows the folder field first in Add download.", tog("askEachTime", s.askEachTime, "Ask where to save each download")) +
    row("active", "Maximum simultaneous downloads", "Others wait in the queue in order. A download that is retrying keeps its slot.",
      numbox("maxConcurrent", s.maxConcurrent, 1, 10, "Maximum simultaneous downloads")) +
    row(null, "Connections per download", "Some servers send large files faster over several connections. Fetchlane only uses them when the server supports it; it doesn’t always help.",
      numbox("connectionsPerDownload", s.connectionsPerDownload, 1, 8, "Connections per download")) +
    row(null, "Continue unfinished downloads when Fetchlane starts", "Downloads interrupted by closing Fetchlane pick up where they stopped.", tog("autoResume", s.autoResume, "Continue unfinished downloads when Fetchlane starts")) +
    row("info", "Notify when a download finishes", "Shows a Windows notification with the file name.", tog("notifyOnFinish", s.notifyOnFinish, "Notify when a download finishes")) +
    "</div></section>" +
    '<section class="fl-sgroup"><h2>Retries</h2><div class="fl-scard">' +
    row("retry", "Retry automatically when a connection drops", "Fetchlane waits a little longer before each attempt and keeps the partial file.", tog("retryAutomatically", s.retryAutomatically, "Retry automatically")) +
    row(null, "Attempts before giving up", "Waits 5 s, 15 s, 45 s, then 2 min between attempts. After the last one, the download moves to Failed.",
      numbox("retryAttempts", s.retryAttempts, 1, 10, "Attempts", s.retryAutomatically), s.retryAutomatically ? "" : " is-disabled") +
    row(null, "Disk full, file not found and access denied are never retried automatically", "They need a decision from you and go straight to Failed.", "") +
    "</div></section>" +
    '<section class="fl-sgroup"><h2>Torrents</h2><div class="fl-scard">' +
    row("down", "Download speed limit", "For all torrents together. 0 means unlimited.",
      numbox("torrentDownloadLimitKib", s.torrentDownloadLimitKib, 0, 4_000_000, "Torrent download speed limit in kilobytes per second, 0 for unlimited", true, 100, 1, "KB/s")) +
    row("arrowUp", "Upload speed limit", "For all torrents together. 0 means unlimited.",
      numbox("torrentUploadLimitKib", s.torrentUploadLimitKib, 0, 4_000_000, "Torrent upload speed limit in kilobytes per second, 0 for unlimited", true, 50, 1, "KB/s")) +
    row("active", "Active torrents", "Torrents downloading at the same time; others wait in line. Seeding torrents don’t count.",
      numbox("maxActiveTorrents", s.maxActiveTorrents, 1, 20, "Active torrents, 1 to 20")) +
    row("info", "About seeding",
      "Seeding uploads the pieces you have to other people downloading the same torrent. It continues after your download completes, until a limit below is reached or you choose Stop seeding.", "") +
    row(null, "Stop seeding at share ratio", "Share ratio is uploaded divided by size: 1.00 means you uploaded as much as you downloaded.",
      tog("seedRatioEnabled", s.seedRatioEnabled, "Stop seeding at a share ratio") +
        numbox("seedRatioPercent", s.seedRatioPercent, 10, 10_000, "Share ratio limit", s.seedRatioEnabled, 10, 100)) +
    row(null, "Stop seeding after a time", "Counts only time spent seeding.",
      tog("seedTimeEnabled", s.seedTimeEnabled, "Stop seeding after a time") +
        numbox("seedTimeMinutes", s.seedTimeMinutes, 1, 525_600, "Seeding time limit in minutes", s.seedTimeEnabled, 15, 1, "min")) +
    "</div></section>" +
    '<section class="fl-sgroup"><h2>Appearance</h2><div class="fl-scard">' +
    row("eye", "Theme", "System follows your Windows setting.",
      `<div class="fl-seg" role="radiogroup" aria-label="Theme">${radio("theme", "system", "System")}${radio("theme", "light", "Light")}${radio("theme", "dark", "Dark")}</div>`) +
    row("comfortable", "List density", "Compact fits about 50% more rows and moves website names into tooltips.",
      `<div class="fl-seg" role="radiogroup" aria-label="List density">${radio("density", "comfortable", "Comfortable")}${radio("density", "compact", "Compact")}</div>`) +
    "</div></section>" +
    '<section class="fl-sgroup"><h2>History</h2><div class="fl-scard">' +
    row("clock", "Keep download history", "Completed entries stay in the list after you restart Fetchlane.", tog("keepHistory", s.keepHistory, "Keep download history")) +
    row(null, "Clear completed entries", `Removes ${completed} ${plural(completed, "entry", "entries")} from the list. Downloaded files stay on disk.`,
      `<button class="fl-btn" data-a="clearhist"${completed ? "" : " disabled"}>Clear from list…</button>`) +
    "</div></section>" +
    `<p class="fl-note" style="margin:0">Fetchlane ${esc(version)} · Open source · HTTP, HTTPS and BitTorrent downloads</p>` +
    "</div></div>"
  );
}

/* ---------------- dialogs ---------------- */

export function confirmHTML(title: string, body: string, okLabel: string, okAction: string, keepLabel = "Keep partial file"): string {
  return (
    '<div class="fl-dialog is-narrow" role="alertdialog" aria-modal="true" aria-labelledby="dlg-t" aria-describedby="dlg-d">' +
    `<div class="fl-dlg-body"><h2 id="dlg-t">${title}</h2><div id="dlg-d" style="display:flex;flex-direction:column;gap:8px;color:var(--ink-muted)">${body.replace(/<p>/g, '<p style="margin:0">')}</div></div>` +
    `<div class="fl-dlg-foot"><button class="fl-btn" data-a="closedlg" data-autofocus>${keepLabel}</button><button class="fl-btn fl-btn-danger-fill" data-a="${okAction}">${okLabel}</button></div></div>`
  );
}

export function removeHTML(items: Item[]): string {
  const n = items.length;
  const inprog = items.filter((d) => !isComplete(d) && d.status !== "cancelled" && d.status !== "failed").length;
  const seeding = items.filter((d) => d.status === "seeding").length;
  const names = n === 1 ? esc(items[0].name) : items.slice(0, 2).map((d) => esc(d.name)).join(", ") + (n > 2 ? ` and ${n - 2} more` : "");
  return (
    '<div class="fl-dialog is-narrow" role="alertdialog" aria-modal="true" aria-labelledby="dlg-t"><div class="fl-dlg-body">' +
    `<h2 id="dlg-t">Remove ${n === 1 ? "this entry" : n + " entries"} from the list?</h2><p>${names}</p>` +
    `<div class="fl-explain">${icon("info", 16, "fl-muted")}<div><p>Only the list ${plural(n, "entry is", "entries are")} removed. <strong>Downloaded files stay on disk.</strong>` +
    (inprog ? ` ${inprog} unfinished ${plural(inprog, "download")} will be stopped; partial data of direct downloads is deleted.` : "") +
    (seeding ? ` ${seeding} ${plural(seeding, "torrent stops", "torrents stop")} seeding.` : "") +
    "</p><p>To delete files too, use <strong>Delete downloaded files</strong> instead.</p></div></div>" +
    `</div><div class="fl-dlg-foot"><button class="fl-btn" data-a="closedlg" data-autofocus>Keep</button>` +
    '<button class="fl-btn fl-btn-primary" data-a="doremove">Remove from list</button></div></div>'
  );
}

/** Confirmation for "Delete downloaded files", stating exactly what goes. */
export function deleteHTML(d: Item, scope: DeleteScope | null): string {
  let body: string;
  if (!scope) {
    body = `<p class="fl-hint is-busy" role="status">${icon("spinner", 12, "fl-spin")}Finding the downloaded files…</p>`;
  } else if (scope.fileCount === 0) {
    body = "<p>No downloaded files were found on disk, so only the list entry will be removed.</p>";
  } else {
    const multi = scope.fileCount > 1;
    body =
      `<p>Moves <strong>${scope.fileCount} ${plural(scope.fileCount, "file")} (${fmtSize(scope.totalBytes)})</strong> to the Recycle Bin and removes ${esc(d.name)} from the list.</p>` +
      `<div class="fl-path" style="flex-direction:column;align-items:stretch;gap:2px"><span class="fl-mono" title="${esc(scope.folder)}">${esc(scope.folder)}</span>` +
      scope.examples.map((e) => `<span class="fl-mono fl-subtle">· ${esc(e)}</span>`).join("") +
      (scope.fileCount > scope.examples.length ? `<span class="fl-subtle">and ${scope.fileCount - scope.examples.length} more</span>` : "") +
      "</div>" +
      (multi || d.kind === "torrent" ? "<p>Only files that belong to this download are deleted. Other files in the folder are kept.</p>" : "") +
      (d.status === "seeding" ? "<p>Seeding stops.</p>" : "");
  }
  return (
    '<div class="fl-dialog is-narrow" role="alertdialog" aria-modal="true" aria-labelledby="dlg-t" aria-describedby="dlg-d">' +
    `<div class="fl-dlg-body"><h2 id="dlg-t">Delete downloaded files?</h2><div id="dlg-d" style="display:flex;flex-direction:column;gap:8px;color:var(--ink-muted)">${body.replace(/<p>/g, '<p style="margin:0">')}</div></div>` +
    `<div class="fl-dlg-foot"><button class="fl-btn" data-a="closedlg" data-autofocus>Keep files</button>` +
    `<button class="fl-btn fl-btn-danger-fill" data-a="dodelete"${scope ? "" : " disabled"}>${scope && scope.fileCount === 0 ? "Remove from list" : "Delete files"}</button></div></div>`
  );
}

export type AddStep =
  | "idle" | "typing" | "checking" | "valid" | "invalid" | "error"
  // torrents
  | "fetching" | "reading" | "preview";

export interface AddState {
  url: string;
  step: AddStep;
  error?: string;
  name: string;
  nameClash: boolean;
  size: number | null;
  resumable: boolean;
  folder: string;
  free: number | null;
  ask: boolean;
  /** What the input turned out to be. */
  kind: "direct" | "magnet" | "file";
  /** Name of a picked or dropped .torrent file. */
  fileLabel: string;
  preview: TorrentPreview | null;
  selected: Set<number>;
  autoStart: boolean;
}

export function addHTML(g: AddState, o: { slotsFull: boolean; max: number; queued: number; held: boolean; dragging: boolean }): string {
  const torrent = g.kind !== "direct";
  let hint = "";
  const field = "fl-input is-mono" + (g.step === "invalid" || g.step === "error" ? " is-error" : "");
  switch (g.step) {
    case "idle":
    case "typing":
      hint = '<div class="fl-hint">Paste an http://, https:// or magnet: link, or open a .torrent file.</div>';
      break;
    case "checking":
      hint = `<div class="fl-hint is-busy" role="status">${icon("spinner", 12, "fl-spin")}Checking link with ${esc(hostOf(g.url))}…</div>`;
      break;
    case "valid":
      hint =
        `<div class="fl-hint is-ok" role="status">${icon("check", 12)}<span>Found ${esc(g.name)}` +
        (g.size != null ? ` · ${fmtSize(g.size)}` : " · size unknown") +
        (g.resumable ? " · can resume" : "") +
        "</span></div>";
      break;
    case "fetching":
      hint = `<div class="fl-hint is-busy" role="status">${icon("spinner", 12, "fl-spin")}Fetching torrent details from peers… This can take a minute.</div>`;
      break;
    case "reading":
      hint = `<div class="fl-hint is-busy" role="status">${icon("spinner", 12, "fl-spin")}Reading ${esc(g.fileLabel)}…</div>`;
      break;
    case "preview":
      hint = `<div class="fl-hint is-ok" role="status">${icon("check", 12)}<span>Torrent details found</span></div>`;
      break;
    case "invalid":
      hint = `<div class="fl-hint is-error" role="alert">${icon("alert", 12)}<span>That doesn’t look like a link. Use an http://, https:// or magnet: link.</span></div>`;
      break;
    case "error":
      hint = `<div class="fl-hint is-error" role="alert">${icon("alert", 12)}<span>${esc(g.error ?? "That couldn’t be checked.")}</span></div>`;
      break;
  }
  const ready = g.step === "valid";
  const busy = g.step === "checking" || g.step === "fetching" || g.step === "reading";
  const linkValue = g.kind === "file" ? "" : g.url;
  const urlField =
    '<div class="fl-field"><label class="fl-label" for="dl-url">Link or magnet</label><div class="fl-input-row">' +
    `<div class="${field}">${icon("link")}<input id="dl-url" data-url placeholder="https://example.com/file.zip or magnet:?xt=…" value="${esc(linkValue)}" spellcheck="false" autocomplete="off"${g.step === "invalid" || g.step === "error" ? ' aria-invalid="true"' : ""}>` +
    (busy ? icon("spinner", 14, "fl-spin") : "") +
    `</div><button class="fl-btn" data-a="paste" title="Paste link from clipboard">${icon("paste")}Paste</button></div>${hint}` +
    `<div class="fl-addalt"><button class="fl-btn fl-btn-sm fl-btn-subtle" data-a="pickfile">${icon("folderOpen", 14)}Open .torrent file…</button>` +
    `<span class="fl-subtle">${g.kind === "file" && g.fileLabel ? esc(g.fileLabel) : "or drop one onto this window"}</span></div></div>`;
  const folderField =
    '<div class="fl-field"><label class="fl-label" for="dl-dest">Save to</label><div class="fl-input-row">' +
    `<div class="fl-input is-mono">${icon("folder")}<input id="dl-dest" value="${esc(g.folder)}" readonly title="${esc(g.folder)}">` +
    (g.free != null ? `<span class="fl-suffix fl-num">${fmtSize(g.free)} free</span>` : "") +
    `</div><button class="fl-btn" data-a="browse">Browse…</button></div>` +
    (g.preview ? `<div class="fl-hint">${icon(g.preview.files.length > 1 ? "folder" : "open", 12)}<span>Saved as <strong>${esc(g.preview.saveAs)}</strong></span></div>` : "") +
    "</div>";

  let h = `<div class="fl-dialog${torrent ? " is-wide" : ""}${o.dragging ? " is-drop" : ""}" role="dialog" aria-modal="true" aria-labelledby="dlg-t"><div class="fl-dlg-body"><h2 id="dlg-t">Add download</h2>`;
  h += urlField;
  if (!torrent) {
    const nameField =
      `<div class="fl-field"><label class="fl-label" for="dl-name">File name</label><div class="fl-input${ready ? "" : " is-disabled"}">` +
      (ready ? fileIcon(g.name, 16) : icon("open", 16)) +
      `<input id="dl-name" data-name value="${esc(ready ? g.name : "")}" placeholder="${g.step === "checking" ? "Getting file name…" : "Filled in from the link"}"${ready ? "" : " disabled"} spellcheck="false"></div>` +
      (ready && g.nameClash
        ? `<div class="fl-hint is-warn">${icon("warn", 12)}<span>A file with the server’s name is already in the folder, so Fetchlane will save it as <strong>${esc(g.name)}</strong>.</span></div>`
        : "") +
      "</div>";
    h += g.ask ? folderField + nameField : nameField + folderField;
    if (ready) {
      const msg = o.held
        ? "The queue is on hold. <strong>Download</strong> puts this first in line; <strong>Add to queue</strong> puts it last. Choose Resume all to start them."
        : o.slotsFull
          ? `All ${o.max} download ${plural(o.max, "slot")} are busy. <strong>Download</strong> puts this first in line; <strong>Add to queue</strong> puts it last (#${o.queued + 1}).`
          : "<strong>Download</strong> starts now; <strong>Add to queue</strong> waits behind the other queued downloads.";
      h += `<div class="fl-explain">${icon(o.slotsFull || o.held ? "clock" : "info", 16, "fl-muted")}<div><p>${msg}</p></div></div>`;
    }
  } else {
    if (g.step === "fetching")
      h +=
        `<label class="fl-checkline" data-a="autostart"><button class="fl-check" role="checkbox" aria-checked="${g.autoStart}" tabindex="0">${icon("check", 12)}</button>` +
        '<span>Start automatically after fetching details<br><span class="fl-subtle" style="font-size:12px">Downloads every file. You can change the selection later in Details.</span></span></label>';
    if (g.preview) h += contentsHTML(g.preview, g.selected);
    h += folderField;
  }
  h += '</div><div class="fl-dlg-foot">';
  if (!torrent) {
    h +=
      '<div class="fl-grow"></div><button class="fl-btn" data-a="closedlg">Cancel</button>' +
      `<button class="fl-btn" data-a="addqueue"${ready ? "" : " disabled"} title="Adds to the end of the queue">${icon("queue")}Add to queue</button>` +
      `<button class="fl-btn fl-btn-primary${g.step === "checking" ? " is-loading" : ""}" data-a="dodownload"${ready ? "" : " disabled"}>${g.step === "checking" ? icon("spinner", 16, "fl-spin") : icon("down")}Download</button>`;
  } else {
    const canAdd = (g.step === "preview" && g.selected.size > 0) || (g.step === "fetching" && g.autoStart);
    const note =
      g.step === "preview"
        ? `${g.selected.size} of ${g.preview?.files.length ?? 0} files · ${fmtSize(selectedSize(g))}`
        : g.step === "fetching" && g.autoStart
          ? "Starts as soon as the details arrive"
          : "";
    h +=
      `<span class="fl-foot-note fl-num">${note}</span><div class="fl-grow"></div>` +
      (g.step === "fetching" ? '<button class="fl-btn" data-a="cancelfetch">Cancel fetching</button>' : '<button class="fl-btn" data-a="closedlg">Cancel</button>') +
      (g.step === "preview" ? `<button class="fl-btn" data-a="taddpaused"${canAdd ? "" : " disabled"}>${icon("pause")}Add paused</button>` : "") +
      `<button class="fl-btn fl-btn-primary" data-a="tadd"${canAdd ? "" : " disabled"}>${icon("down")}${g.step === "fetching" ? "Add" : "Download"}</button>`;
  }
  return h + "</div></div>";
}

function selectedSize(g: AddState): number {
  return g.preview ? g.preview.files.filter((f) => g.selected.has(f.index)).reduce((a, f) => a + f.size, 0) : 0;
}

/** Contents preview: every file with a checkbox and its size. */
function contentsHTML(p: TorrentPreview, selected: Set<number>): string {
  const all = selected.size === p.files.length;
  const shown = p.files.slice(0, 500);
  let h =
    `<div class="fl-field"><div class="fl-tsummary">${p.files.length > 1 ? folderIcon(20) : fileIcon(p.name, 20)}` +
    `<div style="min-width:0;flex:1"><div class="fl-fn" title="${esc(p.name)}">${esc(p.name)}</div>` +
    `<div class="fl-subtle fl-num" style="font-size:12px">${kindTag({ kind: "torrent" } as Item)}${p.files.length} ${plural(p.files.length, "file")} · ${fmtSize(p.totalSize)}</div></div>` +
    (p.files.length > 1
      ? `<button class="fl-btn fl-btn-sm fl-btn-subtle" data-a="${all ? "pnone" : "pall"}">${all ? "Select none" : "Select all"}</button>`
      : "") +
    "</div>";
  if (p.files.length > 1) {
    h += '<div class="fl-tfiles is-dialog" role="group" aria-label="Files to download">';
    for (const f of shown) {
      const on = selected.has(f.index);
      h +=
        `<div class="fl-tfile${on ? "" : " is-off"}"><button class="fl-check" role="checkbox" aria-checked="${on}" data-a="pfile" data-i="${f.index}" aria-label="Download ${esc(f.path)}">${icon("check", 12)}</button>` +
        `<span class="fl-tpath" title="${esc(f.path)}">${esc(f.path)}</span><span class="fl-num fl-subtle">${fmtSize(f.size)}</span></div>`;
    }
    if (p.files.length > shown.length) h += `<div class="fl-hint">and ${p.files.length - shown.length} more files (all selected)</div>`;
    h += "</div>";
    if (!selected.size) h += `<div class="fl-hint is-error" role="alert">${icon("alert", 12)}<span>Choose at least one file.</span></div>`;
  }
  return h + "</div>";
}
