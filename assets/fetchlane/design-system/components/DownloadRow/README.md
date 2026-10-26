One download in the table, built by `Fetchlane.rowHTML(download, options)`; the header by `theadHTML`.

Consumer provides: the download record, density, whether it is selected/focused/open, and the column layout (`wide` adds speed and time-left columns).

- Filename is the widest column, `text-body-strong`, ellipsis + tooltip with the full name; hostname below in `ink-muted` (comfortable only).
- Status cell: label left, percentage right (tabular), bar under. Size "3.68 / 5.91 GB" (one unit when both share it).
- Actions: one contextual icon (Pause, Resume, Start now, Retry now, Show in folder) + overflow, visible on hover, focus or selection. Failed rows always show a labelled recovery button (Retry / Restart…). Completed rows add Open file.
- Double-click: open file (completed) or details. Right-click: the overflow menu for that row (selecting it if it wasn't).
- States: hover wash, selected (`surface-selected` + 3 px `accent` bar + checked box), keyboard focus (inset ring), open-in-details.
