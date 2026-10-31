// Copies the two sibling packages the app shares with the browser extension into vendor/.
//
// They are copied, not linked, because a cloud build (EAS) uploads this repository only: a path that points
// outside it does not exist on the build machine. Run `npm run sync` after changing either package, and commit
// the result. `npm run sync:check` fails when vendor/ is out of date.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');

const PACKAGES = [
  { from: '../bch-intents-wallet-core', to: 'vendor/wallet-core', include: ['src', 'package.json', 'README.md'] },
  { from: '../wdk-wallet-bch', to: 'vendor/wdk-wallet-bch', include: ['src', 'index.js', 'package.json', 'README.md'] },
];

function files(dir, base = dir) {
  if (!existsSync(dir)) return [];
  if (statSync(dir).isFile()) return [''];
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? files(full, base) : [relative(base, full)];
  });
}

// Line endings differ between a checkout on Windows and one on Linux; only the content matters.
const text = file => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

let stale = 0;
for (const pkg of PACKAGES) {
  const source = join(root, pkg.from);
  const target = join(root, pkg.to);
  if (!existsSync(source)) {
    console.log(`skipped ${pkg.to}: ${pkg.from} is not here (vendor/ is used as committed)`);
    continue;
  }
  if (check) {
    for (const part of pkg.include) {
      const a = files(join(source, part)).sort();
      const b = files(join(target, part)).sort();
      const differs = a.length !== b.length || a.some((f, i) => f !== b[i] || text(join(source, part, f)) !== text(join(target, part, f)));
      if (differs) { stale++; console.error(`out of date: ${pkg.to}/${part}`); }
    }
    continue;
  }
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  for (const part of pkg.include) cpSync(join(source, part), join(target, part), { recursive: true });
  console.log(`synced ${pkg.to}`);
}

if (check && stale) {
  console.error('vendor/ does not match the sibling packages. Run `npm run sync` and commit.');
  process.exit(1);
}
if (check) console.log('vendor/ is up to date');
