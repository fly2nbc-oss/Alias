# Mitwirken an Alias

Danke für dein Interesse! Dieses Projekt folgt dem [Code of Conduct](./CODE_OF_CONDUCT.md).

## Voraussetzungen

- Node.js und npm
- Rust (stable) und die [Tauri-v2-Systemvoraussetzungen](https://v2.tauri.app/start/prerequisites/)

## Repository

```bash
git clone https://github.com/fly2nbc-oss/alias.git
cd alias
```

## Ablauf

1. **Issue oder Diskussion:** Für größere Änderungen kurz abstimmen ([Issues](https://github.com/fly2nbc-oss/alias/issues)), damit sich Arbeit nicht überschneidet.
2. **Fork & Branch:** Aussagekräftiger Branch-Name (`fix/…`, `feat/…`).
3. **Änderungen:** 
   - Code- und UI-Stil am bestehenden Projekt ausrichten.
   - Keine unnötigen Refactorings im gleichen PR.
4. **Tests / manuelle Checks:** Wo sinnvoll `npm run build` und lokal `npm exec tauri build` oder `cargo test` im `src-tauri`-Verzeichnis.
5. **Pull Request:** Beschreibung mit Motivation und ggf. Screenshots bei UI-Änderungen.

## Releases (Hinweis)

Für automatisierte Builds und Assets (`.deb`, `.AppImage`, NSIS, `.dmg`, SHA256, `updater.json`) eignet sich z. B. die offizielle Action [`tauri-apps/tauri-action`](https://github.com/tauri-apps/tauri-action) in `.github/workflows/`. Siehe PRD-Datei `prd_github_project.md` für die empfohlene Dateiliste pro Release.

## Lizenz

Mit dem Einreichen von Beiträgen stimmst du zu, dass diese unter der [Apache-2.0-Lizenz](./LICENSE) des Projekts lizenziert werden.
