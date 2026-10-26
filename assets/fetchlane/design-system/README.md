Fetchlane is an open-source download manager for Windows. **Your downloads, in order.** It should feel like a dependable daily utility: quick, calm and approachable — never flashy. This system covers the MVP only: HTTP/HTTPS downloads, queue management, pause/resume, retries, persistent history and settings.

## Voice and copy

- Speak plainly about what happened and what to do next: "Not enough space on drive D:", "Connection lost — stopped after 5 attempts", "Fetchlane will reconnect in 8 s".
- Sentence case everywhere: buttons, headings, menu items ("Add download", "Show in folder"). Never all-caps, never exclamation marks, no emoji.
- Address the person as "you"; Fetchlane refers to itself by name, not "we".
- Put an ellipsis on any command that opens a confirmation or picker: "Cancel…", "Restart download…", "Remove from list…", "Browse…".
- Name destructive buttons for their effect, never "OK" or "Yes": "Delete partial and restart", "Cancel download", "Remove and delete files". Name the safe choice for what it keeps: "Keep partial file", "Keep downloading", "Keep".
- Give sizes and counts, not adjectives: "deletes the 412 MB already downloaded", "Pause 2", "#2 in line".
- Use "—" for a value that applies but is unavailable (time left with no total size), with a tooltip and accessible name explaining why. Leave a cell **empty** when the metric doesn't apply (speed of a completed file).

## Colour

- Dark (charcoal) is the primary theme; light is coordinated value-for-value. Ship **System / Light / Dark**, System following Windows.
- Surfaces step up by layer: `surface-000` frame (title bar, sidebar) → `surface-100` content → `surface-200` raised (fields, details panel) → `surface-300` overlays (dialogs, menus). Separate layers with `border-subtle` hairlines and, for overlays only, `shadow-flyout` / `shadow-dialog`. No gradients, no glass, no blur.
- Teal is the only brand hue. Use `accent` for fills (primary button, progress, selection bar, checked controls) with `on-accent` text; use `accent-text` when teal is text or an icon. Never put white text on `accent` in dark theme.
- Text: `ink` primary, `ink-muted` secondary, `ink-subtle` tertiary; all pass 4.5:1 on every surface including `surface-selected`. `ink-disabled` is for disabled controls only.
- Hover and press are washes (`surface-hover`, `surface-pressed`) laid over whatever surface is below, so one token works on rows, nav items and subtle buttons.
- Control outlines use `border-control` (3:1 on every surface). `border-subtle` is decorative and is never a control's only boundary.

## Status: never colour alone

Every status is **icon + word (+ detail)**, and the progress bar changes form as well as colour:

| State | Token | Icon | Label | Bar |
| --- | --- | --- | --- | --- |
| Downloading | `status-progress` | down arrow | Downloading | solid `progress-fill`; indeterminate sweep when size is unknown |
| Queued | `status-queued` | clock | Queued · #2 in line | none |
| Paused | `status-paused` | pause | Paused | `progress-paused`, keeps its position |
| Retrying (automatic, transient) | `status-retry` | circular arrow | Retrying in 8 s · 2 of 5 | dashed `progress-retry` |
| Failed (persistent) | `status-error` | alert circle | Failed · Disk full | solid `progress-error` (shows partial kept) |
| Completed | `status-done` | check circle | Completed · 14:10 | none |
| Cancelled | `ink-muted` | stop square | Cancelled · partial file deleted | none |

