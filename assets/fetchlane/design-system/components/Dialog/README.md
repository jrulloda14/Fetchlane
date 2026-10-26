Modal dialog over a `scrim`: the Add download form and every confirmation.

- Width 520 (forms) or 440 (confirmations), `radius-lg`, `surface-300`, `shadow-dialog`; footer on `surface-200` with actions right-aligned, primary last.
- Confirmations: title is a question naming the action; body states exactly what is lost (with sizes) and what is kept; the safe button is focused by default; the destructive button is named for its effect.
- Esc, the scrim and the safe button all dismiss without side effects. Focus is trapped while open and returns to the invoking control on close.
