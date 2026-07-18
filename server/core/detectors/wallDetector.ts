import { Detector } from './index';
import { FeatureSnapshot, MarketState, CandidateEvent, PriceLevelState } from '../types';
import { FeatureExtractor } from '../featureExtractor';

/**
 * Wall Detector (Layer 4)
 * Ported from classifyMakerWall() in whaleTracker.ts + WallEngine concept from engine.js
 * 
 * Detects large resting orders on bid/ask side that act as support/resistance.
 * Output: CandidateEvent with type BUY_WALL or SELL_WALL
 */

interface WallCandidate {
  price: number;
  qty: number;
  usdValue: number;
  side: 'bid' | 'ask';
  firstSeenAt: number;
}

export class WallDetector implements Detector {
  private activeWalls: Map<string, WallCandidate[]> = new Map(); // key = symbol
  private WALL_MULTIPLIER = 5; // Wall must be N times the median depth level

  evaluate(features: FeatureSnapshot, state: MarketState): CandidateEvent[] {
    const events: CandidateEvent[] = [];
    const symbol = features.symbol;
    const now = features.time;

    // Calculate median depth per level for bid and ask sides
    const bidEntries = Array.from(state.bids.entries()).filter(([_, q]) => q > 0);
    const askEntries = Array.from(state.asks.entries()).filter(([_, q]) => q > 0);

    if (bidEntries.length < 5 || askEntries.length < 5) return events;

    const medianBidQty = this.median(bidEntries.map(([_, q]) => q));
    const medianAskQty = this.median(askEntries.map(([_, q]) => q));

    // Scan bids for buy walls
    for (const [price, qty] of bidEntries) {
      if (qty > medianBidQty * this.WALL_MULTIPLIER) {
        const usdValue = price * qty;
        if (usdValue < 10_000) continue; // Minimum wall size in USD

        const confidence = this.calcWallConfidence(qty, medianBidQty, usdValue);
        events.push({
          symbol,
          type: 'BUY_WALL',
          price,
          qty,
          usdValue,
          time: now,
          side: 'bid',
          rawConfidence: confidence,
          meta: { medianQty: medianBidQty, ratio: qty / medianBidQty }
        });
      }
    }

    // Scan asks for sell walls
    for (const [price, qty] of askEntries) {
      if (qty > medianAskQty * this.WALL_MULTIPLIER) {
        const usdValue = price * qty;
        if (usdValue < 10_000) continue;

        const confidence = this.calcWallConfidence(qty, medianAskQty, usdValue);
        events.push({
          symbol,
          type: 'SELL_WALL',
          price,
          qty,
          usdValue,
          time: now,
          side: 'ask',
          rawConfidence: confidence,
          meta: { medianQty: medianAskQty, ratio: qty / medianAskQty }
        });
      }
    }

    return events;
  }

  private calcWallConfidence(qty: number, medianQty: number, usdValue: number): number {
    let confidence = 50;
    const ratio = qty / medianQty;
    
    // Higher ratio = more confident it's a real wall
    if (ratio > 10) confidence += 20;
    else if (ratio > 7) confidence += 15;
    else if (ratio > 5) confidence += 10;

    // Bigger USD value = more confident
    if (usdValue > 1_000_000) confidence += 15;
    else if (usdValue > 500_000) confidence += 10;
    else if (usdValue > 100_000) confidence += 5;

    return Math.min(99, confidence);
  }

  private median(arr: number[]): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }
}
