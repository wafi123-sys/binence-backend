// ============================================================
// Matching Engine — Price-Time Priority (FIFO)
// The core of Order Book Arena. Matches incoming orders against
// the opposite side of the book. Produces Execution objects.
// ============================================================

import {
  Order,
  OrderSide,
  OrderType,
  OrderStatus,
  Execution,
  OrderBookLevel,
  OrderQueueEntry,
} from './types';

/**
 * Internal order stored in the book, sorted by price-time priority.
 */
interface BookOrder {
  id: string;
  side: OrderSide;
  price: number;
  originalQty: number;      // total qty when first placed (never changes)
  remainingQty: number;     // qty still waiting on book
  cumulativeFilled: number; // total qty filled so far (for accurate notifications)
  timestamp: number;
  playerId: string;
}

export class MatchingEngine {
  // Bids sorted: highest price first, then earliest timestamp
  private bids: BookOrder[] = [];
  // Asks sorted: lowest price first, then earliest timestamp
  private asks: BookOrder[] = [];

  // Track all orders by ID for cancel/modify
  private orderMap: Map<string, BookOrder> = new Map();

  // Callback for executions
  private onExecution: ((exec: Execution) => void) | null = null;
  // Callback for order status changes
  private onOrderUpdate: ((order: Order) => void) | null = null;

  private execIdCounter = 0;

  setOnExecution(cb: (exec: Execution) => void): void {
    this.onExecution = cb;
  }

  setOnOrderUpdate(cb: (order: Order) => void): void {
    this.onOrderUpdate = cb;
  }

  /**
   * Submit an order to the matching engine.
   * Market orders match immediately. Limit orders match or rest on the book.
   */
  submitOrder(order: Order): Execution[] {
    const executions: Execution[] = [];

    if (order.type === OrderType.MARKET) {
      this.matchMarketOrder(order, executions);
    } else {
      this.matchLimitOrder(order, executions);
    }

    return executions;
  }

  /**
   * Cancel an order by ID. Returns the cancelled order or null.
   */
  cancelOrder(orderId: string, playerId: string): Order | null {
    const bookOrder = this.orderMap.get(orderId);
    if (!bookOrder || bookOrder.playerId !== playerId) return null;

    if (bookOrder.side === OrderSide.BUY) {
      this.bids = this.bids.filter((o) => o.id !== orderId);
    } else {
      this.asks = this.asks.filter((o) => o.id !== orderId);
    }

    this.orderMap.delete(orderId);

    const cancelled: Order = {
      id: bookOrder.id,
      side: bookOrder.side,
      type: OrderType.LIMIT,
      price: bookOrder.price,
      quantity: bookOrder.remainingQty,    // remaining at cancel time
      filledQty: bookOrder.cumulativeFilled,
      timestamp: bookOrder.timestamp,
      playerId: bookOrder.playerId,
      status: OrderStatus.CANCELLED,
    };

    this.onOrderUpdate?.(cancelled);
    return cancelled;
  }

  /**
   * Get the current order book levels (aggregated by price).
   */
  getOrderBookLevels(depth: number = 10): { asks: OrderBookLevel[]; bids: OrderBookLevel[] } {
    return {
      asks: this.aggregateLevels(this.asks, depth),
      bids: this.aggregateLevels(this.bids, depth),
    };
  }

  getBestBid(): number {
    return this.bids.length > 0 ? this.bids[0].price : 0;
  }

  getBestAsk(): number {
    return this.asks.length > 0 ? this.asks[0].price : 0;
  }

  getOrderCount(): number {
    return this.bids.length + this.asks.length;
  }

  getOrder(orderId: string): BookOrder | undefined {
    return this.orderMap.get(orderId);
  }

  // ── Private Methods ──────────────────────────────────────────

  private matchMarketOrder(order: Order, executions: Execution[]): void {
    let remainingQty = order.quantity - order.filledQty;
    const oppositeSide = order.side === OrderSide.BUY ? this.asks : this.bids;

    while (remainingQty > 0 && oppositeSide.length > 0) {
      const bestOpposite = oppositeSide[0];
      const fillQty = Math.min(remainingQty, bestOpposite.remainingQty);

      const exec = this.createExecution(
        bestOpposite.price,
        fillQty,
        order.side === OrderSide.BUY ? order.id : bestOpposite.id,
        order.side === OrderSide.SELL ? order.id : bestOpposite.id,
        order.side
      );
      executions.push(exec);
      this.onExecution?.(exec);

      remainingQty -= fillQty;
      bestOpposite.cumulativeFilled += fillQty;
      bestOpposite.remainingQty -= fillQty;

      if (bestOpposite.remainingQty <= 0) {
        oppositeSide.shift();
        this.orderMap.delete(bestOpposite.id);
        this.notifyOrderFilled(bestOpposite);
      } else {
        this.notifyOrderPartial(bestOpposite);
      }
    }

    order.filledQty = order.quantity - remainingQty;
    if (remainingQty <= 0) {
      order.status = OrderStatus.FILLED;
    } else {
      order.status = order.filledQty > 0 ? OrderStatus.PARTIAL : OrderStatus.CANCELLED;
    }
    this.onOrderUpdate?.(order);
  }

