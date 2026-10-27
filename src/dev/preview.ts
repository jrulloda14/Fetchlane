// Development-only browser preview. When the UI runs in a plain browser
// (`npm run dev`, no Tauri), this installs Tauri's IPC mocks with sample
// downloads so the interface can be reviewed without the backend.
// main.ts only imports it when import.meta.env.DEV is true, so production
// builds don't contain it. Nothing here downloads anything.
import { emit } from "@tauri-apps/api/event";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { DeleteScope, DownloadView, Settings, Snapshot, TorrentDetails, TorrentFile, TorrentPreview, TorrentState } from "../api";

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;
const now = Date.now();
const min = 60_000;
const day = 86_400_000;

let seq = 0;
function dl(over: Partial<DownloadView> & { fileName: string; displayUrl: string }): DownloadView {
  const host = /^https?:\/\/([^/]+)/.exec(over.displayUrl)?.[1] ?? "";
  return {
    id: "p" + ++seq,
    kind: "direct",
    uploadSpeed: null,
    torrent: null,
    hiddenParams: 0,
    host,
    destDir: "D:\\Downloads",
    status: "completed",
    phase: null,
    totalSize: null,
    downloaded: 0,
    speed: null,
    etaSecs: null,
    resumable: true,
    canPause: false,
    connections: 0,
    queuePosition: null,
    retryInSecs: null,
    retryAttempt: null,
    retryLimit: 5,
    error: null,
    createdAt: now - 10 * min,
    completedAt: null,
    ...over,
  };
}

