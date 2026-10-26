# Fetchlane assets

- `logos/` — app mark: `-dark.svg` / `-light.svg` fixed colours; `-themed.svg` uses CSS vars `--accent` / `--on-accent`.
- `icons/` — UI line icons (24 grid, 1.6 stroke, currentColor), draw at 16 px.
- `design-system/` — `tokens.json` (source of truth), `tokens.css` (generated CSS variables, dark first + `[data-theme="light"]`), `components/bundle.css` (class contract) and `bundle.js` (reference renderer + behaviour spec), per-component READMEs and preview pages, and `README.md` (brand book + interaction rules).
