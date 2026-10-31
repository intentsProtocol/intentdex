import fs from 'fs';

function extractRoutes(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const routes = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/(server|fastify|app)\.(get|post|put|delete)\(\s*['"`]([^'"`]+)['"`]/);
    if (match) {
      routes.push({ line: i + 1, method: match[2].toUpperCase(), path: match[3] });
    }
  }
  return routes;
}

console.log('=== CASHTOKEN RELAYER ROUTES ===');
const relayerRoutes = extractRoutes('./src/index.ts');
console.table(relayerRoutes);

console.log('\n=== BCHMESH MESHSERVER ROUTES ===');
const meshRoutes = extractRoutes('../BCHMesh/meshserver/src/index.ts');
console.table(meshRoutes);
