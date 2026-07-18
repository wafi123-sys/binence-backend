import { ProbabilityResult, MarketContext, StrategyDecision, FeatureSnapshot } from '../core/types';

export interface Strategy {
  name: string;
  evaluate(probability: ProbabilityResult, context: MarketContext, features: FeatureSnapshot): StrategyDecision;
}

export class TrendFollowingStrategy implements Strategy {
  name = 'Trend Following';

  evaluate(probability: ProbabilityResult, context: MarketContext, features: FeatureSnapshot): StrategyDecision {
    if (probability.neutral > 60 || probability.trap > 20) {
      return { strategyName: this.name, confidence: 0, direction: 'none' };
    }

    if (context.trend === 'UP' && probability.accumulation > 50) {
      return { strategyName: this.name, confidence: probability.accumulation, direction: 'long' };
    }

    if (context.trend === 'DOWN' && probability.distribution > 50) {
      return { strategyName: this.name, confidence: probability.distribution, direction: 'short' };
    }

    return { strategyName: this.name, confidence: 0, direction: 'none' };
  }
}

export class MeanReversionStrategy implements Strategy {
  name = 'Mean Reversion';

  evaluate(probability: ProbabilityResult, context: MarketContext, features: FeatureSnapshot): StrategyDecision {
    // Only trade mean reversion in sideways markets or high volatility spikes
    if (context.trend !== 'SIDEWAYS' && context.volatilityTier !== 'HIGH') {
      return { strategyName: this.name, confidence: 0, direction: 'none' };
    }

    if (probability.trap > 40) {
      // High chance of a trap, fade the breakout
      if (probability.accumulation > probability.distribution) {
        // Fake accumulation (bull trap) -> go short
        return { strategyName: this.name, confidence: probability.trap, direction: 'short' };
      } else {
        // Fake distribution (bear trap) -> go long
        return { strategyName: this.name, confidence: probability.trap, direction: 'long' };
      }
    }

    return { strategyName: this.name, confidence: 0, direction: 'none' };
  }
}
