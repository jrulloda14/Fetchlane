// Typed wrappers for the backend commands. See docs/IPC.md.
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type Status = "queued" | "downloading" | "paused" | "completed" | "failed" | "canceled";
export type Phase = "connecting" | "transferring" | "retrying" | "finalizing" | "stopping";
export type ErrorKind =
  | "invalidInput" | "network" | "timeout" | "tls" | "redirect" | "http"
  | "notFound" | "accessDenied" | "server" | "rangeMismatch" | "destination"
  | "permission" | "diskFull" | "fileSystem" | "resourceChanged" | "cannotResume"
  | "internal";
export type QueueMove = "top" | "up" | "down";
export type Theme = "system" | "light" | "dark";
export type DownloadKind = "direct" | "torrent";
export type TorrentState =
  | "fetching" | "queued" | "checking" | "connecting" | "downloading"
  | "stalled" | "paused" | "seeding" | "stopped" | "error";

export interface TorrentSummary {
  state: TorrentState;
  peersConnected: number;
  peersKnown: number;
  uploaded: number;
  ratio: number;
  fileCount: number;
  selectedCount: number;
  seedLimitReached: boolean;
  infoHash: string;
}
export type Density = "comfortable" | "compact";

export interface DownloadView {
  id: string;
  kind: DownloadKind;
  displayUrl: string;
  hiddenParams: number;
  host: string;
  fileName: string;
  destDir: string;
  status: Status;
  phase: Phase | null;
  totalSize: number | null;
  downloaded: number;
  speed: number | null;
  etaSecs: number | null;
  resumable: boolean;
  canPause: boolean;
  connections: number;
  queuePosition: number | null;
  retryInSecs: number | null;
  retryAttempt: number | null;
  retryLimit: number;
  error: { kind: ErrorKind; message: string } | null;
  createdAt: number;
  completedAt: number | null;
  uploadSpeed: number | null;
  torrent: TorrentSummary | null;
}

export interface TorrentFile {
  index: number;
  path: string;
  size: number;
}

export interface TorrentPreview {
  probeId: string;
  name: string;
  infoHash: string;
  totalSize: number;
  files: TorrentFile[];
  trackers: string[];
  saveAs: string;
}

export type TorrentSource =
  | { type: "magnet"; value: string }
  | { type: "file"; value: string }
  | { type: "url"; value: string };

export interface AddTorrentRequest {
  probeId?: string;
  magnet?: string;
  destDir?: string;
  selected?: number[];
  startPaused?: boolean;
}

export interface TorrentFileView extends TorrentFile {
  have: number;
  selected: boolean;
}

export interface TorrentDetails {
  files: TorrentFileView[];
  peersConnected: number;
  peersConnecting: number;
  peersKnown: number;
  downloaded: number;
  uploaded: number;
  ratio: number;
  trackers: string[];
  seeding: boolean;
  seededSecs: number;
  ratioLimit: number | null;
  timeLimitMinutes: number | null;
  seedLimitReached: boolean;
  infoHash: string;
  savePath: string;
}

export interface DeleteScope {
  fileCount: number;
  totalBytes: number;
  folder: string;
  examples: string[];
}

export interface Snapshot {
  downloads: DownloadView[];
  queueHeld: boolean;
}

export interface AddRequest {
  url: string;
  destDir?: string;
  fileName?: string;
  startPaused?: boolean;
  queueFirst?: boolean;
}

export interface ProbeResult {
  suggestedName: string;
  nameClash: boolean;
  totalSize: number | null;
  contentType: string | null;
  resumable: boolean;
  redirected: boolean;
}

export interface Settings {
  downloadDir: string;
  askEachTime: boolean;
  maxConcurrent: number;
  connectionsPerDownload: number;
  autoResume: boolean;
  retryAutomatically: boolean;
  retryAttempts: number;
  theme: Theme;
  density: Density;
  keepHistory: boolean;
  notifyOnFinish: boolean;
  torrentDownloadLimitKib: number;
  torrentUploadLimitKib: number;
  maxActiveTorrents: number;
  seedRatioEnabled: boolean;
  seedRatioPercent: number;
  seedTimeEnabled: boolean;
  seedTimeMinutes: number;
}

