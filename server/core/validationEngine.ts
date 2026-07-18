import { CandidateEvent, ValidatedEvent, ValidationCheckResult, MarketState, FeatureSnapshot, PriceLevelState } from './types';
import { FeatureExtractor } from './featureExtractor';

/**
 * Validation Engine (Layer 5)
 * 
 * Receives CandidateEvent from Layer 4 detectors and runs them through
 * a series of validation checks. Only events that pass ALL mandatory checks
 * become ValidatedEvent with isValid = true.
 * 
 * This is the single most impactful layer for reducing false positives.
 */

interface ValidationConfig {
  // Minimum lifetime for a wall/iceberg to be considered real (ms)
  minWallLifetimeMs: number;
  // Minimum refill count for iceberg
  minIcebergRefills: number;
  // Maximum cancel ratio before flagging as spoof (0-1)
  maxCancelRatio: number;
  // Minimum fill ratio for walls to be considered real (0-1)
  minFillRatio: number;
  // Minimum USD value for any event
  minUsdValue: number;
  // Volume multiplier — event size must be > medianTradeSize * this
  minVolumeMultiplier: number;
}

const DEFAULT_CONFIG: ValidationConfig = {
  minWallLifetimeMs: 5_000,    // Wall must exist for at least 5s
  minIcebergRefills: 3,
  maxCancelRatio: 0.8,         // If 80%+ of quantity was cancelled, likely spoof
  minFillRatio: 0.1,           // At least 10% must be filled (not just placed and removed)
  minUsdValue: 5_000,
  minVolumeMultiplier: 3,
};

export class ValidationEngine {
  private config: ValidationConfig;
  private featureExtractor: FeatureExtractor;

  constructor(featureExtractor: FeatureExtractor, config?: Partial<ValidationConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.featureExtractor = featureExtractor;
  }

  validate(candidate: CandidateEvent, features: FeatureSnapshot, state: MarketState): ValidatedEvent {
    const checks: ValidationCheckResult[] = [];

    // 1. Volume Check — is this event large enough to matter?
    checks.push(this.checkVolume(candidate, features));

    // 2. USD Value Check
    checks.push(this.checkMinValue(candidate));

    // 3. Lifetime Check (for walls and icebergs)
    if (['BUY_WALL', 'SELL_WALL', 'ICEBERG'].includes(candidate.type)) {
      checks.push(this.checkLifetime(candidate));
    }

    // 4. Cancel Ratio Check (for spoof detection validation)
    if (['SPOOF', 'BUY_WALL', 'SELL_WALL'].includes(candidate.type)) {
      checks.push(this.checkCancelRatio(candidate));
    }

    // 5. Fill Ratio Check (walls must have some fills to be real)
    if (['BUY_WALL', 'SELL_WALL'].includes(candidate.type)) {
      checks.push(this.checkFillRatio(candidate));
    }

    // 6. Refill Check (icebergs must have sufficient refills)
    if (candidate.type === 'ICEBERG') {
      checks.push(this.checkRefillCount(candidate));
    }

    // 7. Market Context Check — spread must be normal (not during halt/extreme spread)
    checks.push(this.checkMarketContext(candidate, features));

    // Determine final validity
    const mandatoryPassed = checks.filter(c => !c.passed).length === 0;
    
    // Calculate adjusted confidence
    const avgScore = checks.reduce((sum, c) => sum + c.score, 0) / checks.length;
    const finalConfidence = Math.round(candidate.rawConfidence * avgScore);

    return {
      ...candidate,
      checks,
      isValid: mandatoryPassed,
      finalConfidence: Math.min(99, finalConfidence)
    };
  }

  private checkVolume(candidate: CandidateEvent, features: FeatureSnapshot): ValidationCheckResult {
    // For WHALE type, it's already filtered by whaleFloor in the detector
    if (candidate.type === 'WHALE') {
      return { name: 'volume', passed: true, score: 1.0, detail: 'Whale already filtered by floor' };
    }
    
    const passed = candidate.usdValue >= this.config.minUsdValue;
    return {
      name: 'volume',
      passed,
      score: passed ? Math.min(1, candidate.usdValue / (this.config.minUsdValue * 5)) : 0.2,
      detail: `USD value: $${candidate.usdValue.toFixed(0)}, min: $${this.config.minUsdValue}`
    };
  }

