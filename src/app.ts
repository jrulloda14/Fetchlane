// The Fetchlane window: state, rendering, live updates and user actions.
// Behaviour follows the design system's reference renderer; every action
// goes to the real backend (see api.ts).
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

import {
  api, type DeleteScope, errorKind, errorMessage, type QueueMove, type Settings, type Snapshot, type TorrentDetails,
} from "./api";
import { driveOf, esc, fmtDur, fmtPair, fmtSize, fmtSpeed, plural, pct } from "./format";
import { icon } from "./icons";
import {
  checkLink, counts, groups, isComplete, isFinished, type Item, structureKey, toItem, type ViewId, VIEWS, visible,
} from "./model";
import {
  type AddState, addHTML, confirmHTML, deleteHTML, detailsHTML, emptyHTML, listHeadHTML, menuItems, removeHTML, selbarHTML,
  settingsHTML, sidebarHTML, sparkHTML, statusbarHTML, tableHTML, titlebarHTML, toolbarHTML,
} from "./views";

type Dialog =
  | { type: "add"; g: AddState; nameEdited: boolean }
  | { type: "cancel"; id: string }
  | { type: "restart"; id: string }
  | { type: "remove"; ids: string[] }
  | { type: "delete"; id: string; scope: DeleteScope | null }
  | { type: "clearhist" };

interface State {
  loaded: boolean;
  loadError: string | null;
  items: Item[];
  byId: Map<string, Item>;
  held: boolean;
  settings: Settings | null;
  version: string;
  view: ViewId | "settings";
  query: string;
  sel: Set<string>;
  focus: string | null;
  anchor: string | null;
  open: string | null;
  revealed: { id: string; url: string } | null;
  spark: boolean;
  menu: { id: string; x: number; y: number; flip: boolean } | null;
  dialog: Dialog | null;
  showEarlier: boolean;
  toast: { text: string; error: boolean } | null;
  /** Free bytes per folder path, refreshed in the background. */
  free: Map<string, number | null>;
  maximized: boolean;
  structKey: string;
  /** Recent speed samples (bytes/s, ~1 per second) per download. */
  history: Map<string, { t: number; v: number[] }>;
  /** Files, peers and trackers of the torrent shown in the details panel. */
  tdetails: { id: string; data: TorrentDetails } | null;
  trackersOpen: boolean;
  /** A .torrent file is being dragged over the window. */
  dragging: boolean;
  /** Magnet details being fetched in the Add download dialog. */
  probeId: string | null;
}

const S: State = {
  loaded: false,
  loadError: null,
  items: [],
  byId: new Map(),
  held: false,
  settings: null,
  version: "",
  view: "all",
  query: "",
  sel: new Set(),
  focus: null,
  anchor: null,
  open: null,
  revealed: null,
  spark: false,
  menu: null,
  dialog: null,
  showEarlier: false,
  toast: null,
  free: new Map(),
  maximized: false,
  structKey: "",
  history: new Map(),
  tdetails: null,
  trackersOpen: false,
  dragging: false,
  probeId: null,
};

const HISTORY_SAMPLES = 900; // 15 minutes at one sample per second
const win = getCurrentWindow();
let root: HTMLElement;
let elTitle: HTMLElement;
let elBody: HTMLElement;
let elLayer: HTMLElement;

/* ---------------- layout ---------------- */

function layout() {
  const W = window.innerWidth;
  // The design docks the panel at 1200 px with a collapsed sidebar; the
  // sidebar always stays expanded here, so dock only when the list keeps
  // at least ~780 px.
  const docked = W >= 1320;
  const detailsOpen = !!S.open && S.view !== "settings";
  // The sidebar always stays expanded; the list gives up room instead.
  const rail = false;
  const listW = W - 200 - (detailsOpen && docked ? 340 : 0);
  return { W, docked, rail, listW, wide: listW >= 1000, narrow: listW < 900 };
}

function currentList(): Item[] {
  return S.view === "settings" ? [] : visible(S.items, S.view, S.query);
}

/** Direct downloads using a download slot. */
function activeCount() {
  return S.items.filter((d) => d.kind === "direct" && (d.status === "downloading" || d.status === "retrying")).length;
}

/** Anything transferring or about to, for Pause all. */
function anyActive() {
  return S.items.some((d) =>
    ["downloading", "retrying", "connecting", "stalled", "checking", "fetching"].includes(d.status),
  );
}

/* ---------------- rendering ---------------- */

function renderTitle() {
  elTitle.innerHTML = titlebarHTML(S.maximized);
}

/** Remember what had focus so a re-render doesn't steal it. */
function focusKey(): string | null {
  const a = document.activeElement as HTMLElement | null;
  if (!a || !root.contains(a)) return null;
  if (a.dataset.row) return `[data-row="${a.dataset.row}"]`;
  if (a.hasAttribute("data-q")) return "[data-q]";
  if (a.hasAttribute("data-url")) return "[data-url]";
  if (a.hasAttribute("data-name")) return "[data-name]";
  if (a.dataset.numk) return `[data-numk="${a.dataset.numk}"]`;
  if (a.dataset.view) return `[data-view="${a.dataset.view}"]`;
  return null;
}

function restoreFocus(key: string | null) {
  if (!key) return;
  const el = root.querySelector<HTMLElement>(key);
  if (!el) return;
  el.focus({ preventScroll: true });
  if (el instanceof HTMLInputElement && el.type !== "checkbox") {
    const v = el.value;
    el.setSelectionRange(v.length, v.length);
  }
}

/** Scrolling regions whose position survives a re-render. */
const SCROLLERS = [".fl-table", ".fl-settings", ".fl-dbody"];

function renderBody(resetScroll = false) {
  const key = focusKey();
  const scrolls = SCROLLERS.map((sel) => (resetScroll ? 0 : root.querySelector(sel)?.scrollTop ?? 0));
  const L = layout();
  const c = counts(S.items);
  let main: string;
  if (!S.loaded) {
    main = S.loadError
      ? `<div class="fl-content"><div class="fl-empty">${icon("alert", 32, "fl-subtle")}<h2>Fetchlane couldn’t start</h2><p>${esc(S.loadError)}</p></div></div>`
      : `<div class="fl-content"><div class="fl-empty" role="status">${icon("spinner", 24, "fl-spin fl-subtle")}<p>Loading downloads…</p></div></div>`;
  } else if (S.view === "settings" && S.settings) {
    main = `<div class="fl-content">${settingsHTML(S.settings, S.items.filter((d) => isFinished(d)).length, S.version)}</div>`;
  } else {
    const list = currentList();
    const openItem = S.open ? S.byId.get(S.open) : undefined;
    main = `<div class="fl-content"><div class="fl-listwrap">${toolbar(L)}${S.items.length ? head(list, L.narrow) : ""}${table(list, L)}</div>`;
    if (openItem) main += details(openItem, !L.docked);
    main += "</div>";
    if (S.items.length) main += statusbar();
  }
  elBody.innerHTML = sidebarHTML(c, S.view, L.rail) + `<main class="fl-main">${main}</main>`;
  SCROLLERS.forEach((sel, i) => {
    const el = root.querySelector(sel);
    if (el) el.scrollTop = scrolls[i];
  });
  restoreFocus(key);
}

