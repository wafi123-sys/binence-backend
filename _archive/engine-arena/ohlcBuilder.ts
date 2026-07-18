// ============================================================
// OHLC Builder — Constructs candles purely from executions
// Chart Engine reads ONLY from here, never from Order Book.
// ============================================================

import { OHLCBar, Timeframe, TIMEFRAME_MS } from './types';

export class OHLCBuilder {
  // Map of timeframe → array of completed bars
  private bars: Map<Timeframe, OHLCBar[]> = new Map();
  // Current in-progress bar for each timeframe
  private currentBar: Map<Timeframe, OHLCBar | null> = new Map();

  private onBarUpdate: ((timeframe: Timeframe, bar: OHLCBar) => void) | null = null;

  constructor() {
    const timeframes: Timeframe[] = [
      'tick', '1s', '5s', '15s', '30s', '1m', '5m', '15m', '30m', '1h', '1d', '1w',
    ];
    for (const tf of timeframes) {
      this.bars.set(tf, []);
      this.currentBar.set(tf, null);
    }
  }

  setOnBarUpdate(cb: (timeframe: Timeframe, bar: OHLCBar) => void): void {
    this.onBarUpdate = cb;
  }

  /**
   * Add an execution to the OHLC builder.
   * Updates all timeframes simultaneously.
   */
  addExecution(price: number, volume: number, timestamp: number): void {
    for (const [tf] of this.bars) {
      this.updateTimeframe(tf, price, volume, timestamp);
    }
  }

  /**
   * Get all completed + current bars for a timeframe.
   */
  getBars(timeframe: Timeframe): OHLCBar[] {
    const completed = this.bars.get(timeframe) || [];
    const current = this.currentBar.get(timeframe);
    if (current) {
      return [...completed, current];
    }
    return [...completed];
  }

  seedHistoricalData(tf: Timeframe, data: OHLCBar[]): void {
    this.bars.set(tf, data);
  }

  /**
   * Get all bars as a map of timeframe → OHLCBar[].
   */
  getAllBars(): Record<Timeframe, OHLCBar[]> {
    const result: Partial<Record<Timeframe, OHLCBar[]>> = {};
    for (const [tf] of this.bars) {
      result[tf] = this.getBars(tf);
    }
    return result as Record<Timeframe, OHLCBar[]>;
  }

  // ── Private Methods ──────────────────────────────────────────

  private updateTimeframe(tf: Timeframe, price: number, volume: number, timestamp: number): void {
    if (tf === 'tick') {
      // Every execution is its own bar
      const tickBar: OHLCBar = {
        time: Math.floor(timestamp / 1000),
        open: price,
        high: price,
        low: price,
        close: price,
        volume,
      };
      const bars = this.bars.get(tf)!;
      // Ensure unique time for tick bars (add small increment)
      if (bars.length > 0 && bars[bars.length - 1].time >= tickBar.time) {
        tickBar.time = bars[bars.length - 1].time + 1;
      }
      bars.push(tickBar);
      this.onBarUpdate?.(tf, tickBar);
      return;
    }

    const periodMs = TIMEFRAME_MS[tf];
    const barTime = Math.floor(timestamp / periodMs) * periodMs;
    const barTimeSec = Math.floor(barTime / 1000); // LW Charts uses seconds

    let current = this.currentBar.get(tf);

    if (current && current.time === barTimeSec) {
      // Update existing bar
      current.high = Math.max(current.high, price);
      current.low = Math.min(current.low, price);
      current.close = price;
      current.volume += volume;
      this.onBarUpdate?.(tf, { ...current });
    } else {
      // Close previous bar if exists
      if (current) {
        this.bars.get(tf)!.push({ ...current });
      }

      // Open new bar
      const newBar: OHLCBar = {
        time: barTimeSec,
        open: price,
        high: price,
        low: price,
        close: price,
        volume,
      };
      this.currentBar.set(tf, newBar);
      this.onBarUpdate?.(tf, { ...newBar });
    }
  }
}