const items: DownloadView[] = [
  dl({ fileName: "ubuntu-24.04.3-desktop-amd64.iso", displayUrl: "https://releases.ubuntu.com/24.04.3/ubuntu-24.04.3-desktop-amd64.iso", status: "downloading", phase: "transferring", downloaded: 3.68 * GB, totalSize: 5.91 * GB, speed: 8.4 * MB, canPause: true, destDir: "D:\\Downloads\\ISO", connections: 4 }),
  dl({ fileName: "nightly-build-20261026.zip", displayUrl: "https://ci.lanternworks.dev/artifacts/nightly-build-20261026.zip", hiddenParams: 2, status: "downloading", phase: "transferring", downloaded: 48.2 * MB, speed: 3.9 * MB, resumable: false, canPause: false }),
  dl({ fileName: "sentinel2-tile-T51QTV-20261019.tif", displayUrl: "https://data.openearth-archive.org/s2/T51QTV/20261019/tile.tif", hiddenParams: 2, status: "downloading", phase: "retrying", downloaded: 1.02 * GB, totalSize: 2.4 * GB, retryInSecs: 8, retryAttempt: 2, canPause: true, destDir: "D:\\Data\\Satellite" }),
  dl({ fileName: "OBS-Studio-31.1-Windows-x64-Installer.exe", displayUrl: "https://cdn-fastly.obsproject.com/downloads/OBS-Studio-31.1-Windows-x64-Installer.exe", status: "paused", downloaded: 58.9 * MB, totalSize: 154 * MB }),
  dl({ fileName: "LibreOffice_25.8.2_Win_x86-64.msi", displayUrl: "https://download.documentfoundation.org/libreoffice/stable/25.8.2/win/x86_64/LibreOffice_25.8.2_Win_x86-64.msi", status: "queued", queuePosition: 1, totalSize: null, canPause: true }),
  dl({ fileName: "podcast-ep142-master-48k.wav", displayUrl: "https://files.harborline-audio.net/share/ep142/podcast-ep142-master-48k.wav", hiddenParams: 1, status: "queued", queuePosition: 2, canPause: true, destDir: "D:\\Audio\\Masters" }),
  dl({ fileName: "node-v22.20.0-x64.msi", displayUrl: "https://nodejs.org/dist/v22.20.0/node-v22.20.0-x64.msi", status: "queued", queuePosition: 3, canPause: true }),
  dl({ fileName: "vm-backup-2026-10-24.vhdx", displayUrl: "https://files.northgate-it.net/backups/vm-backup-2026-10-24.vhdx", hiddenParams: 1, status: "failed", downloaded: 2.9 * GB, totalSize: 18.2 * GB, destDir: "D:\\Backups", error: { kind: "diskFull", message: "There isn't enough free disk space. Free up space and retry." } }),
  dl({ fileName: "conference-keynote-1080p.mp4", displayUrl: "https://media.summitstream.io/vod/keynote-2026/conference-keynote-1080p.mp4", hiddenParams: 2, status: "failed", downloaded: 412 * MB, totalSize: 1.2 * GB, resumable: false, destDir: "D:\\Videos", error: { kind: "cannotResume", message: "The connection was interrupted. The server can't continue a partial download. Restart to download it again." } }),
  dl({ fileName: "font-pack-variable-2026.zip", displayUrl: "https://assets.typecrate.net/packs/font-pack-variable-2026.zip", status: "failed", downloaded: 21.6 * MB, totalSize: 88 * MB, error: { kind: "network", message: "The connection was interrupted." } }),
  dl({ fileName: "7z2501-x64.exe", displayUrl: "https://www.7-zip.org/a/7z2501-x64.exe", downloaded: 1.6 * MB, totalSize: 1.6 * MB, completedAt: now - 20 * min }),
  dl({ fileName: "Q3-operations-review.pptx", displayUrl: "https://share.northgate-it.net/f/Q3-operations-review.pptx", hiddenParams: 2, downloaded: 24.8 * MB, totalSize: 24.8 * MB, completedAt: now - 45 * min }),
  dl({ fileName: "invoice-2026-1048.pdf", displayUrl: "https://billing.lanternworks.dev/invoices/2026-1048.pdf", downloaded: 214 * KB, totalSize: 214 * KB, completedAt: now - 3 * 60 * min, destDir: "D:\\Documents" }),
  dl({ fileName: "wallpaper-pack-4k.zip", displayUrl: "https://cdn.palettefield.art/packs/wallpaper-pack-4k.zip", downloaded: 486 * MB, totalSize: 486 * MB, completedAt: now - day, createdAt: now - day - 5 * min }),
  dl({ fileName: "driver-pack-2026.10.zip", displayUrl: "https://support.kestrelboards.com/drivers/driver-pack-2026.10.zip", status: "canceled", totalSize: 640 * MB, createdAt: now - day - 2 * 60 * min }),
  dl({ fileName: "transit-ridership-2025.parquet", displayUrl: "https://data.portmeridian.gov/exports/transit-ridership-2025.parquet", downloaded: 912 * MB, totalSize: 912 * MB, completedAt: now - 3 * day, createdAt: now - 3 * day }),
];

/* ---------------- sample torrents ---------------- */

interface PreviewTorrent {
  files: TorrentFile[];
  selected: Set<number>;
  trackers: string[];
  seededSecs: number;
}

const torrents = new Map<string, PreviewTorrent>();

function tor(
  name: string,
  state: TorrentState,
  files: [string, number][],
  over: Partial<DownloadView> = {},
  extra: Partial<{ uploaded: number; peers: number; known: number; selected: number[]; seedLimit: boolean; seeded: number }> = {},
): DownloadView {
  const list = files.map(([path, size], index) => ({ index, path, size }));
  const selected = new Set(extra.selected ?? list.map((f) => f.index));
  const total = list.filter((f) => selected.has(f.index)).reduce((a, f) => a + f.size, 0);
  const status: DownloadView["status"] =
    state === "seeding" || state === "stopped" ? "completed" : state === "queued" ? "queued" : state === "paused" ? "paused" : state === "error" ? "failed" : "downloading";
  const d = dl({
    fileName: name,
    displayUrl: "magnet:?xt=urn:btih:" + "f1e2d3c4b5a6".repeat(3).slice(0, 40),
    kind: "torrent",
    host: selected.size < list.length ? `${selected.size} of ${list.length} files` : `${list.length} ${list.length === 1 ? "file" : "files"}`,
    status,
    totalSize: state === "fetching" ? null : total,
    downloaded: status === "completed" ? total : 0,
    retryLimit: 0,
    ...over,
  });
  d.torrent = {
    state,
    peersConnected: extra.peers ?? 0,
    peersKnown: extra.known ?? 0,
    uploaded: extra.uploaded ?? 0,
    ratio: (extra.uploaded ?? 0) / Math.max(total, 1),
    fileCount: list.length,
    selectedCount: selected.size,
    seedLimitReached: extra.seedLimit ?? false,
    infoHash: "f1e2d3c4b5a6f1e2d3c4b5a6f1e2d3c4b5a6f1e2",
  };
  torrents.set(d.id, {
    files: list,
    selected,
    trackers: ["udp://tracker.opentrackr.org:1337/announce", "https://tracker.lanternworks.dev/announce"],
    seededSecs: extra.seeded ?? 0,
  });
  return d;
}

