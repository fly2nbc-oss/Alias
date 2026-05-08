/**
 * bump-patch.mjs — läuft vor jedem `tauri build` (via beforeBuildCommand).
 * Erhöht die Patch-Version in Cargo.toml und tauri.conf.json automatisch.
 */
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// --- Cargo.toml: erste version = "..." Zeile im [package]-Block ---
const cargoPath = join(root, 'src-tauri', 'Cargo.toml');
let cargo = readFileSync(cargoPath, 'utf8');

const match = cargo.match(/^version\s*=\s*"(\d+)\.(\d+)\.(\d+)"/m);
if (!match) {
  console.error('[bump-patch] ERROR: version not found in Cargo.toml');
  process.exit(1);
}

const major = match[1];
const minor = match[2];
const patch = parseInt(match[3], 10);
const newVersion = `${major}.${minor}.${patch + 1}`;

// Nur erste Fundstelle ersetzen (= [package] version, nicht Dependency-Versionen)
// WICHTIG: m-Flag nötig, da ^ sonst nur den String-Anfang matcht, nicht Zeilenanfänge
cargo = cargo.replace(/^version\s*=\s*"\d+\.\d+\.\d+"/m, `version = "${newVersion}"`);
writeFileSync(cargoPath, cargo, 'utf8');

// --- tauri.conf.json ---
const confPath = join(root, 'src-tauri', 'tauri.conf.json');
const conf = JSON.parse(readFileSync(confPath, 'utf8'));
conf.version = newVersion;
writeFileSync(confPath, JSON.stringify(conf, null, 2) + '\n', 'utf8');

console.log(`[bump-patch] Version: ${match[1]}.${match[2]}.${patch} → ${newVersion}`);
