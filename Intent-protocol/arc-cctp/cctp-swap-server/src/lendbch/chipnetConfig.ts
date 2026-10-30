/**
 * lendbch chipnet config — our own test copy of Paryon on chipnet. Unlike mainnet-v1 (hard-coded in deployment.ts),
 * the chipnet token IDs only exist once the deploy script has broadcast the five genesis transactions, so this is
 * read from and written to a JSON file under the data dir (gitignored). It also carries the genesis txids (for the
 * verify script) and the test oracle's public key. The oracle *private* key and the deployer/keeper wallet live in
 * a separate secrets file that is never committed and never used on mainnet.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { DeploymentParams, LendBchNetwork } from './types.js';
import type { GenesisTxIds } from './verifySetup.js';

export interface ChipnetDeployment {
    params: DeploymentParams;
    genesis: GenesisTxIds;
    /** When it was deployed, for the record. */
    deployedAt: string;
}

/** Keys and funding for the chipnet-only keeper/deployer. NEVER loaded or used on mainnet. */
export interface ChipnetSecrets {
    /** Our test oracle keypair — stands in for General Protocols on chipnet. */
    oraclePublicKey: string;
    oraclePrivateKey: string;
    /** The wallet that funds and signs the genesis transactions and keeper actions. */
    deployerWif: string;
    deployerAddress: string;
    network: LendBchNetwork;
}

function dataDir(): string {
    return process.env.DATA_DIR || './data';
}

const CONFIG_FILE = 'lendbch-chipnet.json';
const SECRETS_FILE = 'lendbch-chipnet-secrets.json';

function readJson<T>(file: string): T | null {
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, 'utf8');
    return raw.trim() ? (JSON.parse(raw) as T) : null;
}

function writeAtomic(file: string, value: unknown) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    fs.renameSync(tmp, file);
}

/**
 * The chipnet deployment: the JSON file in the data dir, or, when there is none, the
 * LENDBCH_CHIPNET_DEPLOYMENT variable holding the same JSON (public data only: params and
 * genesis txids). A container's data dir is an empty volume, so a host like Railway passes
 * it as a variable; it is written to the data dir on first load.
 */
export function loadChipnetDeployment(dir = dataDir()): ChipnetDeployment | null {
    const fromFile = readJson<ChipnetDeployment>(path.join(dir, CONFIG_FILE));
    if (fromFile) return fromFile;
    const raw = process.env.LENDBCH_CHIPNET_DEPLOYMENT?.trim();
    if (!raw) return null;
    let parsed: ChipnetDeployment;
    try {
        parsed = JSON.parse(raw) as ChipnetDeployment;
    } catch (e) {
        throw new Error(`LENDBCH_CHIPNET_DEPLOYMENT is not valid JSON: ${(e as Error).message}`);
    }
    if (!parsed?.params || !parsed?.genesis) throw new Error('LENDBCH_CHIPNET_DEPLOYMENT needs "params" and "genesis"');
    try { saveChipnetDeployment(parsed, dir); } catch { /* read-only data dir: the variable still works */ }
    return parsed;
}

export function saveChipnetDeployment(deployment: ChipnetDeployment, dir = dataDir()): void {
    writeAtomic(path.join(dir, CONFIG_FILE), deployment);
}

export function loadChipnetSecrets(dir = dataDir()): ChipnetSecrets | null {
    const s = readJson<ChipnetSecrets>(path.join(dir, SECRETS_FILE));
    if (s && s.network !== 'chipnet') throw new Error('lendbch chipnet secrets must be for chipnet — refusing to load mainnet secrets here');
    return s;
}

export function saveChipnetSecrets(secrets: ChipnetSecrets, dir = dataDir()): void {
    if (secrets.network !== 'chipnet') throw new Error('refusing to save non-chipnet secrets in the lendbch chipnet secrets file');
    writeAtomic(path.join(dir, SECRETS_FILE), secrets);
}

/** Build chipnet DeploymentParams from deployed token IDs, our oracle key, and the short test period. */
export function chipnetParams(tokenIds: DeploymentParams['tokenIds'], oraclePublicKey: string, protocolFeeLockingBytecode: string, startBlockHeight: number): DeploymentParams {
    return {
        id: 'chipnet-ours',
        network: 'chipnet',
        tokenIds,
        contractParams: {
            oraclePublicKey,
            protocolFeeLockingBytecode,
            startBlockHeight,
            periodLengthBlocks: 6,   // ~1 hour on chipnet, so interest and periods can be exercised in a day
            timeLockRedemption: 2,
        },
    };
}
