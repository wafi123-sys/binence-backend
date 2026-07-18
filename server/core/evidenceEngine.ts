import { 
  EvidenceBreakdown, Sequence, MarketContext, PriceLevelMemory, 
  TimelineEntry, DetectorType 
} from './types';
import { MarketMemory } from './marketMemory';

/**
 * Evidence Engine (Layer 11)
 * 
 * Aggregates all signals (sequences, market memory, context) into a
 * weighted evidence breakdown. Each evidence item has a direction (bullish/bearish)
 * and a weight.
 */

const DETECTOR_DIRECTION: Record<DetectorType, 'bullish' | 'bearish' | 'neutral'> = {
  'BUY_WALL': 'bullish',
  'SELL_WALL': 'bearish',
  'SPOOF': 'neutral',        // Direction depends on side
  'WHALE': 'neutral',         // Direction depends on side
  'ICEBERG': 'neutral',       // Direction depends on side
  'ABSORPTION': 'neutral',
  'DISTRIBUTION': 'bearish',
  'MIGRATION': 'neutral',
  'TRAP': 'neutral',
  'STOP_HUNT': 'neutral',
  'FAKE_BREAKOUT': 'neutral',
  'PASSIVE_BUYER': 'bullish',
  'PASSIVE_SELLER': 'bearish',
};

export class EvidenceEngine {
  compute(
    symbol: string,
    recentEvents: TimelineEntry[],
    sequences: Sequence[],
    marketMemory: MarketMemory,
    context: MarketContext
  ): EvidenceBreakdown {
    const items: { source: string; direction: 'bullish' | 'bearish'; weight: number }[] = [];
    const now = Date.now();

    // 1. Evidence from recent individual events
    for (const event of recentEvents) {
      const baseDirection = DETECTOR_DIRECTION[event.type];
      // Determine actual direction based on side for neutral types
      let direction: 'bullish' | 'bearish';
      if (baseDirection === 'neutral') {
        direction = (event.type === 'WHALE' || event.type === 'ICEBERG') 
          ? 'bullish' // Simplified — in real use, would check side
          : 'bearish';
      } else {
        direction = baseDirection;
      }

      // Weight based on event age (newer = higher weight)
      const ageMs = now - event.time;
      const ageDecay = Math.max(0.1, 1 - (ageMs / 300_000)); // Decay over 5 min
      const weight = 10 * ageDecay;

      items.push({ source: `${event.type}@${event.price.toFixed(0)}`, direction, weight });
    }

    // 2. Evidence from confirmed sequences (higher weight)
    for (const seq of sequences) {
      if (seq.status !== 'CONFIRMED') continue;
      
      const direction: 'bullish' | 'bearish' = 
        seq.pattern.includes('ACCUMULATION') || seq.pattern.includes('SWEEP_REVERSAL') ? 'bullish' : 'bearish';
      
      items.push({
        source: `Sequence:${seq.pattern}`,
        direction,
        weight: seq.strength * 0.5
      });
    }

    // 3. Evidence from market memory (bounce levels = support, break levels = weakness)
    const topLevels = marketMemory.getTopLevels(symbol, 10);
    for (const level of topLevels) {
      if (level.reactionHistory.length < 3) continue; // Need enough data

      if (level.bounceRate > 0.7) {
        // Strong support/resistance level
        items.push({
          source: `Memory:Support@${level.price.toFixed(0)}(${(level.bounceRate * 100).toFixed(0)}%bounce)`,
          direction: 'bullish',
          weight: level.bounceRate * 15
        });
      } else if (level.bounceRate < 0.3) {
        items.push({
          source: `Memory:Broken@${level.price.toFixed(0)}`,
          direction: 'bearish',
          weight: (1 - level.bounceRate) * 10
        });
      }
    }

    // 4. Evidence from context
    if (context.fundingBias === 'POSITIVE') {
      items.push({ source: 'Context:FundingPositive', direction: 'bullish', weight: 5 });
    } else if (context.fundingBias === 'NEGATIVE') {
      items.push({ source: 'Context:FundingNegative', direction: 'bearish', weight: 5 });
    }

    if (context.oiBias === 'BULLISH') {
      items.push({ source: 'Context:OI_Bullish', direction: 'bullish', weight: 8 });
    } else if (context.oiBias === 'BEARISH') {
      items.push({ source: 'Context:OI_Bearish', direction: 'bearish', weight: 8 });
    }

    if (context.trend === 'UP') {
      items.push({ source: 'Context:Uptrend', direction: 'bullish', weight: 6 });
    } else if (context.trend === 'DOWN') {
      items.push({ source: 'Context:Downtrend', direction: 'bearish', weight: 6 });
    }

    // Sum up
    const totalBullish = items.filter(i => i.direction === 'bullish').reduce((s, i) => s + i.weight, 0);
    const totalBearish = items.filter(i => i.direction === 'bearish').reduce((s, i) => s + i.weight, 0);

    return {
      symbol,
      time: now,
      items,
      totalBullish,
      totalBearish
    };
  }
}
