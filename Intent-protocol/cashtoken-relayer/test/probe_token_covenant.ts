import { ElectrumNetworkProvider } from 'cashscript';
const p = 'bchtest:pdctrtk965f8r6rgexpcx8e7mf7fgxum0sd0zfafsfedcvcfa5xw6mejt2lhh';
const r = 'bchtest:rdctrtk965f8r6rgexpcx8e7mf7fgxum0sd0zfafsfedcvcfa5xw6f2w2n7wu';
const prov = new ElectrumNetworkProvider('chipnet');
function describe(u: any): string {
  const tok = u.token
    ? ` token=${u.token.amount}u of ${u.token.category?.slice(0,12)}…`
    : '';
  return `  ${u.txid}:${u.vout}  sats=${u.satoshis}${tok}`;
}
(async () => {
  console.log('-- p-prefix --');
  const up = await prov.getUtxos(p);
  for (const u of up) console.log(describe(u));
  console.log(`  (${up.length} UTXOs)`);
  console.log('-- r-prefix --');
  const ur = await prov.getUtxos(r);
  for (const u of ur) console.log(describe(u));
  console.log(`  (${ur.length} UTXOs)`);
})().catch(e => { console.error('Err:', e.message); process.exit(1); });
