import { Detector } from './index';
import { FeatureSnapshot, MarketState, CandidateEvent } from '../types';

/**
 * Migration Detector (Layer 4) — ASYNC
 * 
 * Detects when large orders (walls) shift/migrate to a new price level.
 * This often indicates institutional repositioning.
 * Key signal: a wall disappears at price A and reappears at price B within a short window.
 */

interface WallSnapshot {
  price: number;
  qty: number;
  usdValue: number;
  side: 'bid' | 'ask';
  seenAt: number;
}

export class MigrationDetector implements Detector {
  private prevWalls: Map<string, WallSnapshot[]> = new Map(); // symbol -> previous large levels
  private WALL_MIN_RATIO = 5;
  private MIGRATION_WINDOW_MS = 30_000; // Wall must reappear within 30s
  private MIGRATION_PRICE_TOLERANCE = 0.02; // 2% price difference max

  evaluate(features: FeatureSnapshot, state: MarketState): CandidateEvent[] {
    const events: CandidateEvent[] = [];
    const symbol = features.symbol;
    const now = features.time;

    // Get current large levels
    const bidQtys = Array.from(state.bids.values()).filter(q => q > 0);
    const askQtys = Array.from(state.asks.values()).filter(q => q > 0);
    const medianBid = this.median(bidQtys);
    const medianAsk = this.median(askQtys);

    const currentWalls: WallSnapshot[] = [];

    for (const [price, qty] of state.bids.entries()) {
      if (qty > medianBid * this.WALL_MIN_RATIO) {
        currentWalls.push({ price, qty, usdValue: price * qty, side: 'bid', seenAt: now });
      }
    }
    for (const [price, qty] of state.asks.entries()) {
      if (qty > medianAsk * this.WALL_MIN_RATIO) {
        currentWalls.push({ price, qty, usdValue: price * qty, side: 'ask', seenAt: now });
      }
    }

    // Compare with previous walls to detect migration
    const prevWalls = this.prevWalls.get(symbol) || [];

    for (const prev of prevWalls) {
      // Check if this old wall is now gone
      const stillExists = currentWalls.some(c => c.price === prev.price && c.side === prev.side);
      if (stillExists) continue;

      // Wall disappeared — check if a similar-sized wall appeared nearby
      for (const curr of currentWalls) {
        if (curr.side !== prev.side) continue;
        if (curr.price === prev.price) continue;

        const priceDiff = Math.abs(curr.price - prev.price) / prev.price;
        if (priceDiff > this.MIGRATION_PRICE_TOLERANCE) continue;

        // Size must be roughly similar (within 50%)
        const sizeRatio = Math.min(curr.qty, prev.qty) / Math.max(curr.qty, prev.qty);
        if (sizeRatio < 0.5) continue;

        const timeDiff = now - prev.seenAt;
        if (timeDiff > this.MIGRATION_WINDOW_MS) continue;

        // Migration detected!
        const direction = curr.price > prev.price ? 'up' : 'down';
        let confidence = 60;
        if (sizeRatio > 0.8) confidence += 10; // Very similar size
        if (priceDiff < 0.005) confidence += 10; // Very close price
        confidence = Math.min(99, confidence);

        events.push({
          symbol,
          type: 'MIGRATION',
          price: curr.price,
          qty: curr.qty,
          usdValue: curr.usdValue,
          time: now,
          side: curr.side,
          rawConfidence: confidence,
          meta: {
            fromPrice: prev.price,
            toPrice: curr.price,
            direction,
            priceDiffPct: priceDiff * 100,
            sizeRatio,
            migrationTimeMs: timeDiff
          }
        });
      }
    }

    // Store current walls for next evaluation
    this.prevWalls.set(symbol, currentWalls);

    return events;
  }

  private median(arr: number[]): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }
}
