# Alias

**Alias** ist eine **Tauri-Desktop-App** zur **Pseudonymisierung / Anonymisierung** von Text und Tabellen: erkannte Entitäten (z. B. Personen per lokalem ONNX-NER), manuelle Zuordnung **Original → Alias**, **Kodieren** und **Dekodieren** mit persistenter Mapping-Tabelle, Datei-Import (u. a. Excel) und Dark-/Light-Theme.

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](./LICENSE)
[![Latest release](https://img.shields.io/github/v/release/fly2nbc-oss/alias?label=release&logo=github)](https://github.com/fly2nbc-oss/alias/releases)
[![Platforms](https://img.shields.io/badge/Platforms-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey)]()
[![Tauri](https://img.shields.io/badge/Framework-Tauri%202-FFC131?logo=tauri)](https://tauri.app/)

---

## Inhaltsverzeichnis

- [Screenshots](#screenshots)
- [Features](#features)
- [Quick Start / Installation](#quick-start--installation)
- [Nutzung](#nutzung)
- [Unterstützte Plattformen & Formate](#unterstützte-plattformen--formate)
- [Entwicklung & Build](#entwicklung--build)
- [Roadmap / Known Issues / Contributing](#roadmap--known-issues--contributing)
- [Lizenz](#lizenz)
- [Englische README](README_EN.md)

---

## Screenshots

Bilder im Ordner [`./screenshots/`](./screenshots/) (hohe Auflösung; ideal **Hell- und Dunkelmodus** und weitere Plattformen). Bereits vorhanden und unten eingebunden:

| Datei | Inhalt |
|--------|--------|
| `alias_linux-dark.png` | Hauptfenster Linux, Dark Mode |
| `alias_linux-light.png` | Hauptfenster Linux, Light Mode |
| `alias_linux-light-detect.png` | Detect / Kandidaten, Linux Light |

Optional ergänzen: `windows-main.png`, `macos-main.png`, `mapping-panel.png`, …

Beispiel (aktuell im Repository):

![Hauptansicht (Linux, Dark)](./screenshots/alias_linux-dark.png)

![Hauptansicht (Linux, Light)](./screenshots/alias_linux-light.png)
![Detect (Linux, Light)](./screenshots/alias_linux-light-detect.png)

Weitere Plattformen: unter den oben genannten Dateinamen ergänzen (`windows-main.png`, …).

---

## Features

- **Lokale Personenerkennung (NER)** mit ONNX (Modell-Download beim ersten Start, optional manuell wiederholbar).
- **Zwei-Spalten-UI**: Textbereich und **Mapping-Tabelle** (Original, Alias, Kategorie, bestätigt), **Resize** per Ziehgriff.
- **Kodieren / Dekodieren** von Freitext mit **Vorschau der Ersetzungen** (Hervorhebung).
- **Persistenter Store** (Laden beim Start), **Import/Export** der Alias-Liste, Autospeicherung unter konfigurierbarem Pfad.
- **Dateien**: Dialog und **Drag & Drop**; Verarbeitung reiner Textinhalte und **Tabellen** (Rust-seitig u. a. via `calamine`).
- **Theming**: Hell/Dunkel, Auswahl wird gespeichert.
- **Plattform**: Tauri 2, Vite, TypeScript-Frontend; Rust-Backend mit optional feature-gesteuertem **`onnx-ner`**.

---

## Quick Start / Installation

### Aus GitHub Releases (empfohlen)

1. [Releases](https://github.com/fly2nbc-oss/alias/releases) öffnen (`v*`-Tag).
2. Passendes Asset laden:
   - **Windows:** Installer (`.exe` / NSIS), ggf. `.msi`
   - **macOS:** `.dmg`
   - **Linux:** `.AppImage` und/oder `.deb`
3. Prüfsummen: `SHA256SUMS.txt` (bei Releases mit anbieten).

### Aus Quellcode

Siehe Abschnitt [Entwicklung & Build](#entwicklung--build).

---

## Nutzung

1. App starten; beim ersten Start wird das **NER-Modell** bei Bedarf heruntergeladen (Fortschritt in der UI).
2. Text einfügen oder **Datei öffnen** / per **Drag & Drop** laden.
3. **Entitäten erkennen** lassen, Vorschläge in der **Kandidaten-Ansicht** prüfen und ins Mapping übernehmen (oder manuell Einträge anlegen).
4. Modus **Kodieren** wählen, um Text mit den gespeicherten Aliases zu ersetzen; **Dekodieren** kehrt das Mapping zurück (je nach implementierter Logik konsistent mit dem Store).
5. Bei Bedarf **Store exportieren/importieren** oder Anonymisat als Datei speichern.

Details zur Oberfläche: Toolbar (Datei, Theme, NER-Status, …), rechtes Panel für **Bulk-Edit** der Zuordnungen.

---

## Unterstützte Plattformen & Formate

| Bereich | Hinweis |
|---------|---------|
| **Desktop** | Windows, Linux, macOS (Tauri/WebView-abhängig) |
| **Bundles** | `deb`, `AppImage` (Linux), `nsis` (Windows), `dmg` (macOS) – siehe `src-tauri/tauri.conf.json` |
| **Dateitypen** | Text und Tabellenformate, die der Rust-Parser unterstützt (u. a. **Excel** über `calamine`) |

---

## Entwicklung & Build

### Voraussetzungen

- **Node.js** (für `npm` / Vite)
- **Rust** (stable) + Systemabhängigkeiten für [Tauri v2](https://v2.tauri.app/start/prerequisites/) (unter Linux z. B. WebKitGTK, unter Windows WebView2)

### Kommandos

```bash
git clone https://github.com/fly2nbc-oss/alias.git
cd alias
npm install
npm run dev          # Vite-Dev-Server + Tauri Dev (über npm run tauri dev falls genutzt)
```

Frontend nur:

```bash
npm run build       # tsc && vite build
```

**Release-Build** (ohne automatisches Patch-Bump der Version):

```bash
npm run build
npm exec tauri build
```

**Linux:** Für das **AppImage**-Bundle benötigt Tauri [`linuxdeploy`](https://github.com/linuxdeploy/linuxdeploy) (und passende Plugins) im `PATH`. Fehlt das Tool, schlägt nur dieser Schritt fehl — das **`.deb`-Paket** wird trotzdem erzeugt. Unter Arch/Manjaro z. B. aus dem AUR oder nach [Tauri-Doku – Linux](https://v2.tauri.app/distribute/) installieren.

Mit **automatischem Patch-Bump** vor dem Build (wie in `package.json` vorgesehen):

```bash
npm run tauri:build
```

### Schlanke Variante ohne lokales ML (kleineres Binary)

Im `Cargo.toml` ist dokumentiert: Release-Build mit `--no-default-features` deaktiviert `onnx-ner`. Dafür Build/CI entsprechend anpassen.

---

## Roadmap / Known Issues / Contributing

- **Roadmap:** Erweiterung weiterer Entitätstypen, bessere Batch-Verarbeitung großer Dokumente, härtere Tests für Randfälle beim Ersetzen.
- **Known Issues:** Erster NER-Lauf kann je nach Hardware kurz dauern; Download erfordert Netzwerk bis die Modelldateien lokal liegen.
- **Mitwirken:** Siehe [CONTRIBUTING.md](./CONTRIBUTING.md) und [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).
- **Änderungshistorie:** [CHANGELOG.md](./CHANGELOG.md).

---

## Lizenz

[Lizenziert unter Apache-2.0](./LICENSE).
