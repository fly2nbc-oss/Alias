# Contributing to Alias

Thanks for your interest. This project follows the [Code of Conduct](./CODE_OF_CONDUCT.md).

## Requirements

- Node.js and npm
- Rust (stable) and the [Tauri v2 system prerequisites](https://v2.tauri.app/start/prerequisites/)

## Repository

```bash
git clone https://github.com/fly2nbc-oss/alias.git
cd alias
```

## Workflow

1. **Discuss first** — For larger changes, open or comment on an [issue](https://github.com/fly2nbc-oss/alias/issues) so work doesn’t overlap.
2. **Fork & branch** — Use clear branch names (`fix/…`, `feat/…`).
3. **Changes** — Match existing code and UI style; avoid unrelated refactors in the same PR.
4. **Checks** — Where reasonable, run `npm run build` and locally `npm exec tauri build` or `cargo test` in `src-tauri`.
5. **Pull request** — Describe the motivation; add screenshots for UI changes.

## Releases

Automated builds and assets (`.deb`, `.AppImage`, NSIS, `.dmg`, `SHA256SUMS.txt`, `updater.json`) are often handled with [`tauri-apps/tauri-action`](https://github.com/tauri-apps/tauri-action) in `.github/workflows/`.

## License

By contributing, you agree that your contributions are licensed under the project’s [Apache-2.0 license](./LICENSE).
