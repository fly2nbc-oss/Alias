# Instructions for coding agents

Alias pseudonymizes texts and documents in the browser: TypeScript and Vite, no framework, built into one self-contained HTML file. Human contributors find the build and check steps in `CONTRIBUTING.md`.

## Standards

This project follows the latest versions of two documents in the parent folder
(outside this repository): `repo_standard_v*.md` (setup, docs, CI, release) and
`ui_design_system_v*.md` (UI, where the project has one). Read them before changing
those areas; where this file says something different, this file wins.

## Rules

- UI strings and docs in English, in plain words (terms below); code comments in English. Line endings LF, except `*.cmd`, `*.bat`, `*.ps1` (CRLF, see `.gitattributes`).
- The app stays **one file**, `dist/alias.html`, that runs from `file://` and from any web server. Everything is inlined by `vite.config.ts`; nothing is loaded from other servers.
- Network URLs in `src/` and `index.html` only from the CI allow list (`.github/workflows/ci.yml`, step "No network references"): `huggingface.co` (model), `github.com/fly2nbc-oss/Alias` (About, update banner), `api.github.com/repos/fly2nbc-oss/Alias/releases/latest` (release check), `apache.org/licenses`, and XML namespaces (never fetched). Tests may hold other URLs as sample input.
- Opened files and imported alias tables are untrusted: escape text (`escHtml()` in `components/dialog.ts`, `escapeHtml()` in `utils/highlight.ts`) before it goes into `innerHTML`; imports go through `parseStoreExport()` / `sanitizeEntry()` in `core/store.ts`; ZIPs through `readZip()` with its size limits.
- Everything that is replaced in a copy must also be shown in the text (`core/office-extras.ts`); otherwise Find names cannot find it.
- **No network request without consent**: the smart name finder (model download) and the update check are off until the user ticks them on the first-run card or in Settings (`core/consent.ts`, `nerEnabled()` and `updateCheckEnabled()` default to false). `api.init()` must not load the model.
- Office XML is edited as strings, text node by text node (`core/office-xml.ts`); not with `DOMParser`/`XMLSerializer`, which rewrite namespaces and formatting.
- ZIP entries: change an entry with `withData(entry, data)` from `core/zip.ts`, **not** `{ ...entry, data }`, which loses the metadata. Unchanged entries are copied byte for byte.
- Do not break the alias table format (`{ entries: [{ id, original, alias, category, confirmed }] }` or a bare array): older exports and `alias_store.json` of the desktop app must still import. Category keys are German (`person`, `firma`, `ort`, `sonstiges`, …) and stored in the table; do not rename them.
- New libraries need a license compatible with Apache-2.0 and an entry in `THIRD_PARTY.md` and `NOTICE`.

## Commands

```bash
npm install
npm run dev                  # dev server on http://localhost:1420
npm test                     # Vitest
ALIAS_LIVE_NER=1 npm test    # also against the real model (downloads about 180 MB once)
npm run build                # tsc + dist/alias.html
npm run preview              # serve dist/, redirects / to alias.html
```

`dist/` is not committed; CI builds it. CI runs `npm ci --ignore-scripts`: do not rely on install scripts.

## Product decisions

Settled; do not propose them again.

- **Browser app, one file** (2026-11, replaces the Tauri desktop app of 1.1 and older): `alias.html` from `file://` or any web server, plus a Windows installer ZIP. No desktop build, no Rust.
- **Windows installer = `install.cmd` / `uninstall.cmd`** (2026-11): per user, no admin rights, own Edge profile so other local HTML files cannot read the alias table. No MSI/NSIS.
- **No code signing** (2026-11, deviation from the repo standard, code signing section): the release has only an HTML file and two batch scripts. Batch files cannot carry an Authenticode signature and an HTML file has none, so SignPath has nothing to sign. Instead every release file is attested (`gh attestation verify <file> --repo fly2nbc-oss/Alias`) and listed in `SHA256SUMS.txt`; the README says that Windows asks once before running `install.cmd`. Revisit only if the release gets an `.exe` or `.msi`.
- **Release files** (2026-11, extends the single-file row of the standard): `alias.html`, `alias_<version>_windows-installer.zip` (scripts, icon, `alias.html`, `LICENSE`, `NOTICE`, `THIRD_PARTY.md`), `SHA256SUMS.txt`.
- **AI model**: `Xenova/bert-base-multilingual-cased-ner-hrl`, not bundled, pinned by revision and SHA-256 per file.
- **UI = proposal B in plain words** (2026-11): one bar at the top with the step switch *1 · My text | 2 · AI's answer* and **exactly one primary button** on the far right that names the next step (Open file → Find names → Hide names → Copy for AI → Paste AI's answer → Bring names back → Copy); all state in the 28 px status bar in whole sentences; step 2 greyed out until the names are hidden; no panel header, no hint bar. Rules in `src/workflow.ts`.
- **Terms** (UI, docs, tooltips): Find names (not Detect), Hide names (not Encode), Bring names back (not Decode), placeholder (not alias), *Names and placeholders* (not alias table), columns Hide · Name · Placeholder · Kind, *smart name finder* (not AI detection/NER). Code identifiers, storage keys, category keys and file suffixes (`_anonym`, `_original`, `_encoded`, `_decoded`) stay as they are.
- **Consent first** (2026-11): smart name finder and update check off by default; a card in the start view asks once (no dialog, design system R12); **Turn on** in the status bar opens Settings.
- **Alias table format** stays compatible with the desktop app (`alias_store.json`); category keys stay German.

