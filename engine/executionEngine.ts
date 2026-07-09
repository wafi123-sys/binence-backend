// ============================================================
// Execution Engine — Processes matched trades
// The ONLY source of trade data. Updates Market State.
// ============================================================

import { Execution, RunningTrade, OrderSide } from './types';
import { MarketState } from './marketState';
import { OHLCBuilder } from './ohlcBuilder';

export class ExecutionEngine {
  private marketState: MarketState;
  private ohlcBuilder: OHLCBuilder;

  constructor(marketState: MarketState, ohlcBuilder: OHLCBuilder) {
    this.marketState = marketState;
    this.ohlcBuilder = ohlcBuilder;
  }

  /**
   * Process an execution from the Matching Engine.
   * This is the ONLY path for trade data to enter the system.
   */
  processExecution(execution: Execution): void {
    // 1. Create a running trade entry
    const trade: RunningTrade = {
      time: execution.timestamp,
      price: execution.price,
      volume: execution.volume,
      side: execution.aggressor,
    };

    // 2. Update Market State with the trade
    this.marketState.addRunningTrade(trade);
    this.marketState.updateLastPrice(
      execution.price,
      execution.volume,
      execution.aggressor
    );

    // 3. Feed the execution to the OHLC Builder (for chart)
    this.ohlcBuilder.addExecution(
      execution.price,
      execution.volume,
      execution.timestamp
    );
  }
}
