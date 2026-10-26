Buttons for commands: primary (one per surface), secondary, subtle, and destructive.

Consumer provides: label (sentence case), optional leading icon, `disabled`, and a loading flag for network waits.

- `fl-btn-primary` — the single main action: Add download, Download, Resume, Retry, Open file. Teal fill, `on-accent` text.
- `fl-btn` (secondary) — everything else: Browse…, Pause all, Show in folder, Cancel…
- `fl-btn-subtle` — low-emphasis, in dense bars: Clear selection, Show more.
- `fl-btn-danger-fill` — only inside a confirmation dialog, for the action that deletes data. Never in toolbars or rows.
- `fl-ibtn` — 32 px (28 px `-sm`) icon button for row and panel actions; always has `aria-label` and a tooltip.
- States: hover, pressed, keyboard focus ring, disabled (no fill, `ink-disabled`), loading (spinner replaces the icon, the label stays so width doesn't jump).
