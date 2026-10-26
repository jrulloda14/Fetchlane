Plain-language status block shown in the details panel (and dialogs) for anything the person might need to act on.

- Title says what happened; body says what Fetchlane did or will do, what is kept, and what to do next. Include sizes and drive letters.
- Variants: `is-retry` (automatic, amber), `is-error` (needs the person, red, `role="alert"`), `is-done` (completed summary), neutral (paused, queued, size unknown).
- Pair each error with exactly the next actions in the panel footer: Retry; Retry + Change folder…; Restart download… (confirms).
