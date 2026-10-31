// Builds the WDK worklet bundle (.wdk-bundle/wdk-worklet.bundle.js) from wdk.config.js.
//
// This is `wdk-worklet-bundler generate` with one repair. The bundler starts its packer with
// execFileSync('npx', ...), and on Windows there is no program called `npx`, only `npx.cmd`, so the call fails
// with ENOENT. Here the same tool is started with Node directly. On macOS and Linux (and on the build servers)
// nothing is changed.

const childProcess = require('node:child_process');
const path = require('node:path');

const root = path.join(__dirname, '..');

if (process.platform === 'win32') {
  const execFileSync = childProcess.execFileSync;
  childProcess.execFileSync = (file, args, options) => {
    if (file !== 'npx') return execFileSync(file, args, options);
    const rest = args.filter(a => a !== '--no-install');
    const tool = rest.shift();
    // Read from disk: the tool's package does not list its package.json among its exports.
    const manifestPath = path.join(root, 'node_modules', tool, 'package.json');
    const manifest = JSON.parse(require('node:fs').readFileSync(manifestPath, 'utf8'));
    const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin[tool];
    return execFileSync(process.execPath, [path.join(path.dirname(manifestPath), bin), ...rest], options);
  };
}

const cli = require.resolve('@tetherto/wdk-worklet-bundler/dist/cli.js', { paths: [root] });
process.argv = [process.argv[0], cli, 'generate', ...process.argv.slice(2)];
process.chdir(root);
require(cli);