items.push(
  tor("debian-13.1.0-amd64-netinst.iso", "downloading", [["debian-13.1.0-amd64-netinst.iso", 754 * MB]],
    { downloaded: 318 * MB, speed: 5.2 * MB, uploadSpeed: 96 * KB, canPause: true, connections: 23 }, { peers: 23, known: 140, uploaded: 12 * MB }),
  tor("Open Movie Collection (CC-BY)", "stalled",
    [["Sintel/Sintel.2010.1080p.mkv", 1.2 * GB], ["Big Buck Bunny/bbb_sunflower_1080p.mp4", 690 * MB], ["Tears of Steel/tos-1080p.mov", 1.5 * GB], ["README.txt", 4 * KB]],
    { downloaded: 1.1 * GB, speed: 0, uploadSpeed: 0, canPause: true }, { peers: 0, known: 12, selected: [0, 1, 3] }),
  tor("archlinux-2026.10.01-x86_64.iso", "fetching", [["archlinux-2026.10.01-x86_64.iso", 1.3 * GB]], { canPause: true }),
  tor("fedora-workstation-43.iso", "checking", [["fedora-workstation-43.iso", 2.4 * GB]], { downloaded: 0.8 * GB, canPause: true }),
  tor("blender-splash-assets.zip", "connecting", [["blender-splash-assets.zip", 340 * MB]], { canPause: true, uploadSpeed: 0 }),
  tor("public-domain-audiobooks", "queued", [["Pride and Prejudice/01.mp3", 48 * MB], ["Pride and Prejudice/02.mp3", 51 * MB]], { queuePosition: 1, canPause: true }),
  tor("Wikipedia dump 2026-10", "paused", [["enwiki-20261001-pages-articles.xml.bz2", 22 * GB]], { downloaded: 7.4 * GB }),
  tor("ubuntu-24.04.3-live-server-amd64.iso", "seeding", [["ubuntu-24.04.3-live-server-amd64.iso", 3.1 * GB]],
    { uploadSpeed: 640 * KB, completedAt: now - 2 * 60 * min }, { uploaded: 1.4 * GB, peers: 9, known: 60, seeded: 3 * 3600 }),
  tor("linux-mint-22-cinnamon.iso", "stopped", [["linuxmint-22-cinnamon-64bit.iso", 2.9 * GB]],
    { completedAt: now - day }, { uploaded: 2.9 * GB, seedLimit: true, seeded: 9 * 3600 }),
  tor("freedos-1.4-full.zip", "error", [["freedos-1.4-full.zip", 410 * MB]],
    { downloaded: 120 * MB, error: { kind: "internal", message: "The torrent stopped because of an error (could not write piece 41). Recheck files or retry." } }),
);

let settings: Settings = {
  downloadDir: "D:\\Downloads",
  askEachTime: false,
  maxConcurrent: 4,
  connectionsPerDownload: 4,
  autoResume: true,
  retryAutomatically: true,
  retryAttempts: 5,
  theme: "system",
  density: "comfortable",
  keepHistory: true,
  notifyOnFinish: true,
  torrentDownloadLimitKib: 0,
  torrentUploadLimitKib: 0,
  maxActiveTorrents: 3,
  seedRatioEnabled: true,
  seedRatioPercent: 100,
  seedTimeEnabled: false,
  seedTimeMinutes: 60,
};
let held = false;

