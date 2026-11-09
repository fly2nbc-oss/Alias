# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), versioning follows [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

## [2.0.0] – 2026-11-09

Alias is now a **browser app**: one HTML file, `alias.html`, that runs in Edge or Chrome, and a Windows installer. The desktop app and its Rust backend are gone; everything runs in TypeScript in the browser.

### Added

- **Files through the AI and back**: after **Hide names** in an opened file, the blue button is **Save file for AI** (a copy with placeholders, `…_anonym.docx`). In *2 · AI's answer*, **Open AI's file** (or `Ctrl+O`, or dropping a file there) opens the file the AI sent back, in any format Alias reads; **Bring names back** and **Save file** write it with the real names in its format (`…_original.docx`). Placeholders in other capitalization or split over two Word runs are brought back; the status bar counts placeholders the AI wrote differently (`Person 1` for `Person-1`) and those not found in the saved file. *Save ▾* also has **Copy the text**.
- **Windows installer**: the release has `alias_<version>_windows-installer.zip`. Its `install.cmd` installs Alias for the current user (no admin rights), adds it to the Start menu, opening in its own Edge window, and to *Settings > Apps*. Alias runs with **its own Edge profile**, so other local HTML files cannot read the list of names. `uninstall.cmd` removes it again; `/purge` also deletes the list of names and the smart name finder.
- **Clean Office copies**: an encoded copy loses author, last editor, company, manager, dates, template path, custom properties, the people list, the thumbnail and JPEG metadata; comment and revision authors become "Author". Alt texts, field codes, hyperlink targets, formulas, chart and pivot caches, Excel sheet names (in formulas too) and embedded Office files are encoded, and so is the file name. Alias lists what it removed and warns about parts it cannot check (images, OLE objects, macros).
- **Everything that is replaced is shown**: footnotes, comments, tracked deletions, text boxes, charts, slide masters, formulas, alt texts, links and properties appear in the text, so Find names can find them.
- **Warning for missed terms**: after saving, Alias names terms it showed but could not replace in the file, for example in Excel date cells.
- **Ask before using the internet**: on the first start a card offers the **smart name finder** (a small AI, downloaded once from Hugging Face, about 180 MB) and a weekly **update check**; both are off unless you tick them. Without them Alias sends no request and finds names with simple rules. Both can be turned on later in Settings or with **Turn on** in the status bar.
- **Settings**: appearance, smart name finder on or off, its size and **Delete download**, update check with *Check now*.
- **Find names shows progress** and can be stopped (`Esc`); for long texts it asks first (*Simple rules only* / *Use the smart finder*).
- **Names and placeholders**: search, sortable columns in natural order, paging for long lists, undo for delete and clear, *Export first* before clearing.
- **Checking found names**: "7 names found", columns Hide · Found by (rule, list, name finder, both, address) · Name · Kind · Placeholder · Times, grouping and ticking by kind, a preview of where the name is, matches over several lines kept; **Use these names** puts them in the list.
- **Keyboard and accessibility**: `Ctrl+Enter` for the next step, `Ctrl+O` open, `Ctrl+Shift+D` / `E` / `U` for Find names, Hide names and Bring names back, `Alt+1` / `Alt+2` for the steps; tooltips name the keys; dialogs with focus handling, `Esc` and ARIA; WCAG AA contrast in both themes.
- **License notices in the app**: About shows the notices of the built-in libraries.

### Changed

- **One button for the next step, words a child understands**: one bar at the top with *1 · My text | 2 · AI's answer* and a single blue button on the right that always names the next step: **Open file → Find names → Hide names → Copy for AI → Paste AI's answer → Bring names back → Copy**, and for a file **… → Hide names → Save file for AI → Open AI's file → Bring names back → Save file**. **Paste AI's answer** goes to step 2 and pastes from the clipboard (or asks for `Ctrl+V`). Step 2 stays greyed out until the names are hidden. The original, the hidden text, the AI's answer and the restored answer are all kept; results are locked, **Change text** / **Change answer** in the status bar edits them again. *Save ▾* offers a copy in the original format and the text.
- **Status bar**: says in one sentence what happened and what to do next ("7 names hidden in 9 places · Now copy the text and give it to the AI."), with the file name, *Locked · Change text* and the state of the name finder. The start view shows the five steps as pictures.
- **New look**: the shared design system v2 – calmer colours, neutral grey dark mode, 40 px top bar, 32 px controls, hints at the top centre, Lucide icons.
- **Replacement ignores capitalization and respects word boundaries**: "MÜLLER" is replaced by the entry "Müller"; "Max" is no longer replaced inside "Maximilian"; "Person-1" no longer matches inside "Person-10". Replacement runs in one pass, so an inserted alias is never replaced again. Highlighting uses the same matching.
- **AI model in the browser**: the same model as before runs in a Web Worker (Transformers.js, ONNX Runtime Web), **pinned to a fixed revision**, every downloaded file checked against its SHA-256, and kept by the browser. It now reads the **whole text** in chunks; the desktop app only looked at the first 512 tokens.
- **Detection is much faster**: 1 MB of text in about 0.4 s instead of about 2 min; long number lists (JSON, CSV) no longer freeze the app.
- **Better detection**: names and companies no longer run across table cells or lines (Excel, CSV, Word tables); a salutation on its own line ("Frau↵Name", address blocks) is still recognized; leading articles are no longer part of company names ("Die Kranich AG" → "Kranich AG"); companies with a legal form win over place names ("Kranich Software GmbH" in "Kranich Software GmbH Hamburg"); several companies in a list are split; chains of titles ("Herrn Dr. …") work; phone numbers no longer run across line breaks; field labels such as IBAN, BIC, Tel., CEO are no longer suggested.
- **Office files**: parts of the file Alias does not change are copied byte for byte, with their timestamps and compression; unusual compression in parts Alias does not need no longer breaks opening or saving; protection against zip bombs.
- **Names and placeholders**: saved automatically after every change; placeholders must be unique and differ from the names; imports are checked strictly (size, types, duplicate IDs).
- **Saving**: copies go through a *Save as* dialog (Edge, Chrome) or the download folder instead of being written next to the source file.
- **Desktop app removed**: no more desktop installers for Windows, Linux and macOS, no `Alias_Reset.bat`, no Rust toolchain. To move from the desktop app, uninstall it and load its alias table (`alias_store.json` in its data folder under `%APPDATA%`) with **Import**.

