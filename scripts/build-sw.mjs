// Writes the precache list of the service worker: every file of the app plus the art it shows,
// with a version from their contents, so a change to any file installs a fresh cache.
// node scripts/build-sw.mjs [--check]
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const root = 'docs/app';
const extra = ['../favicon.svg', '../assets/head-dark.svg', '../assets/mascot-dark.svg'];
const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
const files = walk(root)
  .map((f) => relative(root, f).split(sep).join('/'))
  .filter((f) => f !== 'sw.js')
  .sort();
const hash = createHash('sha256');
for (const f of [...files, ...extra]) hash.update(f).update(readFileSync(join(root, f)));
const list = ['./', ...files, ...extra];
const block = `// precache:start\nconst CACHE_VERSION = '${hash.digest('hex').slice(0, 12)}';\nconst PRECACHE = [\n${list.map((f) => `  '${f}',`).join('\n')}\n];\n// precache:end`;
const sw = readFileSync(join(root, 'sw.js'), 'utf8');
const next = sw.replace(/\/\/ precache:start[\s\S]*?\/\/ precache:end/, block);
if (process.argv.includes('--check')) {
  if (next !== sw) {
    console.error('docs/app/sw.js precache list is stale, run npm run sw');
    process.exit(1);
  }
  console.log('sw: precache list is current');
} else {
  writeFileSync(join(root, 'sw.js'), next);
  console.log(`sw: ${list.length} files precached`);
}
