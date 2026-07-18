import { EvidenceBreakdown, ConflictResult, ProbabilityResult } from './types';

/**
 * Probability Engine (Layer 13)
 * 
 * Maps Evidence & Conflict into distinct probability buckets:
 * Accumulation, Distribution, Trap, or Neutral.
 */

export class ProbabilityEngine {
  compute(evidence: EvidenceBreakdown, conflict: ConflictResult): ProbabilityResult {
    let accumulation = 0;
    let distribution = 0;
    let trap = 0;
    let neutral = 0;

    if (conflict.conflictScore > 70 || (evidence.totalBullish === 0 && evidence.totalBearish === 0)) {
      // High conflict or no evidence = mostly neutral
      neutral = Math.min(100, conflict.conflictScore > 0 ? conflict.conflictScore : 100);
      
      const remaining = 100 - neutral;
      accumulation = remaining * (conflict.bullishPct / 100);
      distribution = remaining * (conflict.bearishPct / 100);
    } else {
      // Low conflict -> clear direction
      neutral = conflict.conflictScore;
      
      const remaining = 100 - neutral;
      
      // Check for trap signatures in evidence
      const hasTrapEvidence = evidence.items.some(i => i.source.includes('TRAP') || i.source.includes('STOP_HUNT'));
      
      if (hasTrapEvidence) {
        trap = remaining * 0.8; // 80% of remaining goes to trap probability
        const leftover = remaining * 0.2;
        accumulation = leftover * (conflict.bullishPct / 100);
        distribution = leftover * (conflict.bearishPct / 100);
      } else {
        accumulation = remaining * (conflict.bullishPct / 100);
        distribution = remaining * (conflict.bearishPct / 100);
      }
    }

    return {
      accumulation,
      distribution,
      trap,
      neutral
    };
  }
}