### Fixed

- **Surnames on their own**: "Frau Hoffmann" next to "Laura Hoffmann" was merged into the full name and stayed in plain text after encoding; it now gets its own entry.
- **Blank lines** no longer double when typing in the editor.
- **App icon**: the icon of the app window (taskbar, Alt+Tab) was a globe because the built-in icon was cut off; it now shows the Alias icon (the masked smiley).
- **Street addresses** no longer include the space after the house number.
- **Addresses in tables**: in an Excel sheet or CSV with an address in each row, the addresses were not found, and a cell such as "Total" next to a number cell was taken for a street or product code. Street, post code and product codes no longer run across cells.

## [1.1.0] – 2026-11-03

### Added

- **More file formats:** PowerPoint (`.pptx`, `.pptm`), Word `.docm`, OpenDocument (`.odt`, `.ods`, `.odp`) and many text formats (`.csv`, `.tsv`, `.log`, `.json`, `.xml`, `.html`, `.yaml`, `.toml`, `.ini`, …). All of them can be saved back encoded/decoded in their original format.
- **PDF** (text layer, no OCR) and legacy **`.xls`** can be opened; the result is saved as `.txt` (no write-back in the original format).
- Saving a copy reports the number of replacements and warns when none were made.

### Changed

- Office files: replacement now works on text nodes per paragraph, so names split across formatting runs are replaced too. Markup and attributes are never touched; all headers/footers, footnotes, endnotes, comments, slide masters/layouts/notes, SmartArt, chart titles, cached Excel formula texts and document properties (author) are included.
- Text files keep their encoding (UTF-8 with/without BOM, UTF-16, Windows-1252) and line endings.
- Decoding `name_anonym.ext` now writes `name_original.ext` (instead of `name_anonym_original.ext`).
- Supported extensions are defined once in `src-tauri/src/formats.rs` (parser, save, dialog, drag & drop).

### Fixed

- `.xls` no longer fails with a ZIP error on save; Word headers/footers beyond `header1`/`footer1` are now replaced.
- Release workflow: Windows build links with the dynamic MSVC runtime (ONNX Runtime), Linux builds on `ubuntu-24.04` (glibc ≥ 2.38), Intel macOS is built without local NER (no prebuilt ONNX Runtime for that target).

## [1.0.1] – 2026-05-09

### Added

- GitHub Actions: **CI** (`.github/workflows/ci.yml`) on pushes/PRs to `main`; **Release** (`.github/workflows/tauri-release.yml`) on tags `v*` with `tauri-apps/tauri-action`, multi-platform bundles, and `SHA256SUMS.txt` upload.

## [1.0.0] – 2026-05-08

### Added

- **About** dialog with app version, license link, repository link, and branding icon (`src-tauri/app-icon-source.png` via Vite).
- `public/favicon.svg` and `public/app-logo.svg` (favicon / optional assets).
- `vite-env.d.ts` and `VITE_APP_VERSION` injection from `package.json`.

### Changed

- Documentation in English; streamlined root `README.md`; removed redundant `README_EN.md`.
- **CONTRIBUTING.md** and **CODE_OF_CONDUCT.md** in English (Contributor Covenant–based).
- **Category** `<select>` styling in dark mode (`color-scheme`, surface background).
- Tauri JS/Rust aligned on 2.11.x / `tauri-build` 2.6; `.cargo/config.toml` `CFLAGS` scoped to Windows MSVC only.

### Fixed

- Linux builds no longer inherit global `CFLAGS=/MD` from Cargo config.

## [0.9.1] – 2026-05-08

### Added

- Project documentation and community files (`README.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`).
- Bundle targets for Linux (`deb`, `appimage`) and macOS (`dmg`) alongside Windows (`nsis`) in `src-tauri/tauri.conf.json`.

### Changed

- Tauri JS/Rust versions aligned (`@tauri-apps/*` 2.11.x, Rust `tauri` 2.11, `tauri-build` 2.6).
- `.cargo/config.toml`: `CFLAGS=/MD` only for `x86_64-pc-windows-msvc`, so Linux/macOS builds are not broken.
- Dark mode: category `<select>` in the alias table uses readable contrast (surface background, `color-scheme`).

### Notes

- Tauri 2 desktop app: anonymization / pseudonymization workflow with local ONNX NER, mapping store, encode/decode, file and Excel-style import.

[Unreleased]: https://github.com/fly2nbc-oss/Alias/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/fly2nbc-oss/Alias/compare/v1.1.0...v2.0.0
[1.1.0]: https://github.com/fly2nbc-oss/Alias/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/fly2nbc-oss/Alias/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/fly2nbc-oss/Alias/releases/tag/v1.0.0
[0.9.1]: https://github.com/fly2nbc-oss/Alias/releases/tag/v0.9.1
