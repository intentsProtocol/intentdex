// Serves test-extension.html on http://localhost:4173 for the dapp tests. The wallet injects into http(s) pages
// only, so the test dapp cannot be opened from file://.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

createServer(async (req, res) => {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  if (path !== '/' && path !== '/test-extension.html') { res.writeHead(404).end('not found'); return; }
  try {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(await readFile(join(root, 'test-extension.html')));
  } catch {
    res.writeHead(500).end('cannot read test-extension.html');
  }
}).listen(4173, () => console.log('test dapp on http://localhost:4173'));
