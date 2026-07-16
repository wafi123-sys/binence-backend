import { BacktestEngine, StrategyConfig } from './engine';
import { ExecutionAssumptions } from './types';

export interface GridSearchRange {
  min: number;
  max: number;
  step: number;
}

export interface GridSearchConfig {
  symbol: string;
  interval: string;
  capital: number;
  baseStrategy: StrategyConfig;
  execAssumptions: ExecutionAssumptions;
  slRange: GridSearchRange;
  tpRange: GridSearchRange;
}

export interface GridSearchResult {
  slPct: number;
  tpPct: number;
  metrics: {
    totalTrades: number;
    winRate: number;
    totalPnL: number;
    maxDrawdown: number;
    profitFactor: number;
  };
  score: number; // custom heuristic score
}

export class GridSearchRunner {
  static async run(config: GridSearchConfig, timeline: any[]): Promise<GridSearchResult[]> {
    const results: GridSearchResult[] = [];
    const engine = new BacktestEngine(config.execAssumptions);

    const slSteps = this.generateSteps(config.slRange);
    const tpSteps = this.generateSteps(config.tpRange);

    // Limit total combinations to prevent memory exhaustion
    const MAX_COMBINATIONS = 200;
    if (slSteps.length * tpSteps.length > MAX_COMBINATIONS) {
      throw new Error(`Grid search combinations (${slSteps.length * tpSteps.length}) exceed maximum allowed (${MAX_COMBINATIONS}). Please narrow your ranges or increase the step size.`);
    }

    for (const sl of slSteps) {
      for (const tp of tpSteps) {
        // Clone strategy with new parameters
        const customStrat: StrategyConfig = {
          ...config.baseStrategy,
          slPct: sl,
          tpPct: tp
        };

        const result = await engine.run(config.symbol, timeline, customStrat, config.capital, config.interval);
        
        // Calculate Profit Factor
        const grossProfit = result.trades.filter(t => t.netPnl > 0).reduce((acc, t) => acc + t.netPnl, 0);
        const grossLoss = Math.abs(result.trades.filter(t => t.netPnl < 0).reduce((acc, t) => acc + t.netPnl, 0)) || 1; // avoid div by 0
        const profitFactor = grossProfit / grossLoss;

        // Custom Score formula: emphasizes consistent profitable trading over just lucky max PnL
        // Score = (Profit Factor * 10) + Win Rate - (Max Drawdown * 100)
        const winRate = result.winRate;
        const maxDrawdown = result.maxDrawdown;
        let score = (profitFactor * 10) + winRate - (maxDrawdown * 100);
        
        // Penalize low trade count (need statistical significance)
        if (result.trades.length < 5) score -= 50;

        results.push({
          slPct: sl,
          tpPct: tp,
          metrics: {
            totalTrades: result.trades.length,
            winRate,
            totalPnL: result.netReturn,
            maxDrawdown,
            profitFactor
          },
          score
        });
      }
    }

    // Sort by descending score
    return results.sort((a, b) => b.score - a.score);
  }

  private static generateSteps(range: GridSearchRange): number[] {
    const steps = [];
    // Handle floating point precision issues in loop
    const stepDecimals = (range.step.toString().split('.')[1] || '').length;
    const factor = Math.pow(10, stepDecimals);
    
    let current = Math.round(range.min * factor);
    const maxVal = Math.round(range.max * factor);
    const stepVal = Math.round(range.step * factor);

    while (current <= maxVal) {
      steps.push(current / factor);
      current += stepVal;
    }
    return steps;
  }
}
