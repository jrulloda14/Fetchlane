// Fetchlane icon set, logo mark and file-type icons, from the design system
// (assets/fetchlane). 24-unit grid, 1.6 stroke, drawn at 16 px in currentColor.

const P: Record<string, string> = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.4-4.4"/>',
  pause: '<path d="M9 5.5v13M15 5.5v13"/>',
  play: '<path d="M7.5 5.2v13.6a.6.6 0 0 0 .9.5l10.8-6.8a.6.6 0 0 0 0-1L8.4 4.7a.6.6 0 0 0-.9.5z"/>',
  retry: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4h-4"/>',
  restart: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v4h4"/><path d="M12 9v3l2 1.5"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
  more: '<circle cx="6" cy="12" r=".9" fill="currentColor"/><circle cx="12" cy="12" r=".9" fill="currentColor"/><circle cx="18" cy="12" r=".9" fill="currentColor"/>',
  folder: '<path d="M3.5 7.5V17a1.5 1.5 0 0 0 1.5 1.5h14a1.5 1.5 0 0 0 1.5-1.5V9.5A1.5 1.5 0 0 0 19 8h-7l-2-2.5H5A1.5 1.5 0 0 0 3.5 7z"/>',
  folderOpen: '<path d="M3.5 17V7a1.5 1.5 0 0 1 1.5-1.5h5l2 2.5h6.5A1.5 1.5 0 0 1 20 9.5V11"/><path d="M3.5 17.5 6 11.6a1 1 0 0 1 .9-.6h14a.7.7 0 0 1 .6 1L19 17.7a1.3 1.3 0 0 1-1.2.8H4.3a.7.7 0 0 1-.8-1z"/>',
  open: '<path d="M14 4.5h5.5V10M19.5 4.5l-8 8"/><path d="M17.5 13.5v4.5a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18V8A1.5 1.5 0 0 1 6 6.5h4.5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  checkCircle: '<circle cx="12" cy="12" r="8.5"/><path d="m8.3 12.3 2.6 2.6 5-5.3"/>',
  alert: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.8v5M12 16.2v.1"/>',
  warn: '<path d="M10.7 4.6 3.4 17.3a1.5 1.5 0 0 0 1.3 2.2h14.6a1.5 1.5 0 0 0 1.3-2.2L13.3 4.6a1.5 1.5 0 0 0-2.6 0z"/><path d="M12 9.5v4M12 16.6v.1"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 7.9v.1"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  down: '<path d="M12 4.5v12M6.5 11 12 16.5 17.5 11"/><path d="M5 20h14"/>',
  all: '<path d="M8.5 6.5h11M8.5 12h11M8.5 17.5h11"/><path d="M4.5 6.5h.1M4.5 12h.1M4.5 17.5h.1"/>',
  active: '<path d="M12 4v10M7.5 9.5 12 14l4.5-4.5"/><path d="M4.5 17.5v1a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-1"/>',
  queue: '<path d="M4.5 6.5h15M4.5 12h15M4.5 17.5h9"/><path d="m17 15.5 2.5 2-2.5 2"/>',
  done: '<circle cx="12" cy="12" r="8.5"/><path d="m8.3 12.3 2.6 2.6 5-5.3"/>',
  failed: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.8v5M12 16.2v.1"/>',
  sliders: '<path d="M4.5 7h9M17.5 7h2M4.5 17h2M10.5 17h9"/><circle cx="15.5" cy="7" r="2"/><circle cx="8.5" cy="17" r="2"/>',
  trash: '<path d="M5 7h14M10 4.5h4M7 7l.8 11.1a1.5 1.5 0 0 0 1.5 1.4h5.4a1.5 1.5 0 0 0 1.5-1.4L17 7"/>',
  remove: '<path d="M5 7.5h14M5 12h8M5 16.5h6"/><path d="m15.5 14.5 4 4M19.5 14.5l-4 4"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="1.5"/><path d="M15.5 8.5V6A1.5 1.5 0 0 0 14 4.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
  paste: '<rect x="5.5" y="5" width="13" height="15.5" rx="1.5"/><path d="M9 5V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"/><path d="M9 11h6M9 15h4"/>',
  chevDown: '<path d="m7 10 5 5 5-5"/>',
  chevRight: '<path d="m10 7 5 5-5 5"/>',
  chevUp: '<path d="m7 14 5-5 5 5"/>',
  arrowUp: '<path d="M12 19V5M6.5 10.5 12 5l5.5 5.5"/>',
  arrowDown: '<path d="M12 5v14M6.5 13.5 12 19l5.5-5.5"/>',
  toTop: '<path d="M5.5 4.5h13M12 20V9M7 13.5 12 8.5l5 5"/>',
  comfortable: '<rect x="4.5" y="5" width="15" height="5.5" rx="1"/><rect x="4.5" y="13.5" width="15" height="5.5" rx="1"/>',
  compact: '<path d="M4.5 5.5h15M4.5 10h15M4.5 14.5h15M4.5 19h15"/>',
  drive: '<rect x="3.5" y="13" width="17" height="6" rx="1.5"/><path d="M5 13 7.2 6a1.5 1.5 0 0 1 1.4-1h6.8a1.5 1.5 0 0 1 1.4 1L19 13"/><path d="M16.5 16h.1"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.5 3.5 5.3 3.5 8.5s-1.1 6-3.5 8.5c-2.4-2.5-3.5-5.3-3.5-8.5s1.1-6 3.5-8.5z"/>',
  lock: '<rect x="5" y="10.5" width="14" height="9" rx="1.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  eye: '<path d="M2.8 12S6 5.8 12 5.8 21.2 12 21.2 12 18 18.2 12 18.2 2.8 12 2.8 12z"/><circle cx="12" cy="12" r="2.8"/>',
  grip: '<circle cx="9.5" cy="7" r=".9" fill="currentColor"/><circle cx="14.5" cy="7" r=".9" fill="currentColor"/><circle cx="9.5" cy="12" r=".9" fill="currentColor"/><circle cx="14.5" cy="12" r=".9" fill="currentColor"/><circle cx="9.5" cy="17" r=".9" fill="currentColor"/><circle cx="14.5" cy="17" r=".9" fill="currentColor"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5"/>',
  spinner: '<path d="M12 3.5a8.5 8.5 0 1 1-8.5 8.5" />',
  minimize: '<path d="M7 12h10" stroke-width="1"/>',
  maximize: '<rect x="7" y="7" width="10" height="10" rx="1.5" stroke-width="1"/>',
  restoreWin: '<rect x="7" y="9" width="8" height="8" rx="1.5" stroke-width="1"/><path d="M9 9V8.5A1.5 1.5 0 0 1 10.5 7H16a1 1 0 0 1 1 1v5.5a1.5 1.5 0 0 1-1.5 1.5H15" stroke-width="1"/>',
  close: '<path d="m7.5 7.5 9 9M16.5 7.5l-9 9" stroke-width="1"/>',
  minus: '<path d="M6 12h12"/>',
};