function renumber() {
  items.filter((d) => d.status === "queued").forEach((d, i) => (d.queuePosition = i + 1));
  items.filter((d) => d.status !== "queued").forEach((d) => (d.queuePosition = null));
}

function snapshot(): Snapshot {
  for (const d of items) d.retryLimit = settings.retryAutomatically ? settings.retryAttempts : 0;
  return { downloads: items.map((d) => ({ ...d })), queueHeld: held };
}

function changed() {
  renumber();
  void emit("downloads-changed", snapshot());
}

function find(id: unknown): DownloadView {
  const d = items.find((x) => x.id === id);
  if (!d) throw { kind: "invalidInput", message: "That download no longer exists." };
  return d;
}

function start(d: DownloadView) {
  d.status = "downloading";
  d.phase = "transferring";
  d.error = null;
  d.speed = 4.2 * MB;
  d.canPause = d.resumable;
}

const probes = new Map<string, { cancelled: boolean }>();
/** Names of .torrent files read by probe_torrent, so the added torrent keeps them. */
const probeNames = new Map<string, string>();

function setState(d: DownloadView, state: TorrentState) {
  d.torrent!.state = state;
  const map: Partial<Record<TorrentState, DownloadView["status"]>> = { seeding: "completed", stopped: "completed", queued: "queued", paused: "paused", error: "failed" };
  d.status = map[state] ?? "downloading";
  d.speed = state === "downloading" ? 3.1 * MB : null;
  d.uploadSpeed = state === "downloading" || state === "seeding" ? 120 * KB : null;
  d.canPause = !["seeding", "stopped", "paused", "error"].includes(state);
  if (state !== "error") d.error = null;
}

function previewOf(name: string, files: [string, number][]): TorrentPreview {
  return {
    probeId: "",
    name,
    infoHash: "0a1b2c3d4e5f0a1b2c3d4e5f0a1b2c3d4e5f0a1b",
    totalSize: files.reduce((a, [, s]) => a + s, 0),
    files: files.map(([path, size], index) => ({ index, path, size })),
    trackers: ["udp://tracker.opentrackr.org:1337/announce"],
    saveAs: name,
  };
}

const SAMPLE_FILES: [string, number][] = [
  ["Season 1/E01 - Pilot.mkv", 1.1 * GB],
  ["Season 1/E02 - The Lane.mkv", 1.0 * GB],
  ["Season 1/E03 - Seeds.mkv", 1.2 * GB],
  ["Extras/Behind the scenes.mp4", 640 * MB],
  ["Subtitles/en.srt", 60 * KB],
];