**Retrying vs Failed.** Amber means "Fetchlane is handling it": a live countdown, the attempt count, and the download keeps its slot. Red means "this needs you": retries are exhausted or the error is one Fetchlane never retries (disk full, 404, access denied, server can't resume). Failed downloads move to the Failed list, raise its count in `status-error`, and always show their recovery action as a labelled button in the row.

## Type

- One family: Segoe UI Variable (`font-ui` for text, `font-display` for titles and the big percentage), falling back to the platform UI face. `font-mono` (Cascadia Mono) only for URLs and paths.
- Styles: `text-title` 20/28 page and dialog titles · `text-subtitle` 16/22 list heading · `text-body-strong` 14/20 filenames · `text-body` 14/20 default · `text-row` 13/18 table cells and status · `text-caption` 12/16 hostnames, headers, status bar · `text-mono` 12/18.
- Every changing number — sizes, speeds, percentages, time left, counts — uses `font-variant-numeric: tabular-nums` and is right-aligned in its column so digits don't jitter while they update once a second.

## Spacing, radius, elevation

- 4 px grid: `space-1` 4 · `space-2` 8 · `space-3` 12 · `space-4` 16 · `space-6` 24. Content gutters are `space-4`; dialogs pad `space-6`.
- Restrained rounding: `radius-sm` 4 px for every control and row wash (the Windows 11 control radius), `radius-lg` 8 px for dialogs, menus, panel blocks and the window, `radius-xs` 2 px for bars and checkboxes. Nothing is pill-shaped except toggles.
- Fixed sizes live in the `size` family: `titlebar-height` 32, `toolbar-height` 52, `statusbar-height` 28, `sidebar-width` 200 / `sidebar-rail` 56, `details-width` 340, `row-comfortable` 48 / `row-compact` 32, `control-height` 32.

## Iconography

- One line set (see the Icons card): 24-unit grid, 1.6 stroke, round caps and joins, drawn at 16 px in `currentColor`. Row actions at 16 px inside 28 px hit targets (26 px compact).
- File types are subtle page outlines in `ink-subtle` with a small glyph (disc, archive, app, video, audio, image, document, data, other) — they aid scanning but never compete with the filename.
- The mark (Logos group) is a file travelling down a dashed lane into a tray. In-app it is drawn with `accent` and `on-accent`, so it follows the theme; the two SVG files are the fixed dark- and light-theme versions for places outside the app.

## Layout and responsive rules

Window minimum 960 × 640; designed at 1280 × 800.

- **Title bar** (32): mark + "Fetchlane", standard Windows caption buttons. **Sidebar**: All downloads, Active, Queued, Completed, Failed with counts; Settings pinned to the bottom. **Toolbar**: Add download (primary), search (Ctrl+F), density switch, Pause all. **List heading** or **selection toolbar**. **Table**. **Status bar** summary.
- Columns, in priority order: checkbox · **filename** (flexible, minimum 220 px, always the widest) · status + progress (248) · size (128) · speed (76) · time left (68) · actions (92, or 100 when a row needs a text button).
- When the list area is narrower than 1000 px, speed and time left fold into the status cell ("Downloading · 8.0 MB/s · 4 min left") and their columns are removed.
- Sidebar collapses to a 56 px icon rail (counts under each icon, labels in tooltips and accessible names) below 1100 px window width, and also when the details panel is docked on a window narrower than 1440 px — the filename column keeps its room.
- Details panel docks at ≥ 1200 px; below that it overlays the list from the right with `shadow-flyout`.
- Below 900 px of list width, the density switch and Clear selection become icon-only (labels kept for screen readers) and search shortens to "Search".

## Interaction rules

**Scope is always explicit.**
- Row actions (hover/focus icons, overflow menu, context menu) affect that one download.
- When rows are selected, the selection toolbar replaces the list heading and each button shows how many selected downloads it applies to ("Pause 2", "Retry 0" disabled).
- Toolbar actions that affect everything say "all": **Pause all / Resume all**. Pause all pauses every active download that can resume and holds the queue; the status bar then reads "All paused · queue on hold".

**Pause ≠ Cancel ≠ Remove.**
- **Pause** stops the transfer and keeps the partial file. If the server can't resume, Pause is unavailable for that download (menu item disabled with the reason) and Pause all skips it.
- **Cancel…** stops the transfer and deletes the partial file; it always asks first. The entry stays in the list as Cancelled so it can be downloaded again.
- **Remove from list…** removes the entry only. Files on disk are kept unless the person ticks "Also delete the downloaded files from disk" (unticked by default; sends them to the Recycle Bin). The button turns destructive only when that box is ticked.
- Any action that discards partial progress — Cancel, Restart on a server that can't resume — opens a confirmation stating the size that will be lost, with the safe choice focused.

**Queue.** Queued downloads start top to bottom, `max` at a time (Settings, default 4; a retrying download keeps its slot). In All they show "Queued · #n in line"; the Queued list shows position numbers and drag handles, and supports Move to top / up / down (Alt+↑ / Alt+↓). "Download" in the add dialog starts now if a slot is free or goes first in line if not; "Add to queue" goes last.

**Selection and keyboard.**
- Click selects one row; Ctrl+click toggles; Shift+click selects a range; the checkbox toggles without clearing others. Checkboxes appear on hover, focus, and on every row once anything is selected.
- The table is a single tab stop (roving tabindex). ↑/↓ move, Shift+↑/↓ extend, Home/End jump, Space toggles selection, Ctrl+A selects the list, Enter opens details (or opens the file for completed rows), Delete removes (with confirmation), Shift+F10 / Menu key opens the row menu, Esc clears selection then closes the details panel.
- Global: Ctrl+N Add download, Ctrl+V anywhere outside a text field opens Add download with the clipboard link, Ctrl+F search, Ctrl+I details.
- Focus is a 2 px solid `focus-ring` outside a 1 px surface gap, visible only for keyboard focus. Rows draw it inset.

**States.** Every interactive element has rest, hover (`surface-hover`), pressed (`surface-pressed`), keyboard focus, disabled (`ink-disabled`, no hover) and — where it waits on the network — loading (spinner replaces the icon, label stays, cursor `progress`). Selected rows get `surface-selected` + a 3 px `accent` bar + a checked checkbox.

**Live values.** Speed, size, percentage and time left update once per second in place; never re-render a row while it's hovered or focused. Time left is hidden ("—") when the total size is unknown or while reconnecting. Unknown sizes read "48.2 MB / unknown" and use the indeterminate bar.

**Privacy.** Source URLs show scheme, host and path; query parameters are replaced by "?2 hidden parameters" until the person presses the eye button. Copy link always copies the full URL.

**Motion.** 120 ms ease-out for toggles and hover washes; the indeterminate bar and spinners respect `prefers-reduced-motion`. Nothing bounces.

## What to build from here

- `components/bundle.css` is the class contract (`fl-` prefix) and reads only token variables. `components/bundle.js` is a dependency-free reference renderer: `Fetchlane.mountApp(el, {width, height, view, density, open, sel, dialog})` renders the complete window with working selection, keyboard, menus, dialogs and simulated transfers. Use it as the behaviour spec; port the markup and rules into the WinUI/WPF/Tauri layer you choose.
- Screens: Main screen, Multi-select, Compact density, Add download, Details, Settings, Empty state, Failure & recovery, Restart confirmation, Completed, Remove confirmation, 960 × 640.