function toolbar(L: ReturnType<typeof layout>): string {
  const act = anyActive();
  const hasPaused = S.items.some((d) => d.status === "paused");
  const resume = S.held || (!act && hasPaused);
  return toolbarHTML({
    query: S.query,
    narrow: L.narrow,
    pauseLabel: resume ? "Resume all" : "Pause all",
    pauseDisabled: !act && !hasPaused && !S.held,
  });
}

function head(list: Item[], narrow: boolean): string {
  if (S.sel.size) {
    const sel = S.items.filter((d) => S.sel.has(d.id));
    return selbarHTML(sel, sel.length === list.length && list.length > 0, narrow);
  }
  const v = VIEWS.find((x) => x.id === S.view)!;
  const max = S.settings?.maxConcurrent ?? 4;
  const sub =
    S.view === "queued"
      ? `Starts top to bottom · ${max} at a time${S.held ? " · on hold" : ""}`
      : S.view === "failed"
        ? list.length ? "Need your attention" : ""
        : `${list.length} ${plural(list.length, "item")}`;
  return listHeadHTML({ title: S.query.trim() ? `Results for “${esc(S.query.trim())}”` : v.label, sub });
}

function table(list: Item[], L: ReturnType<typeof layout>): string {
  if (!list.length) return emptyHTML(S.view as ViewId, S.query, S.items.length > 0);
  const compact = S.settings?.density === "compact";
  const o = {
    wide: L.wide,
    queueView: S.view === "queued",
    compact,
    hasTextAction: L.wide && list.some((d) => d.status === "failed"),
    torrents: list.some((d) => d.kind === "torrent"),
  };
  const first = S.focus && list.some((d) => d.id === S.focus) ? S.focus : list[0].id;
  const inline = !(S.open && L.docked);
  return tableHTML(groups(list, S.view as ViewId, S.query), o, (d) => ({
    selected: S.sel.has(d.id),
    anySel: S.sel.size > 0,
    tab: d.id === first,
    open: S.open === d.id,
    inline,
  }), S.showEarlier);
}

function details(d: Item, overlay: boolean): string {
  return detailsHTML(d, {
    overlay,
    revealed: S.revealed?.id === d.id ? S.revealed.url : null,
    spark: S.spark,
    sparkData: sparkData(d.id),
    free: S.free.get(d.folder) ?? null,
    maxConcurrent: S.settings?.maxConcurrent ?? 4,
    queueHeld: S.held,
    torrent: S.tdetails?.id === d.id ? S.tdetails.data : null,
    trackersOpen: S.trackersOpen,
    maxActiveTorrents: S.settings?.maxActiveTorrents ?? 3,
  });
}

function statusbar(): string {
  const dl = S.items.filter((d) => d.status === "downloading");
  const dir = S.settings?.downloadDir ?? "";
  const uploading = S.items.filter((d) => d.up != null);
  return statusbarHTML({
    seeding: S.items.filter((d) => d.status === "seeding").length,
    upSpeed: uploading.length ? uploading.reduce((a, d) => a + (d.up ?? 0), 0) : null,
    downloading: dl.length,
    retrying: S.items.filter((d) => d.status === "retrying").length,
    queued: S.items.filter((d) => d.status === "queued").length,
    totalSpeed: dl.reduce((a, d) => a + (d.speed ?? 0), 0),
    held: S.held,
    drive: driveOf(dir),
    free: S.free.get(dir) ?? null,
    max: S.settings?.maxConcurrent ?? 4,
  });
}

function renderLayer() {
  const key = focusKey();
  let h = "";
  if (S.menu) {
    const d = S.byId.get(S.menu.id);
    if (d) {
      const queued = S.items.filter((x) => x.status === "queued").length;
      h += `<div class="fl-menu" role="menu" aria-label="Actions for ${esc(d.name)}" style="left:${S.menu.x}px;top:${S.menu.y}px">${menuItems(d, queued)}</div>`;
    } else S.menu = null;
  }
  if (S.dialog) h += `<div class="fl-scrim" data-a="scrim">${dialogHTML(S.dialog)}</div>`;
  else if (S.dragging)
    h += `<div class="fl-dropzone" role="status">${icon("down", 32)}<b>Drop a .torrent file to add it</b></div>`;
  if (S.toast)
    h += `<div class="fl-tip fl-toast${S.toast.error ? " is-error" : ""}" role="${S.toast.error ? "alert" : "status"}">${esc(S.toast.text)}</div>`;
  elLayer.innerHTML = h;
  placeMenu();
  restoreFocus(key);
  // A newly shown dialog takes focus: its safe choice, or its first field.
  if (S.dialog && !elLayer.querySelector(".fl-dialog")?.contains(document.activeElement)) {
    elLayer
      .querySelector<HTMLElement>(".fl-dialog [data-autofocus], .fl-dialog input:not([disabled]):not([readonly])")
      ?.focus();
  }
}

/** Keep the menu inside the window, opening upward near the bottom edge. */
function placeMenu() {
  const m = elLayer.querySelector<HTMLElement>(".fl-menu");
  if (!m || !S.menu) return;
  const r = m.getBoundingClientRect();
  let x = S.menu.x;
  let y = S.menu.y;
  if (x + r.width > window.innerWidth - 8) x = window.innerWidth - r.width - 8;
  if (y + r.height > window.innerHeight - 8) y = S.menu.flip ? S.menu.y - r.height - 40 : window.innerHeight - r.height - 8;
  m.style.left = Math.max(8, x) + "px";
  m.style.top = Math.max(36, y) + "px";
}

