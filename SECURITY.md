# Security

## Supported versions

Security fixes are made for the latest release only.

| Version | Supported |
|---|---|
| latest release | ✅ |
| older releases | ❌ |

## Reporting a vulnerability

Please do **not** open a public issue for security problems. Use GitHub's [private vulnerability reporting](https://github.com/fly2nbc-oss/Alias/security/advisories/new) instead.

Name the browser and its version, the operating system, whether Alias runs from the installer or as `alias.html`, and the steps that make it happen. If a file triggers it, please make a small one with made-up content that shows the problem. Never attach a real document or a real list of names. A first answer comes within 14 days.

## What Alias does

- It runs entirely in the browser. Documents, texts and the list of names are never uploaded, and there is no telemetry. The libraries, the ONNX runtime and the PDF worker are built into the HTML file; the page loads no scripts, styles, fonts or images from other servers.
- It sends no network request until you allow it. On the first start a card asks about the two features that use the network; both are unticked, and **Start** without a tick keeps Alias offline. Both can be turned on or off later in Settings (`src/core/consent.ts`). Then there are exactly two kinds of request:
  - **Smart name finder download** from `huggingface.co`, once, after you turn it on, if the model is not in the browser's cache yet. The model is pinned to a fixed revision, and every file is checked against its SHA-256 while it downloads; a file that does not match is discarded (`src/core/ner/integrity.ts`).
  - **Release check** against `api.github.com`, at most once a week after you turn it on, and when you click **Check now**. It only reads the latest release, sends nothing from the app and stays silent when it fails (`src/core/update-check.ts`).
- It reads files only when you open or drop them, and writes only when you save – through the browser's *Save as* dialog, or as a download. The original file is never changed.
- Opened files are treated as data: Office and OpenDocument files are unpacked with limits against zip bombs (200 MB in total, 50 MB per part) and their XML is read as data; text is escaped before it is shown; nothing in a file is run as code. An imported list of names is checked strictly (size, number of entries, field types and lengths, categories) and never overwrites existing entries.
- It keeps the list of names and placeholders and the settings in the browser's `localStorage`, and the smart name finder in the browser's Cache Storage. When Edge is installed, the Windows installer starts Alias with its own Edge profile in `%LOCALAPPDATA%\AliasData\EdgeProfile`, so no other page or local HTML file shares that storage; `uninstall.cmd /purge` deletes it.

## Verifying a release

Every file of a release is built by this repository's CI. `SHA256SUMS.txt` lists their checksums, and `gh attestation verify <file> --repo fly2nbc-oss/Alias` checks where a file was built.
