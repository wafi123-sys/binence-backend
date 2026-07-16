import { StrategyConfig, EntryFn, ExitFn, StrategySignals, EntryResult, ExitResult } from '../engine';
import { BacktestPosition, TimelineEvent } from '../types';

interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number; }
interface SwingPoint { price: number; time: number; type: 'high' | 'low'; broken: boolean; }

interface SweepCandidate {
  level: SwingPoint;
  sweepTime: number;
  sweepWickPrice: number;
  reclaimConfirmed: boolean;
  reclaimTime?: number;
  reclaimClose?: number;
}

export class LiquiditySweepTracker {
  private htfCandles: Candle[] = [];
  private ltfCandles: Candle[] = [];
  private swingPoints: SwingPoint[] = [];
  private recentSweeps: SweepCandidate[] = [];
  private criteriaLog: Record<string, number> = {};
  
  private currentHTF: Candle | null = null;
  private currentLTF: Candle | null = null;
  
  private readonly HTF_MS = 4 * 60 * 60 * 1000; // 4H
  private readonly LTF_MS = 15 * 60 * 1000;     // 15m
  private readonly RECLAIM_MAX_CANDLES = 3;

  public reset() {
    this.htfCandles = [];
    this.ltfCandles = [];
    this.swingPoints = [];
    this.recentSweeps = [];
    this.criteriaLog = {};
    this.currentHTF = null;
    this.currentLTF = null;
  }

  public getCriteriaLog() {
    return this.criteriaLog;
  }

  private logCriteriaFailure(reason: string) {
    this.criteriaLog[reason] = (this.criteriaLog[reason] || 0) + 1;
  }

  public ingestTick(price: number, qty: number, time: number) {
    this.updateCandle('HTF', price, qty, time, this.HTF_MS);
    this.updateCandle('LTF', price, qty, time, this.LTF_MS);
  }

  private updateCandle(type: 'HTF' | 'LTF', price: number, qty: number, time: number, intervalMs: number) {
    const candleTime = Math.floor(time / intervalMs) * intervalMs;
    let current = type === 'HTF' ? this.currentHTF : this.currentLTF;
    const array = type === 'HTF' ? this.htfCandles : this.ltfCandles;

    if (!current) {
      current = { time: candleTime, open: price, high: price, low: price, close: price, volume: qty };
    } else if (candleTime > current.time) {
      array.push(current);
      if (type === 'HTF') this.updateSwingPoints();
      current = { time: candleTime, open: price, high: price, low: price, close: price, volume: qty };
    } else {
      current.close = price;
      current.volume += qty;
      if (price > current.high) current.high = price;
      if (price < current.low) current.low = price;
    }
    
    if (type === 'HTF') this.currentHTF = current;
    else this.currentLTF = current;
  }

  private updateSwingPoints() {
    if (this.htfCandles.length < 5) return;
    const i = this.htfCandles.length - 3;
    const c = this.htfCandles[i];
    
    const isHigh = c.high > this.htfCandles[i-1].high && c.high > this.htfCandles[i-2].high &&
                   c.high > this.htfCandles[i+1].high && c.high > this.htfCandles[i+2].high;
                   
    const isLow = c.low < this.htfCandles[i-1].low && c.low < this.htfCandles[i-2].low &&
                  c.low < this.htfCandles[i+1].low && c.low < this.htfCandles[i+2].low;

    if (isHigh) this.swingPoints.push({ price: c.high, time: c.time, type: 'high', broken: false });
    if (isLow) this.swingPoints.push({ price: c.low, time: c.time, type: 'low', broken: false });

    // Mark broken swings
    const lastPrice = this.htfCandles[this.htfCandles.length - 1].close;
    for (const sp of this.swingPoints) {
      if (!sp.broken) {
        if (sp.type === 'high' && lastPrice > sp.price) sp.broken = true;
        if (sp.type === 'low' && lastPrice < sp.price) sp.broken = true;
      }
    }
  }

  private getHTFBias(lookback = 20): 'up' | 'down' | 'range' {
    if (this.htfCandles.length < lookback) return 'range';
    const recent = this.htfCandles.slice(-lookback);
    
    let hh = 0, hl = 0, lh = 0, ll = 0;
    for (let i = 2; i < recent.length - 2; i++) {
      const c = recent[i];
      if (c.high > recent[i-1].high && c.high > recent[i-2].high && c.high > recent[i+1].high && c.high > recent[i+2].high) {
        if (hh > 0 && c.high > recent[hh].high) hh++; else hh = 1;
      }
      if (c.low < recent[i-1].low && c.low < recent[i-2].low && c.low < recent[i+1].low && c.low < recent[i+2].low) {
        if (ll > 0 && c.low < recent[ll].low) ll++; else ll = 1;
      }
    }
    if (hh >= 2 && hl >= 2) return 'up';
    if (ll >= 2 && lh >= 2) return 'down';
    return 'range';
  }

