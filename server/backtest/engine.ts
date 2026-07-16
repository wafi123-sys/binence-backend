// ============================================================
// BacktestEngine — Event-driven replay engine for order-flow strategies.
//
// Strictly processes events in chronological order (no-lookahead).
// Uses WhaleDetectorCore (same logic as live) to evaluate signals.
// Supports: Verified Wall Bounce, CVD Divergence Fade, Composite Trust
// ============================================================

import { TimelineEvent, RawTradeLog, SnapshotLog, BacktestPosition, BacktestTrade, BacktestResult, ExecutionAssumptions, DEFAULT_EXEC, OpenPositionInfo } from './types';
import { WhaleDetectorCore, WhaleEvent } from './whaleDetectorCore';

// ─── Scalping Indicators Tracker ──────────────────────────────
export interface OHLC {
  open: number;
  high: number;
  low: number;
  close: number;
  time: number;
}

export interface ScalpingIndicators {
  haClose: number;
  fastEMA: number;
  mediumEMA: number;
  pacC: number;
  pacU: number;
  pacL: number;
  trendDirection: 1 | -1 | 0;
  pacExitU: boolean;
  pacExitL: boolean;
}

export class IndicatorTracker {
  private currentCandle: OHLC | null = null;
  private prevHA: OHLC | null = null;
  
  private fastEMA = 0;
  private mediumEMA = 0;
  private pacC = 0;
  private pacU = 0;
  private pacL = 0;

  private barsSinceBelowPacC = 999;
  private barsSinceAbovePacC = 999;
  
  private readonly INTERVAL: number;
  private initialized = false;

  constructor(intervalMs: number = 60000) {
    this.INTERVAL = intervalMs;
  }

  public indicators: ScalpingIndicators = {
    haClose: 0, fastEMA: 0, mediumEMA: 0, pacC: 0, pacU: 0, pacL: 0,
    trendDirection: 0, pacExitU: false, pacExitL: false
  };

  public ingestPrice(price: number, time: number) {
    const candleTime = Math.floor(time / this.INTERVAL) * this.INTERVAL;

    if (!this.currentCandle) {
      this.currentCandle = { open: price, high: price, low: price, close: price, time: candleTime };
      return;
    }

    if (candleTime > this.currentCandle.time) {
      this.closeCandle();
      this.currentCandle = { open: price, high: price, low: price, close: price, time: candleTime };
    } else {
      this.currentCandle.close = price;
      if (price > this.currentCandle.high) this.currentCandle.high = price;
      if (price < this.currentCandle.low) this.currentCandle.low = price;
    }
  }

  private closeCandle() {
    const c = this.currentCandle!;
    let haOpen = c.open;
    if (this.prevHA) {
      haOpen = (this.prevHA.open + this.prevHA.close) / 2;
    }
    const haClose = (c.open + c.high + c.low + c.close) / 4;
    const haHigh = Math.max(c.high, haOpen, haClose);
    const haLow = Math.min(c.low, haOpen, haClose);
    
    if (!this.initialized) {
      this.fastEMA = haClose;
      this.mediumEMA = haClose;
      this.pacC = haClose;
      this.pacU = haHigh;
      this.pacL = haLow;
      this.initialized = true;
    } else {
      this.fastEMA = this.calcEma(haClose, this.fastEMA, 89);
      this.mediumEMA = this.calcEma(haClose, this.mediumEMA, 200);
      this.pacC = this.calcEma(haClose, this.pacC, 34);
      this.pacU = this.calcEma(haHigh, this.pacU, 34);
      this.pacL = this.calcEma(haLow, this.pacL, 34);
    }

    if (haClose < this.pacC) {
      this.barsSinceBelowPacC = 0;
    } else {
      this.barsSinceBelowPacC++;
    }
    
    if (haClose > this.pacC) {
      this.barsSinceAbovePacC = 0;
    } else {
      this.barsSinceAbovePacC++;
    }

    let trendDirection: 1 | -1 | 0 = 0;
    if (this.fastEMA > this.mediumEMA && this.pacL > this.mediumEMA) trendDirection = 1;
    else if (this.fastEMA < this.mediumEMA && this.pacU < this.mediumEMA) trendDirection = -1;

    const pacExitU = haOpen < this.pacU && haClose > this.pacU && this.barsSinceBelowPacC <= 3;
    const pacExitL = haOpen > this.pacL && haClose < this.pacL && this.barsSinceAbovePacC <= 3;

    this.indicators = {
      haClose,
      fastEMA: this.fastEMA,
      mediumEMA: this.mediumEMA,
      pacC: this.pacC,
      pacU: this.pacU,
      pacL: this.pacL,
      trendDirection,
      pacExitU,
      pacExitL
    };

    this.prevHA = { open: haOpen, high: haHigh, low: haLow, close: haClose, time: c.time };
  }

