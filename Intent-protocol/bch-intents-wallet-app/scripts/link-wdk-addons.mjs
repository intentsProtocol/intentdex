// Links the native addons the WDK worklet loads into react-native-bare-kit's Android addons folder.
//
// react-native-bare-kit 0.16 no longer links addons during the Gradle build: the app has to. QVAC's Expo plugin
// links the addons of its own worker and first empties the folder, so the wallet worklet's addons would be
// gone and the worklet would abort with ADDON_NOT_FOUND. This puts them back. It runs from
// plugins/withWorkletAddons.js after QVAC's step, and can be run by hand:
//
//   node scripts/link-wdk-addons.mjs [outDir]
//
// Which addons: exactly the ones the bundle records. The WDK bundler packs with `--linked`, so the bundle's
// header lists every library it will load (`linked:libbare-fs.4.7.4.so`, …). Each is linked from its own
// package, and the result is checked against that list. Addons both workers load are the same files, because
// package.json pins every bare-* version.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import link from 'bare-link';

const require = createRequire(import.meta.url);
const Bundle = require('bare-bundle');

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(root, '.wdk-bundle', 'wdk-worklet.bundle.js');
const HOSTS = ['android-arm64'];
const DEFAULT_OUT = path.join(root, 'node_modules', 'react-native-bare-kit', 'android', 'src', 'main', 'addons');

/**
 * `linked:libbare-fs.4.7.4.so` → { file: 'libbare-fs.4.7.4.so', name: 'bare-fs', version: '4.7.4', dirs: [...] },
 * where `dirs` are the folders the bundler packed that package from (a package can sit nested in node_modules).
 */
export function androidAddonsOf(bundleSource) {
  const bundle = Bundle.from(Buffer.from(bundleSource, 'utf8'));
  const files = Object.keys(bundle.resolutions ?? {});
  const out = [];
  for (const ref of bundle.addons) {
    const m = /^linked:lib(.+)\.(\d+\.\d+\.\d+(?:-[\w.]+)?)\.so$/.exec(ref);
    if (!m) continue;
    const name = m[1].replace(/^(.+?)__/, '@$1/');
    const marker = `/node_modules/${name}/`;
    const dirs = [...new Set(files.filter(f => f.includes(marker)).map(f => f.slice(0, f.lastIndexOf(marker) + marker.length - 1)))];
    out.push({ file: `lib${m[1]}.${m[2]}.so`, name, version: m[2], dirs });
  }
  return out;
}

export async function linkWdkAddons(out = DEFAULT_OUT) {
  if (!fs.existsSync(BUNDLE)) throw new Error('.wdk-bundle/wdk-worklet.bundle.js is missing: run "npm run bundle:worklet" first');
  const expected = androidAddonsOf(require(BUNDLE));
  fs.mkdirSync(out, { recursive: true });
  const written = [];
  const skipped = [];
  for (const addon of expected) {
    const dir = [...addon.dirs, `/node_modules/${addon.name}`].map(d => path.join(root, d)).find(d => {
      try { return JSON.parse(fs.readFileSync(path.join(d, 'package.json'), 'utf8')).version === addon.version; } catch { return false; }
    });
    if (!dir) throw new Error(`${addon.name}@${addon.version} is not in node_modules any more: run "npm run bundle:worklet"`);
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    // The bundle is packed for every platform; an addon with no Android build (bare-posix) is not loaded there.
    if (!HOSTS.every(h => fs.existsSync(path.join(dir, 'prebuilds', h)))) { skipped.push(addon.file); continue; }
    // bare-link 4 starts from a module file: the package's own entry, whose graph loads the addon.
    const main = [pkg.main, 'index.js', 'binding.js'].map(f => f && path.join(dir, f)).find(f => f && fs.existsSync(f));
    if (!main) throw new Error(`${addon.name}: no entry module to link from`);
    for await (const resource of link(main, { hosts: HOSTS, out })) written.push(resource);
  }
  const present = new Set(fs.readdirSync(out, { recursive: true }).map(f => path.basename(String(f))));
  const missing = expected.filter(a => !skipped.includes(a.file) && !present.has(a.file)).map(a => a.file);
  if (missing.length) throw new Error(`these WDK worklet addons were not linked: ${missing.join(', ')}`);
  return { expected, written, skipped, out };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { expected, written, skipped, out } = await linkWdkAddons(process.argv[2] ? path.resolve(process.argv[2]) : undefined);
  console.log(`WDK worklet: ${expected.length - skipped.length} addons linked into ${path.relative(root, out) || out} (${written.length} files)`);
  if (skipped.length) console.log(`  no Android build, not loaded there: ${skipped.join(', ')}`);
  for (const f of written) console.log('  ' + path.relative(out, f));
}
