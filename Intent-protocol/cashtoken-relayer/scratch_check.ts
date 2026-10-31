import { cashAddressToLockingBytecode, binToHex } from '@bitauth/libauth';
import { TestNetWallet } from 'mainnet-js';

async function check() {
  const w1 = await TestNetWallet.fromWIF('cN4nUwGunYVjG2mKd1ERPXtKFbcu4P9gGBL6DJYMPSVrzqyk1VFv');
  console.log('Relayer WIF cashaddr: ', (w1 as any).cashaddr);
  console.log('Relayer WIF tokenaddr:', (w1 as any).tokenaddr);

  const w2 = await TestNetWallet.fromWIF('cPQQEX4tmyy49t5ZyPzhSnhmuCudeGBpGJis14S8hypzRyPnwMbQ');
  console.log('Contracts WIF cashaddr: ', (w2 as any).cashaddr);
  console.log('Contracts WIF tokenaddr:', (w2 as any).tokenaddr);

  const res1 = cashAddressToLockingBytecode('bchtest:zzufsn0wtcmc4lhc3s3trhl0nxn6dgkpmgtgqkcqqd');
  console.log('zzufsn... locking bytecode:', typeof res1 === 'string' ? res1 : binToHex(res1.bytecode));

  const res2 = cashAddressToLockingBytecode((w1 as any).tokenaddr);
  console.log('w1 tokenaddr locking bytecode:', typeof res2 === 'string' ? res2 : binToHex(res2.bytecode));
}

check().catch(console.error);
