// ============================================================
// Account Engine V2.0 — Professional Stock Trading Logic
//
// SINGLE SOURCE OF TRUTH for all account data.
// Cash Balance ONLY changes on Execution (BUY fill / SELL fill).
// Order Book, Chart, Running Trade CANNOT change balance.
//
// 1 Lot = 100 Shares
// Value = Price × Lots × 100
//
// Example flow:
//   Initial Balance: 10,000
//   BUY 50 lot @ 50 → Cash = 10,000 - (50 × 50 × 100) = -240,000? No...
//   Simplified: BUY costs 2,500 → Cash = 7,500
//   Position grows from 2,500 to 4,000 → SELL → Cash = 7,500 + 4,000 = 11,500
//   Realized PnL = 4,000 - 2,500 = +1,500
// ============================================================

import { OrderSide } from './types';

export interface AccountState {
  // ── Starting Point ──────────────────────────────────────
  initialBalance: number;     // Never changes, used for Return %

  // ── Cash ────────────────────────────────────────────────
  cashBalance: number;        // Real cash. Changes ONLY on BUY/SELL execution
  activeBalance: number;      // Cash reserved by pending BUY orders (NOT deducted from cashBalance)
  availableBalance: number;   // cashBalance - activeBalance

  // ── Position ────────────────────────────────────────────
  stockPosition: number;      // Lots currently held
  avgBuyPrice: number;        // Weighted average cost per share

  // ── Portfolio & Equity ──────────────────────────────────
  portfolioValue: number;     // lastPrice × position × 100
  totalEquity: number;        // cashBalance + portfolioValue

  // ── PnL ─────────────────────────────────────────────────
  unrealizedPnL: number;      // (lastPrice - avgBuyPrice) × position × 100
  realizedPnL: number;        // Cumulative realized PnL from sells (statistic ONLY, not added to cash)

  // ── Performance ─────────────────────────────────────────
  returnPct: number;          // (totalEquity - initialBalance) / initialBalance × 100

  // ── Trade Counters ──────────────────────────────────────
  totalTrades: number;        // Total execution count (buy fills + sell fills)
  totalBought: number;        // Lifetime lots bought
  totalSold: number;          // Lifetime lots sold
  winTrade: number;           // Sell executions where PnL > 0
  lossTrade: number;          // Sell executions where PnL < 0
  winRate: number;            // winTrade / (winTrade + lossTrade) × 100
}

export function makeInitialAccount(initialBalance: number): AccountState {
  return {
    initialBalance,
    cashBalance: initialBalance,
    activeBalance: 0,
    availableBalance: initialBalance,
    stockPosition: 0,
    avgBuyPrice: 0,
    portfolioValue: 0,
    totalEquity: initialBalance,
    unrealizedPnL: 0,
    realizedPnL: 0,
    returnPct: 0,
    totalTrades: 0,
    totalBought: 0,
    totalSold: 0,
    winTrade: 0,
    lossTrade: 0,
    winRate: 0,
  };
}

export class AccountEngine {
  private state: AccountState;
  private lastKnownPrice: number = 0;

  // ── Internal tracking maps ────────────────────────────────
  // orderId → reserved cash amount (for pending BUY orders)
  readonly pendingBuyReserves: Map<string, number> = new Map();
  // orderId → reserved lot count (for pending SELL orders)
  readonly pendingSellReserves: Map<string, number> = new Map();
  // orderId → cumulative filled qty so far (for delta tracking on passive fills)
  readonly filledSoFar: Map<string, number> = new Map();

  constructor(initialBalance: number) {
    this.state = makeInitialAccount(initialBalance);
  }

  // ── Read ────────────────────────────────────────────────────

  getState(): AccountState {
    return { ...this.state };
  }

  getAvailableBalance(): number {
    return this.state.availableBalance;
  }

  getPosition(): number {
    return this.state.stockPosition;
  }

  getAvgBuyPrice(): number {
    return this.state.avgBuyPrice;
  }

  // ── Inject Position (for bots only) ─────────────────────────

