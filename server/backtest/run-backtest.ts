#!/usr/bin/env ts-node
// ============================================================
// run-backtest.ts — CLI runner for the Order-Flow Backtest Engine
//
// Usage:
//   npx ts-node server/backtest/run-backtest.ts [symbol] [strategy] [capital]
//
// Examples:
//   npx ts-node server/backtest/run-backtest.ts btcusdt all 10000
//   npx ts-node server/backtest/run-backtest.ts ethusdt wall_bounce 5000
//
// Available strategies: all | wall_bounce | cvd_fade | composite
// ============================================================

import { loadTimeline, DEFAULT_LOG_DIR } from './datasetLoader';
import { BacktestEngine, ALL_STRATEGIES, STRATEGY_VERIFIED_WALL_BOUNCE, STRATEGY_CVD_DIVERGENCE_FADE, STRATEGY_COMPOSITE_TRUST } from './engine';
import { BacktestResult, DEFAULT_EXEC } from './types';

function fmt(n: number, decimals = 2) {
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtTime(ms: number) {
  return new Date(ms).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
}

function printResult(r: BacktestResult) {
  const arrow = r.netReturn >= 0 ? '▲' : '▼';
  const color = r.netReturn >= 0 ? '\x1b[32m' : '\x1b[31m';
  const reset = '\x1b[0m';

  console.log('\n' + '═'.repeat(60));
  console.log(`  📊 ${r.strategyName} — ${r.symbol}`);
  console.log('═'.repeat(60));
  console.log(`  Period:       ${fmtTime(r.startTime)} → ${fmtTime(r.endTime)}`);
  console.log(`  Trades:       ${r.totalTrades} (${r.wins}W / ${r.losses}L)`);
  console.log(`  Win Rate:     ${fmt(r.winRate)}%`);
  console.log(`${color}  Net Return:   ${arrow} $${fmt(Math.abs(r.netReturn))} (${arrow}${fmt(Math.abs(r.netReturnPct))}%)${reset}`);
  console.log(`  Max Drawdown: -${fmt(r.maxDrawdown)}%`);
  console.log(`  Profit Factor:${r.profitFactor === Infinity ? ' ∞' : ' ' + fmt(r.profitFactor)}`);
  console.log(`  Sharpe Ratio: ${fmt(r.sharpeRatio, 3)}`);
  console.log(`  Avg Win:      +$${fmt(r.avgWin)}`);
  console.log(`  Avg Loss:     -$${fmt(r.avgLoss)}`);
  
  if (r.trades.length > 0) {
    console.log('\n  Last 5 Trades:');
    console.log('  ' + '─'.repeat(56));
    const last5 = r.trades.slice(-5);
    for (const t of last5) {
      const pnlColor = t.netPnl >= 0 ? '\x1b[32m' : '\x1b[31m';
      console.log(
        `  ${fmtTime(t.entryTime).split(',')[0]} ` +
        `[${t.side.toUpperCase().padEnd(5)}] ` +
        `${fmt(t.entryPrice)} → ${fmt(t.exitPrice)} ` +
        `| ${pnlColor}${t.netPnl >= 0 ? '+' : ''}$${fmt(t.netPnl)}${reset} ` +
        `[${t.exitReason}]`
      );
    }
  }
  console.log('═'.repeat(60) + '\n');
}

async function main() {
  const args = process.argv.slice(2);
  const symbol   = (args[0] || 'btcusdt').toLowerCase();
  const stratArg = (args[1] || 'all').toLowerCase();
  const capital  = parseFloat(args[2] || '10000');
  const logDir   = process.env.DATA_LOG_DIR || DEFAULT_LOG_DIR;

  console.log('\n🚀 Agnoia Terminal — Order-Flow Backtest Engine');
  console.log(`   Symbol: ${symbol.toUpperCase()}  |  Capital: $${capital.toLocaleString()}`);
  console.log(`   Log Dir: ${logDir}\n`);

  let timeline;
  try {
    timeline = await loadTimeline(logDir, symbol);
  } catch (e: any) {
    console.error('\n❌ Error loading dataset:', e.message);
    console.error('   Make sure the DataLogger has been running and data files exist in:', logDir);
    process.exit(1);
  }

  if (timeline.length < 1000) {
    console.warn(`⚠️  Warning: Only ${timeline.length} events loaded. Results may not be statistically significant.`);
    console.warn('   Recommended: Run DataLogger for at least 1-2 weeks before backtesting.\n');
  }

  const strategies = stratArg === 'all' ? ALL_STRATEGIES
    : stratArg === 'wall_bounce' ? [STRATEGY_VERIFIED_WALL_BOUNCE]
    : stratArg === 'cvd_fade'    ? [STRATEGY_CVD_DIVERGENCE_FADE]
    : stratArg === 'composite'   ? [STRATEGY_COMPOSITE_TRUST]
    : ALL_STRATEGIES;

  const engine = new BacktestEngine(DEFAULT_EXEC);
  const results: BacktestResult[] = [];

  for (const strategy of strategies) {
    console.log(`⏳ Running: ${strategy.name}...`);
    const result = await engine.run(symbol, timeline, strategy, capital);
    results.push(result);
    printResult(result);
  }

  if (results.length > 1) {
    console.log('\n📋 SUMMARY COMPARISON');
    console.log('─'.repeat(72));
    console.log(
      'Strategy'.padEnd(30) +
      'Trades'.padStart(7) +
      'WinRate%'.padStart(10) +
      'Return%'.padStart(10) +
      'MaxDD%'.padStart(8) +
      'Sharpe'.padStart(8)
    );
    console.log('─'.repeat(72));
    for (const r of results) {
      const returnColor = r.netReturnPct >= 0 ? '\x1b[32m' : '\x1b[31m';
      const reset = '\x1b[0m';
      console.log(
        r.strategyName.padEnd(30) +
        String(r.totalTrades).padStart(7) +
        fmt(r.winRate).padStart(10) +
        `${returnColor}${r.netReturnPct >= 0 ? '+' : ''}${fmt(r.netReturnPct)}${reset}`.padStart(18) +
        `-${fmt(r.maxDrawdown)}`.padStart(9) +
        fmt(r.sharpeRatio, 3).padStart(8)
      );
    }
    console.log('─'.repeat(72) + '\n');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
