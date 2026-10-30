// Basic client for the Bridge Relayer API

const RELAYER_URL = import.meta.env.VITE_RELAYER_URL || 'http://localhost:3001';

export interface DepositAddressResponse {
    depositAddress: string;
    network: string;
    chainId: number;
    supportedTokens: string[];
    createdAt: number;
}

export interface RelayerStats {
    totalAddresses: number;
    trackedAddresses: string[];
}

/**
 * Get the deposit address for a given user wallet
 */
export async function getDepositAddress(userWallet: string): Promise<DepositAddressResponse | null> {
    try {
        const response = await fetch(`${RELAYER_URL}/api/deposit-address?userWallet=${userWallet}`);
        if (!response.ok) {
            throw new Error('Failed to fetch deposit address');
        }
        return await response.json();
    } catch (error) {
        console.error('Bridge API Error:', error);
        return null;
    }
}

/**
 * Get relayer health status
 */
export async function getRelayerHealth(): Promise<boolean> {
    try {
        const response = await fetch(`${RELAYER_URL}/api/health`);
        return response.ok;
    } catch (error) {
        return false;
    }
}
