// Number, size, time and text formatting. Ported from the design system's
// reference renderer so the app shows values exactly as specified.

export const KB = 1024;
export const MB = KB * 1024;
export const GB = MB * 1024;

export function fmtSize(b: number | null | undefined): string {
  if (b == null) return "";
  if (b >= GB) return (b / GB).toFixed(b >= 10 * GB ? 1 : 2) + " GB";
  if (b >= MB) return (b / MB).toFixed(b >= 100 * MB ? 0 : 1) + " MB";
  if (b >= KB) return Math.round(b / KB) + " KB";
  return b + " B";
}

type Unit = "GB" | "MB" | "KB" | "B";
const DIV: Record<Unit, number> = { GB, MB, KB, B: 1 };

function unit(b: number): Unit {
  return b >= GB ? "GB" : b >= MB ? "MB" : b >= KB ? "KB" : "B";
}

function num(b: number, u: Unit): string {
  const v = b / DIV[u];
  return u === "GB" ? v.toFixed(2) : u === "MB" ? v.toFixed(v >= 100 ? 0 : 1) : String(Math.round(v));
}

/** "3.68 / 5.91 GB" when units match, "152 MB / 1.20 GB" otherwise. Returns HTML. */
export function fmtPair(done: number, total: number | null): string {
  if (total == null) return fmtSize(done) + ' / <span class="fl-na">unknown</span>';
  const u = unit(total);
  if (u === unit(done)) return `${num(done, u)} / ${num(total, u)} ${u}`;
  return `${fmtSize(done)} / ${fmtSize(total)}`;
}

export function fmtSpeed(bps: number | null | undefined): string {
  if (bps == null) return "";
  return bps >= MB ? (bps / MB).toFixed(1) + " MB/s" : Math.round(bps / KB) + " KB/s";
}

export function fmtDur(secs: number | null | undefined, long = false): string {
  if (secs == null) return "";
  let s = Math.max(0, Math.round(secs));
  if (s < 60) return s + " s";
  let m = Math.floor(s / 60);
  s = s % 60;
  if (m < 60) return m + " min" + (long && s ? " " + s + " s" : "");
  const h = Math.floor(m / 60);
  m = m % 60;
  return h + " h" + (m ? " " + m + " min" : "");
}

export function esc(s: unknown): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

export function pct(done: number, total: number | null): number | null {
  return total ? Math.min(100, Math.floor((done / total) * 100)) : null;
}

export type Day = "today" | "yesterday" | "earlier";

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function dayOf(ms: number, now = Date.now()): Day {
  const today = startOfDay(now);
  if (ms >= today) return "today";
  if (ms >= today - 86_400_000) return "yesterday";
  return "earlier";
}

export function clock(ms: number): string {
  const d = new Date(ms);
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

/** "14:10", "Yesterday 14:10" or "12 Oct 14:10". */
export function when(ms: number, now = Date.now()): string {
  const day = dayOf(ms, now);
  if (day === "today") return clock(ms);
  if (day === "yesterday") return "Yesterday " + clock(ms);
  const d = new Date(ms);
  return d.getDate() + " " + d.toLocaleString("en", { month: "short" }) + " " + clock(ms);
}

/** "Today, 14:02" style used in the details panel. */
export function whenLong(ms: number, now = Date.now()): string {
  const day = dayOf(ms, now);
  if (day === "today") return "Today, " + clock(ms);
  if (day === "yesterday") return "Yesterday, " + clock(ms);
  return when(ms, now);
}

/** "D:" for Windows paths, otherwise the folder name. */
export function driveOf(path: string): string {
  const m = /^([A-Za-z]:)/.exec(path);
  if (m) return m[1].toUpperCase();
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

export function hostOf(url: string): string {
  const m = /^[a-z]+:\/\/(?:[^@/?#]*@)?([^/?#:]+)/i.exec(url || "");
  return m ? m[1] : "the server";
}

export function plural(n: number, one: string, many = one + "s"): string {
  return n === 1 ? one : many;
}