## Files

| Path | Purpose |
|---|---|
| `index.html`, `src/main.ts` | Entry: layout, theme, resize handle |
| `src/api.ts` | App API used by the UI (detect, encode/decode, open, save, import/export) |
| `src/store.ts` | UI state: input and result of step *1 · My text* (encode) and *2 · AI's answer* (decode), first run, finder state |
| `src/workflow.ts` | Rules without DOM: next step (primary button), allowed actions and their reasons, step-2 lock, status bar sentences, keys (`SHORTCUT`) |
| `src/actions.ts` | What buttons and keys do (open, find, hide, paste answer, bring back, copy, save), keyboard shortcuts |
| `src/components/` | Toolbar, text panel (editor, picture story), status bar, first-run card, names and placeholders table, check dialog (`candidate-review.ts`), settings, about (with license notices), hints, progress pill |
| `src/core/detector/` | Rule pipeline: patterns, persons, companies, addresses; word lists in `src/core/data/` |
| `src/core/ner/` | AI model in a Web Worker (`worker.ts`), client, BIO decoding, `integrity.ts` (pinned revision, SHA-256 per file), `model-cache.ts` |
| `src/core/substitute.ts` | Encode/decode: case-insensitive, whole words, one pass |
| `src/core/formats.ts` | Supported extensions, defined once |
| `src/core/parsers.ts`, `text-codec.ts` | File to text; pdf.js and SheetJS are loaded on demand |
| `src/core/file-copy.ts`, `office-xml.ts`, `office-extras.ts`, `xlsx-formula.ts`, `sanitize.ts`, `zip.ts` | Writing the encoded/decoded copy, metadata cleanup, ZIP reader/writer |
| `src/core/browser-io.ts` | File picker, *Save as* (File System Access API, else download), `localStorage` |
| `src/core/update-check.ts` | Weekly release check (off until turned on) |
| `src/core/consent.ts` | First-run answer; starts only what the user turned on |
| `vite.config.ts` | Single-file build, version meta tag, ONNX WASM inlined as gzip + Base64 |
| `packaging/windows/` | `install.cmd` / `uninstall.cmd` (per user: copy to `%LOCALAPPDATA%\Programs\Alias`, Start menu entry with `msedge --user-data-dir=… --app`, entry in Settings > Apps) and `alias.ico`; the release job zips them with `alias.html`, `LICENSE`, `NOTICE`, `THIRD_PARTY.md` |
| `docs/` | `icon.svg` (app icon, also inlined as favicon in `index.html`), `FILE-FORMATS.md`, `examples/` (sample documents for manual tests) |
| `screenshots/` | README screenshots; how to take them in `screenshots/README.md` |
| `.github/` | CI (`workflows/ci.yml`: build, lint workflows, draft release), Dependabot, issue forms |

## Storage

`localStorage`: `alias.store.v1` (names and placeholders), `alias.consent.v1` (first-run card answered), `alias.nerEnabled.v1` (`true` only after consent), `alias.updateCheck.v1` (`enabled: true` only after consent), `alias.theme.v1`. Cache Storage: `transformers-cache` (model). Under `file://` in a normal browser profile all local HTML files share this storage; the installer's own Edge profile (`%LOCALAPPDATA%\AliasData\EdgeProfile`) avoids that. Values read back from storage are checked like external input.

## Tests

Vitest, files `src/**/*.test.ts`, environment `node`. `*.live.test.ts` runs only with `ALIAS_LIVE_NER=1`. For UI changes, also try `dist/alias.html` from disk in Edge or Chrome: the worker, pdf.js and the save dialog behave differently under `file://` than on the dev server.

## Release

1. Set the version in `package.json` (`npm run bump-patch` for a patch release; the About dialog shows it). In `CHANGELOG.md` rename `[Unreleased]` to `## [x.y.z] – YYYY-MM-DD` and add an empty `[Unreleased]` above. If the UI changed visibly, renew the README screenshot. Commit, push, wait for green CI.
2. `git tag -a vx.y.z -m "Alias x.y.z"` and `git push origin vx.y.z`, only when the owner says so. CI checks tag = `package.json`, the version in `dist/alias.html` (`<meta name="alias-version">`) and the changelog section, attests the files and drafts the release.
3. Check the draft (notes, files, checksums), then `gh release edit vx.y.z --draft=false --latest`. Releases are immutable once published.

## Gotchas

- `packaging/windows/*.cmd` are batch + PowerShell in one file: the batch part runs the rest with `Invoke-Expression`, so no execution policy applies; keep them ASCII and CRLF. `uninstall.cmd` deletes itself: its batch part is one block ending in `(goto) 2>nul & exit /b N`, because a plain `exit /b` would read the deleted file. If PowerShell is locked down, `install.cmd` writes a `.url` shortcut instead of the `.lnk`.
- The NER worker must stay a classic worker (`worker.format: "iife"`), inlined as a Blob URL: under `file://` Chromium refuses module workers from Blob URLs.
- Updating the model: new `MODEL_REVISION` and new hashes in `src/core/ner/integrity.ts` (the comment there says how).
- `xlsx` (SheetJS) comes from the SheetJS CDN tarball in `package.json`, not from the npm registry; Dependabot (`.github/dependabot.yml`) does not cover it, update it by hand.
- Pushing changes to `.github/workflows/` needs a token with the `workflow` scope (`gh auth refresh -s workflow`).
