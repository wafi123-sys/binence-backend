import { Detector } from './index';
import { FeatureSnapshot, MarketState, CandidateEvent } from '../types';

/**
 * Absorption Detector (Layer 4) — ASYNC
 * 
 * Detects when a large wall order is being eaten through by aggressive market orders
 * but the price doesn't move (wall is "absorbing" the flow).
 * Key signals: high trade volume at a wall price level, wall qty decreasing but price stable.
 */

interface AbsorptionTracker {
  price: number;
  side: 'bid' | 'ask';
  initialQty: number;
  currentQty: number;
  volumeAbsorbed: number; // total trade volume matched at this level
  startTime: number;
  lastUpdate: number;
  emitted: boolean;
}

export class AbsorptionDetector implements Detector {
  private trackers: Map<string, AbsorptionTracker[]> = new Map();
  private MIN_ABSORPTION_USD = 50_000; // Minimum absorbed volume to flag
  private WALL_MIN_RATIO = 5; // Wall must be 5x median to start tracking

  evaluate(features: FeatureSnapshot, state: MarketState): CandidateEvent[] {
    const events: CandidateEvent[] = [];
    const symbol = features.symbol;
    const now = features.time;

    if (!this.trackers.has(symbol)) {
      this.trackers.set(symbol, []);
    }
    const trackers = this.trackers.get(symbol)!;

    // Calculate medians
    const bidQtys = Array.from(state.bids.values()).filter(q => q > 0);
    const askQtys = Array.from(state.asks.values()).filter(q => q > 0);
    const medianBid = this.median(bidQtys);
    const medianAsk = this.median(askQtys);

    // Check existing trackers for absorption progress
    for (const tracker of trackers) {
      if (tracker.emitted) continue;
      
      const currentQty = tracker.side === 'bid'
        ? (state.bids.get(tracker.price) || 0)
        : (state.asks.get(tracker.price) || 0);

      const consumed = tracker.initialQty - currentQty;
      if (consumed > 0) {
        tracker.volumeAbsorbed = consumed * tracker.price;
        tracker.currentQty = currentQty;
        tracker.lastUpdate = now;
      }

      // Emit if significant absorption happened
      if (tracker.volumeAbsorbed > this.MIN_ABSORPTION_USD && !tracker.emitted) {
        const absorptionRatio = consumed / tracker.initialQty;
        if (absorptionRatio > 0.3) { // At least 30% of wall consumed
          let confidence = 55;
          if (absorptionRatio > 0.7) confidence += 20;
          else if (absorptionRatio > 0.5) confidence += 10;
          if (tracker.volumeAbsorbed > 200_000) confidence += 10;
          confidence = Math.min(99, confidence);

          events.push({
            symbol,
            type: 'ABSORPTION',
            price: tracker.price,
            qty: consumed,
            usdValue: tracker.volumeAbsorbed,
            time: now,
            side: tracker.side,
            rawConfidence: confidence,
            meta: {
              initialQty: tracker.initialQty,
              remainingQty: tracker.currentQty,
              absorptionRatio,
              durationMs: now - tracker.startTime
            }
          });
          tracker.emitted = true;
        }
      }
    }

    // Scan for new wall candidates to start tracking
    const scanSide = (book: Map<number, number>, side: 'bid' | 'ask', median: number) => {
      for (const [price, qty] of book.entries()) {
        if (qty > median * this.WALL_MIN_RATIO) {
          const alreadyTracked = trackers.some(t => t.price === price && t.side === side);
          if (!alreadyTracked) {
            trackers.push({
              price, side,
              initialQty: qty,
              currentQty: qty,
              volumeAbsorbed: 0,
              startTime: now,
              lastUpdate: now,
              emitted: false
            });
          }
        }
      }
    };

    scanSide(state.bids, 'bid', medianBid);
    scanSide(state.asks, 'ask', medianAsk);

    // Cleanup old trackers (> 5 min old or fully consumed)
    const cleaned = trackers.filter(t => {
      if (now - t.lastUpdate > 300_000) return false;
      if (t.currentQty <= 0 && t.emitted) return false;
      return true;
    });
    this.trackers.set(symbol, cleaned);

    return events;
  }

  private median(arr: number[]): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }
}