export type IconName = keyof typeof P;

export function icon(name: string, size = 16, cls = ""): string {
  return (
    `<svg class="fl-i${cls ? " " + cls : ""}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" ` +
    `stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
    (P[name] ?? "") +
    "</svg>"
  );
}

/** The mark: a file travelling down a dashed lane into a tray. Follows the theme. */
export function mark(size = 16): string {
  return (
    `<svg class="fl-i" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true">` +
    '<rect width="32" height="32" rx="7" fill="var(--accent)"/>' +
    '<path d="M7 6.5v3M7 12.5v3M25 6.5v3M25 12.5v3" stroke="var(--on-accent)" stroke-width="2" stroke-linecap="round" opacity=".55"/>' +
    '<path d="M12 5.5h5.2L21 9.3V17a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1z" fill="var(--on-accent)"/>' +
    '<path d="M17 5.5v4h4" fill="none" stroke="var(--accent)" stroke-width="1.4" stroke-linejoin="round"/>' +
    '<path d="M6.5 19.5v3.5a2.5 2.5 0 0 0 2.5 2.5h14a2.5 2.5 0 0 0 2.5-2.5v-3.5" fill="none" stroke="var(--on-accent)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>' +
    "</svg>"
  );
}

type Kind = "disc" | "archive" | "app" | "video" | "audio" | "image" | "doc" | "data" | "file";

