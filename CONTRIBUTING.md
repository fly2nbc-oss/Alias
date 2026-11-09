# Contributing

Thank you for helping improve **Alias**.

## Prerequisites

1. [Node.js](https://nodejs.org/) 22 or newer, with npm
2. Edge or Chrome to try the result
3. For the Windows installer: Windows with Edge

## Getting started

```bash
git clone https://github.com/fly2nbc-oss/Alias.git
cd Alias
npm install
npm run dev        # dev server on http://localhost:1420
```

For the file users get: `npm run build` writes `dist/alias.html`; open it in Edge or Chrome, or run `npm run preview`.

## How the code is laid out

| Path | Purpose |
|---|---|
| `src/main.ts`, `src/workflow.ts`, `src/actions.ts`, `src/api.ts`, `src/components/` | UI: next-step rules, toolbar, text panel, status bar, names and placeholders, dialogs, settings |
| `src/core/detector/` | Rule-based detection: patterns, persons, companies, addresses |
| `src/core/ner/` | AI model: Web Worker, inference, BIO decoding, pinned revision and SHA-256 check (`integrity.ts`) |
| `src/core/office-xml.ts`, `office-extras.ts`, `file-copy.ts`, `sanitize.ts`, `parsers.ts`, `zip.ts` | Reading, rewriting and cleaning Office, PDF and text files |
| `src/core/store.ts`, `substitute.ts`, `browser-io.ts` | Alias table, encode/decode, opening and saving files in the browser |
| `src/core/update-check.ts` | Weekly release check |
| `vite.config.ts` | Single-file build: inlines scripts, styles, the ONNX runtime and the pdf.js worker into `dist/alias.html` |
| `packaging/windows/` | `install.cmd`, `uninstall.cmd` and the icon for the Windows installer ZIP |
| `docs/` | App icon and the file format reference |

[`AGENTS.md`](./AGENTS.md) describes conventions and pitfalls in more detail.

## Rules

- The app stays **one file** that runs from `file://` and from any web server: no CDN, nothing loaded from other servers. The only network requests are the model download from Hugging Face and the release check against the GitHub API.
- The UI and the docs are in English; code comments are in German.
- Opened files and imported alias tables are untrusted data: check them, escape text before it reaches HTML, never run anything from them.
- Do not break the alias table format: older JSON exports, including `alias_store.json` of the desktop app, must still import.
- New libraries need a license compatible with Apache-2.0 and an entry in [`THIRD_PARTY.md`](./THIRD_PARTY.md) and [`NOTICE`](./NOTICE).

## Checking your build

CI runs exactly these:

```bash
npm ci --ignore-scripts       # clean install from package-lock.json, no install scripts
npm test                      # unit tests (Vitest)
npm run build                 # type check + dist/alias.html
```

For changes to detection or the AI model, also run `ALIAS_LIVE_NER=1 npm test` (against the real model; downloads about 180 MB once). `dist/` is not committed; CI builds it.

## Packages

The release job builds the Windows installer ZIP; there is no local script for it. To try the installer, put `packaging/windows/install.cmd`, `uninstall.cmd`, `alias.ico`, `dist/alias.html`, `LICENSE`, `NOTICE` and `THIRD_PARTY.md` into one folder and run `install.cmd`. Keep the `.cmd` files ASCII with CRLF line endings (`.gitattributes` takes care of it on checkout).

## Continuous Integration

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on pushes and pull requests to **`main`** and on `v*` tags:

- **Build** – `npm ci --ignore-scripts`, `npm test`, `npm run build`; fails when `src/` or `index.html` name a URL that is not on the allowed list, or when `dist/alias.html` loads a script, style, image or frame from another server. `alias.html` is kept as a workflow artifact.
- **Lint workflows** – `actionlint` and `zizmor` check the workflow files.
- **Draft release** (`v*` tags only) – checks the tag against `package.json` and `CHANGELOG.md`, zips `packaging/windows/` with `alias.html`, `LICENSE`, `NOTICE` and `THIRD_PARTY.md` into the Windows installer, writes `SHA256SUMS.txt`, attests where the files were built, and drafts a GitHub release with them.

[Dependabot](.github/dependabot.yml) proposes updates of the pinned actions and the npm packages once a month. `xlsx` (SheetJS) comes from the SheetJS CDN, not from the npm registry, and is updated by hand.

## Pull requests

- Keep changes focused on one concern where possible; for larger changes, open an [issue](https://github.com/fly2nbc-oss/Alias/issues/new/choose) first.
- Describe **what** changed and **why** in the PR description.
- For UI changes, attach screenshots when practical – with a made-up sample text, never real names.
- Run the commands from *Checking your build*, and try the change in Edge or Chrome.

## Code of conduct

Participants are expected to follow our [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md).

## License

By contributing, you agree that your contributions are licensed under the project’s [Apache-2.0 license](./LICENSE).