  private calcEma(price: number, prev: number, length: number): number {
    const k = 2 / (length + 1);
    return price * k + prev * (1 - k);
  }
}

// ─── Strategy Signal Types ────────────────────────────────────
export interface StrategySignals {
  whaleEvent: WhaleEvent | null;
  trust: ReturnType<WhaleDetectorCore['computeCompositeTrust']>;
  indicators: ScalpingIndicators;
  lastPrice: number;
  time: number;
}

export type EntryFn = (signals: StrategySignals) => 'long' | 'short' | null;
export type ExitFn  = (pos: BacktestPosition, signals: StrategySignals) => boolean;

export interface StrategyConfig {
  name: string;
  slPct: number;       // stop loss %
  tpPct: number;       // take profit %
  timeLimitMs?: number; // time-stop (close position after N ms if no TP/SL)
  entryFn: EntryFn;
  exitFn?: ExitFn;     // optional custom exit logic
  allowShort?: boolean;
}

// ─── Built-in Strategies ─────────────────────────────────────
export const STRATEGY_VERIFIED_WALL_BOUNCE: StrategyConfig = {
  name: 'Verified Wall Bounce',
  slPct: 1.5,
  tpPct: 3.0,
  timeLimitMs: 15 * 60 * 1000, // 15 min time-stop
  allowShort: false,
  entryFn: (s) => {
    // Entry LONG: Whale BUY single/split + trust bullish >= 60 confidence
    if (
      s.whaleEvent &&
      (s.whaleEvent.side === 'buy' || s.whaleEvent.side === 'bid') &&
      s.trust.confidence >= 60 &&
      s.trust.direction === 'bullish'
    ) return 'long';
    return null;
  },
};

export const STRATEGY_CVD_DIVERGENCE_FADE: StrategyConfig = {
  name: 'CVD Divergence Fade',
  slPct: 1.0,
  tpPct: 2.0,
  timeLimitMs: 10 * 60 * 1000,
  allowShort: true,
  entryFn: (s) => {
    // SHORT when buyPressure is heavily dominant but trust direction flips bearish
    // (this approximates a CVD divergence: price might look bullish but whale flow is mixed)
    const { buyPressure, sellPressure, direction } = s.trust;
    const total = buyPressure + sellPressure || 1;
    const buyRatio = buyPressure / total;

    // Fade: buy pressure >65% but composite direction says bearish (divergence)
    if (buyRatio > 0.65 && direction === 'bearish' && s.trust.confidence >= 55) return 'short';
    // Converse: sell pressure >65% but direction bullish
    if (buyRatio < 0.35 && direction === 'bullish' && s.trust.confidence >= 55) return 'long';
    return null;
  },
};

export const STRATEGY_COMPOSITE_TRUST: StrategyConfig = {
  name: 'Composite Trust Confirmed',
  slPct: 2.0,
  tpPct: 4.0,
  timeLimitMs: 20 * 60 * 1000,
  allowShort: true,
  entryFn: (s) => {
    if (s.trust.confidence < 70) return null;
    if (s.trust.direction === 'bullish') return 'long';
    if (s.trust.direction === 'bearish') return 'short';
    return null;
  },
  exitFn: (pos, s) => {
    // Exit when confidence drops below 30 (signal collapse)
    return s.trust.confidence < 30;
  },
};

export const STRATEGY_SCALPING_PULLBACK: StrategyConfig = {
  name: 'Scalping PullBack R1.1',
  slPct: 0.5,
  tpPct: 1.0,
  timeLimitMs: 15 * 60 * 1000,
  allowShort: true,
  entryFn: (s) => {
    // Pine Script Strategy entries without Whale Event dependency
    if (s.indicators.trendDirection === 1 && s.indicators.pacExitU) return 'long';
    if (s.indicators.trendDirection === -1 && s.indicators.pacExitL) return 'short';
    return null;
  },
  exitFn: (pos, s) => {
    // Exit when price crosses center of PAC channel in opposite direction
    if (pos.side === 'long' && s.indicators.haClose < s.indicators.pacC) return true;
    if (pos.side === 'short' && s.indicators.haClose > s.indicators.pacC) return true;
    return false;
  }
};

export const ALL_STRATEGIES = [
  STRATEGY_VERIFIED_WALL_BOUNCE,
  STRATEGY_CVD_DIVERGENCE_FADE,
  STRATEGY_COMPOSITE_TRUST,
  STRATEGY_SCALPING_PULLBACK,
];

// ─── Core Engine ─────────────────────────────────────────────
export class BacktestEngine {
  private detector: WhaleDetectorCore;
  private exec: ExecutionAssumptions;

  constructor(exec: ExecutionAssumptions = DEFAULT_EXEC) {
    this.detector = new WhaleDetectorCore();
    this.exec = exec;
  }