function torrentCommand(cmd: string, a: Record<string, unknown>): { handled: boolean; value?: unknown } {
  const id = a.id as string | undefined;
  const d = id ? items.find((x) => x.id === id) : undefined;
  const t = d?.torrent ? d : undefined;
  switch (cmd) {
    case "probe_torrent": {
      const src = a.source as { type: string; value: string };
      const pid = String(a.probeId);
      if (src.type === "file") {
        const name = src.value.split(/[\\/]/).pop()!.replace(/\.torrent$/i, "");
        probeNames.set(pid, name);
        return { handled: true, value: Promise.resolve({ ...previewOf(name, SAMPLE_FILES), probeId: pid }) };
      }
      const probe = { cancelled: false };
      probes.set(pid, probe);
      const dn = /dn=([^&]+)/.exec(src.value)?.[1];
      return {
        handled: true,
        value: new Promise((resolve, reject) =>
          setTimeout(() => {
            if (probe.cancelled) reject({ kind: "invalidInput", message: "Fetching torrent details was cancelled." });
            else resolve({ ...previewOf(dn ? decodeURIComponent(dn.replace(/\+/g, " ")) : "Magnet download", SAMPLE_FILES), probeId: pid });
          }, 3000),
        ),
      };
    }
    case "cancel_torrent_probe": {
      const pr = probes.get(String(a.probeId));
      if (pr) pr.cancelled = true;
      return { handled: true, value: null };
    }
    case "add_torrent": {
      const r = a.request as { probeId?: string; magnet?: string; destDir?: string; selected?: number[]; startPaused?: boolean };
      const files = SAMPLE_FILES;
      const nd = tor(r.magnet ? "Magnet download" : (r.probeId && probeNames.get(r.probeId)) || "New torrent", r.magnet ? "fetching" : r.startPaused ? "paused" : "connecting", files,
        { createdAt: Date.now(), destDir: r.destDir ?? settings.downloadDir, canPause: true }, { selected: r.selected });
      items.push(nd);
      if (!r.magnet && !r.startPaused) setTimeout(() => { setState(nd, "downloading"); changed(); }, 1500);
      if (r.magnet) setTimeout(() => { setState(nd, "downloading"); nd.totalSize = files.reduce((x, [, s]) => x + s, 0); changed(); }, 3000);
      setTimeout(changed);
      return { handled: true, value: { ...nd } };
    }
    case "torrent_details": {
      if (!t) throw { kind: "invalidInput", message: "That download no longer exists." };
      const info = torrents.get(t.id)!;
      const doneFrac = t.totalSize ? t.downloaded / t.totalSize : 0;
      const details: TorrentDetails = {
        files: t.torrent!.state === "fetching" ? [] : info.files.map((f) => ({ ...f, selected: info.selected.has(f.index), have: info.selected.has(f.index) ? Math.round(f.size * Math.min(1, doneFrac)) : 0 })),
        peersConnected: t.torrent!.peersConnected,
        peersConnecting: 3,
        peersKnown: t.torrent!.peersKnown,
        downloaded: t.downloaded,
        uploaded: t.torrent!.uploaded,
        ratio: t.torrent!.ratio,
        trackers: info.trackers,
        seeding: t.torrent!.state === "seeding",
        seededSecs: info.seededSecs,
        ratioLimit: settings.seedRatioEnabled ? settings.seedRatioPercent / 100 : null,
        timeLimitMinutes: settings.seedTimeEnabled ? settings.seedTimeMinutes : null,
        seedLimitReached: t.torrent!.seedLimitReached,
        infoHash: t.torrent!.infoHash,
        savePath: t.destDir + (info.files.length > 1 ? "\\" + t.fileName : ""),
      };
      return { handled: true, value: details };
    }
    case "set_torrent_files": {
      if (!t) break;
      const info = torrents.get(t.id)!;
      info.selected = new Set(a.selected as number[]);
      t.torrent!.selectedCount = info.selected.size;
      t.host = info.selected.size < info.files.length ? `${info.selected.size} of ${info.files.length} files` : `${info.files.length} files`;
      t.totalSize = info.files.filter((f) => info.selected.has(f.index)).reduce((x, f) => x + f.size, 0);
      setTimeout(changed);
      return { handled: true, value: null };
    }
    case "recheck_torrent": {
      if (!t) break;
      setState(t, "checking");
      setTimeout(() => { setState(t, t.downloaded >= (t.totalSize ?? 0) ? "seeding" : "downloading"); changed(); }, 2500);
      setTimeout(changed);
      return { handled: true, value: null };
    }
    case "delete_scope": {
      if (!d) break;
      const info = t ? torrents.get(t.id) : undefined;
      const files = info ? info.files.filter((f) => info.selected.has(f.index)) : [{ path: d.fileName, size: d.totalSize ?? d.downloaded }];
      const scope: DeleteScope = {
        fileCount: files.length,
        totalBytes: files.reduce((x, f) => x + f.size, 0),
        folder: d.destDir + (info && info.files.length > 1 ? "\\" + d.fileName : ""),
        examples: files.slice(0, 3).map((f) => f.path),
      };
      return { handled: true, value: scope };
    }
    case "pause_download":
      if (!t) break;
      setState(t, t.torrent!.state === "seeding" ? "stopped" : "paused");
      setTimeout(changed);
      return { handled: true, value: null };
    case "resume_download":
    case "retry_now":
    case "start_now":
      if (!t) break;
      t.torrent!.seedLimitReached = false;
      setState(t, t.torrent!.state === "stopped" ? "seeding" : "downloading");
      setTimeout(changed);
      return { handled: true, value: null };
  }
  return { handled: false };
}

