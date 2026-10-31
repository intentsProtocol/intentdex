export interface DutchAuctionIntent {
    address: string;
    makerPkh: Uint8Array;
    sellTokenCategory: string;
    buyTokenCategory: string;
    sellAmount: bigint;
    startBuyAmount: bigint;
    endBuyAmount: bigint;
    startTime: bigint;
    duration: bigint;
}

export interface LimitOrderIntent {
    address: string;
    makerPkh: Uint8Array;
    sellTokenCategory: string;
    buyTokenCategory: string;
    sellAmount: bigint;
    buyAmount: bigint;
    expiryTime: bigint;
}

export const KNOWN_AUCTIONS: DutchAuctionIntent[] = [];
export const KNOWN_LIMIT_ORDERS: LimitOrderIntent[] = [];
