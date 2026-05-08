# Alias

**Alias** is a **Tauri desktop app** for **pseudonymization / anonymization** of text and spreadsheets: entity detection (e.g. persons via local ONNX NER), manual **original → alias** mapping, **encode** and **decode** with a persistent mapping table, file import (including Excel), and dark/light theme.

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](./LICENSE)
[![Latest release](https://img.shields.io/github/v/release/fly2nbc-oss/alias?label=release&logo=github)](https://github.com/fly2nbc-oss/alias/releases)
[![Platforms](https://img.shields.io/badge/Platforms-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey)]()
[![Tauri](https://img.shields.io/badge/Framework-Tauri%202-FFC131?logo=tauri)](https://tauri.app/)

---

## Contents

[Screenshots](#screenshots) · [Features](#features) · [Quick start](#quick-start--installation) · [Usage](#usage) · [Platforms & formats](#supported-platforms--formats) · [Development & build](#development--build) · [Roadmap / contributing](#roadmap--known-issues--contributing) · [License](#license)

[Deutsche README](README.md)

---

## Screenshots

Place images in [`./screenshots/`](./screenshots/) (high quality; **dark + light**; **Windows, Linux, macOS**). Suggested names: `linux-main-dark.png`, `windows-main.png`, `mapping-panel.png`, etc. (see German README for a full table).

---

## Features

- **Local person NER** (ONNX; model download on first run).
- **Split UI**: text panel + **mapping table**, resizable divider.
- **Encode / decode** with substitution preview highlights.
- **Persistent store**, import/export, file dialogs and **drag & drop**.
- **Theming**: light/dark.
- **Stack**: Tauri 2, Vite, TypeScript; Rust backend with optional **`onnx-ner`** feature.

---

## Quick start / installation

### From GitHub Releases

Download from [Releases](https://github.com/fly2nbc-oss/alias/releases) (tag `v*`).

### From source

See [Development & build](#development--build).

---

## Usage

1. Start the app; allow **NER model download** if prompted.
2. Paste text or **open / drop** a file.
3. Run **detect entities**, review candidates, confirm mappings.
4. Use **encode** to anonymize; **decode** to reverse using the store.
5. Export/import the store or save output via the file dialogs.

---

## Supported platforms & formats

| Area | Notes |
|------|--------|
| **Desktop** | Windows, Linux, macOS |
| **Bundles** | `deb`, `AppImage`, `nsis`, `dmg` (see `src-tauri/tauri.conf.json`) |
| **Files** | Text and spreadsheet formats supported by the Rust parser (e.g. **Excel** via `calamine`) |

---

## Development & build

**Prerequisites:** Node.js, Rust, [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS.

```bash
git clone https://github.com/fly2nbc-oss/alias.git
cd alias
npm install
npm run build
npm exec tauri build
```

With automatic patch version bump: `npm run tauri:build`.

Smaller binary without bundled ML: build with `--no-default-features` for `onnx-ner` (see `src-tauri/Cargo.toml`).

---

## Roadmap / known issues / contributing

- **Roadmap:** More entity types, large-document batch flows, stronger edge-case tests for substitution.
- **Known issues:** First NER inference may be slow; initial download needs network access.
- **Contributing:** [CONTRIBUTING.md](./CONTRIBUTING.md), [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).
- **Changelog:** [CHANGELOG.md](./CHANGELOG.md).

---

## License

[Apache-2.0](./LICENSE).
