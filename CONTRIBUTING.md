# Contributing to Alias

Thanks for your interest. This project follows the [Code of Conduct](./CODE_OF_CONDUCT.md).

## Requirements

- Node.js and npm
- Rust (stable) and the [Tauri v2 system prerequisites](https://v2.tauri.app/start/prerequisites/)

## Repository

```bash
git clone https://github.com/fly2nbc-oss/Alias.git
cd alias
```

## Workflow

1. **Discuss first** — For larger changes, open or comment on an [issue](https://github.com/fly2nbc-oss/Alias/issues) so work doesn’t overlap.
2. **Fork & branch** — Use clear branch names (`fix/…`, `feat/…`).
3. **Changes** — Match existing code and UI style; avoid unrelated refactors in the same PR.
4. **Checks** — Where reasonable, run `npm run build` and locally `npm exec tauri build` or `cargo test` in `src-tauri`.
5. **Pull request** — Describe the motivation; add screenshots for UI changes.

## Releases & CI/CD

- **CI** ([`ci.yml`](.github/workflows/ci.yml)): runs on pushes and pull requests to `main` — `npm ci`, `npm run build`, `cargo clippy`, `cargo test` on Ubuntu with Tauri Linux dependencies.
- **Release** ([`tauri-release.yml`](.github/workflows/tauri-release.yml)): runs when you push a version tag matching `v*` (same version as in `package.json` / `src-tauri/tauri.conf.json`). Uses [`tauri-apps/tauri-action`](https://github.com/tauri-apps/tauri-action) to build **Windows**, **Linux**, and **macOS** bundles and attach them to the GitHub release. A follow-up step uploads **`SHA256SUMS.txt`** for all release assets (per project PRD).

**Repository setting:** **Settings → Actions → General → Workflow permissions** — set **Read and write** so `GITHUB_TOKEN` can publish releases and upload assets.

**Tauri updater (`updater.json`):** The release workflow sets `uploadUpdaterJson: false` until [`tauri-plugin-updater`](https://v2.tauri.app/plugin/updater/) and code-signing are configured. Then set it to `true` in `tauri-release.yml` and add updater config in `tauri.conf.json`.

## License

By contributing, you agree that your contributions are licensed under the project’s [Apache-2.0 license](./LICENSE).