function handle(cmd: string, a: Record<string, unknown>): unknown {
  const tc = torrentCommand(cmd, a);
  if (tc.handled) return tc.value;
  switch (cmd) {
    case "list_downloads":
      return snapshot();
    case "get_settings":
      return settings;
    case "update_settings":
      settings = { ...(a.settings as Settings) };
      settings.maxConcurrent = Math.min(10, Math.max(1, settings.maxConcurrent));
      settings.retryAttempts = Math.min(10, Math.max(1, settings.retryAttempts));
      settings.connectionsPerDownload = Math.min(8, Math.max(1, settings.connectionsPerDownload));
      setTimeout(changed);
      return settings;
    case "free_space":
      return 212 * GB;
    case "probe_url": {
      const url = String(a.url);
      if (/missing|404/.test(url)) throw { kind: "notFound", message: "The file wasn't found on the server (HTTP 404)." };
      const name = decodeURIComponent(url.split("?")[0].split("/").pop() || "download");
      const clash = items.some((d) => d.fileName === name);
      return { suggestedName: clash ? name.replace(/(\.[^.]+)?$/, " (1)$1") : name, nameClash: clash, totalSize: 118 * MB, contentType: null, resumable: true, redirected: false };
    }
    case "add_download": {
      const r = a.request as { url: string; destDir?: string; fileName?: string; queueFirst?: boolean };
      const d = dl({ fileName: r.fileName ?? "download", displayUrl: r.url.split("?")[0], destDir: r.destDir ?? settings.downloadDir, status: "queued", totalSize: 118 * MB, createdAt: Date.now(), canPause: true });
      const active = items.filter((x) => x.status === "downloading").length;
      if (!held && active < settings.maxConcurrent) start(d);
      if (r.queueFirst) items.unshift(d);
      else items.push(d);
      setTimeout(changed);
      renumber();
      return { ...d };
    }
    case "pause_download": {
      const d = find(a.id);
      if (d.status === "downloading" && !d.canPause) throw { kind: "cannotResume", message: "This download can't be paused because the server can't resume it." };
      d.status = "paused";
      d.phase = null;
      d.speed = null;
      break;
    }
    case "resume_download":
    case "retry_now":
    case "start_now": {
      const d = find(a.id);
      if (d.error?.kind === "cannotResume") throw { kind: "cannotResume", message: "The server can't continue this download. Restart it to download it again." };
      if (d.status === "canceled") d.downloaded = 0;
      start(d);
      break;
    }
    case "restart_download": {
      const d = find(a.id);
      d.downloaded = 0;
      start(d);
      break;
    }
    case "cancel_download": {
      const d = find(a.id);
      d.status = "canceled";
      d.phase = null;
      d.downloaded = 0;
      d.speed = null;
      break;
    }
    case "remove_download":
      items.splice(items.indexOf(find(a.id)), 1);
      break;
    case "clear_finished":
      for (let i = items.length - 1; i >= 0; i--)
        if ((items[i].status === "completed" && items[i].torrent?.state !== "seeding") || items[i].status === "canceled") items.splice(i, 1);
      break;
    case "pause_all":
      held = true;
      for (const d of items) if (d.status === "downloading" && d.canPause) Object.assign(d, { status: "paused", phase: null, speed: null });
      break;
    case "resume_all":
      held = false;
      for (const d of items) if (d.status === "paused") start(d);
      break;
    case "move_in_queue":
    case "move_to_position": {
      const d = find(a.id);
      const q = items.filter((x) => x.status === "queued");
      const cur = q.indexOf(d);
      const target = cmd === "move_to_position" ? Number(a.position) - 1 : a.to === "top" ? 0 : a.to === "up" ? cur - 1 : cur + 1;
      q.splice(cur, 1);
      q.splice(Math.max(0, Math.min(q.length, target)), 0, d);
      const rest = items.filter((x) => x.status !== "queued");
      items.splice(0, items.length, ...rest.slice(0, 4), ...q, ...rest.slice(4));
      break;
    }
    case "get_source_url": {
      const d = find(a.id);
      return d.hiddenParams ? d.displayUrl + "?token=preview_abc123&sig=9f2c1e" : d.displayUrl;
    }
    case "open_file":
    case "show_in_folder":
    case "copy_source_url":
    case "show_extension_folder":
      return null;
    case "take_external_adds":
      return [];
    case "integration_status":
      return integration;
    case "set_magnet_handler":
      integration.magnetHandler = !!a.enabled;
      return integration;
    case "plugin:app|version":
      return "0.1.1-preview";
    case "plugin:clipboard-manager|read_text":
      return "https://download.kdenlive.org/stable/25.08.2/kdenlive-25.08.2.exe";
    case "plugin:dialog|open": {
      const opts = (a.options ?? {}) as { directory?: boolean };
      return opts.directory ? "D:\\Downloads\\Other" : "C:\\Users\\you\\Downloads\\open-movie-series.torrent";
    }
    default:
      if (cmd.startsWith("plugin:window|")) return cmd.endsWith("is_maximized") ? false : null;
      return null;
  }
  setTimeout(changed);
  return null;
}

