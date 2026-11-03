# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

## [1.0.1] - 2026-05-09

### Added

- GitHub Actions: **CI** (`.github/workflows/ci.yml`) on pushes/PRs to `main`; **Release** (`.github/workflows/tauri-release.yml`) on tags `v*` with `tauri-apps/tauri-action`, multi-platform bundles, and `SHA256SUMS.txt` upload.

## [1.0.0] - 2026-05-08

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

## [0.9.1] - 2026-05-08

### Added

- Project documentation and community files (`README.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`).
- Bundle targets for Linux (`deb`, `appimage`) and macOS (`dmg`) alongside Windows (`nsis`) in `src-tauri/tauri.conf.json`.

### Changed

- Tauri JS/Rust versions aligned (`@tauri-apps/*` 2.11.x, Rust `tauri` 2.11, `tauri-build` 2.6).
- `.cargo/config.toml`: `CFLAGS=/MD` only for `x86_64-pc-windows-msvc`, so Linux/macOS builds are not broken.
- Dark mode: category `<select>` in the alias table uses readable contrast (surface background, `color-scheme`).

### Notes

- Tauri 2 desktop app: anonymization / pseudonymization workflow with local ONNX NER, mapping store, encode/decode, file and Excel-style import.

[Unreleased]: https://github.com/fly2nbc-oss/Alias/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/fly2nbc-oss/Alias/releases/tag/v1.0.0
[0.9.1]: https://github.com/fly2nbc-oss/Alias/releases/tag/v0.9.1