  injectPosition(lots: number, avgPrice: number): void {
    const s = this.state;
    if (s.stockPosition > 0) {
      const totalCost = s.avgBuyPrice * s.stockPosition + avgPrice * lots;
      s.stockPosition += lots;
      s.avgBuyPrice = totalCost / s.stockPosition;
    } else {
      s.stockPosition = lots;
      s.avgBuyPrice = avgPrice;
    }
    this.recalcDerived(avgPrice);
  }

  // ── Order Placement (Reserve) ──────────────────────────────
  //
  // These do NOT touch cashBalance. They only track what's
  // committed so we can compute availableBalance.

  /**
   * Reserve cash for a BUY order.
   * Does NOT deduct cashBalance. Only increases activeBalance.
   * Returns false if availableBalance is insufficient.
   */
  reserveForBuy(orderId: string, reservePrice: number, lots: number): boolean {
    const required = reservePrice * lots * 100;
    if (required > this.state.availableBalance) return false;

    this.pendingBuyReserves.set(orderId, (this.pendingBuyReserves.get(orderId) ?? 0) + required);
    this.recalcActiveBalance();
    return true;
  }

  /**
   * Reserve position for a SELL order.
   * Does NOT touch position count. Only tracks the commitment.
   * Returns false if position is insufficient.
   */
  reserveForSell(orderId: string, lots: number): boolean {
    const totalReserved = this.getTotalSellReserved();
    const availablePosition = this.state.stockPosition - totalReserved;
    if (lots > availablePosition) return false;

    this.pendingSellReserves.set(orderId, (this.pendingSellReserves.get(orderId) ?? 0) + lots);
    return true;
  }

  /**
   * Check if a BUY can be afforded (without actually reserving).
   */
  canAffordBuy(price: number, lots: number): boolean {
    return (price * lots * 100) <= this.state.availableBalance;
  }

  /**
   * Check if a SELL can be covered (without actually reserving).
   */
  canAffordSell(lots: number): boolean {
    const totalReserved = this.getTotalSellReserved();
    return lots <= (this.state.stockPosition - totalReserved);
  }

  // ── Execution Handlers ─────────────────────────────────────
  //
  // These are the ONLY methods that change cashBalance and position.

  /**
   * Called when a BUY order is filled (partially or fully).
   *
   * cashBalance -= fillPrice × fillLots × 100
   * position += fillLots
   * avgBuyPrice = weighted average
   * activeBalance -= consumed reserve
   */
  onBuyExecution(
    orderId: string,
    fillPrice: number,
    fillLots: number,
    lastPrice: number
  ): void {
    const s = this.state;
    const fillValue = fillPrice * fillLots * 100;

    // 1. Deduct cash
    s.cashBalance -= fillValue;

    // 2. Reduce the pending reserve for this order
    const currentReserve = this.pendingBuyReserves.get(orderId) ?? 0;
    const reserveConsumed = fillValue;
    const remaining = Math.max(0, currentReserve - reserveConsumed);
    if (remaining <= 0) {
      this.pendingBuyReserves.delete(orderId);
    } else {
      this.pendingBuyReserves.set(orderId, remaining);
    }

    // 3. Update position with weighted average
    const prevCost = s.avgBuyPrice * s.stockPosition;
    s.stockPosition += fillLots;
    s.avgBuyPrice = s.stockPosition > 0
      ? (prevCost + fillPrice * fillLots) / s.stockPosition
      : 0;

    // 4. Update counters
    s.totalBought += fillLots;
    s.totalTrades += 1;

    // 5. Track fill delta
    this.filledSoFar.set(orderId, (this.filledSoFar.get(orderId) ?? 0) + fillLots);

    this.lastKnownPrice = lastPrice;
    this.recalcActiveBalance();
    this.recalcDerived(lastPrice);
  }

