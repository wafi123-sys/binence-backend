import { Detector } from './index';
import { FeatureSnapshot, MarketState, CandidateEvent } from '../types';
import { FeatureExtractor } from '../featureExtractor';

/**
 * Spoof Detector (Layer 4)
 * Ported from SpoofEngine concept in engine.js
 * 
 * Detects orders that appear large but are quickly cancelled before being filled.
 * Key signals: high cancelCount, low fillCount, short lifetime.
 * 
 * This detector works by tracking price levels over time and flagging those
 * with suspicious cancel-to-fill ratios and short lifetimes.
 */

interface TrackedLevel {
  price: number;
  side: 'bid' | 'ask';
  peakQty: number;
  firstSeenAt: number;
  cancelCount: number;
  fillCount: number;
  disappeared: boolean;
  lastSeenAt: number;
}

export class SpoofDetector implements Detector {
  private trackedLevels: Map<string, Map<number, TrackedLevel>> = new Map(); // symbol -> price -> TrackedLevel
  private SPOOF_LIFETIME_MAX_MS = 30_000; // Orders lasting < 30s are suspicious
  private SPOOF_MIN_QTY_RATIO = 3; // Must be at least 3x median to be considered spoof candidate
  private CLEANUP_INTERVAL_MS = 60_000;
  private lastCleanup: number = 0;

  evaluate(features: FeatureSnapshot, state: MarketState): CandidateEvent[] {
    const events: CandidateEvent[] = [];
    const symbol = features.symbol;
    const now = features.time;

    if (!this.trackedLevels.has(symbol)) {
      this.trackedLevels.set(symbol, new Map());
    }
    const levels = this.trackedLevels.get(symbol)!;

    // Calculate medians
    const bidEntries = Array.from(state.bids.entries()).filter(([_, q]) => q > 0);
    const askEntries = Array.from(state.asks.entries()).filter(([_, q]) => q > 0);
    const medianBid = this.median(bidEntries.map(([_, q]) => q));
    const medianAsk = this.median(askEntries.map(([_, q]) => q));

    // Track current large levels on bids
    for (const [price, qty] of bidEntries) {
      if (qty > medianBid * this.SPOOF_MIN_QTY_RATIO) {
        if (!levels.has(price)) {
          levels.set(price, {
            price, side: 'bid', peakQty: qty,
            firstSeenAt: now, cancelCount: 0, fillCount: 0,
            disappeared: false, lastSeenAt: now
          });
        } else {
          const l = levels.get(price)!;
          if (qty > l.peakQty) l.peakQty = qty;
          l.lastSeenAt = now;
          l.disappeared = false;
        }
      }
    }

    // Track current large levels on asks
    for (const [price, qty] of askEntries) {
      if (qty > medianAsk * this.SPOOF_MIN_QTY_RATIO) {
        if (!levels.has(-price)) { // Use negative price as key for asks to avoid collision
          levels.set(-price, {
            price, side: 'ask', peakQty: qty,
            firstSeenAt: now, cancelCount: 0, fillCount: 0,
            disappeared: false, lastSeenAt: now
          });
        } else {
          const l = levels.get(-price)!;
          if (qty > l.peakQty) l.peakQty = qty;
          l.lastSeenAt = now;
          l.disappeared = false;
        }
      }
    }

    // Check for disappeared levels (spoof candidates)
    for (const [key, level] of levels.entries()) {
      const currentQty = level.side === 'bid' 
        ? (state.bids.get(level.price) || 0) 
        : (state.asks.get(level.price) || 0);

      if (currentQty === 0 && !level.disappeared) {
        level.disappeared = true;
        level.cancelCount++;

        const lifetime = now - level.firstSeenAt;
        
        // Spoof: large order that disappeared quickly without being filled
        if (lifetime < this.SPOOF_LIFETIME_MAX_MS && level.fillCount === 0) {
          const usdValue = level.price * level.peakQty;
          if (usdValue < 5_000) continue; // Ignore tiny spoofs
          
          let confidence = 60;
          if (lifetime < 5_000) confidence += 20; // Very short lived
          else if (lifetime < 15_000) confidence += 10;
          if (level.peakQty > (level.side === 'bid' ? medianBid : medianAsk) * 10) confidence += 10;
          confidence = Math.min(99, confidence);

          events.push({
            symbol,
            type: 'SPOOF',
            price: level.price,
            qty: level.peakQty,
            usdValue,
            time: now,
            side: level.side,
            rawConfidence: confidence,
            meta: { 
              lifetimeMs: lifetime, 
              cancelCount: level.cancelCount,
              fillCount: level.fillCount,
              peakQty: level.peakQty
            }
          });
        }
      } else if (currentQty > 0 && currentQty < level.peakQty * 0.5) {
        // Qty decreased significantly - might be getting filled (not spoof)
        level.fillCount++;
      }
    }

    // Periodic cleanup of stale tracked levels
    if (now - this.lastCleanup > this.CLEANUP_INTERVAL_MS) {
      this.lastCleanup = now;
      for (const [key, level] of levels.entries()) {
        if (now - level.lastSeenAt > this.CLEANUP_INTERVAL_MS * 2) {
          levels.delete(key);
        }
      }
    }

    return events;
  }

  private median(arr: number[]): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }
}
