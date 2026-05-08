# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.9.1] - 2026-05-08

### Added

- Project documentation and community files (`README.md`, `README_EN.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`).
- Bundle targets for Linux (`deb`, `appimage`) and macOS (`dmg`) alongside Windows (`nsis`) in `src-tauri/tauri.conf.json`.

### Changed

- Tauri JS/Rust versions aligned (`@tauri-apps/*` 2.11.x, Rust `tauri` 2.11, `tauri-build` 2.6).
- `.cargo/config.toml`: `CFLAGS=/MD` only for `x86_64-pc-windows-msvc`, so Linux/macOS builds are not broken.
- Dark mode: category `<select>` in the alias table uses readable contrast (surface background, `color-scheme`).

### Notes

- Tauri 2 desktop app: anonymization / pseudonymization workflow with local ONNX NER, mapping store, encode/decode, file and Excel-style import.

[Unreleased]: https://github.com/fly2nbc-oss/alias/compare/v0.9.1...HEAD
[0.9.1]: https://github.com/fly2nbc-oss/alias/releases/tag/v0.9.1