  private matchLimitOrder(order: Order, executions: Execution[]): void {
    let remainingQty = order.quantity - order.filledQty;
    const oppositeSide = order.side === OrderSide.BUY ? this.asks : this.bids;

    while (remainingQty > 0 && oppositeSide.length > 0) {
      const bestOpposite = oppositeSide[0];

      const pricesCross =
        order.side === OrderSide.BUY
          ? order.price >= bestOpposite.price
          : order.price <= bestOpposite.price;

      if (!pricesCross) break;

      const fillQty = Math.min(remainingQty, bestOpposite.remainingQty);

      const exec = this.createExecution(
        bestOpposite.price,
        fillQty,
        order.side === OrderSide.BUY ? order.id : bestOpposite.id,
        order.side === OrderSide.SELL ? order.id : bestOpposite.id,
        order.side
      );
      executions.push(exec);
      this.onExecution?.(exec);

      remainingQty -= fillQty;
      bestOpposite.cumulativeFilled += fillQty;
      bestOpposite.remainingQty -= fillQty;

      if (bestOpposite.remainingQty <= 0) {
        oppositeSide.shift();
        this.orderMap.delete(bestOpposite.id);
        this.notifyOrderFilled(bestOpposite);
      } else {
        this.notifyOrderPartial(bestOpposite);
      }
    }

    order.filledQty = order.quantity - remainingQty;

    if (remainingQty <= 0) {
      order.status = OrderStatus.FILLED;
      this.onOrderUpdate?.(order);
    } else {
      order.status = order.filledQty > 0 ? OrderStatus.PARTIAL : OrderStatus.NEW;
      this.onOrderUpdate?.(order);

      // Rest remaining on book
      const bookOrder: BookOrder = {
        id: order.id,
        side: order.side,
        price: order.price,
        originalQty: order.quantity,          // full original qty
        remainingQty: remainingQty,
        cumulativeFilled: order.filledQty,    // already filled before resting
        timestamp: order.timestamp,
        playerId: order.playerId,
      };

      this.insertOrder(bookOrder);
    }
  }

  private insertOrder(order: BookOrder): void {
    const list = order.side === OrderSide.BUY ? this.bids : this.asks;

    let lo = 0;
    let hi = list.length;

    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const cmp = this.compareOrders(order, list[mid], order.side);
      if (cmp < 0) {
        hi = mid;
      } else {
        lo = mid + 1;
      }
    }

    list.splice(lo, 0, order);
    this.orderMap.set(order.id, order);
  }

  private compareOrders(a: BookOrder, b: BookOrder, side: OrderSide): number {
    if (a.price !== b.price) {
      return side === OrderSide.BUY
        ? b.price - a.price
        : a.price - b.price;
    }
    return a.timestamp - b.timestamp;
  }

  private aggregateLevels(orders: BookOrder[], depth: number): OrderBookLevel[] {
    const levelMap = new Map<number, OrderBookLevel>();

    for (const order of orders) {
      let level = levelMap.get(order.price);
      if (!level) {
        level = {
          price: order.price,
          totalLot: 0,
          frequency: 0,
          orders: [],
        };
        levelMap.set(order.price, level);
      }
      level.totalLot += order.remainingQty;
      level.frequency += 1;
      level.orders.push({
        orderId: order.id,
        playerId: order.playerId,
        remainingQty: order.remainingQty,
        timestamp: order.timestamp,
      } as OrderQueueEntry);
    }

    const levels: OrderBookLevel[] = [];
    const seenPrices = new Set<number>();

    for (const order of orders) {
      if (!seenPrices.has(order.price)) {
        seenPrices.add(order.price);
        const level = levelMap.get(order.price)!;
        levels.push(level);
        if (levels.length >= depth) break;
      }
    }

    return levels;
  }

  private createExecution(
    price: number,
    volume: number,
    buyOrderId: string,
    sellOrderId: string,
    aggressor: OrderSide
  ): Execution {
    this.execIdCounter++;
    return {
      id: `exec-${this.execIdCounter}-${Date.now()}`,
      price,
      volume,
      buyOrderId,
      sellOrderId,
      timestamp: Date.now(),
      aggressor,
    };
  }

  /**
   * Notify: a resting order has been fully filled by an aggressor.
   */
  private notifyOrderFilled(bookOrder: BookOrder): void {
    this.onOrderUpdate?.({
      id: bookOrder.id,
      side: bookOrder.side,
      type: OrderType.LIMIT,
      price: bookOrder.price,
      quantity: bookOrder.originalQty,           // ← FIXED: total original qty
      filledQty: bookOrder.cumulativeFilled,     // ← FIXED: actual cumulative filled
      timestamp: bookOrder.timestamp,
      playerId: bookOrder.playerId,
      status: OrderStatus.FILLED,
    });
  }

  /**
   * Notify: a resting order has been partially filled by an aggressor.
   */
  private notifyOrderPartial(bookOrder: BookOrder): void {
    this.onOrderUpdate?.({
      id: bookOrder.id,
      side: bookOrder.side,
      type: OrderType.LIMIT,
      price: bookOrder.price,
      quantity: bookOrder.originalQty,           // ← FIXED: total original qty
      filledQty: bookOrder.cumulativeFilled,     // ← FIXED: actual cumulative filled
      timestamp: bookOrder.timestamp,
      playerId: bookOrder.playerId,
      status: OrderStatus.PARTIAL,
    });
  }
}