export interface CommandError {
  kind: ErrorKind;
  message: string;
}

/** Turn anything a command rejected with into a message fit to show. */
export function errorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String((e as CommandError).message);
  return typeof e === "string" ? e : "Something went wrong.";
}

export function errorKind(e: unknown): ErrorKind | null {
  return e && typeof e === "object" && "kind" in e ? (e as CommandError).kind : null;
}

/** A link or .torrent file handed over by the browser extension or Windows. */
export type ExternalAdd = { type: "link"; value: string } | { type: "torrentFile"; value: string };

export interface IntegrationStatus {
  browserHost: boolean;
  magnetHandler: boolean;
  magnetUserChoice: string | null;
  extensionDir: string | null;
}

export const api = {
  list: () => invoke<Snapshot>("list_downloads"),
  probe: (url: string, destDir?: string) => invoke<ProbeResult>("probe_url", { url, destDir }),
  add: (request: AddRequest) => invoke<DownloadView>("add_download", { request }),
  pause: (id: string) => invoke<void>("pause_download", { id }),
  resume: (id: string) => invoke<void>("resume_download", { id }),
  startNow: (id: string) => invoke<void>("start_now", { id }),
  retryNow: (id: string) => invoke<void>("retry_now", { id }),
  restart: (id: string) => invoke<void>("restart_download", { id }),
  move: (id: string, to: QueueMove) => invoke<void>("move_in_queue", { id, to }),
  moveTo: (id: string, position: number) => invoke<void>("move_to_position", { id, position }),
  cancel: (id: string) => invoke<void>("cancel_download", { id }),
  remove: (id: string, deleteFiles: boolean) => invoke<void>("remove_download", { id, deleteFiles }),
  clearFinished: () => invoke<void>("clear_finished"),
  pauseAll: () => invoke<void>("pause_all"),
  resumeAll: () => invoke<void>("resume_all"),
  openFile: (id: string) => invoke<void>("open_file", { id }),
  showInFolder: (id: string) => invoke<void>("show_in_folder", { id }),
  sourceUrl: (id: string) => invoke<string>("get_source_url", { id }),
  copySourceUrl: (id: string) => invoke<void>("copy_source_url", { id }),
  freeSpace: (path: string) => invoke<number | null>("free_space", { path }),
  probeTorrent: (source: TorrentSource, probeId: string, destDir?: string) =>
    invoke<TorrentPreview>("probe_torrent", { source, probeId, destDir }),
  cancelTorrentProbe: (probeId: string) => invoke<void>("cancel_torrent_probe", { probeId }),
  addTorrent: (request: AddTorrentRequest) => invoke<DownloadView>("add_torrent", { request }),
  recheck: (id: string) => invoke<void>("recheck_torrent", { id }),
  setTorrentFiles: (id: string, selected: number[]) => invoke<void>("set_torrent_files", { id, selected }),
  torrentDetails: (id: string) => invoke<TorrentDetails>("torrent_details", { id }),
  deleteScope: (id: string) => invoke<DeleteScope>("delete_scope", { id }),
  getSettings: () => invoke<Settings>("get_settings"),
  updateSettings: (settings: Settings) => invoke<Settings>("update_settings", { settings }),
  onChange: (cb: (s: Snapshot) => void): Promise<UnlistenFn> =>
    listen<Snapshot>("downloads-changed", (e) => cb(e.payload)),
  takeExternalAdds: () => invoke<ExternalAdd[]>("take_external_adds"),
  onExternalAdd: (cb: () => void): Promise<UnlistenFn> => listen("external-add", () => cb()),
  onFocusDownload: (cb: (id: string) => void): Promise<UnlistenFn> =>
    listen<string>("focus-download", (e) => cb(e.payload)),
  integrationStatus: () => invoke<IntegrationStatus>("integration_status"),
  setMagnetHandler: (enabled: boolean) => invoke<IntegrationStatus>("set_magnet_handler", { enabled }),
  showExtensionFolder: () => invoke<void>("show_extension_folder"),
};