  /**
   * Run a single strategy over a given timeline.
   * STRICT NO-LOOKAHEAD: events are processed in order, signals only use
   * state that has been built up to the current event time.
   */
  public async run(
    symbol: string,
    timeline: TimelineEvent[],
    strategy: StrategyConfig,
    startingCapital: number = 10_000,
    intervalStr: string = '1m'
  ): Promise<BacktestResult> {
    this.detector.reset();

    let intervalMs = 60000;
    if (intervalStr === '3m') intervalMs = 180000;
    else if (intervalStr === '5m') intervalMs = 300000;
    else if (intervalStr === '15m') intervalMs = 900000;
    else if (intervalStr === '1h') intervalMs = 3600000;
    else if (intervalStr === '4h') intervalMs = 14400000;
    else if (intervalStr === '1d') intervalMs = 86400000;

    const sym = symbol.toLowerCase();
    const trades: BacktestTrade[] = [];
    const equity: { time: number; value: number }[] = [];
    let balance = startingCapital;
    let position: BacktestPosition | null = null;
    let lastPrice = 0;

    const feeRate = (this.exec.takerFeeBps / 10_000); // bps → fraction
    const slipRate = (this.exec.slippageBps / 10_000);

    const indicatorTracker = new IndicatorTracker(intervalMs);

    for (const event of timeline) {
      let whaleEvent: WhaleEvent | null = null;

      if (event.type === 'trade') {
        const raw = event.data as RawTradeLog;
        const price = parseFloat(raw.p);
        const qty   = parseFloat(raw.q);
        const time  = raw.T || raw.local_time;
        lastPrice = price;

        indicatorTracker.ingestPrice(price, event.time);

        // Feed to detector — identical logic to live WhaleTracker
        whaleEvent = this.detector.ingestAggTrade(sym, price, qty, raw.m, time);

        // Check SL/TP for existing position using this tick price
        if (position) {
          const closeResult = this.checkSlTp(position, price, event.time, strategy);
          if (closeResult) {
            const t = this.closePosition(position, closeResult.price, event.time, closeResult.reason, feeRate, slipRate);
            balance += t.netPnl;
            trades.push(t);
            position = null;
            equity.push({ time: event.time, value: balance });
            continue; // no new entry on same tick
          }

          // Time-stop check
          if (strategy.timeLimitMs && event.time - position.entryTime > strategy.timeLimitMs) {
            const t = this.closePosition(position, price, event.time, 'EOD', feeRate, slipRate);
            balance += t.netPnl;
            trades.push(t);
            position = null;
            equity.push({ time: event.time, value: balance });
            continue;
          }
        }

        // Evaluate strategy entry
        // NOTE: Strategy Scalping Pullback uses indicators only, so we allow entry even if whaleEvent is null
        if (!position) {
          const trust = this.detector.computeCompositeTrust(sym, event.time);
          const signals: StrategySignals = { 
            whaleEvent, 
            trust, 
            indicators: indicatorTracker.indicators, 
            lastPrice: price, 
            time: event.time 
          };
          const entrySide = strategy.entryFn(signals);

          if (entrySide && (entrySide === 'long' || strategy.allowShort)) {
            // Simulate latency: we use the current tick price (already past latencyMs in replay time)
            const execPrice = price * (1 + (entrySide === 'long' ? slipRate : -slipRate));
            const entryFee = balance * feeRate;
            const effectiveCapital = balance - entryFee;
            position = {
              side: entrySide,
              entryPrice: execPrice,
              entryTime: event.time,
              qty: effectiveCapital / execPrice,
              cost: effectiveCapital,
              strategyName: strategy.name,
            };
          }
        }

      } else if (event.type === 'snapshot') {
        const snap = event.data as SnapshotLog;
        this.detector.ingestSnapshot(sym, snap.b, snap.a);

        // Check custom exitFn (e.g. Composite Trust confidence drop)
        if (position && strategy.exitFn) {
          const trust = this.detector.computeCompositeTrust(sym, event.time);
          const signals: StrategySignals = { 
            whaleEvent: null, 
            trust, 
            indicators: indicatorTracker.indicators, 
            lastPrice, 
            time: event.time 
          };
          if (strategy.exitFn(position, signals)) {
            const t = this.closePosition(position, lastPrice, event.time, 'Strategy', feeRate, slipRate);
            balance += t.netPnl;
            trades.push(t);
            position = null;
            equity.push({ time: event.time, value: balance });
          }
        }
      }

      equity.push({ time: event.time, value: balance + this.markToMarket(position, lastPrice) });
    }

    // Track any remaining open position (DON'T force-close it)
    let openPosition: OpenPositionInfo | null = null;
    if (position && lastPrice > 0) {
      const floatingPnl = this.markToMarket(position, lastPrice);
      const cost = position.entryPrice * position.qty;
      openPosition = {
        side: position.side,
        entryPrice: position.entryPrice,
        entryTime: position.entryTime,
        currentPrice: lastPrice,
        floatingPnl,
        floatingPct: cost > 0 ? (floatingPnl / cost * 100) : 0,
        strategyName: position.strategyName,
      };
      // Include floating PNL in final equity point
      equity.push({ time: timeline[timeline.length - 1].time, value: balance + floatingPnl });
    }

    return this.buildResult(strategy.name, symbol, timeline, startingCapital, balance, trades, equity, openPosition);
  }

