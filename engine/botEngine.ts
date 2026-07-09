// ============================================================
// Bot Engine — Market maker bot to keep the order book alive
// Seeds initial orders and periodically adds/modifies/cancels
// orders to simulate realistic market activity.
// ============================================================

import { OrderSide, OrderType } from './types';
import { OrderEngine } from './orderEngine';
import { MatchingEngine } from './matchingEngine';

const BOT_PLAYER_ID = '__bot__';

interface BotOrder {
  orderId: string;
  side: OrderSide;
  price: number;
}

export class BotEngine {
  private orderEngine: OrderEngine;
  private matchingEngine: MatchingEngine;
  private botOrders: BotOrder[] = [];
  private basePrice: number;
  private interval: ReturnType<typeof setInterval> | null = null;
  private tickSize: number = 1;
  private spread: number = 3; // min spread in ticks

  constructor(
    orderEngine: OrderEngine,
    matchingEngine: MatchingEngine,
    basePrice: number = 5000
  ) {
    this.orderEngine = orderEngine;
    this.matchingEngine = matchingEngine;
    this.basePrice = basePrice;
  }

  /**
   * Seed the initial order book with realistic orders.
   */
  seedOrderBook(): void {
    const midPrice = this.basePrice;

    // Create ask levels (offers) - 10 levels above mid
    for (let i = 1; i <= 10; i++) {
      const price = midPrice + i * this.tickSize;
      const numOrders = Math.max(1, Math.floor(Math.random() * 5) + 1);

      for (let j = 0; j < numOrders; j++) {
        const qty = this.randomLot();
        try {
          const result = this.orderEngine.submitOrder(
            BOT_PLAYER_ID,
            OrderSide.SELL,
            OrderType.LIMIT,
            price,
            qty
          );
          this.botOrders.push({
            orderId: result.order.id,
            side: OrderSide.SELL,
            price,
          });
        } catch {
          // Skip failed orders
        }
      }
    }

    // Create bid levels - 10 levels below mid
    for (let i = 1; i <= 10; i++) {
      const price = midPrice - i * this.tickSize;
      const numOrders = Math.max(1, Math.floor(Math.random() * 5) + 1);

      for (let j = 0; j < numOrders; j++) {
        const qty = this.randomLot();
        try {
          const result = this.orderEngine.submitOrder(
            BOT_PLAYER_ID,
            OrderSide.BUY,
            OrderType.LIMIT,
            price,
            qty
          );
          this.botOrders.push({
            orderId: result.order.id,
            side: OrderSide.BUY,
            price,
          });
        } catch {
          // Skip failed orders
        }
      }
    }
  }

  /**
   * Start the bot — periodically adds, modifies, or cancels orders
   * to simulate market activity.
   */
  start(intervalMs: number = 800): void {
    if (this.interval) return;

    this.interval = setInterval(() => {
      this.tick();
    }, intervalMs);
  }

  /**
   * Stop the bot.
   */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  // ── Private Methods ──────────────────────────────────────────

  private tick(): void {
    const action = Math.random();

    if (action < 0.35) {
      // 35% chance: Add new order near best bid/ask
      this.addOrder();
    } else if (action < 0.55) {
      // 20% chance: Cancel a random bot order
      this.cancelRandomOrder();
    } else if (action < 0.75) {
      // 20% chance: Aggressive market order to create trades
      this.aggressiveOrder();
    } else {
      // 25% chance: Replenish thin levels
      this.replenishLevels();
    }
  }

  private addOrder(): void {
    const side = Math.random() > 0.5 ? OrderSide.BUY : OrderSide.SELL;
    const bestBid = this.matchingEngine.getBestBid();
    const bestAsk = this.matchingEngine.getBestAsk();

    if (bestBid === 0 || bestAsk === 0) {
      this.replenishLevels();
      return;
    }

    let price: number;
    if (side === OrderSide.BUY) {
      // Place bid slightly below best ask
      const offset = Math.floor(Math.random() * 5) + 1;
      price = bestAsk - offset * this.tickSize;
      if (price <= 0) price = bestBid;
    } else {
      // Place ask slightly above best bid
      const offset = Math.floor(Math.random() * 5) + 1;
      price = bestBid + offset * this.tickSize;
    }

    const qty = this.randomLot();

    try {
      const result = this.orderEngine.submitOrder(
        BOT_PLAYER_ID,
        side,
        OrderType.LIMIT,
        price,
        qty
      );
      if (result.order.status !== 'FILLED') {
        this.botOrders.push({
          orderId: result.order.id,
          side,
          price,
        });
      }
    } catch {
      // Ignore
    }
  }

  private cancelRandomOrder(): void {
    if (this.botOrders.length === 0) return;

    const idx = Math.floor(Math.random() * this.botOrders.length);
    const orderToCancel = this.botOrders[idx];

    this.orderEngine.cancelOrder(orderToCancel.orderId, BOT_PLAYER_ID);
    this.botOrders.splice(idx, 1);
  }

  private aggressiveOrder(): void {
    const side = Math.random() > 0.5 ? OrderSide.BUY : OrderSide.SELL;
    const qty = Math.floor(Math.random() * 30) + 5; // Small aggressive orders

    const bestBid = this.matchingEngine.getBestBid();
    const bestAsk = this.matchingEngine.getBestAsk();

    if (bestBid === 0 || bestAsk === 0) return;

    try {
      if (side === OrderSide.BUY) {
        // Buy at best ask (crossing the spread)
        this.orderEngine.submitOrder(
          BOT_PLAYER_ID,
          OrderSide.BUY,
          OrderType.LIMIT,
          bestAsk,
          qty
        );
      } else {
        // Sell at best bid (crossing the spread)
        this.orderEngine.submitOrder(
          BOT_PLAYER_ID,
          OrderSide.SELL,
          OrderType.LIMIT,
          bestBid,
          qty
        );
      }
    } catch {
      // Ignore
    }

    // Clean up filled bot orders
    this.botOrders = this.botOrders.filter((bo) => {
      const order = this.matchingEngine.getOrder(bo.orderId);
      return order !== undefined;
    });
  }

  private replenishLevels(): void {
    const bestBid = this.matchingEngine.getBestBid();
    const bestAsk = this.matchingEngine.getBestAsk();

    const refPrice = bestBid > 0 && bestAsk > 0
      ? Math.floor((bestBid + bestAsk) / 2)
      : this.basePrice;

    // Add some orders on both sides
    const side = Math.random() > 0.5 ? OrderSide.BUY : OrderSide.SELL;
    const offset = Math.floor(Math.random() * 8) + 1;
    const price = side === OrderSide.BUY
      ? refPrice - offset * this.tickSize
      : refPrice + offset * this.tickSize;

    if (price <= 0) return;

    const qty = this.randomLot();

    try {
      const result = this.orderEngine.submitOrder(
        BOT_PLAYER_ID,
        side,
        OrderType.LIMIT,
        price,
        qty
      );
      if (result.order.status !== 'FILLED') {
        this.botOrders.push({
          orderId: result.order.id,
          side,
          price,
        });
      }
    } catch {
      // Ignore
    }
  }

  private randomLot(): number {
    // Generate realistic lot sizes: mostly small, occasionally large
    const r = Math.random();
    if (r < 0.4) return Math.floor(Math.random() * 50) + 10;     // 10-60
    if (r < 0.7) return Math.floor(Math.random() * 200) + 50;    // 50-250
    if (r < 0.9) return Math.floor(Math.random() * 500) + 100;   // 100-600
    return Math.floor(Math.random() * 1000) + 500;                // 500-1500
  }
}