function dialogHTML(g: Dialog): string {
  switch (g.type) {
    case "add": {
      const max = S.settings?.maxConcurrent ?? 4;
      return addHTML(g.g, {
        slotsFull: activeCount() >= max,
        max,
        queued: S.items.filter((d) => d.status === "queued" && d.kind === "direct").length,
        held: S.held,
        dragging: S.dragging,
      });
    }
    case "restart": {
      const d = S.byId.get(g.id);
      if (!d) return "";
      const why =
        d.errorKind === "cannotResume" || !d.resumable
          ? `<p><strong>${esc(d.host)}</strong> can’t continue a partial download.</p>`
          : "";
      return confirmHTML(
        "Restart download from the beginning?",
        why +
          `<p>Restarting <strong>deletes the ${fmtSize(d.done)} already downloaded</strong> and downloads ` +
          (d.total != null ? `all ${fmtSize(d.total)} of ` : "") +
          `${esc(d.name)} again.</p>`,
        "Delete partial and restart",
        "dorestart",
      );
    }
    case "cancel": {
      const d = S.byId.get(g.id);
      if (!d) return "";
      return confirmHTML(
        "Cancel this download?",
        `<p>Cancelling stops <strong>${esc(d.name)}</strong> and <strong>deletes the ${d.done ? fmtSize(d.done) + " partial file" : "partial file"}</strong>. The entry stays in your list as Cancelled.</p>` +
          (d.canPause ? "<p>To keep the progress instead, choose Pause.</p>" : ""),
        "Cancel download",
        "docancel",
        d.status === "queued" ? "Keep in queue" : "Keep downloading",
      );
    }
    case "remove": {
      const items = g.ids.map((id) => S.byId.get(id)).filter((d): d is Item => !!d);
      return items.length ? removeHTML(items) : "";
    }
    case "delete": {
      const d = S.byId.get(g.id);
      return d ? deleteHTML(d, g.scope) : "";
    }
    case "clearhist": {
      const n = S.items.filter(isFinished).length;
      return confirmHTML(
        `Clear ${n} completed ${plural(n, "entry", "entries")} from the list?`,
        "<p>Completed and cancelled entries are removed from the list. <strong>Downloaded files stay on disk.</strong> Torrents that are still seeding stay in the list.</p>",
        "Clear from list",
        "doclearhist",
        "Keep",
      );
    }
  }
}

function render() {
  renderBody();
  renderLayer();
}

/** Re-render only the details panel (keeps the list's hover and focus). */
function renderDetails() {
  const panel = root.querySelector(".fl-details");
  const d = S.open ? S.byId.get(S.open) : undefined;
  if (!panel || !d) return;
  const scroll = panel.querySelector(".fl-dbody")?.scrollTop ?? 0;
  const files = panel.querySelector(".fl-tfiles")?.scrollTop ?? 0;
  panel.outerHTML = details(d, !layout().docked);
  const fresh = root.querySelector(".fl-details");
  const body = fresh?.querySelector(".fl-dbody");
  if (body) body.scrollTop = scroll;
  const list = fresh?.querySelector(".fl-tfiles");
  if (list) list.scrollTop = files;
}

async function pollTorrentDetails() {
  const d = S.open ? S.byId.get(S.open) : undefined;
  if (!d || d.kind !== "torrent") return;
  try {
    const data = await api.torrentDetails(d.id);
    if (S.open !== d.id) return;
    S.tdetails = { id: d.id, data };
    renderDetails();
  } catch {
    /* the torrent may have just been removed */
  }
}

/**
 * Apply selection, focus and "open" changes to the existing rows instead of
 * re-rendering, so double-clicks, hover and keyboard focus survive.
 */
function syncSelection() {
  const rows = root.querySelectorAll<HTMLElement>("[data-row]");
  if (!rows.length) return renderBody();
  const any = S.sel.size > 0;
  rows.forEach((r) => {
    const id = r.dataset.row!;
    const sel = S.sel.has(id);
    r.classList.toggle("is-selected", sel);
    r.classList.toggle("is-open", S.open === id);
    r.setAttribute("aria-selected", String(sel));
    r.tabIndex = id === S.focus ? 0 : -1;
    const c = r.querySelector<HTMLElement>(".fl-check");
    if (c) {
      c.setAttribute("aria-checked", String(sel));
      c.classList.toggle("fl-hover-only", !sel && !any);
    }
  });
  const h = root.querySelector(".fl-selbar, .fl-listhead");
  if (h) h.outerHTML = head(currentList(), layout().narrow);
}

/* ---------------- live updates ---------------- */

function sparkData(id: string): number[] {
  const v = S.history.get(id)?.v ?? [];
  if (v.length <= 150) return v;
  // Average into at most 150 points so the path stays light.
  const step = v.length / 150;
  const out: number[] = [];
  for (let i = 0; i < 150; i++) {
    const a = Math.floor(i * step);
    const b = Math.max(a + 1, Math.floor((i + 1) * step));
    const part = v.slice(a, b);
    out.push(part.reduce((x, y) => x + y, 0) / part.length);
  }
  return out;
}

function recordSpeeds(now: number) {
  for (const d of S.items) {
    if (d.status !== "downloading" || d.speed == null) continue;
    let h = S.history.get(d.id);
    if (!h) S.history.set(d.id, (h = { t: 0, v: [] }));
    if (now - h.t < 900) continue;
    h.t = now;
    h.v.push(d.speed);
    if (h.v.length > HISTORY_SAMPLES) h.v.shift();
  }
  for (const id of S.history.keys()) if (!S.byId.has(id)) S.history.delete(id);
}

function apply(snap: Snapshot) {
  const before = new Map(S.items.map((d) => [d.id, d.status]));
  S.items = snap.downloads.map(toItem);
  S.byId = new Map(S.items.map((d) => [d.id, d]));
  S.held = snap.queueHeld;
  for (const id of [...S.sel]) if (!S.byId.has(id)) S.sel.delete(id);
  if (S.open && !S.byId.has(S.open)) S.open = null;
  if (S.tdetails && S.tdetails.id !== S.open) S.tdetails = null;
  if (S.menu && !S.byId.has(S.menu.id)) S.menu = null;
  if (S.focus && !S.byId.has(S.focus)) S.focus = null;
  recordSpeeds(Date.now());
  // A download that just finished frees or uses disk space.
  if (S.items.some((d) => d.status === "completed" && before.get(d.id) && before.get(d.id) !== "completed")) refreshFree();

  const key = structureKey(S.items, S.held);
  if (key !== S.structKey || !S.loaded) {
    S.structKey = key;
    S.loaded = true;
    renderBody();
    if (S.menu || S.dialog) renderLayer();
  } else {
    patch();
  }
}