  private checkMinValue(candidate: CandidateEvent): ValidationCheckResult {
    const passed = candidate.usdValue >= this.config.minUsdValue;
    return {
      name: 'minValue',
      passed,
      score: passed ? 1.0 : 0.0,
      detail: `$${candidate.usdValue.toFixed(0)} vs min $${this.config.minUsdValue}`
    };
  }

  private checkLifetime(candidate: CandidateEvent): ValidationCheckResult {
    const lifetimeMs = (candidate.meta.lifetimeMs as number) || 0;
    const passed = lifetimeMs >= this.config.minWallLifetimeMs;
    const score = Math.min(1, lifetimeMs / (this.config.minWallLifetimeMs * 3));
    return {
      name: 'lifetime',
      passed,
      score,
      detail: `Lifetime: ${lifetimeMs}ms, min: ${this.config.minWallLifetimeMs}ms`
    };
  }

  private checkCancelRatio(candidate: CandidateEvent): ValidationCheckResult {
    const cancelCount = (candidate.meta.cancelCount as number) || 0;
    const fillCount = (candidate.meta.fillCount as number) || 0;
    const total = cancelCount + fillCount;
    
    if (total === 0) {
      // No data yet, give benefit of the doubt
      return { name: 'cancelRatio', passed: true, score: 0.5, detail: 'No cancel/fill data yet' };
    }

    const cancelRatio = cancelCount / total;
    
    // For SPOOF type, high cancel ratio CONFIRMS the detection (inverted logic)
    if (candidate.type === 'SPOOF') {
      const passed = cancelRatio > this.config.maxCancelRatio;
      return {
        name: 'cancelRatio',
        passed,
        score: passed ? cancelRatio : 0.3,
        detail: `Cancel ratio: ${(cancelRatio * 100).toFixed(0)}% (spoof confirmation)`
      };
    }

    // For walls, high cancel ratio means it's likely fake
    const passed = cancelRatio <= this.config.maxCancelRatio;
    return {
      name: 'cancelRatio',
      passed,
      score: passed ? (1 - cancelRatio) : 0.1,
      detail: `Cancel ratio: ${(cancelRatio * 100).toFixed(0)}%, max: ${(this.config.maxCancelRatio * 100).toFixed(0)}%`
    };
  }

  private checkFillRatio(candidate: CandidateEvent): ValidationCheckResult {
    const fillCount = (candidate.meta.fillCount as number) || 0;
    const totalFilledQty = (candidate.meta.totalFilledQty as number) || 0;
    
    // Wall must have at least some fills to prove it's absorbing real flow
    const passed = fillCount > 0;
    const score = Math.min(1, fillCount / 5);
    
    return {
      name: 'fillRatio',
      passed,
      score,
      detail: `Fill count: ${fillCount}, filled qty: ${totalFilledQty.toFixed(2)}`
    };
  }

  private checkRefillCount(candidate: CandidateEvent): ValidationCheckResult {
    const refillCount = (candidate.meta.refillCount as number) || 0;
    const passed = refillCount >= this.config.minIcebergRefills;
    return {
      name: 'refill',
      passed,
      score: Math.min(1, refillCount / (this.config.minIcebergRefills * 2)),
      detail: `Refills: ${refillCount}, min: ${this.config.minIcebergRefills}`
    };
  }

  private checkMarketContext(candidate: CandidateEvent, features: FeatureSnapshot): ValidationCheckResult {
    // Check if spread is abnormally wide (market might be halted/illiquid)
    const spreadPct = features.spread / (features.vwap || 1) * 100;
    const normalSpread = spreadPct < 1.0; // If spread > 1% of price, market is unhealthy
    
    return {
      name: 'marketContext',
      passed: normalSpread,
      score: normalSpread ? Math.max(0.5, 1 - spreadPct) : 0.2,
      detail: `Spread: ${spreadPct.toFixed(3)}% ${normalSpread ? '(normal)' : '(wide — suspicious)'}`
    };
  }
}
