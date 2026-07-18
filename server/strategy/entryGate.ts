import { 
  StrategyDecision, ProbabilityResult, ConflictResult, 
  MarketContext, FeatureSnapshot, EntryDecision, EntryGateCheck 
} from '../core/types';

/**
 * Entry Gate (Layer 15)
 * 
 * Final sanity check before any signal becomes a trade or alert.
 * Checks for market conditions that make trading dangerous (wide spread, spoofing, etc).
 */

export class EntryGate {
  evaluate(
    decision: StrategyDecision,
    probability: ProbabilityResult,
    conflict: ConflictResult,
    context: MarketContext,
    features: FeatureSnapshot,
    recentSpoofsCount: number
  ): EntryDecision {
    const checks: EntryGateCheck[] = [];

    // 1. Conflict Check
    const conflictPassed = conflict.conflictScore < 50;
    checks.push({
      name: 'conflict',
      passed: conflictPassed,
      value: conflict.conflictScore,
      threshold: 50
    });

    // 2. Probability Check
    const probValue = decision.direction === 'long' ? probability.accumulation : probability.distribution;
    const probPassed = probValue >= 40 || (decision.strategyName === 'Mean Reversion' && probability.trap >= 40);
    checks.push({
      name: 'probability',
      passed: probPassed,
      value: probValue,
      threshold: 40
    });

    // 3. Spread Check (max 0.2% spread for entry)
    const spreadPct = (features.spread / features.vwap) * 100;
    const spreadPassed = spreadPct < 0.2;
    checks.push({
      name: 'spread',
      passed: spreadPassed,
      value: spreadPct,
      threshold: 0.2
    });

    // 4. Spoof Environment Check
    const spoofPassed = recentSpoofsCount < 3;
    checks.push({
      name: 'spoof',
      passed: spoofPassed,
      value: recentSpoofsCount,
      threshold: 3
    });

    // 5. Market Session Check (just an example, could restrict Asia session)
    const sessionPassed = context.session !== 'OVERLAP'; // Sometimes overlaps are too choppy
    checks.push({
      name: 'marketSession',
      passed: sessionPassed,
      value: context.session === 'OVERLAP' ? 0 : 1,
      threshold: 1
    });

    const allowed = decision.direction !== 'none' && checks.every(c => c.passed);

    return {
      allowed,
      checks,
      entryPrice: allowed ? features.vwap : undefined // Rough estimate
    };
  }
}