  // ─── Helpers ──────────────────────────────────────────────
  private markToMarket(pos: BacktestPosition | null, lastPrice: number): number {
    if (!pos || lastPrice === 0) return 0;
    return pos.side === 'long'
      ? (lastPrice - pos.entryPrice) * pos.qty
      : (pos.entryPrice - lastPrice) * pos.qty;
  }

  private checkSlTp(
    pos: BacktestPosition,
    price: number,
    time: number,
    strategy: StrategyConfig
  ): { price: number; reason: 'SL' | 'TP' } | null {
    if (pos.side === 'long') {
      const sl = pos.entryPrice * (1 - strategy.slPct / 100);
      const tp = pos.entryPrice * (1 + strategy.tpPct / 100);
      if (price <= sl) return { price: sl, reason: 'SL' };
      if (price >= tp) return { price: tp, reason: 'TP' };
    } else {
      const sl = pos.entryPrice * (1 + strategy.slPct / 100);
      const tp = pos.entryPrice * (1 - strategy.tpPct / 100);
      if (price >= sl) return { price: sl, reason: 'SL' };
      if (price <= tp) return { price: tp, reason: 'TP' };
    }
    return null;
  }

  private closePosition(
    pos: BacktestPosition,
    exitPrice: number,
    exitTime: number,
    reason: BacktestTrade['exitReason'],
    feeRate: number,
    slipRate: number
  ): BacktestTrade {
    const effExit = exitPrice * (1 + (pos.side === 'long' ? -slipRate : slipRate));
    const grossPnl = pos.side === 'long'
      ? (effExit - pos.entryPrice) * pos.qty
      : (pos.entryPrice - effExit) * pos.qty;
    const exitFee = effExit * pos.qty * feeRate;
    const netPnl = grossPnl - exitFee;
    const cost = pos.entryPrice * pos.qty;
    return {
      side: pos.side,
      entryPrice: pos.entryPrice,
      exitPrice: effExit,
      entryTime: pos.entryTime,
      exitTime,
      grossPnl,
      netPnl,
      pct: cost > 0 ? (netPnl / cost * 100) : 0,
      feePaid: exitFee,
      exitReason: reason,
      strategyName: pos.strategyName,
    };
  }

  private buildResult(
    name: string,
    symbol: string,
    timeline: TimelineEvent[],
    startCap: number,
    finalBal: number,
    trades: BacktestTrade[],
    equity: { time: number; value: number }[],
    openPosition: OpenPositionInfo | null = null
  ): BacktestResult {
    const wins = trades.filter(t => t.netPnl > 0);
    const losses = trades.filter(t => t.netPnl <= 0);
    const totalWin = wins.reduce((s, t) => s + t.netPnl, 0);
    const totalLoss = Math.abs(losses.reduce((s, t) => s + t.netPnl, 0));

    // Sharpe ratio (simplified, daily-like approximation)
    const returns = trades.map(t => t.pct / 100);
    const meanR = returns.reduce((a, b) => a + b, 0) / (returns.length || 1);
    const stdR = Math.sqrt(returns.reduce((a, b) => a + (b - meanR) ** 2, 0) / (returns.length || 1));
    const sharpe = stdR > 0 ? (meanR / stdR) * Math.sqrt(252) : 0;

    // Max drawdown
    let maxDD = 0, peak = startCap;
    for (const e of equity) {
      if (e.value > peak) peak = e.value;
      const dd = (peak - e.value) / peak * 100;
      if (dd > maxDD) maxDD = dd;
    }

    return {
      strategyName: name,
      symbol: symbol.toUpperCase(),
      startTime: timeline[0]?.time ?? 0,
      endTime: timeline[timeline.length - 1]?.time ?? 0,
      totalTrades: trades.length,
      wins: wins.length,
      losses: losses.length,
      winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
      netReturn: finalBal - startCap,
      netReturnPct: (finalBal - startCap) / startCap * 100,
      maxDrawdown: maxDD,
      profitFactor: totalLoss > 0 ? totalWin / totalLoss : Infinity,
      avgWin: wins.length ? totalWin / wins.length : 0,
      avgLoss: losses.length ? totalLoss / losses.length : 0,
      sharpeRatio: sharpe,
      trades,
      equity,
      openPosition,
    };
  }
}
