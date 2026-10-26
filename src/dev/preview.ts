// Development-only browser preview. When the UI runs in a plain browser
// (`npm run dev`, no Tauri), this installs Tauri's IPC mocks with sample
// downloads so the interface can be reviewed without the backend.
// main.ts only imports it when import.meta.env.DEV is true, so production
// builds don't contain it. Nothing here downloads anything.
import { emit } from "@tauri-apps/api/event";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { DownloadView, Settings, Snapshot } from "../api";

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

function handle(cmd: string, a: Record<string, unknown>): unknown {
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
      for (let i = items.length - 1; i >= 0; i--) if (items[i].status === "completed" || items[i].status === "canceled") items.splice(i, 1);
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
      return null;
    case "plugin:app|version":
      return "0.1.0-preview";
    case "plugin:clipboard-manager|read_text":
      return "https://download.kdenlive.org/stable/25.08.2/kdenlive-25.08.2.exe";
    case "plugin:dialog|open":
      return "D:\\Downloads\\Other";
    default:
      if (cmd.startsWith("plugin:window|")) return cmd.endsWith("is_maximized") ? false : null;
      return null;
  }
  setTimeout(changed);
  return null;
}

export function installPreview() {
  mockWindows("main");
  mockIPC((cmd, payload) => handle(cmd, (payload ?? {}) as Record<string, unknown>), { shouldMockEvents: true });
  // Move the sample transfers along so live updates can be reviewed.
  setInterval(() => {
    for (const d of items) {
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
