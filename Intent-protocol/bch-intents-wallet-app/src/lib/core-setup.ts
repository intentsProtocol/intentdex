/**
 * Gives the shared package its storage and service URLs. Imported for its side effect by the root layout,
 * before anything reads the chain table.
 *
 * An empty service URL stays empty: unlike the extension there is no localhost default, because on a phone
 * "localhost" is the phone.
 */
import { configure } from '@bch-intents/wallet-core/platform';
import { appStore } from './storage';
import { RPC_OVERRIDES, SERVICES } from './config';

configure({ storage: appStore, services: SERVICES, rpc: RPC_OVERRIDES });
