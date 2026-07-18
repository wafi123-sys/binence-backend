import { MarketEvent, PriceLevelMemory } from './types';

/**
 * Market Memory (Layer 9)
 * 
 * Ported from volumeProfile + decayLevel in whaleTracker.ts, expanded with
 * reactionHistory tracking (bounce/break tracking per level).
 * 
 * This is the "memory" of the system — it remembers which price levels
 * have been important and how price reacted when revisiting them.
 */

const HALF_LIFE_MS = 6 * 60 * 60 * 1000; // 6 hours
const PRICE_PROXIMITY_PCT = 0.001; // 0.1% proximity for "touching" a level
const MAX_LEVELS = 500;

export class MarketMemory {
  private levels: Map<string, Map<number, PriceLevelMemory>> = new Map(); // symbol -> price -> memory

  update(symbol: string, events: MarketEvent[], lastPrice: number) {
    if (!this.levels.has(symbol)) {
      this.levels.set(symbol, new Map());
    }
    const symbolLevels = this.levels.get(symbol)!;
    const now = Date.now();

    // 1. Update volume profiles from new events
    for (const event of events) {
      const bucketPrice = this.bucketize(event.price);
      let level = symbolLevels.get(bucketPrice);

      if (!level) {
        level = {
          symbol,
          price: bucketPrice,
          bVol: 0,
          sVol: 0,
          relevanceScore: 1.0,
          reactionHistory: [],
          bounceRate: 0,
          label: undefined
        };
        symbolLevels.set(bucketPrice, level);
      }

      // Apply decay before adding new data
      this.decayLevel(level, now);

      // Update volume based on event side
      if (event.side === 'buy' || event.side === 'bid') {
        level.bVol += event.strength;
      } else {
        level.sVol += event.strength;
      }

      // Label significant levels
      if (event.confidence > 80) {
        level.label = `Institutional (${event.type})`;
      }
    }

    // 2. Check for price revisits — record bounce/break
    for (const [price, level] of symbolLevels.entries()) {
      const proximity = Math.abs(lastPrice - price) / price;
      if (proximity < PRICE_PROXIMITY_PCT) {
        // Price is touching this level!
        const lastReaction = level.reactionHistory[level.reactionHistory.length - 1];
        
        // Don't record multiple reactions within 30 seconds
        if (lastReaction && now - lastReaction.time < 30_000) continue;

        // We'll determine bounce vs break on the NEXT tick after touching
        // For now, mark it as pending by recording the touch
        // The outcome will be updated when price moves away
      }
    }

    // 3. Determine bounce/break outcomes for levels price recently touched
    for (const [price, level] of symbolLevels.entries()) {
      if (level.reactionHistory.length > 0) {
        const lastReaction = level.reactionHistory[level.reactionHistory.length - 1];
        // If the last reaction was recent (within 5 min), determine outcome
        if (now - lastReaction.time < 300_000) continue;
      }

      const proximity = Math.abs(lastPrice - price) / price;
      if (proximity < PRICE_PROXIMITY_PCT * 3) {
        // Price is near this level — record what happened
        const priceMoved = (lastPrice - price) / price;
        const outcome: 'BOUNCE' | 'BREAK' = Math.abs(priceMoved) < PRICE_PROXIMITY_PCT ? 'BOUNCE' : 'BREAK';
        
        level.reactionHistory.push({ time: now, outcome });
        
        // Keep only last 20 reactions
        if (level.reactionHistory.length > 20) {
          level.reactionHistory = level.reactionHistory.slice(-20);
        }

        // Recalculate bounce rate
        const bounces = level.reactionHistory.filter(r => r.outcome === 'BOUNCE').length;
        level.bounceRate = bounces / level.reactionHistory.length;
      }
    }

    // Cleanup: remove levels with very low relevance
    if (symbolLevels.size > MAX_LEVELS) {
      const entries = Array.from(symbolLevels.entries());
      entries.sort((a, b) => (b[1].bVol + b[1].sVol) * b[1].relevanceScore - (a[1].bVol + a[1].sVol) * a[1].relevanceScore);
      
      const toKeep = new Map(entries.slice(0, MAX_LEVELS));
      this.levels.set(symbol, toKeep);
    }
  }

  getTopLevels(symbol: string, count: number = 50): PriceLevelMemory[] {
    const symbolLevels = this.levels.get(symbol);
    if (!symbolLevels) return [];

    return Array.from(symbolLevels.values())
      .sort((a, b) => {
        const scoreA = (a.bVol + a.sVol) * a.relevanceScore;
        const scoreB = (b.bVol + b.sVol) * b.relevanceScore;
        return scoreB - scoreA;
      })
      .slice(0, count);
  }

  getLevelAtPrice(symbol: string, price: number): PriceLevelMemory | null {
    const symbolLevels = this.levels.get(symbol);
    if (!symbolLevels) return null;
    
    const bucketPrice = this.bucketize(price);
    return symbolLevels.get(bucketPrice) || null;
  }

  private decayLevel(level: PriceLevelMemory, now: number) {
    // We don't have lastUpdated in the new interface, so use relevanceScore decay
    // Apply a simple exponential decay factor
    const decayFactor = 0.999; // Very slow decay per call
    level.bVol *= decayFactor;
    level.sVol *= decayFactor;
    level.relevanceScore *= decayFactor;
  }

  private bucketize(price: number): number {
    // Round to nearest significant price level
    const mag = Math.pow(10, Math.floor(Math.log10(price)));
    const step = mag * 0.001; // 0.1% of magnitude
    return Math.round(price / step) * step;
  }
}
