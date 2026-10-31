import { ElectrumNetworkProvider } from 'cashscript';
// 5 same-chain BCH→PUSDTEST contract addresses from the user's dashboard.
// IDs come from relayer's pending list (created today/yesterday by the user).
const addrs = [
  // Newest 5 BCH→PUSDTEST from the screenshot — get contract addresses from /intents
];
const prov = new ElectrumNetworkProvider('chipnet');
(async () => {
  // Fetch all pending intents from the relayer to get the actual contract addresses
  const res = await fetch('http://localhost:3006/intents?status=pending&limit=50');
  const data: any = await res.json();
  const items = (data?.items || data?.intents || data) as any[];
  // Filter to BCH→PUSDTEST same-chain orders (PUSD category contains "dfe50223")
  const PUSD = 'dfe50223c8d5cba8dcef8dff6d92b61deb88a8ba44947367f2b746487b56039b';
  const bchToPusd = items.filter(i =>
    i.type === 'DUTCH_AUCTION'
    && i.sellToken === 'BCH'
    && i.buyToken === PUSD
  ).sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
  console.log(`Found ${bchToPusd.length} pending BCH→PUSD dutch auctions to probe\n`);
  for (const i of bchToPusd) {
    const addr = i.contractAddress;
    const utxos = await prov.getUtxos(addr);
    const hasUtxo = utxos.length > 0;
    const ageH = ((Date.now() - i.createdAt)/3.6e6).toFixed(1);
    console.log(`  id=${i.id}  age=${ageH}h  utxos=${utxos.length}${hasUtxo ? '  ✓ FUNDED' : '  ✗ GHOST (no on-chain covenant)'}`);
    if (hasUtxo) {
      for (const u of utxos) console.log(`    └─ ${(u as any).txid}:${(u as any).vout}  sats=${(u as any).satoshis}`);
    }
  }
})().catch(e => { console.error('Err:', e.message); process.exit(1); });
