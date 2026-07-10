// ============================================================
// Bot Engine — Multi-Agent Market Simulator
// Simulates Market Makers, Pro Scalpers, and Whales.
// ============================================================

import { OrderSide, OrderType } from './types';
import { OrderEngine } from './orderEngine';
import { MatchingEngine } from './matchingEngine';

const BOT_MM_ID = '__bot_mm__';
const BOT_SCALPER_ID = '__bot_scalp__';
const BOT_WHALE_ID = '__bot_whale__';

interface BotOrder {
  orderId: string;
  side: OrderSide;
  price: number;
}

export class BotEngine {
  private orderEngine: OrderEngine;
  private matchingEngine: MatchingEngine;
  
  private mmOrders: BotOrder[] = [];
  private basePrice: number;
  private tickSize: number = 1;
  
  // Timers
  private mmInterval: ReturnType<typeof setInterval> | null = null;
  private scalperInterval: ReturnType<typeof setInterval> | null = null;
  private whaleInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    orderEngine: OrderEngine,
    matchingEngine: MatchingEngine,
    basePrice: number = 5000
  ) {
    this.orderEngine = orderEngine;
    this.matchingEngine = matchingEngine;
    this.basePrice = basePrice;
  }

  seedOrderBook(): void {
    const midPrice = this.basePrice;

    // Seed 20 levels deep
    for (let i = 1; i <= 20; i++) {
      const askPrice = midPrice + i * this.tickSize;
      const askQty = this.randomLot(10, 200);
      this.orderEngine.submitOrder(BOT_MM_ID, OrderSide.SELL, OrderType.LIMIT, askPrice, askQty);

      const bidPrice = midPrice - i * this.tickSize;
      const bidQty = this.randomLot(10, 200);
      this.orderEngine.submitOrder(BOT_MM_ID, OrderSide.BUY, OrderType.LIMIT, bidPrice, bidQty);
    }
  }

  start(): void {
    if (this.mmInterval) return;

    // 1. Market Maker (Moderate - 300ms)
    // Keeps liquidity tighter
    this.mmInterval = setInterval(() => this.tickMarketMaker(), 300);

    // 2. Pro Scalper (Slower - 800ms)
    // Front-runs and eats spread intelligently
    this.scalperInterval = setInterval(() => this.tickScalper(), 800);

    // 3. Whale Bot (Random, roughly every 10 seconds)
    // Places huge walls or market dumps
    this.whaleInterval = setInterval(() => this.tickWhale(), 10000);
  }

  stop(): void {
    if (this.mmInterval) clearInterval(this.mmInterval);
    if (this.scalperInterval) clearInterval(this.scalperInterval);
    if (this.whaleInterval) clearInterval(this.whaleInterval);
    this.mmInterval = null;
    this.scalperInterval = null;
    this.whaleInterval = null;
  }

  // ── 1. Market Maker (Liquidity) ────────────────────────────────

  private tickMarketMaker(): void {
    const bestBid = this.matchingEngine.getBestBid();
    const bestAsk = this.matchingEngine.getBestAsk();
    
    // Clean up old tracked orders randomly to prevent infinite buildup
    if (this.mmOrders.length > 50 && Math.random() < 0.2) {
      const idx = Math.floor(Math.random() * this.mmOrders.length);
      this.orderEngine.cancelOrder(this.mmOrders[idx].orderId, BOT_MM_ID);
      this.mmOrders.splice(idx, 1);
    }

    if (bestBid === 0 || bestAsk === 0) {
      this.seedOrderBook();
      return;
    }

    const side = Math.random() > 0.5 ? OrderSide.BUY : OrderSide.SELL;
    // 60% chance to place at tightest spread (offset 1)
    const offset = Math.random() < 0.6 ? 1 : Math.floor(Math.random() * 3) + 2;
    
    let price: number;
    if (side === OrderSide.BUY) {
      price = bestAsk - offset * this.tickSize;
      if (price <= 0) price = bestBid;
    } else {
      price = bestBid + offset * this.tickSize;
    }

    const qty = this.randomLot(5, 50);
    try {
      const result = this.orderEngine.submitOrder(BOT_MM_ID, side, OrderType.LIMIT, price, qty);
      if (result.order.status !== 'FILLED') {
        this.mmOrders.push({ orderId: result.order.id, side, price });
      }
    } catch {}
  }

  // ── 2. Pro Scalper (HFT) ──────────────────────────────────────

  private tickScalper(): void {
    const bestBid = this.matchingEngine.getBestBid();
    const bestAsk = this.matchingEngine.getBestAsk();
    
    if (bestBid === 0 || bestAsk === 0) return;
    
    const spread = bestAsk - bestBid;
    
    // If spread is large enough (> 1 tick), front-run it!
    if (spread > this.tickSize) {
      const frontRunBid = bestBid + this.tickSize;
      const frontRunAsk = bestAsk - this.tickSize;
      
      const qty = this.randomLot(50, 300);
      try {
        if (Math.random() > 0.5) {
          this.orderEngine.submitOrder(BOT_SCALPER_ID, OrderSide.BUY, OrderType.LIMIT, frontRunBid, qty);
        } else {
          this.orderEngine.submitOrder(BOT_SCALPER_ID, OrderSide.SELL, OrderType.LIMIT, frontRunAsk, qty);
        }
      } catch {}
    } else {
      // If spread is tight, occasionally eat the book (Aggressive market-like limit order)
      if (Math.random() < 0.3) {
        const side = Math.random() > 0.5 ? OrderSide.BUY : OrderSide.SELL;
        const aggressivePx = side === OrderSide.BUY ? bestAsk : bestBid;
        const qty = this.randomLot(10, 100);
        try {
          this.orderEngine.submitOrder(BOT_SCALPER_ID, side, OrderType.LIMIT, aggressivePx, qty);
        } catch {}
      }
    }
  }

  // ── 3. Whale Bot (Manipulation) ───────────────────────────────

  private tickWhale(): void {
    if (Math.random() < 0.3) return; // Sometimes sleep

    const bestBid = this.matchingEngine.getBestBid();
    const bestAsk = this.matchingEngine.getBestAsk();
    if (bestBid === 0 || bestAsk === 0) return;

    const action = Math.random();

    if (action < 0.5) {
      // Put a massive WALL slightly away from the spread to scare retail
      const side = Math.random() > 0.5 ? OrderSide.BUY : OrderSide.SELL;
      const offset = Math.floor(Math.random() * 3) + 2; // 2-4 ticks away
      const price = side === OrderSide.BUY 
        ? bestAsk - offset * this.tickSize 
        : bestBid + offset * this.tickSize;
      
      if (price > 0) {
        const wallQty = this.randomLot(5000, 20000); // Massive lot
        try {
          this.orderEngine.submitOrder(BOT_WHALE_ID, side, OrderType.LIMIT, price, wallQty);
        } catch {}
      }
    } else {
      // Market DUMP / PUMP (Sweep the book)
      const side = Math.random() > 0.5 ? OrderSide.BUY : OrderSide.SELL;
      const sweepQty = this.randomLot(2000, 8000);
      
      try {
        // Submit a Market Order to eat liquidity
        this.orderEngine.submitOrder(BOT_WHALE_ID, side, OrderType.MARKET, 0, sweepQty);
      } catch {}
    }
  }

  // ── Helpers ───────────────────────────────────────────────────

  private randomLot(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
}