  public evaluateEntry(signals: StrategySignals): EntryResult | null {
    if (!this.currentLTF || !this.currentHTF) {
      // Still populate initial ticks
      if (signals.whaleEvent) {
        this.ingestTick(signals.whaleEvent.price, signals.whaleEvent.val, signals.whaleEvent.time);
      } else {
        this.ingestTick(signals.lastPrice, 0, signals.time);
      }
      return null;
    }
    
    // Ingest events to build candle
    if (signals.whaleEvent) {
       this.ingestTick(signals.whaleEvent.price, signals.whaleEvent.val, signals.whaleEvent.time);
    } else {
       this.ingestTick(signals.lastPrice, 0, signals.time);
    }

    const currentCandle = this.currentLTF;
    const price = currentCandle.close;

    // Manage pending sweeps for reclaim
    const pendingSweeps = this.recentSweeps.filter(s => !s.reclaimConfirmed);
    let entrySignal: EntryResult | null = null;

    for (const sweep of pendingSweeps) {
      // Check reclaim
      const candlesAfterSweep = this.ltfCandles.filter(c => c.time > sweep.sweepTime);
      if (candlesAfterSweep.length > this.RECLAIM_MAX_CANDLES) {
        this.logCriteriaFailure('reclaim-timeout');
        sweep.reclaimConfirmed = true; // invalidate it
        continue;
      }

      let reclaimed = false;
      if (sweep.level.type === 'low' && currentCandle.close > sweep.level.price) reclaimed = true;
      if (sweep.level.type === 'high' && currentCandle.close < sweep.level.price) reclaimed = true;

      if (reclaimed) {
        sweep.reclaimConfirmed = true;
        sweep.reclaimTime = currentCandle.time;
        sweep.reclaimClose = currentCandle.close;

        // Check Volume
        const avgVol = this.ltfCandles.slice(-15).reduce((s, c) => s + c.volume, 0) / 15;
        if (currentCandle.volume <= avgVol * 1.3) {
          this.logCriteriaFailure('volume-unconfirmed');
          continue;
        }

        // Check Order Flow Confirmation (using Trust object which includes whale confirmations)
        if (signals.trust.confidence < 60) {
          this.logCriteriaFailure('order-flow-unconfirmed');
          continue;
        }

        const direction = sweep.level.type === 'low' ? 'long' : 'short';
        const wickBuffer = Math.abs(sweep.sweepWickPrice - sweep.level.price) * 0.3;
        const stopLoss = direction === 'long' ? sweep.sweepWickPrice - wickBuffer : sweep.sweepWickPrice + wickBuffer;
        const entryPrice = currentCandle.close;
        const risk = Math.abs(entryPrice - stopLoss);
        
        entrySignal = {
          side: direction,
          entryPrice,
          stopLoss,
          takeProfit: direction === 'long' ? entryPrice + risk : entryPrice - risk,
          confidence: signals.trust.confidence,
          criteria: ['bias', 'key-level-found', 'sweep-detected', 'reclaim-confirmed', 'order-flow-confirmed', 'volume-confirmed']
        };
        break; // take first valid signal
      } else {
        // If it goes further against the sweep, invalidate
        if (sweep.level.type === 'low' && currentCandle.close < sweep.sweepWickPrice) sweep.reclaimConfirmed = true;
        if (sweep.level.type === 'high' && currentCandle.close > sweep.sweepWickPrice) sweep.reclaimConfirmed = true;
      }
    }

    if (entrySignal) return entrySignal;

    // Detect new sweeps
    const bias = this.getHTFBias();
    const activeLevels = this.swingPoints.filter(s => !s.broken && Math.abs(s.price - price) / price < 0.05);

    if (activeLevels.length === 0) {
      this.logCriteriaFailure('no-key-levels');
      return null;
    }

    for (const level of activeLevels) {
      if (bias === 'up' && level.type !== 'low') continue;
      if (bias === 'down' && level.type !== 'high') continue;

      let isSweep = false;
      let wickPrice = price;

      if (level.type === 'low') {
        if (currentCandle.low < level.price && currentCandle.close > level.price) {
           isSweep = true; wickPrice = currentCandle.low;
        }
      } else {
        if (currentCandle.high > level.price && currentCandle.close < level.price) {
           isSweep = true; wickPrice = currentCandle.high;
        }
      }

      if (isSweep) {
        this.recentSweeps.push({
          level,
          sweepTime: currentCandle.time,
          sweepWickPrice: wickPrice,
          reclaimConfirmed: false
        });
      }
    }

    return null;
  }

  public evaluateExit(position: BacktestPosition, signals: StrategySignals): ExitResult {
    if (!this.currentLTF) return false;
    
    // Check partial TP dynamically based on R:R 1:1 if not already taken
    if (!position.partialTaken && position.dynamicTp && position.dynamicSl) {
      const risk = Math.abs(position.entryPrice - position.dynamicSl);
      const tp1 = position.side === 'long' ? position.entryPrice + risk : position.entryPrice - risk;
      
      const hitTP1 = position.side === 'long' ? this.currentLTF.high >= tp1 : this.currentLTF.low <= tp1;
      
      if (hitTP1) {
        position.dynamicSl = position.entryPrice; // move SL to BE
        return { action: 'partial', price: tp1 };
      }
    }

    // Trailing logic (if it makes a new swing in favor)
    if (this.swingPoints.length > 0) {
      const latestSwing = this.swingPoints[this.swingPoints.length - 1];
      if (position.side === 'long' && latestSwing.type === 'low' && latestSwing.price > (position.dynamicSl || 0)) {
        position.dynamicSl = latestSwing.price - (latestSwing.price * 0.001);
      } else if (position.side === 'short' && latestSwing.type === 'high' && latestSwing.price < (position.dynamicSl || Infinity)) {
        position.dynamicSl = latestSwing.price + (latestSwing.price * 0.001);
      }
    }

    return false;
  }
}

let tracker = new LiquiditySweepTracker();

export const STRATEGY_LIQUIDITY_SWEEP: StrategyConfig = {
  name: 'Liquidity Sweep + Reclaim',
  slPct: 2.0, // fallback
  tpPct: 4.0, // fallback
  allowShort: true,
  entryFn: (signals) => tracker.evaluateEntry(signals),
  exitFn: (pos, signals) => tracker.evaluateExit(pos, signals),
  getCriteriaLog: () => tracker.getCriteriaLog()
};

export const resetLiquiditySweepTracker = () => {
  tracker.reset();
};
