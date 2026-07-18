import { Detector } from './index';
import { FeatureSnapshot, MarketState, CandidateEvent, RawTrade } from '../types';

/**
 * Iceberg Detector (Layer 4)
 * Ported from journey iceberg/reload detection in whaleTracker.ts
 * 
 * Detects hidden large orders that refill after partial fills.
 * Key signals: a price level that keeps getting filled but the resting qty
 * keeps coming back (refillCount high, fillCount high).
 */

interface RefillTracker {
  price: number;
  side: 'bid' | 'ask';
  refillCount: number;
  fillCount: number;
  totalFilledQty: number;
  lastQty: number;
  firstSeenAt: number;
  lastRefillAt: number;
  emitted: boolean; // prevent duplicate events for same iceberg
}

export class IcebergDetector implements Detector {
  private trackers: Map<string, Map<number, RefillTracker>> = new Map(); // symbol -> price -> tracker
  private MIN_REFILLS = 3; // Need at least 3 refills to confirm iceberg
  private TRACKER_TTL_MS = 300_000; // 5 min TTL
  private lastCleanup = 0;

  evaluate(features: FeatureSnapshot, state: MarketState, trade?: RawTrade): CandidateEvent[] {
    const events: CandidateEvent[] = [];
    const symbol = features.symbol;
    const now = features.time;

    if (!this.trackers.has(symbol)) {
      this.trackers.set(symbol, new Map());
    }
    const trackers = this.trackers.get(symbol)!;

    // Update trackers from current order book state
    const processBook = (book: Map<number, number>, side: 'bid' | 'ask') => {
      for (const [price, qty] of book.entries()) {
        if (qty <= 0) continue;
        
        const key = side === 'bid' ? price : -price;
        const tracker = trackers.get(key);

        if (!tracker) {
          trackers.set(key, {
            price, side,
            refillCount: 0, fillCount: 0,
            totalFilledQty: 0,
            lastQty: qty,
            firstSeenAt: now,
            lastRefillAt: now,
            emitted: false
          });
        } else {
          // Detect refill: qty decreased then increased back
          if (qty > tracker.lastQty && tracker.lastQty < tracker.totalFilledQty * 0.3) {
            // Qty bounced back up after being depleted — refill detected
            tracker.refillCount++;
            tracker.lastRefillAt = now;
          }
          
          if (qty < tracker.lastQty) {
            // Being consumed (filled)
            tracker.fillCount++;
            tracker.totalFilledQty += (tracker.lastQty - qty);
          }
          
          tracker.lastQty = qty;
        }
      }
    };

    processBook(state.bids, 'bid');
    processBook(state.asks, 'ask');

    // Emit iceberg events for confirmed icebergs
    for (const [key, tracker] of trackers.entries()) {
      if (tracker.emitted) continue;
      if (tracker.refillCount >= this.MIN_REFILLS && tracker.fillCount >= this.MIN_REFILLS) {
        const usdValue = tracker.price * tracker.totalFilledQty;
        if (usdValue < 5_000) continue;

        let confidence = 65;
        if (tracker.refillCount > 5) confidence += 15;
        else if (tracker.refillCount > 3) confidence += 10;
        if (usdValue > 100_000) confidence += 10;
        confidence = Math.min(99, confidence);

        events.push({
          symbol,
          type: 'ICEBERG',
          price: tracker.price,
          qty: tracker.totalFilledQty,
          usdValue,
          time: now,
          side: tracker.side,
          rawConfidence: confidence,
          meta: {
            refillCount: tracker.refillCount,
            fillCount: tracker.fillCount,
            totalFilledQty: tracker.totalFilledQty,
            lifetimeMs: now - tracker.firstSeenAt
          }
        });

        tracker.emitted = true;
      }
    }

    // Cleanup old trackers
    if (now - this.lastCleanup > 60_000) {
      this.lastCleanup = now;
      for (const [key, tracker] of trackers.entries()) {
        if (now - tracker.lastRefillAt > this.TRACKER_TTL_MS) {
          trackers.delete(key);
        }
      }
    }

    return events;
  }
}
