# Fetchlane backend API (for the UI)

The desktop backend (`src-tauri`) exposes the commands and the event below to the web view.
Call commands with `invoke` from `@tauri-apps/api/core`. Argument names and all JSON fields
are camelCase.

The UI in `src/` uses this contract (`src/api.ts` holds the typed wrappers). It is built from
the design system in [`assets/fetchlane/design-system/`](../assets/fetchlane/design-system/README.md).
File opening, folder revealing and link copying go through commands that take a download ID,
never a path or URL, so the web view can't open arbitrary files. Folder pickers use
`@tauri-apps/plugin-dialog` (`dialog:allow-open`), and the Paste button reads the clipboard
(`clipboard-manager:allow-read-text`). .torrent files arrive by the picker or as a path from
the webview's drag-and-drop event; the backend only reads files ending in `.torrent` (20 MB
at most).

Torrents share the download list. Commands that take a download ID work for both kinds
unless the table says otherwise; check `kind`.

## Commands

| Command | Arguments | Returns / notes |
| --- | --- | --- |
| `list_downloads` | none | `Snapshot` |
| `probe_url` | `{ url, destDir? }` | `ProbeResult`. Used for the "checking link" state of Add download. |
| `add_download` | `{ request: AddRequest }` | `DownloadView`. Set `queueFirst: true` for **Download** (first in line); leave it false for **Add to queue** (last). |
| `pause_download` | `{ id }` | Rejects with `cannotResume` when `canPause` is false. For a seeding torrent this is **Stop seeding**. |
| `resume_download` | `{ id }` | Resumes a paused download or retries a failed one. Ignores the Pause all hold. Rejects with `cannotResume` when a restart is needed. For a stopped torrent this is **Start seeding**; seeding then ignores the automatic limits until the torrent is paused again. |
| `start_now` | `{ id }` | **Start now**: starts immediately even if every slot is busy, and moves the download to the top of the queue. |
| `retry_now` | `{ id }` | **Retry now**: skips the remaining retry countdown, or retries a failed download. |
| `restart_download` | `{ id }` | **Delete partial and restart**: deletes partial data and starts from zero. Not allowed for completed downloads or torrents. |
| `move_in_queue` | `{ id, to: QueueMove }` | **Move to top / up / down**. Only for queued downloads. |
| `move_to_position` | `{ id, position }` | Drag and drop in the queue: `position` is 1-based; past the end means last. Direct downloads only. |
| `cancel_download` | `{ id }` | **Cancel download**: stops the download and deletes its partial file. The entry stays as `canceled`. Direct downloads only. |
| `remove_download` | `{ id, deleteFiles: boolean }` | **Remove from list**: partial data of unfinished downloads is always deleted. A completed file is kept unless `deleteFiles` is true, in which case it goes to the Recycle Bin. If that fails, the command rejects and the entry stays. For a torrent, it stops the torrent; `deleteFiles` sends only that torrent's own files to the Recycle Bin and removes folders left empty. |
| `clear_finished` | none | Removes completed and canceled entries from the list. Files stay on disk. |
| `pause_all` | none | Pauses every active download that can resume, and **holds the queue** (`queueHeld`). Downloads that can't resume keep running. |
| `resume_all` | none | Releases the hold and resumes every paused download. |
| `open_file` | `{ id }` | Completed downloads only. |
| `show_in_folder` | `{ id }` | Selects the file if it's complete; otherwise opens the destination folder. |
| `get_source_url` | `{ id }` | The full link, including credentials and parameters. Use it for the reveal (eye) toggle. |
| `copy_source_url` | `{ id }` | **Copy link**: puts the full link on the clipboard from the backend. |
| `free_space` | `{ path }` | Free bytes on that drive, or `null`. Used for the "free space" text in Add download and the status bar. |
| `probe_torrent` | `{ source: TorrentSource, probeId, destDir? }` | `TorrentPreview`. Reads a .torrent file at once; a magnet link fetches details from peers ("Fetching torrent details"). Choose a fresh `probeId` per attempt. |
| `cancel_torrent_probe` | `{ probeId }` | Cancels a magnet fetch; the pending `probe_torrent` rejects with "Fetching torrent details was cancelled." |
| `add_torrent` | `{ request: AddTorrentRequest }` | `DownloadView`. Pass `probeId` from a preview, with `selected` file indexes. Or pass `magnet` alone for **Start automatically after fetching details**: the entry appears as `fetching` and starts with all files. |
| `recheck_torrent` | `{ id }` | **Recheck files**: verifies every piece on disk and downloads what's missing or damaged. |
| `set_torrent_files` | `{ id, selected: number[] }` | Changes which files are downloaded. At least one file. Skipped files that are already on disk are kept. |
| `torrent_details` | `{ id }` | `TorrentDetails`, for the details panel. Poll it while the panel is open. |
| `delete_scope` | `{ id }` | `DeleteScope`: what **Delete downloaded files** would send to the Recycle Bin. Works for both kinds. |
| `get_settings` | none | `Settings` |
| `update_settings` | `{ settings: Settings }` | `Settings`, clamped. Settings apply immediately, with no Save button. Also sets the native title-bar theme. |