/** Update numbers in place without rebuilding rows (keeps hover and focus). */
function patch() {
  const set = (k: string, v: string) => {
    root.querySelectorAll<HTMLElement>(`[data-m="${k}"]`).forEach((el) => {
      if (el.textContent !== v) el.textContent = v;
    });
  };
  for (const d of S.items) {
    if (d.status === "retrying") {
      set(`retry-${d.id}`, String(d.retryIn ?? 0));
      set(`retry2-${d.id}`, String(d.retryIn ?? 0));
    }
    if (d.kind === "torrent" && d.up != null) {
      set(`up-${d.id}`, fmtSpeed(d.up) || "0 KB/s");
      set(`upd-${d.id}`, fmtSpeed(d.up) || "0 KB/s");
    }
    if (!["downloading", "connecting", "stalled", "checking"].includes(d.status)) continue;
    const p = pct(d.done, d.total);
    if (d.speed != null) {
      set(`speed-${d.id}`, fmtSpeed(d.speed));
      set(`speedd-${d.id}`, fmtSpeed(d.speed));
    }
    if (d.eta != null) {
      set(`eta-${d.id}`, fmtDur(d.eta));
      set(`etad-${d.id}`, fmtDur(d.eta, true));
    }
    if (p != null && d.total) {
      set(`pct-${d.id}`, p + "%");
      set(`pctbig-${d.id}`, p + "%");
      set(`of-${d.id}`, fmtSize(d.done) + " of " + fmtSize(d.total));
      root.querySelectorAll<HTMLElement>(`[data-m="bar-${d.id}"]`).forEach((b) => {
        b.style.width = ((d.done / d.total!) * 100).toFixed(2) + "%";
      });
    } else {
      set(`pctbig-${d.id}`, fmtSize(d.done));
    }
    root.querySelectorAll<HTMLElement>(`[data-m="size-${d.id}"]`).forEach((el) => {
      const html = fmtPair(d.done, d.total);
      if (el.innerHTML !== html) el.innerHTML = html;
    });
  }
  const total = S.items.filter((d) => d.status === "downloading").reduce((a, d) => a + (d.speed ?? 0), 0);
  set("total-speed", fmtSpeed(total) || "0 KB/s");
  const up = S.items.filter((d) => d.up != null).reduce((a, d) => a + (d.up ?? 0), 0);
  set("total-up", fmtSpeed(up) || "0 KB/s");
  if (S.open && S.spark) {
    const el = root.querySelector(`[data-m="spark-${S.open}"]`);
    if (el) el.outerHTML = sparkHTML(S.open, sparkData(S.open));
  }
}

/* ---------------- background data ---------------- */

async function refreshFree(extra?: string) {
  const dirs = new Set<string>();
  if (S.settings) dirs.add(S.settings.downloadDir);
  if (extra) dirs.add(extra);
  const open = S.open ? S.byId.get(S.open) : undefined;
  if (open?.errorKind === "diskFull") dirs.add(open.folder);
  let changed = false;
  for (const dir of dirs) {
    try {
      const v = await api.freeSpace(dir);
      if (S.free.get(dir) !== v) {
        S.free.set(dir, v);
        changed = true;
      }
    } catch {
      /* free space is informational only */
    }
  }
  if (changed) {
    renderBody();
    if (S.dialog?.type === "add") {
      S.dialog.g.free = S.free.get(S.dialog.g.folder) ?? null;
      renderLayer();
    }
  }
}

function applyTheme() {
  const t = S.settings?.theme ?? "system";
  const dark = t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
}

/* ---------------- feedback ---------------- */

let toastTimer: number | undefined;
function toast(text: string, error = false) {
  S.toast = { text, error };
  renderLayer();
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    S.toast = null;
    renderLayer();
  }, error ? 5000 : 2200);
}

/** Run a backend call; show its error message if it fails. */
async function run<T>(p: Promise<T>, ok?: string): Promise<T | undefined> {
  try {
    const r = await p;
    if (ok) toast(ok);
    return r;
  } catch (e) {
    toast(errorMessage(e), true);
    return undefined;
  }
}

/* ---------------- add download ---------------- */

function openAdd(url = "", torrentFile?: string) {
  const folder = S.settings?.downloadDir ?? "";
  cancelFetch();
  S.menu = null;
  S.dialog = {
    type: "add",
    nameEdited: false,
    g: {
      url, step: "idle", name: "", nameClash: false, size: null, resumable: false,
      folder, free: S.free.get(folder) ?? null, ask: !!S.settings?.askEachTime,
      kind: "direct", fileLabel: "", preview: null, selected: new Set(), autoStart: false,
    },
  };
  renderLayer();
  const input = elLayer.querySelector<HTMLInputElement>("[data-url]");
  input?.focus();
  if (torrentFile) void openTorrentFile(torrentFile);
  else if (url) checkLink_();
  else if (S.settings?.askEachTime) void browseAddFolder();
  void refreshFree(folder);
}

