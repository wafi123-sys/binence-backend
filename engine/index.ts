// ============================================================
// Engine Orchestrator — Wires all engines together
// Single entry point for the server to interact with.
// ============================================================

import { MatchingEngine } from './matchingEngine';
import { OrderEngine } from './orderEngine';
import { ExecutionEngine } from './executionEngine';
import { MarketState } from './marketState';
import { OHLCBuilder } from './ohlcBuilder';
import { BotEngine } from './botEngine';
import {
  Execution,
  Order,
  OrderSide,
  OrderType,
  RunningTrade,
  Timeframe,
  OHLCBar,
  MarketSnapshot,
  OrderBookLevel,
} from './types';

export interface EngineEvents {
  onExecution: (exec: Execution) => void;
  onOrderBookUpdate: (asks: OrderBookLevel[], bids: OrderBookLevel[]) => void;
  onRunningTrade: (trade: RunningTrade) => void;
  onOHLCUpdate: (timeframe: Timeframe, bar: OHLCBar) => void;
  onOrderUpdate: (order: Order) => void;
}

export class Engine {
  private matchingEngine: MatchingEngine;
  private orderEngine: OrderEngine;
  private executionEngine: ExecutionEngine;
  private marketState: MarketState;
  private ohlcBuilder: OHLCBuilder;
  private botEngine: BotEngine;

  private events: Partial<EngineEvents> = {};

  constructor(basePrice: number = 5000) {
    // Initialize all engines
    this.marketState = new MarketState();
    this.ohlcBuilder = new OHLCBuilder();
    this.matchingEngine = new MatchingEngine();
    this.orderEngine = new OrderEngine(this.matchingEngine);
    this.executionEngine = new ExecutionEngine(this.marketState, this.ohlcBuilder);
    this.botEngine = new BotEngine(this.orderEngine, this.matchingEngine, basePrice);

    // Wire up callbacks
    this.matchingEngine.setOnExecution((exec) => {
      this.executionEngine.processExecution(exec);
      this.refreshOrderBook();
      this.events.onExecution?.(exec);
      this.events.onRunningTrade?.({
        time: exec.timestamp,
        price: exec.price,
        volume: exec.volume,
        side: exec.aggressor,
      });
    });

    this.matchingEngine.setOnOrderUpdate((order) => {
      this.events.onOrderUpdate?.(order);
    });

    this.ohlcBuilder.setOnBarUpdate((tf, bar) => {
      this.events.onOHLCUpdate?.(tf, bar);
    });
  }

  /**
   * Set event handlers.
   */
  setEvents(events: Partial<EngineEvents>): void {
    this.events = events;
  }

  /**
   * Initialize the engine: seed order book, start bot.
   */
  start(): void {
    this.botEngine.seedOrderBook();
    this.refreshOrderBook();
    this.botEngine.start(800);
  }

  /**
   * Stop the engine.
   */
  stop(): void {
    this.botEngine.stop();
  }

  /**
   * Submit a player order.
   */
  submitOrder(
    playerId: string,
    side: OrderSide,
    orderType: OrderType,
    price: number,
    quantity: number
  ): { order: Order; executions: Execution[] } {
    const result = this.orderEngine.submitOrder(playerId, side, orderType, price, quantity);
    this.refreshOrderBook();
    return result;
  }

  /**
   * Cancel a player order.
   */
  cancelOrder(orderId: string, playerId: string): Order | null {
    const result = this.orderEngine.cancelOrder(orderId, playerId);
    if (result) this.refreshOrderBook();
    return result;
  }

  /**
   * Modify a player order.
   */
  modifyOrder(
    orderId: string,
    playerId: string,
    newPrice?: number,
    newQuantity?: number
  ): { order: Order; executions: Execution[] } | null {
    const result = this.orderEngine.modifyOrder(orderId, playerId, newPrice, newQuantity);
    if (result) this.refreshOrderBook();
    return result;
  }

  /**
   * Get a full market snapshot (for new client connections).
   */
  getSnapshot(): MarketSnapshot {
    return this.marketState.getSnapshot();
  }

  /**
   * Get OHLC data for all timeframes.
   */
  getOHLCData(): Record<Timeframe, OHLCBar[]> {
    return this.ohlcBuilder.getAllBars();
  }

  /**
   * Get current order book levels.
   */
  getOrderBookLevels(): { asks: OrderBookLevel[]; bids: OrderBookLevel[] } {
    return this.matchingEngine.getOrderBookLevels(10);
  }

  // ── Private Methods ──────────────────────────────────────────

  private refreshOrderBook(): void {
    const { asks, bids } = this.matchingEngine.getOrderBookLevels(10);
    this.marketState.updateOrderBook(asks, bids);
    this.events.onOrderBookUpdate?.(asks, bids);
  }
}

// Re-export types
export * from './types';
