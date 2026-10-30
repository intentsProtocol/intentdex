/**
 * Treasury — the wallets our fees are paid into: one active EVM address (the same on every EVM chain) and one
 * active Solana address.
 *
 * A wallet is either generated here (the secret is written to data/treasury-keys/, never returned by the API;
 * `scripts/treasury_export.ts` prints it for a sweep) or added as an external, watch-only address. For mainnet,
 * use an external address held in a hardware wallet or multisig: a key on this server is only as safe as the server.
 */
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { ethers } from 'ethers';
import { Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { HttpError } from '../types.js';

export type WalletKind = 'evm' | 'solana';

export interface TreasuryWallet {
    id: string;
    kind: WalletKind;
    address: string;
    label: string;
    origin: 'generated' | 'external';
    active: boolean;
    archived: boolean;
    createdAt: number;
}

export class Treasury {
    private wallets: TreasuryWallet[] = [];
    private file: string;
    private keyDir: string;
    onChange?: (event: 'created' | 'activated' | 'archived', w: TreasuryWallet) => void;

    constructor(dataDir: string) {
        fs.mkdirSync(dataDir, { recursive: true });
        this.file = path.join(dataDir, 'treasury.json');
        this.keyDir = path.join(dataDir, 'treasury-keys');
        if (fs.existsSync(this.file)) this.wallets = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    }

    private save() {
        const tmp = `${this.file}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(this.wallets, null, 2));
        fs.renameSync(tmp, this.file);
    }

    list(): TreasuryWallet[] { return this.wallets.map(w => ({ ...w })); }
    active(kind: WalletKind): TreasuryWallet | undefined { const w = this.wallets.find(x => x.kind === kind && x.active); return w ? { ...w } : undefined; }
    get(id: string): TreasuryWallet | undefined { const w = this.wallets.find(x => x.id === id); return w ? { ...w } : undefined; }

    /** A new key pair kept on this server. The first wallet of a kind becomes active. */
    generate(kind: WalletKind, label?: string): TreasuryWallet {
        let address: string, secret: string;
        if (kind === 'evm') { const w = ethers.Wallet.createRandom(); address = w.address; secret = w.privateKey; }
        else { const k = Keypair.generate(); address = k.publicKey.toBase58(); secret = bs58.encode(k.secretKey); }
        fs.mkdirSync(this.keyDir, { recursive: true });
        fs.writeFileSync(path.join(this.keyDir, `${address}.json`), JSON.stringify({ kind, address, secret, createdAt: new Date().toISOString() }), { mode: 0o600 });
        return this.add(kind, address, label ?? `${kind === 'evm' ? 'EVM' : 'Solana'} treasury`, 'generated');
    }

    /** A watch-only address held elsewhere (hardware wallet, multisig). */
    addExternal(kind: WalletKind, address: unknown, label?: string): TreasuryWallet {
        if (typeof address !== 'string') throw new HttpError(400, 'address is required');
        let norm: string;
        if (kind === 'evm') {
            if (!ethers.isAddress(address)) throw new HttpError(400, 'not a valid EVM address');
            norm = ethers.getAddress(address);
        } else {
            try { norm = new PublicKey(address).toBase58(); } catch { throw new HttpError(400, 'not a valid Solana address'); }
            if (norm !== address) throw new HttpError(400, 'not a valid Solana address');
        }
        if (this.wallets.some(w => w.kind === kind && w.address === norm && !w.archived)) throw new HttpError(409, 'this address is already in the treasury');
        return this.add(kind, norm, label ?? 'External wallet', 'external');
    }

    private add(kind: WalletKind, address: string, label: string, origin: TreasuryWallet['origin']): TreasuryWallet {
        const first = !this.wallets.some(w => w.kind === kind && w.active);
        const w: TreasuryWallet = { id: randomUUID(), kind, address, label: label.slice(0, 60), origin, active: first, archived: false, createdAt: Date.now() };
        this.wallets.push(w);
        this.save();
        this.onChange?.('created', { ...w });
        return { ...w };
    }

    /** Make this wallet the fee recipient for its kind. Transfers already created keep the recipient they were quoted with. */
    activate(id: string): TreasuryWallet {
        const w = this.wallets.find(x => x.id === id);
        if (!w) throw new HttpError(404, 'wallet not found');
        if (w.archived) throw new HttpError(409, 'archived wallets cannot be activated');
        for (const x of this.wallets) if (x.kind === w.kind) x.active = x.id === id;
        this.save();
        this.onChange?.('activated', { ...w });
        return { ...w };
    }

    /** Hide a wallet that no longer receives fees. Its key file, if any, is kept. */
    archive(id: string): TreasuryWallet {
        const w = this.wallets.find(x => x.id === id);
        if (!w) throw new HttpError(404, 'wallet not found');
        if (w.active) throw new HttpError(409, 'activate another wallet first; the active wallet cannot be archived');
        w.archived = true;
        this.save();
        this.onChange?.('archived', { ...w });
        return { ...w };
    }

    /** The secret of a generated wallet, for server-side signing (Jupiter referral setup and claims). Never exposed over HTTP. */
    secretOf(address: string): string | undefined {
        try { return JSON.parse(fs.readFileSync(path.join(this.keyDir, `${address}.json`), 'utf8')).secret; } catch { return undefined; }
    }
}
