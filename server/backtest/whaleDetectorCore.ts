// ============================================================
// WhaleDetectorCore — stripped-down, injectable version of the
// WhaleTracker logic. This can be driven by BOTH live WebSocket
// data AND replayed historical data from BacktestEngine.
//
// Key design principle: NO file I/O, NO WebSocket connections.
// Pure state-machine functions that accept events as input.
// ============================================================

import {
  CoinState,
  WhaleEvent,
  PriceLevelMemory,
} from '../whaleTracker';

// Re-export the interfaces needed downstream
export type { CoinState, WhaleEvent };

// ─── Internal Fingerprint State ──────────────────────────────
interface TradeFingerprint {
  side: 'buy' | 'sell';
  priceband: number;
  trades: { price: number; qty: number; time: number }[];
  totalUsd: number;
  firstSeen: number;
  lastSeen: number;
}

const FINGERPRINT_WINDOW_MS = 45_000;
const FINGERPRINT_PRICE_TOLERANCE = 0.004;
const HALF_LIFE_MS = 6 * 60 * 60 * 1000;

const VOL_TIERS = [
  { name: 'MEGA',  minVol: 1_000_000_000, whaleFloor: 150_000 },
  { name: 'LARGE', minVol:   100_000_000, whaleFloor:  50_000 },
  { name: 'MID',   minVol:    10_000_000, whaleFloor:  15_000 },
  { name: 'SMALL', minVol:     1_000_000, whaleFloor:   5_000 },
  { name: 'MICRO', minVol:             0, whaleFloor:   1_200 },
];

function getWhaleFloor(vol24h: number, avgTradeUsd: number): number {
  const tier = VOL_TIERS.find(t => vol24h >= t.minVol) ?? VOL_TIERS[VOL_TIERS.length - 1];
  return Math.max(tier.whaleFloor, avgTradeUsd * 20);
}

function decayLevel(mem: PriceLevelMemory, now: number) {
  const elapsed = now - mem.lastUpdated;
  if (elapsed < 0) return;
  const decayFactor = Math.pow(0.5, elapsed / HALF_LIFE_MS);
  mem.bVol *= decayFactor;
  mem.sVol *= decayFactor;
  mem.bFreq *= decayFactor;
  mem.sFreq *= decayFactor;
  mem.relevanceScore = decayFactor;
  mem.lastUpdated = now;
}

function computeSplittingSuspicion(fp: TradeFingerprint): number {
  if (fp.trades.length < 4) return 0;
  const intervals: number[] = [];
  const sizes: number[] = [];
  for (let i = 1; i < fp.trades.length; i++) {
    intervals.push(fp.trades[i].time - fp.trades[i - 1].time);
    sizes.push(fp.trades[i].qty);
  }
  const cv = (arr: number[]) => {
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    if (mean === 0) return 1;
    const variance = arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length;
    return Math.sqrt(variance) / mean;
  };
  return 1 - Math.min(1, (cv(intervals) + cv(sizes)) / 2);
}

// ─── Detector State ──────────────────────────────────────────
export class WhaleDetectorCore {
  private states = new Map<string, CoinState>();
  private fingerprints = new Map<string, TradeFingerprint>();

  /** 
   * Resets all state for a fresh backtest run.
   * Call this between walk-forward windows.
   */
  public reset() {
    this.states.clear();
    this.fingerprints.clear();
  }

  public getState(symbol: string): CoinState {
    if (!this.states.has(symbol)) {
      this.states.set(symbol, {
        events: [],
        journeys: new Map(),
        volumeProfile: new Map(),
        asks: new Map(),
        bids: new Map(),
        vol24h: 0,
      });
    }
    return this.states.get(symbol)!;
  }

  /**
   * Feed a raw aggTrade message exactly as received from Binance
   * (or from a replayed log file).
   */
  public setVol24h(symbol: string, vol24h: number) {
    const state = this.getState(symbol);
    state.vol24h = vol24h;
  }

