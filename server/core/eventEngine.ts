import { ValidatedEvent, MarketEvent } from './types';
import { randomUUID } from 'crypto';

/**
 * Event Engine (Layer 6)
 * 
 * Wraps validated events into final MarketEvent objects with unique IDs.
 * Only events where isValid === true should be passed to this engine.
 * 
 * This is the boundary between "raw detection" and "confirmed signal".
 * Everything downstream (Timeline, Sequence, Evidence) only sees MarketEvent.
 */

export class EventEngine {
  create(validated: ValidatedEvent): MarketEvent {
    return {
      id: randomUUID(),
      symbol: validated.symbol,
      type: validated.type,
      price: validated.price,
      time: validated.time,
      strength: this.calcStrength(validated),
      confidence: validated.finalConfidence,
      side: validated.side,
      sourceChecks: validated.checks
    };
  }

  private calcStrength(validated: ValidatedEvent): number {
    // Strength is a composite of USD value significance and validation score quality
    let strength = 50;
    
    // USD value contribution
    if (validated.usdValue > 1_000_000) strength += 25;
    else if (validated.usdValue > 500_000) strength += 20;
    else if (validated.usdValue > 100_000) strength += 15;
    else if (validated.usdValue > 50_000) strength += 10;
    else if (validated.usdValue > 10_000) strength += 5;

    // Validation quality contribution
    const avgCheckScore = validated.checks.reduce((s, c) => s + c.score, 0) / validated.checks.length;
    strength += Math.round(avgCheckScore * 20);

    return Math.min(99, strength);
  }
}
