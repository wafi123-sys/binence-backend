// ============================================================
// Engine Orchestrator — Wires all engines together
// Single entry point for the server to interact with.
// ============================================================

import { MatchingEngine } from './matchingEngine';
import { OrderEngine } from './orderEngine';
import { ExecutionEngine } from './executionEngine';
import { MarketState } from './marketState';
import { OHLCBuilder } from './ohlcBuilder';
import { DataManager } from './dataManager';
import { SultanBotEngine } from './sultanBotEngine';
import { SultanBotStats } from './types';
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
  private dataManager: DataManager;
  private botEngine: SultanBotEngine;

  private events: Partial<EngineEvents> = {};

  constructor(basePrice: number = 5000) {
    // Initialize all engines
    this.marketState = new MarketState();
    this.ohlcBuilder = new OHLCBuilder();
    this.dataManager = new DataManager(this.ohlcBuilder);
    this.matchingEngine = new MatchingEngine();
    this.orderEngine = new OrderEngine(this.matchingEngine);
    this.executionEngine = new ExecutionEngine(this.marketState, this.ohlcBuilder);
    this.botEngine = new SultanBotEngine(this.orderEngine, this.matchingEngine, basePrice);

    // Wire up callbacks
    this.matchingEngine.setOnExecution((exec) => {
      this.executionEngine.processExecution(exec);
      this.refreshOrderBook();
      this.botEngine.onPriceUpdate(exec.price);
      this.events.onExecution?.(exec);
      this.events.onRunningTrade?.({
        time: exec.timestamp,
        price: exec.price,
        volume: exec.volume,
        side: exec.aggressor,
      });
    });

    this.matchingEngine.setOnOrderUpdate((order) => {
      this.botEngine.processPassiveFill(
        order.id, 
        order.playerId, 
        order.filledQty, 
        order.price, 
        this.marketState.getSnapshot().lastPrice, 
        order.side, 
        order.status
      );
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
    const hasData = this.dataManager.loadOHLC();
    this.dataManager.startAutoSave(60000);

    this.botEngine.seedOrderBook();
    this.refreshOrderBook();
    this.botEngine.start();

    // Generate simulated historical uptrend for 1W to match user request ONLY if no data loaded
    if (!hasData) {
      const weeklyData: OHLCBar[] = [];
      const weeks = 50;
      let price = 100;
      const endPrice = 300; // bot base price
      const drift = Math.pow(endPrice / price, 1 / weeks);
      const nowSec = Math.floor(Date.now() / 1000);
      const weekSec = 604800;
      
      for (let i = weeks; i > 0; i--) {
        const time = nowSec - (i * weekSec);
        const open = price;
        // Add random volatility on top of drift
        price = price * drift * (1 + (Math.random() - 0.4) * 0.05);
        const close = price;
        const high = Math.max(open, close) * (1 + Math.random() * 0.02);
        const low = Math.min(open, close) * (1 - Math.random() * 0.02);
        weeklyData.push({ time, open, high, low, close, volume: 100 + Math.random() * 1000 });
      }
      
      this.ohlcBuilder.seedHistoricalData('1w', weeklyData);
    }
  }

  /**
   * Stop the engine.
   */
  stop(): void {
    this.botEngine.stop();
    this.dataManager.stopAutoSave();
    this.dataManager.saveOHLC();
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
    return this.matchingEngine.getOrderBookLevels(40);
  }

  /**
   * Get Top 10 Sultan bots leaderboard
   */
  getSultanLeaderboard(): SultanBotStats[] {
    return this.botEngine.getLeaderboard();
  }

  // ── Private Methods ──────────────────────────────────────────

  private refreshOrderBook(): void {
    const { asks, bids } = this.matchingEngine.getOrderBookLevels(40);
    this.marketState.updateOrderBook(asks, bids);
    this.events.onOrderBookUpdate?.(asks, bids);
  }
}

// Re-export types
export * from './types';
