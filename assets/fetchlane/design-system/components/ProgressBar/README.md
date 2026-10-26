Progress bar: 4 px in rows, 6 px in the details panel; `role="progressbar"` with `aria-valuenow`.

- Each state changes the bar's form as well as colour: solid teal (downloading), grey (paused), dashed amber (retrying), solid red (failed, showing partial data kept), sliding segment (size unknown).
- Queued, completed and cancelled downloads have no bar.
- With `prefers-reduced-motion`, the indeterminate bar becomes a static half-strength full bar.
