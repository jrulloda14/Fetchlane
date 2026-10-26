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
export type Density = "comfortable" | "compact";

export interface DownloadView {
  id: string;
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
  getSettings: () => invoke<Settings>("get_settings"),
  updateSettings: (settings: Settings) => invoke<Settings>("update_settings", { settings }),
  onChange: (cb: (s: Snapshot) => void): Promise<UnlistenFn> =>
    listen<Snapshot>("downloads-changed", (e) => cb(e.payload)),
};
