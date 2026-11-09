/**
 * bump-patch.mjs: raises the patch version in package.json and package-lock.json.
 * Usage: npm run bump-patch
 */
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function bump(file, apply) {
  const path = join(root, file);
  const json = JSON.parse(readFileSync(path, 'utf8'));
  apply(json);
  writeFileSync(path, JSON.stringify(json, null, 2) + '\n', 'utf8');
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(pkg.version);
if (!m) {
  console.error(`[bump-patch] ERROR: unexpected version "${pkg.version}"`);
  process.exit(1);
}
const newVersion = `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;

bump('package.json', (j) => {
  j.version = newVersion;
});
bump('package-lock.json', (j) => {
  j.version = newVersion;
  if (j.packages?.['']) j.packages[''].version = newVersion;
});

console.log(`[bump-patch] ${pkg.version} → ${newVersion}`);