const KIND: Record<string, Kind> = {
  iso: "disc", img: "disc", vhd: "disc", vhdx: "disc", dmg: "disc",
  zip: "archive", gz: "archive", tgz: "archive", "7z": "archive", rar: "archive", xz: "archive", bz2: "archive", tar: "archive", zst: "archive",
  exe: "app", msi: "app", msix: "app", appx: "app", apk: "app", deb: "app", rpm: "app",
  mp4: "video", mkv: "video", mov: "video", avi: "video", webm: "video", m4v: "video",
  wav: "audio", mp3: "audio", flac: "audio", ogg: "audio", m4a: "audio", aac: "audio", opus: "audio",
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", tif: "image", tiff: "image", bmp: "image", svg: "image", heic: "image",
  pdf: "doc", doc: "doc", docx: "doc", ppt: "doc", pptx: "doc", xls: "doc", xlsx: "doc", odt: "doc", txt: "doc", md: "doc", epub: "doc",
  csv: "data", parquet: "data", json: "data", xml: "data", sql: "data", db: "data", sqlite: "data",
};

const GLYPH: Record<Kind, string> = {
  disc: '<circle cx="12" cy="15" r="3.6"/><circle cx="12" cy="15" r=".8"/>',
  archive: '<path d="M11 9.5h2M11 12h2M11 14.5h2"/><rect x="10.5" y="16.5" width="3" height="2.5" rx=".5"/>',
  app: '<rect x="8.5" y="12" width="7" height="6" rx="1"/><path d="M8.5 14h7"/>',
  video: '<path d="M10.5 12.3v5.4l4.5-2.7z"/>',
  audio: '<path d="M9 14v3M11 12v7M13 13v5M15 14.5v2"/>',
  image: '<circle cx="10" cy="12.5" r="1.1"/><path d="m8 19 3.2-3.2 1.6 1.6 1.4-1.4L16 18"/>',
  doc: '<path d="M8.5 12h7M8.5 14.5h7M8.5 17h4.5"/>',
  data: '<path d="M8.5 12h7M8.5 15h7M8.5 18h7M11 12v6"/>',
  file: '<path d="M8.5 13h7M8.5 16h5"/>',
};

export function fileKind(name: string): Kind {
  const m = /\.([a-z0-9]+)$/i.exec(name || "");
  return (m && KIND[m[1].toLowerCase()]) || "file";
}

export function fileIcon(name: string, size?: number): string {
  const style = size ? ` style="width:${size}px;height:${size}px"` : "";
  return (
    `<svg class="fl-ftype"${style} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" ` +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M6.5 2.8h7.2L18.8 8v12.2a1 1 0 0 1-1 1H6.5a1 1 0 0 1-1-1V3.8a1 1 0 0 1 1-1z"/><path d="M13.5 2.8V8h5.3"/>' +
    GLYPH[fileKind(name)] +
    "</svg>"
  );
}

export const EMPTY_ART =
  '<svg class="fl-empty-art" width="96" height="96" viewBox="0 0 96 96" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M22 14v10M22 32v10M74 14v10M74 32v10" opacity=".6"/>' +
  '<path class="fl-art-file" d="M38 12h16l10 10v30a3 3 0 0 1-3 3H38a3 3 0 0 1-3-3V15a3 3 0 0 1 3-3z"/>' +
  '<path class="fl-art-file" d="M54 12v10h10"/>' +
  '<path d="M18 60v14a6 6 0 0 0 6 6h48a6 6 0 0 0 6-6V60"/><path d="M18 60h16l4 6h20l4-6h16" opacity=".6"/></svg>';
