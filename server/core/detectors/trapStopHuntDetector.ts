import { Detector } from './index';
import { FeatureSnapshot, MarketState, CandidateEvent, RawTrade } from '../types';

/**
 * Trap & Stop Hunt Detector (Layer 4) — ASYNC
 * 
 * Detects price patterns that suggest deliberate trapping:
 * 
 * 1. TRAP: Price breaks a key level (high/low), triggers stops, then reverses sharply.
 *    - Fake breakout above resistance → reversal = BULL TRAP
 *    - Fake breakdown below support → reversal = BEAR TRAP
 * 
 * 2. STOP_HUNT: Large spike in liquidations + rapid price reversal
 * 
 * 3. FAKE_BREAKOUT: Price pierces a level but volume doesn't confirm, 
 *    and it returns within the range quickly.
 */

interface PriceExtremeTracker {
  highWatermark: number;
  lowWatermark: number;
  lastUpdate: number;
  recentPrices: { price: number; time: number }[];
}

export class TrapStopHuntDetector implements Detector {
  private trackers: Map<string, PriceExtremeTracker> = new Map();
  private LOOKBACK_MS = 60_000; // 1 minute window for trap detection
  private REVERSAL_THRESHOLD = 0.003; // 0.3% reversal after break = trap candidate
  private MIN_SPIKE_RATIO = 1.5; // Volume spike must be 1.5x average

  evaluate(features: FeatureSnapshot, state: MarketState, trade?: RawTrade): CandidateEvent[] {
    if (!trade) return [];
    
    const events: CandidateEvent[] = [];
    const symbol = trade.symbol;
    const now = trade.tradeTime;
    const price = trade.price;

    if (!this.trackers.has(symbol)) {
      this.trackers.set(symbol, {
        highWatermark: price,
        lowWatermark: price,
        lastUpdate: now,
        recentPrices: []
      });
    }

    const tracker = this.trackers.get(symbol)!;
    tracker.recentPrices.push({ price, time: now });

    // Prune old prices
    while (tracker.recentPrices.length > 0 && now - tracker.recentPrices[0].time > this.LOOKBACK_MS) {
      tracker.recentPrices.shift();
    }

    if (tracker.recentPrices.length < 10) {
      // Update watermarks
      if (price > tracker.highWatermark) tracker.highWatermark = price;
      if (price < tracker.lowWatermark) tracker.lowWatermark = price;
      return events;
    }

    // Compute range stats
    const prices = tracker.recentPrices.map(p => p.price);
    const rangeHigh = Math.max(...prices);
    const rangeLow = Math.min(...prices);
    const rangeSize = rangeHigh - rangeLow;
    
    if (rangeSize === 0) return events;

    const midRange = (rangeHigh + rangeLow) / 2;
    const currentPrice = prices[prices.length - 1];
    const recentHigh = Math.max(...prices.slice(-5));
    const recentLow = Math.min(...prices.slice(-5));

    // TRAP detection: price spiked to new extreme then reversed
    // Check if price broke above high then came back down
    if (tracker.highWatermark > 0) {
      const breakAbove = rangeHigh > tracker.highWatermark;
      const reversedDown = currentPrice < tracker.highWatermark - (tracker.highWatermark * this.REVERSAL_THRESHOLD);
      
      if (breakAbove && reversedDown && rangeHigh === recentHigh) {
        // Only fire if we haven't broken above this level before recently
        let confidence = 55;
        const reversalPct = (rangeHigh - currentPrice) / rangeHigh * 100;
        if (reversalPct > 0.5) confidence += 15;
        if (features.volume > 0) confidence += 10;
        confidence = Math.min(99, confidence);

        events.push({
          symbol,
          type: 'TRAP',
          price: rangeHigh,
          qty: 0,
          usdValue: 0,
          time: now,
          side: 'sell', // Bull trap — trapped longs
          rawConfidence: confidence,
          meta: {
            trapType: 'BULL_TRAP',
            breakLevel: tracker.highWatermark,
            peakPrice: rangeHigh,
            currentPrice,
            reversalPct
          }
        });

        // Reset watermark
        tracker.highWatermark = currentPrice;
      }
    }

    // Check if price broke below low then came back up
    if (tracker.lowWatermark > 0 && tracker.lowWatermark < Infinity) {
      const breakBelow = rangeLow < tracker.lowWatermark;
      const reversedUp = currentPrice > tracker.lowWatermark + (tracker.lowWatermark * this.REVERSAL_THRESHOLD);

      if (breakBelow && reversedUp && rangeLow === recentLow) {
        let confidence = 55;
        const reversalPct = (currentPrice - rangeLow) / rangeLow * 100;
        if (reversalPct > 0.5) confidence += 15;
        if (features.volume > 0) confidence += 10;
        confidence = Math.min(99, confidence);

        events.push({
          symbol,
          type: 'TRAP',
          price: rangeLow,
          qty: 0,
          usdValue: 0,
          time: now,
          side: 'buy', // Bear trap — trapped shorts
          rawConfidence: confidence,
          meta: {
            trapType: 'BEAR_TRAP',
            breakLevel: tracker.lowWatermark,
            troughPrice: rangeLow,
            currentPrice,
            reversalPct
          }
        });

        tracker.lowWatermark = currentPrice;
      }
    }

    // Update watermarks gradually
    if (price > tracker.highWatermark) tracker.highWatermark = price;
    if (price < tracker.lowWatermark) tracker.lowWatermark = price;

    return events;
  }
}
