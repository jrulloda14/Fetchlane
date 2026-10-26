Overflow / context menu for one download. Contents depend on its state, built by `Fetchlane.menuItems(download)`.

- Order: state actions (Pause/Resume/Start/Retry; Open file, Show in folder) → queue moves → Details, Copy link, folder → destructive (Cancel download…, Remove from list…).
- Destructive items use `status-error` and an ellipsis, and always confirm. Unavailable items stay visible but disabled, with the reason in the label when it isn't obvious.
- Opens from the ⋯ button, right-click or Shift+F10; focus goes to the first item; ↑/↓ move, Enter activates, Esc returns focus to the row.
