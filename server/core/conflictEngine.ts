import { EvidenceBreakdown, ConflictResult } from './types';

/**
 * Conflict Engine (Layer 12)
 * 
 * Analyzes the evidence breakdown to determine if signals are conflicting.
 * If bullish and bearish evidence are roughly equal, conflict score is high.
 * A high conflict score means the market is undecided, and strategies should stay out.
 */

export class ConflictEngine {
  compute(evidence: EvidenceBreakdown): ConflictResult {
    const totalEvidence = evidence.totalBullish + evidence.totalBearish;
    
    if (totalEvidence === 0) {
      return { bullishPct: 0, bearishPct: 0, conflictScore: 0 };
    }

    const bullishPct = (evidence.totalBullish / totalEvidence) * 100;
    const bearishPct = (evidence.totalBearish / totalEvidence) * 100;

    // Conflict score: how close are bullish and bearish percentages to 50/50?
    // Formula: 100 - |bullishPct - bearishPct|
    // If bullish is 50 and bearish is 50, diff = 0 -> conflict = 100
    // If bullish is 90 and bearish is 10, diff = 80 -> conflict = 20
    const diff = Math.abs(bullishPct - bearishPct);
    const conflictScore = 100 - diff;

    return {
      bullishPct,
      bearishPct,
      conflictScore
    };
  }
}