  /**
   * Called when a SELL order is filled (partially or fully).
   *
   * cashBalance += fillPrice × fillLots × 100
   * position -= fillLots
   * realizedPnL += (fillPrice - avgBuyPrice) × fillLots × 100
   */
  onSellExecution(
    orderId: string,
    fillPrice: number,
    fillLots: number,
    lastPrice: number
  ): void {
    const s = this.state;
    const proceeds = fillPrice * fillLots * 100;

    // 1. Credit cash
    s.cashBalance += proceeds;

    // 2. Reduce pending sell reserve
    const currentReserve = this.pendingSellReserves.get(orderId) ?? 0;
    const remaining = Math.max(0, currentReserve - fillLots);
    if (remaining <= 0) {
      this.pendingSellReserves.delete(orderId);
    } else {
      this.pendingSellReserves.set(orderId, remaining);
    }

    // 3. Calculate realized PnL BEFORE reducing position
    const pnl = (fillPrice - s.avgBuyPrice) * fillLots * 100;
    s.realizedPnL += pnl;

    // 4. Win/Loss tracking per execution
    if (pnl > 0) s.winTrade += 1;
    else if (pnl < 0) s.lossTrade += 1;

    // 5. Reduce position
    s.stockPosition -= fillLots;
    if (s.stockPosition <= 0) {
      s.stockPosition = 0;
      s.avgBuyPrice = 0;
    }

    // 6. Update counters
    s.totalSold += fillLots;
    s.totalTrades += 1;

    // 7. Track fill delta
    this.filledSoFar.set(orderId, (this.filledSoFar.get(orderId) ?? 0) + fillLots);

    this.lastKnownPrice = lastPrice;
    this.recalcDerived(lastPrice);
  }

  // ── Order Cancellation ─────────────────────────────────────

  /**
   * Called when an order is cancelled. Releases reserves.
   * Does NOT touch cashBalance or position.
   */
  onOrderCancelled(orderId: string, side: OrderSide): void {
    if (side === OrderSide.BUY) {
      this.pendingBuyReserves.delete(orderId);
      this.recalcActiveBalance();
    } else {
      this.pendingSellReserves.delete(orderId);
    }
    this.filledSoFar.delete(orderId);
    this.recalcDerived(this.lastKnownPrice);
  }

  /**
   * Called when an order is fully filled. Cleans up tracking maps.
   */
  onOrderCompleted(orderId: string): void {
    this.pendingBuyReserves.delete(orderId);
    this.pendingSellReserves.delete(orderId);
    this.filledSoFar.delete(orderId);
    this.recalcActiveBalance();
  }

  // ── Price Update ───────────────────────────────────────────

  /**
   * Called every time last price changes.
   * Recalculates unrealized PnL, portfolio value, equity, return.
   * Does NOT change cashBalance or position.
   */
  onPriceUpdate(lastPrice: number): void {
    this.lastKnownPrice = lastPrice;
    this.recalcDerived(lastPrice);
  }

  // ── Private Helpers ────────────────────────────────────────

  private recalcActiveBalance(): void {
    let total = 0;
    for (const v of this.pendingBuyReserves.values()) total += v;
    this.state.activeBalance = total;
    this.state.availableBalance = this.state.cashBalance - this.state.activeBalance;
  }

  private getTotalSellReserved(): number {
    let total = 0;
    for (const v of this.pendingSellReserves.values()) total += v;
    return total;
  }

  private recalcDerived(lastPrice: number): void {
    const s = this.state;

    // Active & Available
    this.recalcActiveBalance();

    // Portfolio Value = lastPrice × position × 100
    s.portfolioValue = s.stockPosition > 0 && lastPrice > 0
      ? s.stockPosition * lastPrice * 100
      : 0;

    // Total Equity = Cash Balance + Portfolio Value
    s.totalEquity = s.cashBalance + s.portfolioValue;

    // Unrealized PnL = (lastPrice - avgBuyPrice) × position × 100
    s.unrealizedPnL = s.stockPosition > 0 && lastPrice > 0
      ? (lastPrice - s.avgBuyPrice) * s.stockPosition * 100
      : 0;

    // Return % = (totalEquity - initialBalance) / initialBalance × 100
    s.returnPct = s.initialBalance > 0
      ? ((s.totalEquity - s.initialBalance) / s.initialBalance) * 100
      : 0;

    // Win Rate
    const totalDecided = s.winTrade + s.lossTrade;
    s.winRate = totalDecided > 0 ? (s.winTrade / totalDecided) * 100 : 0;
  }
}
