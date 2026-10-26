Left navigation between the five download lists, with live counts, plus Settings.

- Lists: All downloads, Active (downloading, retrying, paused), Queued, Completed, Failed. Counts are tabular numbers; Failed's count turns `status-error` and bold when above zero.
- Current item: `surface-selected` + 3 px `accent` indicator + bold label + `aria-current="page"`.
- Rail mode (56 px): icon with the count beneath; label in tooltip and accessible name. See layout rules for when it engages.
- Arrow keys move between items; Enter/Space activates.