const integration = {
  browserHost: true,
  magnetHandler: false,
  magnetUserChoice: null as string | null,
  extensionDir: "C:\\Users\\you\\AppData\\Local\\Fetchlane\\browser-extension",
};

export function installPreview() {
  (window as unknown as { __FL_PREVIEW__: boolean }).__FL_PREVIEW__ = true;
  mockWindows("main");
  mockIPC((cmd, payload) => handle(cmd, (payload ?? {}) as Record<string, unknown>), { shouldMockEvents: true });
  // Move the sample transfers along so live updates can be reviewed.
  setInterval(() => {
    for (const d of items) {
      if (d.torrent) {
        if (d.torrent.state === "downloading" && d.totalSize) {
          d.speed = Math.max(0.5 * MB, (d.speed ?? MB) * (0.95 + Math.random() * 0.1));
          d.downloaded = Math.min(d.totalSize, d.downloaded + d.speed / 2);
          d.etaSecs = Math.ceil((d.totalSize - d.downloaded) / d.speed);
          d.torrent.uploaded += (d.uploadSpeed ?? 0) / 2;
          if (d.downloaded >= d.totalSize) {
            setState(d, "seeding");
            d.completedAt = Date.now();
          }
        } else if (d.torrent.state === "seeding") {
          d.uploadSpeed = Math.max(20 * KB, (d.uploadSpeed ?? 100 * KB) * (0.9 + Math.random() * 0.2));
          d.torrent.uploaded += d.uploadSpeed / 2;
          d.torrent.ratio = d.torrent.uploaded / Math.max(d.totalSize ?? 1, 1);
          torrents.get(d.id)!.seededSecs += 0.5;
        }
        continue;
      }
      if (d.status === "downloading" && d.phase === "transferring") {
        d.speed = Math.max(0.6 * MB, (d.speed ?? MB) * (0.95 + Math.random() * 0.1));
        d.downloaded += d.speed / 2;
        if (d.totalSize != null) {
          d.etaSecs = Math.ceil((d.totalSize - d.downloaded) / d.speed);
          if (d.downloaded >= d.totalSize) Object.assign(d, { downloaded: d.totalSize, status: "completed", phase: null, speed: null, etaSecs: null, completedAt: Date.now() });
        }
      }
      if (d.phase === "retrying") d.retryInSecs = d.retryInSecs! <= 1 ? 15 : d.retryInSecs! - 1;
    }
    changed();
  }, 500);
  console.info("Fetchlane UI preview: sample data, no real downloads.");
}
