
import { PrivyClient } from '@privy-io/node';
const privy = new PrivyClient({ appId: 'test', appSecret: 'test' });
console.log('Keys:', Object.keys(privy));
console.log('Has verifyAuthToken:', !!privy.verifyAuthToken);
console.log('Prototype keys:', Object.getOwnPropertyNames(Object.getPrototypeOf(privy)));
