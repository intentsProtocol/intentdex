export interface TokenInfo {
    faAddress: string;
    coinType: string;
    symbol: string;
    name: string;
    decimals: number;
    logoUrl: string;
}

export const TOKENS: TokenInfo[] = [
    {
        faAddress: "",
        coinType: "0x1::aptos_coin::AptosCoin",
        symbol: "MOVE",
        name: "Movement Coin",
        decimals: 8,
        logoUrl: "https://raw.githubusercontent.com/kitelabs-io/mvmt-tokens/main/logos/MOVE.png"
    },
    {
        faAddress: "0xab85cf20d26368dc43b49152a7b4543eb86c6a2d98c30b9b2cfb7b574f364981",
        coinType: "",
        symbol: "WETH.e",
        name: "WETH.e",
        decimals: 8,
        logoUrl: "https://raw.githubusercontent.com/kitelabs-io/mvmt-tokens/main/logos/WETH.png"
    },
    {
        faAddress: "0xb89077cfd2a82a0c1450534d49cfd5f2707643155273069bc23a912bcfefdee7",
        coinType: "",
        symbol: "USDC.e",
        name: "USDC.e",
        decimals: 6,
        logoUrl: "https://raw.githubusercontent.com/kitelabs-io/mvmt-tokens/main/logos/USDC.png"
    },
    {
        faAddress: "0xc6f5b46ab5307dfe3e565668edcc1461b31cac5a6c2739fba17d9fdde16813a2",
        coinType: "",
        symbol: "USDT.e",
        name: "USDT.e",
        decimals: 6,
        logoUrl: "https://raw.githubusercontent.com/kitelabs-io/mvmt-tokens/main/logos/USDT.png"
    }
];
