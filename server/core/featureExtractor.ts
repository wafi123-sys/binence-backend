import { MarketState, FeatureSnapshot, PriceLevelState, RawTrade } from './types';

interface TradeHistory {
  price: number;
  qty: number;
  isMaker: boolean;
  time: number;
}

export class FeatureExtractor {
  private tradeWindows: Map<string, TradeHistory[]> = new Map();
  private levelStates: Map<string, Map<number, PriceLevelState>> = new Map();
  private cvdMap: Map<string, number> = new Map();
  
  private WINDOW_MS = 5 * 60 * 1000; // 5 minutes rolling window
  private DEPTH_LEVELS_TO_CONSIDER = 20;

  public applyTrade(trade: RawTrade) {
    const sym = trade.symbol;
    if (!this.tradeWindows.has(sym)) {
      this.tradeWindows.set(sym, []);
      this.cvdMap.set(sym, 0);
    }
    const window = this.tradeWindows.get(sym)!;
    window.push({ price: trade.price, qty: trade.qty, isMaker: trade.isMaker, time: trade.tradeTime });
    
    // Update CVD (Cumulative Volume Delta)
    // isMaker = true means taker order was SELL (hit bid). isMaker = false means taker BUY (hit ask).
    const isBuyer = !trade.isMaker;
    const delta = isBuyer ? trade.qty : -trade.qty;
    this.cvdMap.set(sym, this.cvdMap.get(sym)! + delta);
    
    // Update fillCount in level state
    this.updateLevelFill(sym, trade.price);
  }

  public compute(symbol: string, state: MarketState): FeatureSnapshot {
    this.pruneWindow(symbol);
    this.updateLevelMicrostructure(symbol, state);

    const window = this.tradeWindows.get(symbol) || [];
    const now = Date.now();

    // 1. Compute Trade based features (delta, vwap, vol, velocity)
    let buyVol = 0;
    let sellVol = 0;
    let totalVol = 0;
    let volPrice = 0;
    
    for (const t of window) {
      if (!t.isMaker) buyVol += t.qty;
      else sellVol += t.qty;
      totalVol += t.qty;
      volPrice += (t.price * t.qty);
    }

    const delta = buyVol - sellVol;
    const vwap = totalVol > 0 ? volPrice / totalVol : state.lastPrice;
    const cvd = this.cvdMap.get(symbol) || 0;
    
    // Velocity: price change over the window (last price - first price)
    let velocity = 0;
    if (window.length > 0) {
      const oldest = window[0].price;
      const newest = window[window.length - 1].price;
      const timeDiff = (window[window.length - 1].time - window[0].time) / 1000;
      if (timeDiff > 0) {
        velocity = (newest - oldest) / timeDiff; // Price change per second
      }
    }

    // Volatility (simple standard deviation of prices in window)
    let variance = 0;
    if (window.length > 0) {
      const meanPrice = window.reduce((sum, t) => sum + t.price, 0) / window.length;
      variance = window.reduce((sum, t) => sum + Math.pow(t.price - meanPrice, 2), 0) / window.length;
    }
    const volatility = Math.sqrt(variance);

    // 2. Compute Order Book features
    const bidPrices = Array.from(state.bids.keys()).sort((a, b) => b - a); // Descending
    const askPrices = Array.from(state.asks.keys()).sort((a, b) => a - b); // Ascending

    const bestBid = bidPrices[0] || 0;
    const bestAsk = askPrices[0] || 0;
    const spread = bestAsk > 0 && bestBid > 0 ? bestAsk - bestBid : 0;
    const mid = (bestBid + bestAsk) / 2;

    let depthBid = 0;
    for (let i = 0; i < Math.min(bidPrices.length, this.DEPTH_LEVELS_TO_CONSIDER); i++) {
      depthBid += state.bids.get(bidPrices[i]) || 0;
    }

    let depthAsk = 0;
    for (let i = 0; i < Math.min(askPrices.length, this.DEPTH_LEVELS_TO_CONSIDER); i++) {
      depthAsk += state.asks.get(askPrices[i]) || 0;
    }

    const imbalance = (depthBid + depthAsk) > 0 ? (depthBid - depthAsk) / (depthBid + depthAsk) : 0;
    
    // Liquidity density: total depth / spread (or price range if spread is 0)
    const range = (askPrices[Math.min(askPrices.length, this.DEPTH_LEVELS_TO_CONSIDER) - 1] || mid) - 
                  (bidPrices[Math.min(bidPrices.length, this.DEPTH_LEVELS_TO_CONSIDER) - 1] || mid);
    const liquidityDensity = range > 0 ? (depthBid + depthAsk) / range : 0;

    // Liquidity Gap: simplest is just the spread
    const liquidityGap = spread;

    return {
      symbol,
      time: now,
      spread,
      depthBid,
      depthAsk,
      imbalance,
      delta,
      cvd,
      vwap,
      volume: totalVol,
      velocity,
      atr: volatility, // Using vol as proxy for ATR for now
      volatility,
      liquidityDensity,
      liquidityGap
    };
  }

  public getLevelState(symbol: string, price: number): PriceLevelState | null {
    return this.levelStates.get(symbol)?.get(price) || null;
  }

  private pruneWindow(symbol: string) {
    const window = this.tradeWindows.get(symbol);
    if (!window) return;
    const cutoff = Date.now() - this.WINDOW_MS;
    while (window.length > 0 && window[0].time < cutoff) {
      window.shift();
    }
  }

  private updateLevelMicrostructure(symbol: string, state: MarketState) {
    if (!this.levelStates.has(symbol)) {
      this.levelStates.set(symbol, new Map());
    }
    const levels = this.levelStates.get(symbol)!;
    const now = Date.now();

    const processSide = (book: Map<number, number>) => {
      for (const [price, qty] of book.entries()) {
        if (!levels.has(price)) {
          levels.set(price, {
            price,
            qty,
            firstSeenAt: now,
            lastQty: qty,
            refillCount: 0,
            cancelCount: 0,
            fillCount: 0,
            lifetimeMs: 0
          });
        } else {
          const l = levels.get(price)!;
          l.lifetimeMs = now - l.firstSeenAt;
          
          if (qty > l.lastQty) {
            // Qty increased (refill)
            l.refillCount++;
          } else if (qty < l.lastQty && l.fillCount === 0) {
            // Qty decreased, but no trades happened here recently -> cancel/spoof behavior
            // We check this roughly. A true cancel check requires exact sync between trade and depth updates.
            l.cancelCount++;
          }
          l.qty = qty;
          l.lastQty = qty;
        }
      }
    };

    processSide(state.bids);
    processSide(state.asks);
  }

  private updateLevelFill(symbol: string, price: number) {
    const levels = this.levelStates.get(symbol);
    if (levels && levels.has(price)) {
      levels.get(price)!.fillCount++;
      // We reset cancel suspicion if a fill happened, meaning it was real
    }
  }
}