  public ingestAggTrade(
    symbol: string,
    price: number,
    qty: number,
    isMaker: boolean,
    time: number
  ): WhaleEvent | null {
    const state = this.getState(symbol);
    const usd = price * qty;

    // ── Volume profile update ──────────────────────────
    const mag = Math.pow(10, Math.floor(Math.log10(Math.max(price, 0.0001))));
    const step = mag * 0.0005 * 200;
    const bucketPrice = Math.floor(price / step) * step;
    let bkt = state.volumeProfile.get(bucketPrice);
    if (!bkt) {
      bkt = { price: bucketPrice, bVol: 0, sVol: 0, bFreq: 0, sFreq: 0, firstSeen: time, lastUpdated: time, relevanceScore: 1.0 };
      state.volumeProfile.set(bucketPrice, bkt);
    }
    decayLevel(bkt, time);
    if (isMaker) { bkt.sVol += qty; bkt.sFreq += 1; }
    else          { bkt.bVol += qty; bkt.bFreq += 1; }

    // ── Fingerprint / split detection ─────────────────
    const isBuy = !isMaker;
    const priceband = Math.round(price / (price * FINGERPRINT_PRICE_TOLERANCE));
    const key = `${symbol}:${isBuy ? 'buy' : 'sell'}:${priceband}`;

    let fp = this.fingerprints.get(key);
    if (!fp || time - fp.lastSeen > FINGERPRINT_WINDOW_MS) {
      fp = { side: isBuy ? 'buy' : 'sell', priceband, trades: [], totalUsd: 0, firstSeen: time, lastSeen: time };
      this.fingerprints.set(key, fp);
    }
    fp.trades.push({ price, qty, time });
    fp.totalUsd += usd;
    fp.lastSeen = time;

    const whaleFloor = getWhaleFloor(state.vol24h || 1_000_000_000, usd);

    // Emit SINGLE whale event
    if (usd >= whaleFloor && fp.trades.length === 1) {
      const ev: WhaleEvent = {
        time, price, qty, val: usd,
        side: isBuy ? 'buy' : 'sell',
        exec: isMaker ? 'Limit Hit' : 'Market',
        status: 'AGGRESSIVE',
        score: Math.min(99, 70 + Math.floor(usd / 1_000_000) * 10),
        type: 'SINGLE',
      };
      state.events.unshift(ev);
      if (state.events.length > 2000) state.events.pop();
      return ev;
    }

    // Emit SPLIT_DETECTED event
    const suspicion = computeSplittingSuspicion(fp);
    if (fp.totalUsd >= whaleFloor && fp.trades.length >= 4 && suspicion > 0.6) {
      const ev: WhaleEvent = {
        time, price, qty: fp.totalUsd / price,
        val: fp.totalUsd,
        side: isBuy ? 'buy' : 'sell',
        exec: 'Iceberg / Split',
        status: 'SPLIT_DETECTED',
        score: Math.min(99, 70 + Math.round(suspicion * 20)),
        type: 'SPLIT_DETECTED',
      };
      state.events.unshift(ev);
      if (state.events.length > 2000) state.events.pop();
      this.fingerprints.delete(key);
      return ev;
    }

    return null;
  }

  /**
   * Feed an order book snapshot. Updates bids/asks state used
   * by wall classification logic.
   */
  public ingestSnapshot(
    symbol: string,
    bids: [number, number][],
    asks: [number, number][]
  ) {
    const state = this.getState(symbol);
    for (const [p, q] of bids) {
      if (q === 0) state.bids.delete(p);
      else state.bids.set(p, q);
    }
    for (const [p, q] of asks) {
      if (q === 0) state.asks.delete(p);
      else state.asks.set(p, q);
    }
  }

  /**
   * Compute a Composite Trust Score from the current state.
   * Returns confidence (0–100) and direction ('bullish'|'bearish'|'neutral').
   */
  public computeCompositeTrust(symbol: string, now: number): {
    confidence: number;
    direction: 'bullish' | 'bearish' | 'neutral';
    buyPressure: number;
    sellPressure: number;
    recentWhaleEvents: WhaleEvent[];
  } {
    const state = this.getState(symbol);
    const window5m = 5 * 60 * 1000;
    
    const recentEvents = state.events.filter(e => now - e.time < window5m);
    
    let buyPressure = 0, sellPressure = 0;
    for (const ev of recentEvents) {
      if (ev.side === 'buy' || ev.side === 'bid') buyPressure += ev.val;
      else sellPressure += ev.val;
    }
    
    const total = buyPressure + sellPressure || 1;
    const buyRatio = buyPressure / total;
    
    // Weighted confidence based on buy/sell imbalance and recent event count
    const imbalance = Math.abs(buyRatio - 0.5) * 2; // 0–1
    const confidence = Math.round(40 + imbalance * 50 + Math.min(recentEvents.length, 5) * 2);
    
    const direction: 'bullish' | 'bearish' | 'neutral' =
      buyRatio > 0.6 ? 'bullish' :
      buyRatio < 0.4 ? 'bearish' : 'neutral';
    
    return {
      confidence: Math.min(100, confidence),
      direction,
      buyPressure,
      sellPressure,
      recentWhaleEvents: recentEvents.slice(0, 5),
    };
  }
}
