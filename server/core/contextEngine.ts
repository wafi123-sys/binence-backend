import { MarketState, MarketContext, FeatureSnapshot } from './types';

/**
 * Context Engine (Layer 10)
 * 
 * Computes the current macro/micro market context for a symbol.
 * This was completely missing in the old codebase — now formalized.
 */

// Hardcoded cap tiers for popular symbols. Extend as needed.
const CAP_TIER_MAP: Record<string, 'MEGA' | 'LARGE' | 'MID' | 'SMALL' | 'MICRO'> = {
  'btcusdt': 'MEGA',
  'ethusdt': 'MEGA',
  'bnbusdt': 'LARGE',
  'solusdt': 'LARGE',
  'xrpusdt': 'LARGE',
  'dogeusdt': 'MID',
  'adausdt': 'MID',
  'avaxusdt': 'MID',
  'dotusdt': 'MID',
  'maticusdt': 'MID',
  'linkusdt': 'MID',
  'trxusdt': 'MID',
};

function getCapTier(symbol: string, vol24h: number): 'MEGA' | 'LARGE' | 'MID' | 'SMALL' | 'MICRO' {
  if (CAP_TIER_MAP[symbol]) return CAP_TIER_MAP[symbol];
  if (vol24h > 1_000_000_000) return 'MEGA';
  if (vol24h > 100_000_000) return 'LARGE';
  if (vol24h > 10_000_000) return 'MID';
  if (vol24h > 1_000_000) return 'SMALL';
  return 'MICRO';
}

function getSession(): 'ASIA' | 'EUROPE' | 'US' | 'OVERLAP' {
  const hour = new Date().getUTCHours();
  // Asia: 00-08 UTC, Europe: 07-16 UTC, US: 13-22 UTC
  if (hour >= 7 && hour < 8) return 'OVERLAP';    // Asia-Europe overlap
  if (hour >= 13 && hour < 16) return 'OVERLAP';   // Europe-US overlap
  if (hour >= 0 && hour < 8) return 'ASIA';
  if (hour >= 8 && hour < 16) return 'EUROPE';
  return 'US';
}

export class ContextEngine {
  private priceHistory: Map<string, { price: number; time: number }[]> = new Map();
  private TREND_WINDOW_MS = 5 * 60 * 1000; // 5 min window for trend detection
  
  compute(symbol: string, state: MarketState, features: FeatureSnapshot): MarketContext {
    const now = Date.now();

    // Update price history
    if (!this.priceHistory.has(symbol)) {
      this.priceHistory.set(symbol, []);
    }
    const history = this.priceHistory.get(symbol)!;
    history.push({ price: state.lastPrice, time: now });
    
    // Prune old history
    while (history.length > 0 && now - history[0].time > this.TREND_WINDOW_MS) {
      history.shift();
    }

    // Determine trend
    let trend: 'UP' | 'DOWN' | 'SIDEWAYS' = 'SIDEWAYS';
    if (history.length > 10) {
      const oldest = history[0].price;
      const newest = history[history.length - 1].price;
      const changePct = (newest - oldest) / oldest;
      
      if (changePct > 0.002) trend = 'UP';       // > 0.2% up
      else if (changePct < -0.002) trend = 'DOWN'; // > 0.2% down
    }

    // Determine volatility tier from ATR/volatility
    let volatilityTier: 'LOW' | 'MEDIUM' | 'HIGH' = 'MEDIUM';
    if (features.volatility > 0) {
      const volPct = features.volatility / state.lastPrice * 100;
      if (volPct > 0.5) volatilityTier = 'HIGH';
      else if (volPct < 0.1) volatilityTier = 'LOW';
    }

    // Funding bias
    let fundingBias: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' = 'NEUTRAL';
    if (state.fundingRate > 0.0001) fundingBias = 'POSITIVE';
    else if (state.fundingRate < -0.0001) fundingBias = 'NEGATIVE';

    // OI bias
    let oiBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    if (state.openInterestDelta > 0 && trend === 'UP') oiBias = 'BULLISH';
    else if (state.openInterestDelta > 0 && trend === 'DOWN') oiBias = 'BEARISH';
    else if (state.openInterestDelta < 0 && trend === 'UP') oiBias = 'BEARISH'; // Shorts closing
    else if (state.openInterestDelta < 0 && trend === 'DOWN') oiBias = 'BULLISH'; // Longs closing

    return {
      symbol,
      capTier: getCapTier(symbol, state.vol24h),
      session: getSession(),
      trend,
      volatilityTier,
      fundingBias,
      oiBias,
      time: now
    };
  }
}