function newProbeId(): string {
  return "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Stop a magnet fetch started from the dialog, if any. */
function cancelFetch() {
  if (S.probeId) {
    void api.cancelTorrentProbe(S.probeId).catch(() => {});
    S.probeId = null;
  }
}

async function fetchMagnet(dlg: Extract<Dialog, { type: "add" }>) {
  const g = dlg.g;
  cancelFetch();
  const probeId = newProbeId();
  S.probeId = probeId;
  g.kind = "magnet";
  g.step = "fetching";
  g.preview = null;
  renderLayer();
  try {
    const p = await api.probeTorrent({ type: "magnet", value: g.url.trim() }, probeId, g.folder);
    if (S.dialog !== dlg || S.probeId !== probeId) return;
    S.probeId = null;
    if (g.autoStart) {
      // Details arrived while "start automatically" was ticked: add it now.
      g.preview = p;
      g.selected = new Set(p.files.map((f) => f.index));
      g.step = "preview";
      return submitTorrent(false);
    }
    g.preview = p;
    g.selected = new Set(p.files.map((f) => f.index));
    g.step = "preview";
  } catch (e) {
    if (S.dialog !== dlg || S.probeId !== probeId) return;
    S.probeId = null;
    g.step = "error";
    g.error = errorMessage(e);
  }
  renderLayer();
}

async function openTorrentFile(path: string) {
  const dlg = S.dialog;
  if (dlg?.type !== "add") return openAdd("", path);
  const g = dlg.g;
  cancelFetch();
  g.kind = "file";
  g.url = path;
  g.fileLabel = path.split(/[\\/]/).pop() ?? path;
  g.step = "reading";
  g.preview = null;
  renderLayer();
  try {
    const p = await api.probeTorrent({ type: "file", value: path }, newProbeId(), g.folder);
    if (S.dialog !== dlg) return;
    g.preview = p;
    g.selected = new Set(p.files.map((f) => f.index));
    g.step = "preview";
  } catch (e) {
    if (S.dialog !== dlg) return;
    g.step = "error";
    g.error = errorMessage(e);
  }
  renderLayer();
}

async function pickTorrentFile() {
  const picked = await openDialog({ multiple: false, filters: [{ name: "Torrent files", extensions: ["torrent"] }], title: "Open a .torrent file" });
  if (typeof picked === "string") await openTorrentFile(picked);
}

async function submitTorrent(paused: boolean) {
  const dlg = S.dialog;
  if (dlg?.type !== "add") return;
  const g = dlg.g;
  let req;
  if (g.step === "preview" && g.preview) {
    if (!g.selected.size) return;
    const all = g.selected.size === g.preview.files.length;
    req = { probeId: g.preview.probeId, destDir: g.folder, selected: all ? undefined : [...g.selected].sort((a, b) => a - b), startPaused: paused };
  } else if (g.step === "fetching" && g.autoStart) {
    cancelFetch();
    req = { magnet: g.url.trim(), destDir: g.folder, startPaused: false };
  } else return;
  const v = await run(api.addTorrent(req));
  if (!v) return;
  S.dialog = null;
  S.sel.clear();
  S.focus = v.id;
  renderLayer();
  toast(req.magnet ? "Torrent added · it starts once its details arrive" : paused ? "Torrent added, paused" : "Torrent added");
}

let checkSeq = 0;
let checkTimer: number | undefined;

async function checkLink_() {
  const dlg = S.dialog;
  if (dlg?.type !== "add") return;
  const g = dlg.g;
  window.clearTimeout(checkTimer);
  const seq = ++checkSeq;
  const kind = checkLink(g.url);
  if (kind === "magnet") return fetchMagnet(dlg);
  cancelFetch();
  g.kind = "direct";
  g.preview = null;
  if (kind === "empty" || kind === "typing") g.step = "idle";
  else if (kind === "invalid") g.step = kind;
  if (kind !== "ok") {
    renderLayer();
    return;
  }
  g.step = "checking";
  renderLayer();
  try {
    const r = await api.probe(g.url.trim(), g.folder);
    if (seq !== checkSeq || S.dialog !== dlg) return;
    g.step = "valid";
    if (!dlg.nameEdited) g.name = r.suggestedName;
    g.nameClash = r.nameClash && !dlg.nameEdited;
    g.size = r.totalSize;
    g.resumable = r.resumable;
  } catch (e) {
    if (seq !== checkSeq || S.dialog !== dlg) return;
    g.step = "error";
    g.error = errorMessage(e);
  }
  renderLayer();
}

async function browseAddFolder() {
  const dlg = S.dialog;
  if (dlg?.type !== "add") return;
  const picked = await openDialog({ directory: true, defaultPath: dlg.g.folder, title: "Save downloads to" });
  if (typeof picked !== "string" || S.dialog !== dlg) return;
  dlg.g.folder = picked;
  dlg.g.free = null;
  renderLayer();
  void refreshFree(picked);
  if (dlg.g.step === "valid" && !dlg.nameEdited) void checkLink_();
  // The name a torrent is saved as depends on the folder.
  if (dlg.g.kind === "file" && dlg.g.step === "preview") void openTorrentFile(dlg.g.url);
}

async function submitAdd(queueFirst: boolean) {
  const dlg = S.dialog;
  if (dlg?.type !== "add" || dlg.g.step !== "valid") return;
  const g = dlg.g;
  const v = await run(
    api.add({ url: g.url.trim(), destDir: g.folder, fileName: g.name.trim() || undefined, queueFirst }),
  );
  if (!v) return;
  S.dialog = null;
  S.sel.clear();
  S.focus = v.id;
  renderLayer();
  toast(v.status === "queued" ? `Added to queue as #${v.queuePosition ?? 1}` : v.status === "paused" ? "Added, paused" : "Download started");
}

async function pasteInto() {
  try {
    const text = (await readText())?.trim() ?? "";
    const dlg = S.dialog;
    if (dlg?.type !== "add") return;
    if (!text) {
      toast("The clipboard doesn’t contain a link.", true);
      return;
    }
    dlg.g.url = text;
    dlg.g.kind = "direct";
    void checkLink_();
  } catch {
    toast("Couldn’t read the clipboard. Paste with Ctrl+V instead.", true);
  }
}

/* ---------------- actions ---------------- */

function selected(): Item[] {
  return S.items.filter((d) => S.sel.has(d.id));
}

function openMenu(id: string, x: number, y: number, flip: boolean) {
  S.menu = S.menu?.id === id ? null : { id, x, y, flip };
  renderLayer();
  elLayer.querySelector<HTMLElement>(".fl-mi:not([disabled])")?.focus();
}

async function updateSettings(patch: Partial<Settings>) {
  if (!S.settings) return;
  const next = await run(api.updateSettings({ ...S.settings, ...patch }));
  if (!next) return;
  S.settings = next;
  applyTheme();
  renderBody();
  void refreshFree();
}

async function act(a: string, id: string | null, el: HTMLElement) {
  const d = id ? S.byId.get(id) : undefined;
  if (a !== "menu" && S.menu) {
    S.menu = null;
    renderLayer();
  }
  switch (a) {
    case "add":
      return openAdd();
    case "pastenew":
      openAdd();
      return pasteInto();
    case "paste":
      return pasteInto();
    case "browse":
      return browseAddFolder();
    case "closedlg":
      cancelFetch();
      S.dialog = null;
      return renderLayer();
    case "scrim":
      if (el === elLayer.querySelector(".fl-scrim")) {
        cancelFetch();
        S.dialog = null;
        renderLayer();
      }
      return;
    case "pickfile":
      return pickTorrentFile();
    case "cancelfetch": {
      cancelFetch();
      if (S.dialog?.type === "add") {
        S.dialog.g.step = "idle";
        S.dialog.g.kind = "direct";
      }
      return renderLayer();
    }
    case "autostart":
      if (S.dialog?.type === "add") S.dialog.g.autoStart = !S.dialog.g.autoStart;
      return renderLayer();
    case "pfile":
    case "pall":
    case "pnone": {
      if (S.dialog?.type !== "add" || !S.dialog.g.preview) return;
      const g = S.dialog.g;
      if (a === "pall") g.selected = new Set(g.preview!.files.map((f) => f.index));
      else if (a === "pnone") g.selected = new Set();
      else {
        const i = Number(el.dataset.i);
        if (g.selected.has(i)) g.selected.delete(i);
        else g.selected.add(i);
      }
      const scroll = elLayer.querySelector(".fl-tfiles")?.scrollTop ?? 0;
      renderLayer();
      const list = elLayer.querySelector(".fl-tfiles");
      if (list) list.scrollTop = scroll;
      elLayer.querySelector<HTMLElement>(a === "pfile" ? `[data-a="pfile"][data-i="${el.dataset.i}"]` : "[data-a=pall],[data-a=pnone]")?.focus();
      return;
    }
    case "tadd":
      return submitTorrent(false);
    case "taddpaused":
      return submitTorrent(true);
    case "recheck":
      return void run(api.recheck(id!), "Checking files…");
    case "trackers":
      S.trackersOpen = !S.trackersOpen;
      return renderDetails();
    case "tfile": {
      const t = S.tdetails?.id === id ? S.tdetails.data : null;
      if (!t) return;
      const i = Number(el.dataset.i);
      const next = new Set(t.files.filter((f) => f.selected).map((f) => f.index));
      if (next.has(i)) next.delete(i);
      else next.add(i);
      if (!next.size) return toast("At least one file must stay selected.", true);
      for (const f of t.files) f.selected = next.has(f.index);
      renderDetails();
      await run(api.setTorrentFiles(id!, [...next].sort((x, y) => x - y)));
      return void pollTorrentDetails();
    }
    case "delete": {
      const dlg: Dialog = { type: "delete", id: id!, scope: null };
      S.dialog = dlg;
      renderLayer();
      try {
        const scope = await api.deleteScope(id!);
        if (S.dialog === dlg) {
          dlg.scope = scope;
          renderLayer();
        }
      } catch (e) {
        S.dialog = null;
        renderLayer();
        toast(errorMessage(e), true);
      }
      return;
    }
    case "dodelete": {
      if (S.dialog?.type !== "delete") return;
      const target = S.dialog.id;
      S.dialog = null;
      renderLayer();
      await run(api.remove(target, true), "Files moved to the Recycle Bin");
      return;
    }
    case "dodownload":
      return submitAdd(true);
    case "addqueue":
      return submitAdd(false);

    case "pause":
      return void run(api.pause(id!));
    case "resume":
    case "again":
      return void run(api.resume(id!));
    case "start":
      return void run(api.startNow(id!));
    case "retry":
    case "retrynow":
      return void run(api.retryNow(id!));
    case "restart":
      S.dialog = { type: "restart", id: id! };
      return renderLayer();
    case "dorestart": {
      const target = S.dialog?.type === "restart" ? S.dialog.id : null;
      S.dialog = null;
      renderLayer();
      if (target) await run(api.restart(target), "Restarted from the beginning");
      return;
    }
    case "cancel":
      S.dialog = { type: "cancel", id: id! };
      return renderLayer();
    case "docancel": {
      const target = S.dialog?.type === "cancel" ? S.dialog.id : null;
      S.dialog = null;
      renderLayer();
      if (target) await run(api.cancel(target));
      return;
    }
    case "remove":
      S.dialog = { type: "remove", ids: [id!] };
      return renderLayer();
    case "selremove":
      S.dialog = { type: "remove", ids: [...S.sel] };
      return renderLayer();
    case "doremove": {
      if (S.dialog?.type !== "remove") return;
      const { ids } = S.dialog;
      const del = false;
      S.dialog = null;
      renderLayer();
      let failed = 0;
      for (const rid of ids) {
        try {
          await api.remove(rid, del);
          S.sel.delete(rid);
        } catch (e) {
          failed++;
          toast(errorMessage(e), true);
        }
      }
      if (!failed) {
        const n = ids.length;
        toast(`${n} ${plural(n, "entry", "entries")} removed · ${del ? "files moved to Recycle Bin" : "files kept on disk"}`);
      }
      return;
    }
    case "clearhist":
      S.dialog = { type: "clearhist" };
      return renderLayer();
    case "doclearhist":
      S.dialog = null;
      renderLayer();
      return void run(api.clearFinished(), "Completed entries cleared · files kept on disk");

    case "openfile":
      return void run(api.openFile(id!));
    case "openfolder":
      return void run(api.showInFolder(id!));
    case "copylink":
      return void run(api.copySourceUrl(id!), d?.kind === "torrent" ? "Magnet link copied" : "Full link copied");
    case "reveal":
      if (S.revealed?.id === id) S.revealed = null;
      else {
        const url = await run(api.sourceUrl(id!));
        if (url) S.revealed = { id: id!, url };
      }
      return renderBody();
    case "spark":
      S.spark = !S.spark;
      return renderBody();
    case "details":
      S.open = id;
      S.revealed = null;
      void refreshFree();
      renderBody();
      return void pollTorrentDetails();
    case "closepanel":
      S.open = null;
      return renderBody();

    case "menu": {
      const r = el.getBoundingClientRect();
      return openMenu(id!, r.right - 228, r.bottom + 4, true);
    }
    case "top":
    case "up":
    case "downq":
      return void run(api.move(id!, (a === "downq" ? "down" : a) as QueueMove));

    case "pauseall": {
      const resume = S.held || (!anyActive() && S.items.some((x) => x.status === "paused"));
      return void run(resume ? api.resumeAll() : api.pauseAll());
    }
    case "selpause":
      for (const x of selected())
        if (["downloading", "connecting", "stalled", "checking", "fetching"].includes(x.status) ? x.canPause : x.status === "retrying")
          await run(api.pause(x.id));
      return;
    case "selresume":
      for (const x of selected()) {
        if (x.status === "paused") await run(api.resume(x.id));
        else if (x.status === "queued") await run(api.startNow(x.id));
      }
      return;
    case "selretry":
      for (const x of selected()) if (x.status === "failed" && x.errorKind !== "cannotResume") await run(api.retryNow(x.id));
      return;
    case "seltop": {
      const q = selected().filter((x) => x.status === "queued" && x.kind === "direct").sort((p, n) => (n.pos ?? 0) - (p.pos ?? 0));
      for (const x of q) await run(api.move(x.id, "top"));
      return;
    }
    case "clearsel":
      S.sel.clear();
      return syncSelection();
    case "selall": {
      const l = currentList();
      if (S.sel.size === l.length) S.sel.clear();
      else l.forEach((x) => S.sel.add(x.id));
      return syncSelection();
    }
    case "check":
      if (S.sel.has(id!)) S.sel.delete(id!);
      else S.sel.add(id!);
      S.anchor = id;
      S.focus = id;
      return syncSelection();
    case "clearq":
      S.query = "";
      return renderBody();
    case "older":
      S.showEarlier = !S.showEarlier;
      return renderBody();

    case "browsedefault": {
      if (!S.settings) return;
      const picked = await openDialog({ directory: true, defaultPath: S.settings.downloadDir, title: "Default download folder" });
      if (typeof picked === "string") await updateSettings({ downloadDir: picked });
      return;
    }
    case "num": {
      if (!S.settings) return;
      const k = el.dataset.k as keyof Settings;
      const cur = Number(S.settings[k]);
      const next = Math.min(Number(el.dataset.max ?? Infinity), Math.max(Number(el.dataset.min ?? 0), cur + Number(el.dataset.d)));
      return updateSettings({ [k]: next } as Partial<Settings>);
    }
  }
  void d;
}

/* ---------------- row selection ---------------- */

function orderedIds(): string[] {
  return Array.from(root.querySelectorAll<HTMLElement>("[data-row]")).map((r) => r.dataset.row!);
}

function selectRange(a: string, b: string) {
  const l = orderedIds();
  const i = l.indexOf(a);
  const j = l.indexOf(b);
  if (i < 0 || j < 0) return;
  S.sel = new Set(l.slice(Math.min(i, j), Math.max(i, j) + 1));
}

function focusRow(id: string) {
  const r = root.querySelector<HTMLElement>(`[data-row="${id}"]`);
  r?.focus();
  r?.scrollIntoView({ block: "nearest" });
}

/* ---------------- drag to reorder (Queued list) ---------------- */

function startDrag(id: string, e: PointerEvent) {
  const rows = Array.from(root.querySelectorAll<HTMLElement>("[data-row]"));
  const others = rows.filter((r) => r.dataset.row !== id);
  const dragged = rows.find((r) => r.dataset.row === id);
  if (!dragged) return;
  e.preventDefault();
  dragged.classList.add("is-dragging");
  let index = -1;
  const clear = () => others.forEach((r) => r.classList.remove("is-drop-before", "is-drop-after"));
  const move = (ev: PointerEvent) => {
    clear();
    index = others.length;
    for (let i = 0; i < others.length; i++) {
      const b = others[i].getBoundingClientRect();
      if (ev.clientY < b.top + b.height / 2) {
        index = i;
        break;
      }
    }
    if (index < others.length) others[index].classList.add("is-drop-before");
    else if (others.length) others[others.length - 1].classList.add("is-drop-after");
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    clear();
    dragged.classList.remove("is-dragging");
    if (index >= 0) void run(api.moveTo(id, index + 1));
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

/* ---------------- events ---------------- */

function onClick(e: MouseEvent) {
  const target = e.target as HTMLElement;
  const winBtn = target.closest<HTMLElement>("[data-win]");
  if (winBtn) {
    const w = winBtn.dataset.win;
    if (w === "minimize") void win.minimize();
    if (w === "maximize") void win.toggleMaximize();
    if (w === "close") void win.close();
    return;
  }
  const t = target.closest<HTMLElement>("[data-a],[data-view],[data-density],[data-set],[data-setv],[data-row]");
  if (!t || !root.contains(t)) {
    if (S.menu) {
      S.menu = null;
      renderLayer();
    }
    return;
  }
  if (t.dataset.view) {
    S.view = t.dataset.view as State["view"];
    S.sel.clear();
    S.menu = null;
    S.query = "";
    renderBody(true);
    renderLayer();
    return;
  }
  if (t.dataset.density) return void updateSettings({ density: t.dataset.density as Settings["density"] });
  if (t.dataset.set && S.settings) {
    const k = t.dataset.set as keyof Settings;
    return void updateSettings({ [k]: !S.settings[k] } as Partial<Settings>);
  }
  if (t.dataset.setv) {
    const [k, v] = t.dataset.setv.split(":");
    return void updateSettings({ [k]: v } as Partial<Settings>);
  }
  if (t.dataset.a) {
    e.stopPropagation();
    if ((t as HTMLButtonElement).disabled) return;
    void act(t.dataset.a, t.dataset.id ?? null, t);
    return;
  }
  const id = t.dataset.row!;
  const openBefore = S.open;
  if (e.shiftKey && S.anchor) selectRange(S.anchor, id);
  else if (e.ctrlKey || e.metaKey) {
    if (S.sel.has(id)) S.sel.delete(id);
    else S.sel.add(id);
    S.anchor = id;
  } else {
    S.sel = new Set([id]);
    S.anchor = id;
    if (S.open) {
      S.open = id;
      S.revealed = null;
    }
  }
  S.focus = id;
  if (S.menu) {
    S.menu = null;
    renderLayer();
  }
  if (S.open !== openBefore) {
    renderBody();
    void pollTorrentDetails();
  } else syncSelection();
}

function onDblClick(e: MouseEvent) {
  const target = e.target as HTMLElement;
  if (target.closest("[data-a]")) return;
  const r = target.closest<HTMLElement>("[data-row]");
  if (!r) return;
  const d = S.byId.get(r.dataset.row!);
  if (!d) return;
  if (isComplete(d)) void run(api.openFile(d.id));
  else {
    S.open = d.id;
    S.revealed = null;
    renderBody();
    void pollTorrentDetails();
  }
}

function onInput(e: Event) {
  const t = e.target as HTMLInputElement;
  if (t.hasAttribute("data-q")) {
    S.query = t.value;
    S.sel.clear();
    renderBody();
  } else if (t.hasAttribute("data-url") && S.dialog?.type === "add") {
    S.dialog.g.url = t.value;
    if (S.dialog.g.kind === "file") S.dialog.g.kind = "direct";
    window.clearTimeout(checkTimer);
    checkTimer = window.setTimeout(() => void checkLink_(), 350);
  } else if (t.hasAttribute("data-name") && S.dialog?.type === "add") {
    S.dialog.g.name = t.value;
    S.dialog.nameEdited = true;
  }
}

function onChange(e: Event) {
  const t = e.target as HTMLInputElement;
  if (t.dataset.numk && S.settings) {
    const k = t.dataset.numk as keyof Settings;
    const n = Math.round(Number(t.value.replace(",", ".")) * Number(t.dataset.scale ?? 1));
    const v = Number.isFinite(n) ? Math.min(Number(t.dataset.max), Math.max(Number(t.dataset.min), n)) : Number(S.settings[k]);
    void updateSettings({ [k]: v } as Partial<Settings>);
  }
}

function onKeyDown(e: KeyboardEvent) {
  const ctrl = e.ctrlKey || e.metaKey;
  if (S.menu) {
    const items = Array.from(elLayer.querySelectorAll<HTMLElement>(".fl-mi:not([disabled])"));
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
    } else if (e.key === "Escape") {
      const mid = S.menu.id;
      S.menu = null;
      renderLayer();
      focusRow(mid);
    } else if (e.key === "Tab") e.preventDefault();
    return;
  }
  if (S.dialog) {
    if (e.key === "Escape") {
      cancelFetch();
      S.dialog = null;
      renderLayer();
    } else if (e.key === "Enter" && S.dialog.type === "add" && S.dialog.g.step === "valid") {
      e.preventDefault();
      void submitAdd(true);
    } else if (e.key === "Enter" && S.dialog.type === "add" && S.dialog.g.step === "preview" && (e.target as HTMLElement).tagName === "INPUT") {
      e.preventDefault();
      void submitTorrent(false);
    } else if (e.key === "Tab") trapFocus(e);
    return;
  }
  const t = e.target as HTMLElement;
  if (ctrl && e.key.toLowerCase() === "n") {
    e.preventDefault();
    return openAdd();
  }
  if (ctrl && e.key.toLowerCase() === "f") {
    e.preventDefault();
    if (S.view === "settings") {
      S.view = "all";
      render();
    }
    root.querySelector<HTMLInputElement>("[data-q]")?.focus();
    return;
  }
  if (t.tagName === "INPUT") {
    if (t.hasAttribute("data-q")) {
      if (e.key === "Escape") {
        S.query = "";
        renderBody();
      } else if (e.key === "ArrowDown") root.querySelector<HTMLElement>(".fl-row")?.focus();
    }
    return;
  }
  const row = t.closest?.<HTMLElement>("[data-row]");
  if (!row) {
    if (e.key === "Escape" && S.open) {
      S.open = null;
      renderBody();
    }
    return;
  }
  const ids = orderedIds();
  const id = row.dataset.row!;
  const idx = ids.indexOf(id);
  const d = S.byId.get(id);
  if (!d) return;
  const go = (n: number) => {
    n = Math.max(0, Math.min(ids.length - 1, n));
    const nid = ids[n];
    if (e.shiftKey) selectRange(S.anchor ?? id, nid);
    else if (!ctrl) {
      if (S.sel.size > 1 || S.sel.has(id)) S.sel = new Set([nid]);
      S.anchor = nid;
    }
    S.focus = nid;
    if (S.open && S.open !== nid) {
      S.open = nid;
      S.revealed = null;
      renderBody();
    } else syncSelection();
    focusRow(nid);
  };
  if (e.altKey && d.status === "queued" && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
    e.preventDefault();
    void run(api.move(id, e.key === "ArrowUp" ? "up" : "down"));
    return;
  }
  switch (e.key) {
    case "ArrowDown":
      e.preventDefault();
      return go(idx + 1);
    case "ArrowUp":
      e.preventDefault();
      return go(idx - 1);
    case "Home":
      e.preventDefault();
      return go(0);
    case "End":
      e.preventDefault();
      return go(ids.length - 1);
    case " ":
      e.preventDefault();
      if (S.sel.has(id)) S.sel.delete(id);
      else S.sel.add(id);
      S.anchor = id;
      syncSelection();
      return focusRow(id);
    case "a":
      if (ctrl) {
        e.preventDefault();
        void act("selall", null, row);
      }
      return;
    case "Enter":
      if (isComplete(d)) void run(api.openFile(id));
      else {
        S.open = id;
        renderBody();
        focusRow(id);
        void pollTorrentDetails();
      }
      return;
    case "i":
      if (ctrl) {
        e.preventDefault();
        S.open = id;
        renderBody();
        focusRow(id);
        void pollTorrentDetails();
      }
      return;
    case "Delete":
      void act(S.sel.size > 1 && S.sel.has(id) ? "selremove" : "remove", id, row);
      return;
    case "ContextMenu":
    case "F10": {
      if (e.key === "F10" && !e.shiftKey) return;
      e.preventDefault();
      const b = row.querySelector<HTMLElement>('[data-a="menu"]')!.getBoundingClientRect();
      return openMenu(id, b.right - 228, b.bottom + 4, true);
    }
    case "Escape":
      if (S.sel.size) {
        S.sel.clear();
        syncSelection();
        focusRow(id);
      } else if (S.open) {
        S.open = null;
        renderBody();
        focusRow(id);
      }
      return;
  }
}

function trapFocus(e: KeyboardEvent) {
  const f = Array.from(
    elLayer.querySelectorAll<HTMLElement>(".fl-dialog button:not([disabled]), .fl-dialog input:not([disabled]):not([readonly]), .fl-dialog [tabindex='0']"),
  );
  if (!f.length) return;
  const i = f.indexOf(document.activeElement as HTMLElement);
  if (e.shiftKey && (i <= 0)) {
    e.preventDefault();
    f[f.length - 1].focus();
  } else if (!e.shiftKey && i === f.length - 1) {
    e.preventDefault();
    f[0].focus();
  }
}

function onContextMenu(e: MouseEvent) {
  const t = e.target as HTMLElement;
  if (t.closest("input, textarea")) return;
  e.preventDefault();
  const r = t.closest<HTMLElement>("[data-row]");
  if (!r) return;
  const id = r.dataset.row!;
  if (!S.sel.has(id)) {
    S.sel = new Set([id]);
    S.anchor = id;
    S.focus = id;
    renderBody();
  }
  openMenu(id, e.clientX, e.clientY, false);
}

function onPaste(e: ClipboardEvent) {
  const t = e.target as HTMLElement;
  if (t.closest?.("input, textarea") || S.dialog) return;
  const text = e.clipboardData?.getData("text")?.trim();
  if (!text) return;
  e.preventDefault();
  openAdd(text);
}

function onPointerDown(e: PointerEvent) {
  const g = (e.target as HTMLElement).closest<HTMLElement>("[data-grip]");
  if (g && e.button === 0) startDrag(g.dataset.grip!, e);
}

/* ---------------- drop a .torrent file ---------------- */

function setDragging(on: boolean) {
  if (S.dragging === on) return;
  S.dragging = on;
  renderLayer();
}

function droppedTorrent(paths: string[]): string | undefined {
  return paths.find((p) => /\.torrent$/i.test(p));
}

async function listenForDrops() {
  if ("__TAURI_INTERNALS__" in window && !(window as unknown as { __FL_PREVIEW__?: boolean }).__FL_PREVIEW__) {
    await getCurrentWebview().onDragDropEvent((ev) => {
      const p = ev.payload;
      if (p.type === "enter") setDragging(!!droppedTorrent(p.paths));
      else if (p.type === "leave") setDragging(false);
      else if (p.type === "drop") {
        setDragging(false);
        const file = droppedTorrent(p.paths);
        if (file) void openTorrentFile(file);
        else if (p.paths.length) toast("Only .torrent files can be dropped here.", true);
      }
    });
    return;
  }
  // Browser preview: HTML drag and drop (file names only).
  window.addEventListener("dragover", (e) => {
    e.preventDefault();
    setDragging(true);
  });
  window.addEventListener("dragleave", (e) => {
    if (!e.relatedTarget) setDragging(false);
  });
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    setDragging(false);
    const name = Array.from(e.dataTransfer?.files ?? []).map((f) => f.name).find((n) => /\.torrent$/i.test(n));
    if (name) void openTorrentFile(name);
  });
}

