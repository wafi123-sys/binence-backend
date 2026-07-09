// ============================================================
// Market State — Single source of truth for all market data
// All UI components read from here. Nothing writes directly.
// ============================================================

import {
  OrderBookLevel,
  RunningTrade,
  MarketSnapshot,
  OrderSide,
} from './types';

const MAX_RUNNING_TRADES = 200;

export class MarketState {
  private _lastPrice: number = 0;
  private _lastVolume: number = 0;
  private _lastSide: OrderSide | null = null;
  private _runningTrades: RunningTrade[] = [];

  // Order book levels are updated externally by the engine orchestrator
  private _asks: OrderBookLevel[] = [];
  private _bids: OrderBookLevel[] = [];

  // ── Getters ──────────────────────────────────────────────

  get lastPrice(): number {
    return this._lastPrice;
  }

  get lastVolume(): number {
    return this._lastVolume;
  }

  get lastSide(): OrderSide | null {
    return this._lastSide;
  }

  get runningTrades(): RunningTrade[] {
    return this._runningTrades;
  }

  get asks(): OrderBookLevel[] {
    return this._asks;
  }

  get bids(): OrderBookLevel[] {
    return this._bids;
  }

  // ── Updates ──────────────────────────────────────────────

  updateLastPrice(price: number, volume: number, side: OrderSide): void {
    this._lastPrice = price;
    this._lastVolume = volume;
    this._lastSide = side;
  }

  addRunningTrade(trade: RunningTrade): void {
    this._runningTrades.unshift(trade);
    if (this._runningTrades.length > MAX_RUNNING_TRADES) {
      this._runningTrades = this._runningTrades.slice(0, MAX_RUNNING_TRADES);
    }
  }

  updateOrderBook(asks: OrderBookLevel[], bids: OrderBookLevel[]): void {
    this._asks = asks;
    this._bids = bids;
  }

  /**
   * Get a full snapshot of the market state (for new clients).
   */
  getSnapshot(): MarketSnapshot {
    return {
      asks: this._asks.map((l) => ({ ...l, orders: [...l.orders] })),
      bids: this._bids.map((l) => ({ ...l, orders: [...l.orders] })),
      lastPrice: this._lastPrice,
      lastVolume: this._lastVolume,
      lastSide: this._lastSide,
      runningTrades: [...this._runningTrades],
    };
  }
}