A failed command rejects with `CommandError`:

```ts
interface CommandError { kind: ErrorKind; message: string } // message is ready to show
```

## Event

`downloads-changed`: its payload is the full `Snapshot`. It fires on any change and about twice
a second while downloads are active (at most about 10 times a second). Call `list_downloads`
once at startup, then render from this event.

When a download or torrent finishes and `notifyOnFinish` is on, the backend shows a Windows
notification ("Download finished" and the name). The UI doesn't need to do anything.

## Types

```ts
interface Snapshot {
  downloads: DownloadView[]; // queue order; group and sort for display in the UI
  queueHeld: boolean;        // Pause all is in effect: "All paused · queue on hold"
}

type Status = "queued" | "downloading" | "paused" | "completed" | "failed" | "canceled";
// The UI label for "canceled" is "Cancelled" (design-system spelling).

// Only present while a worker is running.
type Phase = "connecting" | "transferring" | "retrying" | "finalizing" | "stopping";

type ErrorKind =
  | "invalidInput" | "network" | "timeout" | "tls" | "redirect" | "http"
  | "notFound" | "accessDenied" | "server" | "rangeMismatch" | "destination"
  | "permission" | "diskFull" | "fileSystem" | "resourceChanged" | "cannotResume"
  | "internal";

type QueueMove = "top" | "up" | "down";

interface DownloadView {
  id: string;
  kind: "direct" | "torrent";
  displayUrl: string;        // scheme + host + path only
  hiddenParams: number;      // "?2 hidden parameters"; reveal with get_source_url
  host: string;
  fileName: string;          // final name; may gain " (1)" if a file appeared meanwhile
  destDir: string;
  status: Status;
  phase: Phase | null;
  totalSize: number | null;  // null = unknown size: show "48.2 MB / unknown" and an indeterminate bar
  downloaded: number;
  speed: number | null;      // bytes/s, null until measurable
  etaSecs: number | null;
  resumable: boolean;
  canPause: boolean;         // false: disable Pause, with the reason "server can't resume"
  connections: number;
  queuePosition: number | null; // "#2 in line" (queued only)
  retryInSecs: number | null;   // live countdown while phase === "retrying"
  retryAttempt: number | null;  // "Retrying in 8 s · 2 of 5" → retryAttempt of retryLimit
  retryLimit: number;           // 0 when automatic retry is off
  error: { kind: ErrorKind; message: string } | null; // when status === "failed"
  createdAt: number;         // ms since epoch
  completedAt: number | null;
  uploadSpeed: number | null; // torrents only, bytes/s
  torrent: TorrentSummary | null; // torrents only
}

// For torrents, `status` is a coarse summary (queued, downloading, paused, completed for
// seeding/stopped, failed for error) and `torrent.state` is the exact state. `host` holds
// "3 files", "2 of 5 files" or "Fetching details"; `displayUrl` is empty.
type TorrentState =
  | "fetching" | "queued" | "checking" | "connecting" | "downloading"
  | "stalled" | "paused" | "seeding" | "stopped" | "error";

interface TorrentSummary {
  state: TorrentState;
  peersConnected: number;
  peersKnown: number;
  uploaded: number;
  ratio: number;             // uploaded / downloaded
  fileCount: number;
  selectedCount: number;
  seedLimitReached: boolean; // stopped by the automatic seeding limits
  infoHash: string;
}

type TorrentSource = { type: "magnet"; value: string } | { type: "file"; value: string };

interface TorrentPreview {
  probeId: string;
  name: string;
  infoHash: string;
  totalSize: number;
  files: { index: number; path: string; size: number }[];
  trackers: string[];
  saveAs: string;            // unique name of the folder or file in the destination
}

interface AddTorrentRequest {
  probeId?: string;
  magnet?: string;
  destDir?: string;
  selected?: number[];       // default: all files
  startPaused?: boolean;     // "Add paused"
}

interface TorrentDetails {
  files: { index: number; path: string; size: number; have: number; selected: boolean }[];
  peersConnected: number;
  peersConnecting: number;
  peersKnown: number;
  downloaded: number;
  uploaded: number;
  ratio: number;
  trackers: string[];
  seeding: boolean;
  seededSecs: number;
  ratioLimit: number | null;       // null = no ratio limit
  timeLimitMinutes: number | null; // null = no time limit
  seedLimitReached: boolean;
  infoHash: string;
  savePath: string;
}

interface DeleteScope {
  fileCount: number;
  totalBytes: number;
  folder: string;
  examples: string[];        // a few file names to show in the confirmation
}

interface AddRequest {
  url: string;
  destDir?: string;          // default: settings.downloadDir
  fileName?: string;         // rejected if it contains \ / : * ? " < > |
  startPaused?: boolean;
  queueFirst?: boolean;      // true = "Download" (first in line), false = "Add to queue"
}

interface ProbeResult {
  suggestedName: string;     // sanitized, unique in the destination; differs on a name clash
  totalSize: number | null;
  contentType: string | null;
  resumable: boolean;        // server advertises ranges (verified again when downloading)
  redirected: boolean;
}

interface Settings {
  downloadDir: string;
  askEachTime: boolean;           // UI asks for a folder in Add download
  maxConcurrent: number;          // 1–10, default 4
  connectionsPerDownload: number; // 1–8; 1 turns off multi-connection downloads
  autoResume: boolean;            // restart interrupted downloads when Fetchlane starts
  retryAutomatically: boolean;    // default true
  retryAttempts: number;          // 1–10, default 5
  theme: "system" | "light" | "dark";
  density: "comfortable" | "compact";
  keepHistory: boolean;           // false: completed downloads are dropped at the next start
  notifyOnFinish: boolean;        // default true
  torrentDownloadLimitKib: number; // 0 = unlimited
  torrentUploadLimitKib: number;   // 0 = unlimited
  maxActiveTorrents: number;      // 1–20, default 3
  seedRatioEnabled: boolean;      // default true
  seedRatioPercent: number;       // 10–10000, default 100 (ratio 1.0)
  seedTimeEnabled: boolean;       // default false
  seedTimeMinutes: number;        // default 60
}
```

## Mapping to design-system states

| Design state | How to detect it |
| --- | --- |
| Downloading | `status === "downloading"`, with `phase` other than `"retrying"` |
| Retrying (amber) | `status === "downloading" && phase === "retrying"`. Show `retryInSecs` and `retryAttempt` of `retryLimit`. |
| Queued · #n in line | `status === "queued"`, using `queuePosition` |
| Paused | `status === "paused"` |
| Failed (red) | `status === "failed"`; the reason comes from `error.kind`. `cannotResume` means the only recovery is **Restart download…**. |
| Completed | `status === "completed"` |
| Cancelled | `status === "canceled"` (partial file deleted) |
| Torrent states | `kind === "torrent"`; use `torrent.state`. `stalled` means no peers are sending data; `stopped` means complete and not seeding. |

Never-retried errors: `notFound`, `accessDenied`, `diskFull`, `destination`, `permission`,
`cannotResume`, `tls`, `redirect`, `invalidInput`.

For the Restart confirmation, use `downloaded` for the amount it discards ("deletes the
412 MB already downloaded").