/* ---------------- start ---------------- */

export async function start(el: HTMLElement) {
  root = el;
  root.innerHTML = '<div class="fl-window" data-win-root><div data-title></div><div class="fl-body" data-body></div><div data-layer></div></div>';
  elTitle = root.querySelector("[data-title]")!;
  elBody = root.querySelector("[data-body]")!;
  elLayer = root.querySelector("[data-layer]")!;
  applyTheme();
  renderTitle();
  renderBody();

  root.addEventListener("click", onClick);
  root.addEventListener("dblclick", onDblClick);
  root.addEventListener("input", onInput);
  root.addEventListener("change", onChange);
  root.addEventListener("pointerdown", onPointerDown);
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("contextmenu", onContextMenu);
  document.addEventListener("paste", onPaste);
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
  let resizeT: number | undefined;
  window.addEventListener("resize", () => {
    window.clearTimeout(resizeT);
    resizeT = window.setTimeout(async () => {
      S.maximized = await win.isMaximized().catch(() => false);
      renderTitle();
      render();
    }, 60);
  });

  try {
    const [settings, version] = await Promise.all([api.getSettings(), getVersion().catch(() => "")]);
    S.settings = settings;
    S.version = version;
    S.maximized = await win.isMaximized().catch(() => false);
    applyTheme();
    renderTitle();
    await api.onChange(apply);
    apply(await api.list());
    void refreshFree();
    window.setInterval(() => void refreshFree(), 15_000);
    window.setInterval(() => void pollTorrentDetails(), 1500);
    void listenForDrops();
  } catch (e) {
    S.loadError = errorMessage(e) || "The download engine didn’t respond.";
    if (errorKind(e) == null && !("__TAURI_INTERNALS__" in window))
      S.loadError = "Fetchlane needs its desktop app to run. Start it with npm run tauri dev.";
    renderBody();
  }
}
