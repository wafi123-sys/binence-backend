// Geometric Brownian Motion simulation for realistic price data
// Each asset has: startPrice, annualDrift (mu), annualVolatility (sigma)

interface AssetConfig {
  name: string;
  ticker: string;
  startPrice: number;
  annualDrift: number;
  annualVolatility: number;
  currency: string;
  type: 'crypto' | 'stock';
}

export const ASSETS: AssetConfig[] = [
  { name: 'Bitcoin', ticker: 'BTC', startPrice: 42000, annualDrift: 0.65, annualVolatility: 0.55, currency: 'USD', type: 'crypto' },
  { name: 'Bank Central Asia', ticker: 'BBCA', startPrice: 9525, annualDrift: 0.12, annualVolatility: 0.22, currency: 'IDR', type: 'stock' },
  { name: 'Bank Rakyat Indonesia', ticker: 'BBRI', startPrice: 5800, annualDrift: 0.10, annualVolatility: 0.25, currency: 'IDR', type: 'stock' },
  { name: 'GoTo Group', ticker: 'GOTO', startPrice: 82, annualDrift: 0.05, annualVolatility: 0.60, currency: 'IDR', type: 'stock' },
  { name: 'Metrodata Electronics', ticker: 'MTDL', startPrice: 460, annualDrift: 0.08, annualVolatility: 0.30, currency: 'IDR', type: 'stock' },
];

export const PORTFOLIO_WEIGHTS: Record<string, number> = {
  CASH: 0.3338,
  BTC: 0.2643,
  BBCA: 0.2218,
  BBRI: 0.1294,
  GOTO: 0.0277,
  MTDL: 0.0180,
};

// Seeded random for reproducibility
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// Box-Muller transform for normal distribution
function normalRandom(rng: () => number): number {
  const u1 = rng();
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export interface PricePoint {
  date: Date;
  timestamp: number;
  price: number;
}

export interface OHLCPoint {
  date: Date;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Generate daily price data using GBM
export function generatePriceHistory(asset: AssetConfig, startDate: Date, endDate: Date, seed: number = 42): PricePoint[] {
  const rng = seededRandom(seed + asset.ticker.charCodeAt(0) * 1000);
  const dt = 1 / 252; // Trading days in a year
  const drift = asset.annualDrift;
  const vol = asset.annualVolatility;

  const points: PricePoint[] = [];
  let price = asset.startPrice;
  const current = new Date(startDate);

  while (current <= endDate) {
    // Skip weekends for stocks
    if (asset.type === 'stock') {
      const day = current.getDay();
      if (day === 0 || day === 6) {
        current.setDate(current.getDate() + 1);
        continue;
      }
    }

    points.push({
      date: new Date(current),
      timestamp: current.getTime(),
      price: Math.max(price, asset.startPrice * 0.1), // Floor at 10% of start
    });

    // GBM step: dS = S * (mu*dt + sigma*sqrt(dt)*Z)
    const z = normalRandom(rng);
    const dailyReturn = (drift - 0.5 * vol * vol) * dt + vol * Math.sqrt(dt) * z;
    price = price * Math.exp(dailyReturn);

    current.setDate(current.getDate() + 1);
  }

  return points;
}

// Generate OHLC data from price history
export function generateOHLCData(asset: AssetConfig, startDate: Date, endDate: Date, seed: number = 42): OHLCPoint[] {
  const priceHistory = generatePriceHistory(asset, startDate, endDate, seed);
  const rng = seededRandom(seed + asset.ticker.charCodeAt(0) * 500 + 999);

  return priceHistory.map((point) => {
    const volatilityFactor = asset.annualVolatility / Math.sqrt(252);
    const range = point.price * volatilityFactor * (0.5 + rng() * 1.5);

    const open = point.price + (rng() - 0.5) * range * 0.3;
    const close = point.price;
    const high = Math.max(open, close) + rng() * range * 0.5;
    const low = Math.min(open, close) - rng() * range * 0.5;
    const volume = Math.floor(1000000 + rng() * 5000000);

    return {
      date: point.date,
      timestamp: point.timestamp,
      open: Math.max(open, 0.01),
      high: Math.max(high, 0.01),
      low: Math.max(low, 0.01),
      close: Math.max(close, 0.01),
      volume,
    };
  });
}

// Calculate portfolio return series
export function generatePortfolioReturns(startDate: Date, endDate: Date): PricePoint[] {
  const assetHistories: Record<string, PricePoint[]> = {};

  for (const asset of ASSETS) {
    assetHistories[asset.ticker] = generatePriceHistory(asset, startDate, endDate);
  }

  // Find common dates (use BTC as reference since it trades daily)
  const btcHistory = assetHistories['BTC'];
  const portfolioReturns: PricePoint[] = [];
  let portfolioValue = 100; // Start at 100 (index)

  for (let i = 0; i < btcHistory.length; i++) {
    if (i === 0) {
      portfolioReturns.push({
        date: btcHistory[i].date,
        timestamp: btcHistory[i].timestamp,
        price: 100,
      });
      continue;
    }

    // Calculate weighted daily return
    let totalReturn = 0;

    for (const asset of ASSETS) {
      const history = assetHistories[asset.ticker];
      // Find matching or closest prior date
      const idx = Math.min(i, history.length - 1);
      const prevIdx = Math.max(0, idx - 1);

      if (idx > 0 && history[idx] && history[prevIdx]) {
        const assetReturn = (history[idx].price - history[prevIdx].price) / history[prevIdx].price;
        totalReturn += assetReturn * PORTFOLIO_WEIGHTS[asset.ticker];
      }
    }

    // Cash earns ~5% annually
    totalReturn += PORTFOLIO_WEIGHTS['CASH'] * (0.05 / 252);

    portfolioValue *= (1 + totalReturn);
    portfolioReturns.push({
      date: btcHistory[i].date,
      timestamp: btcHistory[i].timestamp,
      price: portfolioValue,
    });
  }

  return portfolioReturns;
}

// Generate a real-time tick (small random movement)
export function generateTick(lastPrice: number, volatility: number): number {
  const z = (Math.random() - 0.5) * 2;
  const tickSize = lastPrice * volatility / Math.sqrt(252 * 86400); // Per-second volatility
  return lastPrice + z * tickSize;
}

// Order book data types
export interface OrderBookLevel {
  price: number;
  amount: number;
  total: number;
}

export interface OrderBookData {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  spread: number;
  spreadPercent: number;
}

// Generate realistic order book data
export function generateOrderBook(midPrice: number, levels: number = 12): OrderBookData {
  const spread = midPrice * 0.0002; // 0.02% spread
  const bidStart = midPrice - spread / 2;
  const askStart = midPrice + spread / 2;

  const bids: OrderBookLevel[] = [];
  const asks: OrderBookLevel[] = [];

  let bidTotal = 0;
  let askTotal = 0;

  for (let i = 0; i < levels; i++) {
    const bidPrice = bidStart - (i * midPrice * 0.0003);
    const askPrice = askStart + (i * midPrice * 0.0003);

    // Volume increases with distance from mid (realistic depth)
    const bidAmount = (0.5 + Math.random() * 2) * (1 + i * 0.3);
    const askAmount = (0.5 + Math.random() * 2) * (1 + i * 0.3);

    bidTotal += bidAmount;
    askTotal += askAmount;

    bids.push({ price: bidPrice, amount: bidAmount, total: bidTotal });
    asks.push({ price: askPrice, amount: askAmount, total: askTotal });
  }

  return {
    bids,
    asks,
    spread: askStart - bidStart,
    spreadPercent: ((askStart - bidStart) / midPrice) * 100,
  };
}
