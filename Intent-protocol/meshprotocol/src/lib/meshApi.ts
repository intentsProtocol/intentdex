export interface MeshStats {
  bchUsd: number;
  tvlSats: string;
  volume24hSats: string;
  fees24hSats: string;
  poolCount: number;
  strategyCount: number;
  activeIntentsCount: number;
}

export interface MeshPool {
  address: string;
  reserve: string;
  reserveSymbol: string;
  targetToken: string;
  targetSymbol: string;
  tvlSats: number;
  tvlUsd: number;
  volume24hUsd: number;
  feeBps: number;
  apyPct: number;
  status: 'optimal' | 'rebalancing' | 'active';
  mode: 'mirror' | 'dock';
  priceTokensPerBch: number;
}

export interface StrategyArchetype {
  id: string;
  name: string;
  category: 'Range' | 'Market making' | 'Limit' | 'Directional' | 'Stable' | 'Multi-asset';
  summary: string;
  deposit: string;
  earns: string;
  risk: string;
  recycles: boolean;
  estApy: string;
}

export const ARCHETYPES: StrategyArchetype[] = [
  {
    id: 'recycling-pair',
    name: 'Recycling Pair',
    category: 'Range',
    summary: 'Autonomous buy-low, sell-high loop. Filled orders immediately fund reverse mirror covenant pools.',
    deposit: 'BCH or CashTokens',
    earns: 'Spread + Pool fee on every round-trip cycle',
    risk: 'Low to Moderate',
    recycles: true,
    estApy: '28.4%',
  },
  {
    id: 'grid',
    name: 'Multi-Rung Grid',
    category: 'Range',
    summary: '2 to 10 laddered rungs across a custom price range with automated cross-rung recycling.',
    deposit: 'BCH',
    earns: 'Accumulates spread across price oscillations',
    risk: 'Moderate',
    recycles: true,
    estApy: '34.2%',
  },
  {
    id: 'spread',
    name: 'Spread Market Maker',
    category: 'Market making',
    summary: 'Quotes a simultaneous bid below and ask above the market mid to capture two-sided flow.',
    deposit: 'BCH and CashTokens',
    earns: 'The full bid-ask spread plus trading fees',
    risk: 'Moderate',
    recycles: true,
    estApy: '22.8%',
  },
  {
    id: 'stable-pair',
    name: 'Stable Peg Anchor',
    category: 'Stable',
    summary: 'Concentrated liquidity around a 1:1 or pegged ratio with minimal spread and near-zero IL.',
    deposit: 'Either or both tokens',
    earns: 'High-volume swap fees between pegged assets',
    risk: 'Minimal',
    recycles: false,
    estApy: '14.6%',
  },
  {
    id: 'multi-pair',
    name: 'Multi-Pair BCH Indexer',
    category: 'Multi-asset',
    summary: 'One BCH reserve quotes buy bids for 2 to 3 CashTokens simultaneously from the same balance.',
    deposit: 'BCH once',
    earns: 'Captures volatility across multiple token pairs',
    risk: 'Moderate',
    recycles: false,
    estApy: '26.1%',
  },
  {
    id: 'accumulate',
    name: 'Accumulate Ladder',
    category: 'Directional',
    summary: 'Executes laddered DCA buys into a CashToken as price dips, saving slippage vs market orders.',
    deposit: 'BCH',
    earns: 'Lower cost-basis on entry + maker fee capture',
    risk: 'Directional (Asset exposure)',
    recycles: false,
    estApy: '18.5%',
  },
  {
    id: 'take-profit',
    name: 'Take-Profit Ladder',
    category: 'Directional',
    summary: 'Automated laddered token exit as price ascends, securing BCH at favorable steps.',
    deposit: 'CashTokens',
    earns: 'Disciplined profit realization in BCH',
    risk: 'Directional (Token exit)',
    recycles: false,
    estApy: '19.2%',
  },
  {
    id: 'fixed',
    name: 'Fixed Price Limit Order',
    category: 'Limit',
    summary: 'Sovereign on-chain limit order at an exact price with zero custodian counterparty risk.',
    deposit: 'BCH or CashTokens',
    earns: 'Exact execution at your targeted limit level',
    risk: 'Low',
    recycles: false,
    estApy: '12.0%',
  },
];

export const MOCK_POOLS: MeshPool[] = [
  {
    address: 'bchtest:qp3wjpa...89f1',
    reserve: '0x',
    reserveSymbol: 'BCH',
    targetToken: 'pusd',
    targetSymbol: 'pUSD',
    tvlSats: 48200000000,
    tvlUsd: 172400,
    volume24hUsd: 58200,
    feeBps: 30,
    apyPct: 24.8,
    status: 'optimal',
    mode: 'mirror',
    priceTokensPerBch: 357.25,
  },
  {
    address: 'bchtest:qz7vlkp...42c8',
    reserve: '0x',
    reserveSymbol: 'BCH',
    targetToken: 'musd',
    targetSymbol: 'mUSD',
    tvlSats: 29500000000,
    tvlUsd: 105600,
    volume24hUsd: 31400,
    feeBps: 30,
    apyPct: 21.2,
    status: 'optimal',
    mode: 'mirror',
    priceTokensPerBch: 358.10,
  },
  {
    address: 'bchtest:qr9kmzq...17e3',
    reserve: 'pusd',
    reserveSymbol: 'pUSD',
    targetToken: 'musd',
    targetSymbol: 'mUSD',
    tvlSats: 62000000000,
    tvlUsd: 221800,
    volume24hUsd: 94100,
    feeBps: 5,
    apyPct: 15.4,
    status: 'optimal',
    mode: 'mirror',
    priceTokensPerBch: 1.002,
  },
  {
    address: 'bchtest:qp5xxam...93b4',
    reserve: '0x',
    reserveSymbol: 'BCH',
    targetToken: 'mesh',
    targetSymbol: 'MESH',
    tvlSats: 18400000000,
    tvlUsd: 65800,
    volume24hUsd: 18900,
    feeBps: 50,
    apyPct: 38.6,
    status: 'rebalancing',
    mode: 'mirror',
    priceTokensPerBch: 1240.0,
  },
];
