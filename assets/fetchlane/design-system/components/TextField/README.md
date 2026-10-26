Single-line inputs: the link field with live validation, search, file name and folder path.

Consumer provides: label, value, placeholder, validation state (idle, checking, valid, invalid, unsupported, server error) and its message.

- Validation runs 350 ms after typing stops, or immediately on Paste. While checking, show a spinner in the field and "Checking link with host…" below; the Download button shows a spinner and stays disabled.
- Messages sit under the field with an icon and say what to do: not a web link → check it starts with http(s)://; magnet/torrent → not supported; 404 → ask for a new link. Error fields get a `status-error` outline and `aria-invalid`.
- Focus draws a 2 px `accent` underline (Windows 11 style); the outline stays `border-control`.
- URLs and paths use `font-mono`. Search shows its shortcut (Ctrl+F) until it has text, then a clear button.
