import { OrderSide, OrderType, SultanBotConfig, SultanBotStats } from './types';
import { OrderEngine } from './orderEngine';
import { MatchingEngine } from './matchingEngine';
import { AccountEngine } from './accountEngine';

const SULTANS: SultanBotConfig[] = [
  { id: 'sultan_1', name: 'The Collector', strategy: 'The Collector', initialCapital: 10_000_000_000, maxPosition: 100000, targetProfitPct: 0.1 },
  { id: 'sultan_2', name: 'The Absorber', strategy: 'The Absorber', initialCapital: 15_000_000_000, maxPosition: 150000, maxExposure: 0.5 },
  { id: 'sultan_3', name: 'The Breakout Hunter', strategy: 'The Breakout Hunter', initialCapital: 5_000_000_000, maxPosition: 50000, targetProfitPct: 0.05 },
  { id: 'sultan_4', name: 'The Distributor', strategy: 'The Distributor', initialCapital: 20_000_000_000, maxPosition: 200000 },
  { id: 'sultan_5', name: 'The Scalper', strategy: 'The Scalper', initialCapital: 2_000_000_000, maxPosition: 10000, targetProfitPct: 0.01 },
  { id: 'sultan_6', name: 'The Momentum', strategy: 'The Momentum', initialCapital: 8_000_000_000, maxPosition: 80000, trailingStopPct: 0.02 },
  { id: 'sultan_7', name: 'The Liquidity Provider', strategy: 'The Liquidity Provider', initialCapital: 50_000_000_000, maxPosition: 500000 },
  { id: 'sultan_8', name: 'The Contrarian', strategy: 'The Contrarian', initialCapital: 12_000_000_000, maxPosition: 120000 },
  { id: 'sultan_9', name: 'The Swing Trader', strategy: 'The Swing Trader', initialCapital: 25_000_000_000, maxPosition: 250000, targetProfitPct: 0.15 },
  { id: 'sultan_10', name: 'The Institution', strategy: 'The Institution', initialCapital: 100_000_000_000, maxPosition: 1000000 },
];

export enum MarketPhase {
  Accumulation = 'Accumulation',
  Markup = 'Markup',
  Distribution = 'Distribution',
  Markdown = 'Markdown'
}

interface BotInstance {
  config: SultanBotConfig;
  account: AccountEngine;
  activeOrderIds: Set<string>;
}

export class SultanBotEngine {
  private orderEngine: OrderEngine;
  private matchingEngine: MatchingEngine;
  private basePrice: number;
  private lastPrice: number;
  private tickSize: number = 1;
  
  private bots: Map<string, BotInstance> = new Map();
  private botIntervals: ReturnType<typeof setInterval>[] = [];
  private maintainerInterval: ReturnType<typeof setInterval> | null = null;
  private phaseInterval: ReturnType<typeof setInterval> | null = null;

  public marketPhase: MarketPhase = MarketPhase.Accumulation;

  constructor(
    orderEngine: OrderEngine,
    matchingEngine: MatchingEngine,
    basePrice: number = 5000
  ) {
    this.orderEngine = orderEngine;
    this.matchingEngine = matchingEngine;
    this.basePrice = basePrice;
    this.lastPrice = basePrice;

    // Initialize 10 Sultans
    for (const config of SULTANS) {
      const acct = new AccountEngine(config.initialCapital);
      // Inject massive initial position for some bots so they can play both sides
      if (['The Distributor', 'The Institution', 'The Liquidity Provider'].includes(config.strategy)) {
        acct.injectPosition(Math.floor((config.maxPosition || 100000) / 2), basePrice);
      }
      
      this.bots.set(config.id, {
        config,
        account: acct,
        activeOrderIds: new Set(),
      });
    }

    // Initialize 50 Retail Bots (Noise & Liquidity absorbers)
    for (let i = 1; i <= 50; i++) {
      const config: SultanBotConfig = {
        id: `retail_${i}`,
        name: `Retail ${i}`,
        strategy: 'Retail Trader',
        initialCapital: this.randomLot(100_000_000, 500_000_000), // Richer so they don't get stuck
      };
      const acct = new AccountEngine(config.initialCapital);
      acct.injectPosition(this.randomLot(5, 50), basePrice);
      
      this.bots.set(config.id, {
        config,
        account: acct,
        activeOrderIds: new Set(),
      });
    }
  }

  // ── Public Access ─────────────────────────────────────────────

  getLeaderboard(): SultanBotStats[] {
    const stats: SultanBotStats[] = [];
    for (const bot of this.bots.values()) {
      if (bot.config.id.startsWith('retail_')) continue;
      const state = bot.account.getState();
      stats.push({
        id: bot.config.id,
        name: bot.config.name,
        strategy: bot.config.strategy,
        ...state
      });
    }

    // Sort by Total Equity by default
    return stats.sort((a, b) => b.totalEquity - a.totalEquity);
  }

  // ── Lifecycle ─────────────────────────────────────────────────

  start(): void {
    if (this.botIntervals.length > 0) return; // already started

    // Seed order book first to ensure there's liquidity
    this.seedOrderBook();

    // Start ticks for bots based on their strategies
    for (const bot of this.bots.values()) {
      const interval = this.getTickInterval(bot.config.strategy);
      const timerId = setInterval(() => this.tickBot(bot), interval);
      this.botIntervals.push(timerId);
    }

    // Autonomous Market Maintainer (self-healing loop)
    this.maintainerInterval = setInterval(() => this.maintainMarket(), 250);

    // Market Phase cycler (every 2 minutes)
    this.phaseInterval = setInterval(() => this.cycleMarketPhase(), 120_000);
  }

  stop(): void {
    for (const interval of this.botIntervals) {
      clearInterval(interval);
    }
    this.botIntervals = [];

    if (this.maintainerInterval) {
      clearInterval(this.maintainerInterval);
      this.maintainerInterval = null;
    }

    if (this.phaseInterval) {
      clearInterval(this.phaseInterval);
      this.phaseInterval = null;
    }
  }

  private cycleMarketPhase(): void {
    const phases = [MarketPhase.Accumulation, MarketPhase.Markup, MarketPhase.Distribution, MarketPhase.Markdown];
    const currentIndex = phases.indexOf(this.marketPhase);
    this.marketPhase = phases[(currentIndex + 1) % phases.length];
    console.log(`[Market Cycle] Shifted to ${this.marketPhase}`);
  }

  seedOrderBook(): void {
    const midPrice = this.basePrice;
    const lpBot = this.bots.get('sultan_7'); // The Liquidity Provider
    if (!lpBot) return;

    for (let i = 1; i <= 20; i++) {
      const askPrice = midPrice + i * this.tickSize;
      const askQty = this.randomLot(10, 100);
      this.submitBotOrder(lpBot, OrderSide.SELL, OrderType.LIMIT, askPrice, askQty);

      const bidPrice = midPrice - i * this.tickSize;
      const bidQty = this.randomLot(10, 100);
      this.submitBotOrder(lpBot, OrderSide.BUY, OrderType.LIMIT, bidPrice, bidQty);
    }
  }

  // ── Autonomous Market Maintainer ───────────────────────────────

  private maintainMarket(): void {
    const lpBot = this.bots.get('sultan_7');
    if (!lpBot) return;

    // Get current top 40 levels to fill the entire visible Order Book
    const levels = this.matchingEngine.getOrderBookLevels(40);
    const bids = levels.bids;
    const asks = levels.asks;

    const currentLast = this.lastPrice > 0 ? this.lastPrice : this.basePrice;

    // 1. Check & Heal Bids
    let expectedBid = bids.length > 0 ? bids[0].price : (asks.length > 0 ? asks[0].price - this.tickSize : currentLast - this.tickSize);
    if (expectedBid <= 0) expectedBid = this.tickSize;

    for (let i = 0; i < 40; i++) {
       const targetPrice = expectedBid - (i * this.tickSize);
       if (targetPrice <= 0) break;

       const existingLevel = bids.find(b => b.price === targetPrice);
       const targetVol = (i === 0) ? 500 : 100;

       if (!existingLevel) {
          this.submitBotOrder(lpBot, OrderSide.BUY, OrderType.LIMIT, targetPrice, targetVol + this.randomLot(10, 50));
       } else if (existingLevel.totalLot < targetVol) {
          const needed = targetVol - existingLevel.totalLot;
          this.submitBotOrder(lpBot, OrderSide.BUY, OrderType.LIMIT, targetPrice, needed + this.randomLot(10, 50));
       }
    }

    // 2. Check & Heal Asks
    let expectedAsk = asks.length > 0 ? asks[0].price : (bids.length > 0 ? bids[0].price + this.tickSize : currentLast + this.tickSize);

    for (let i = 0; i < 40; i++) {
       const targetPrice = expectedAsk + (i * this.tickSize);

       const existingLevel = asks.find(a => a.price === targetPrice);
       const targetVol = (i === 0) ? 500 : 100;

       if (!existingLevel) {
          this.submitBotOrder(lpBot, OrderSide.SELL, OrderType.LIMIT, targetPrice, targetVol + this.randomLot(10, 50));
       } else if (existingLevel.totalLot < targetVol) {
          const needed = targetVol - existingLevel.totalLot;
          this.submitBotOrder(lpBot, OrderSide.SELL, OrderType.LIMIT, targetPrice, needed + this.randomLot(10, 50));
       }
    }
  }

  // ── Passive Fills Handler ──────────────────────────────────────

  processPassiveFill(orderId: string, playerId: string, filledQty: number, price: number, lastPrice: number, side: OrderSide, status: string): void {
    const bot = this.bots.get(playerId);
    if (!bot) return;

    const acct = bot.account;
    const previousFilled = acct.filledSoFar.get(orderId) ?? 0;
    const justFilled = filledQty - previousFilled;
    if (justFilled <= 0) return;

    if (side === OrderSide.BUY) {
      acct.onBuyExecution(orderId, price, justFilled, lastPrice);
    } else {
      acct.onSellExecution(orderId, price, justFilled, lastPrice);
    }

    if (status === 'FILLED' || status === 'CANCELLED') {
      acct.onOrderCompleted(orderId);
      bot.activeOrderIds.delete(orderId);
    }
  }
  
  onPriceUpdate(lastPrice: number): void {
    this.lastPrice = lastPrice;
    for (const bot of this.bots.values()) {
       bot.account.onPriceUpdate(lastPrice);
    }
  }

  // ── Trading Logic ─────────────────────────────────────────────

  private getTickInterval(strategy: string): number {
    switch (strategy) {
      case 'The Scalper': return 1000;
      case 'The Liquidity Provider': return 1500;
      case 'The Absorber': return 2500;
      case 'The Collector': return 3500;
      case 'The Momentum': return 4000;
      case 'The Contrarian': return 4500;
      case 'The Breakout Hunter': return 6000;
      case 'The Distributor': return 7000;
      case 'The Institution': return 8000;
      case 'The Swing Trader': return 12000;
      case 'Retail Trader': return Math.floor(Math.random() * 800) + 200; // Super fast! (0.2s - 1s)
      default: return 5000;
    }
  }

  private tickBot(bot: BotInstance): void {
    // Aggressively cancel old orders to prevent memory leak and free up tied capital
    if (bot.activeOrderIds.size > 20) {
      const toCancel = Math.floor(Math.random() * 5) + 1;
      const iterator = bot.activeOrderIds.values();
      for (let i = 0; i < toCancel; i++) {
        const id = iterator.next().value;
        if (id) this.cancelBotOrder(bot, id);
      }
    }

    let bestBid = this.matchingEngine.getBestBid();
    let bestAsk = this.matchingEngine.getBestAsk();
    
    if (bestBid === 0) bestBid = this.lastPrice > 0 ? this.lastPrice - this.tickSize : this.basePrice - this.tickSize;
    if (bestAsk === 0) bestAsk = this.lastPrice > 0 ? this.lastPrice + this.tickSize : this.basePrice + this.tickSize;
    if (bestBid <= 0) bestBid = this.tickSize;
    const spread = bestAsk - bestBid;

    // --- Risk & Capital Management ---
    const availableCash = bot.account.getAvailableBalance();
    const position = bot.account.getPosition();
    const maxPosition = bot.config.maxPosition || 100000;
    
    // Emergency Dump (out of cash and need to sell)
    if (availableCash < bot.config.initialCapital * 0.05 && position > 0) {
       if (Math.random() < 0.5) {
         const dumpQty = Math.min(position, this.randomLot(100, 500));
         this.submitBotOrder(bot, OrderSide.SELL, OrderType.LIMIT, bestBid, dumpQty);
         return; 
       }
    }

    // Limit position exposure
    if (position >= maxPosition && Math.random() < 0.2) {
        // Need to reduce position
        const dumpQty = Math.min(position, this.randomLot(100, 1000));
        this.submitBotOrder(bot, OrderSide.SELL, OrderType.LIMIT, bestAsk, dumpQty);
        return;
    }

    switch (bot.config.strategy) {
      case 'The Collector':
        this.runCollectorStrategy(bot, bestBid, bestAsk);
        break;
      case 'The Absorber':
        this.runAbsorberStrategy(bot, bestBid, bestAsk);
        break;
      case 'The Breakout Hunter':
        this.runBreakoutHunterStrategy(bot, bestBid, bestAsk);
        break;
      case 'The Distributor':
        this.runDistributorStrategy(bot, bestBid, bestAsk);
        break;
      case 'The Scalper':
        this.runScalperStrategy(bot, bestBid, bestAsk, spread);
        break;
      case 'The Momentum':
        this.runMomentumStrategy(bot, bestBid, bestAsk);
        break;
      case 'The Liquidity Provider':
        this.runLiquidityProviderStrategy(bot, bestBid, bestAsk);
        break;
      case 'The Contrarian':
        this.runContrarianStrategy(bot, bestBid, bestAsk);
        break;
      case 'The Swing Trader':
        this.runSwingTraderStrategy(bot, bestBid, bestAsk);
        break;
      case 'The Institution':
        this.runInstitutionStrategy(bot, bestBid, bestAsk);
        break;
      case 'Retail Trader':
        this.runRetailStrategy(bot, bestBid, bestAsk);
        break;
    }
  }

  private submitBotOrder(bot: BotInstance, side: OrderSide, type: OrderType, price: number, lots: number): void {
    if (lots <= 0) return;
    const acct = bot.account;
    
    if (side === OrderSide.BUY) {
       let reservePrice = price > 0 ? price : this.matchingEngine.getBestAsk();
       if (reservePrice === 0) reservePrice = this.lastPrice > 0 ? this.lastPrice : this.basePrice;
       if (!acct.canAffordBuy(reservePrice, lots)) return;
    } else {
       if (!acct.canAffordSell(lots)) return;
    }

    try {
      const result = this.orderEngine.submitOrder(bot.config.id, side, type, price, lots);
      const order = result.order;
      const currentLastPrice = this.lastPrice;

      let totalFillLots = 0;
      for (const exec of result.executions) {
        if (side === OrderSide.BUY && exec.buyOrderId === order.id) {
           acct.onBuyExecution(order.id, exec.price, exec.volume, currentLastPrice);
           totalFillLots += exec.volume;
        } else if (side === OrderSide.SELL && exec.sellOrderId === order.id) {
           acct.onSellExecution(order.id, exec.price, exec.volume, currentLastPrice);
           totalFillLots += exec.volume;
        }
      }

      if (order.status === 'FILLED') {
        acct.onOrderCompleted(order.id);
      } else {
        bot.activeOrderIds.add(order.id);
        const remainingLots = lots - totalFillLots;
        if (remainingLots > 0) {
          if (side === OrderSide.BUY) {
            acct.reserveForBuy(order.id, price > 0 ? price : currentLastPrice, remainingLots);
          } else {
            acct.reserveForSell(order.id, remainingLots);
          }
        }
      }
      acct.onPriceUpdate(currentLastPrice);
    } catch (e) {}
  }

  private cancelBotOrder(bot: BotInstance, orderId: string): void {
    const result = this.orderEngine.cancelOrder(orderId, bot.config.id);
    if (!result) return;
    bot.activeOrderIds.delete(orderId);
    bot.account.onOrderCancelled(orderId, result.side);
    bot.account.onPriceUpdate(this.lastPrice);
  }

  // ── Bot Specific Strategies ──────────────────────────────────────

  private runCollectorStrategy(bot: BotInstance, bestBid: number, bestAsk: number): void {
    // The Collector: Accumulates slowly at Bid. Doesn't chase. Stops if price spikes.
    if (this.marketPhase === MarketPhase.Markup) return; // Stop buying if price rising fast
    
    const qty = this.randomLot(10, 50); // Small, quiet accumulation
    // Place slightly below or at bid
    const offset = Math.random() > 0.5 ? 0 : this.tickSize;
    this.submitBotOrder(bot, OrderSide.BUY, OrderType.LIMIT, bestBid - offset, qty);
  }

  private runAbsorberStrategy(bot: BotInstance, bestBid: number, bestAsk: number): void {
    // The Absorber: Absorbs sell pressure. Buys when market drops.
    if (this.marketPhase === MarketPhase.Distribution || this.marketPhase === MarketPhase.Markdown) {
      // Step in and buy gradually
      const qty = this.randomLot(50, 200);
      this.submitBotOrder(bot, OrderSide.BUY, OrderType.LIMIT, bestBid, qty);
    }
  }

  private runBreakoutHunterStrategy(bot: BotInstance, bestBid: number, bestAsk: number): void {
    // The Breakout Hunter: Rarely trades. Enters forcefully when resistance breaks.
    if (this.marketPhase === MarketPhase.Markup && Math.random() < 0.2) {
      // Market buy / cross spread to ignite momentum
      const qty = this.randomLot(100, 1000);
      this.submitBotOrder(bot, OrderSide.BUY, OrderType.LIMIT, bestAsk, qty);
    } else if (bot.account.getState().unrealizedPnL > bot.config.initialCapital * 0.05) {
      // Take profit
      const qty = Math.min(bot.account.getPosition(), this.randomLot(100, 500));
      this.submitBotOrder(bot, OrderSide.SELL, OrderType.LIMIT, bestAsk, qty);
    }
  }

  private runDistributorStrategy(bot: BotInstance, bestBid: number, bestAsk: number): void {
    // The Distributor: Sells slowly. Doesn't dump. Avoids crashing price.
    if (this.marketPhase === MarketPhase.Accumulation) return; // Do not distribute during accumulation

    const pos = bot.account.getPosition();
    if (pos > 0) {
      const qty = Math.min(pos, this.randomLot(20, 100)); // Distribute in small batches
      // Place above best ask to avoid aggressive impact
      this.submitBotOrder(bot, OrderSide.SELL, OrderType.LIMIT, bestAsk + this.tickSize, qty);
    }
  }

  private runScalperStrategy(bot: BotInstance, bestBid: number, bestAsk: number, spread: number): void {
    // The Scalper: Short hold time, many small trades, tight spread.
    const pos = bot.account.getPosition();
    const avgBuy = bot.account.getAvgBuyPrice();

    if (pos > 100 && avgBuy > 0 && bestAsk > avgBuy) {
      // Quick profit
      this.submitBotOrder(bot, OrderSide.SELL, OrderType.LIMIT, bestAsk, pos);
    } else if (spread >= this.tickSize) {
      // Try to get in at best bid
      const qty = this.randomLot(10, 50);
      this.submitBotOrder(bot, OrderSide.BUY, OrderType.LIMIT, bestBid, qty);
    }
  }

  private runMomentumStrategy(bot: BotInstance, bestBid: number, bestAsk: number): void {
    // The Momentum: Follows trend aggressively.
    const pos = bot.account.getPosition();

    if (this.marketPhase === MarketPhase.Markup) {
      // Aggressive buy
      this.submitBotOrder(bot, OrderSide.BUY, OrderType.LIMIT, bestAsk, this.randomLot(100, 300));
    } else if (this.marketPhase === MarketPhase.Markdown) {
      // Aggressive sell
      if (pos > 0) {
        this.submitBotOrder(bot, OrderSide.SELL, OrderType.LIMIT, bestBid, Math.min(pos, this.randomLot(100, 300)));
      }
    }
  }

  private runLiquidityProviderStrategy(bot: BotInstance, bestBid: number, bestAsk: number): void {
    // The Liquidity Provider: Always maintains both sides. Handled heavily by maintainMarket.
    // Also does standard quoting here.
    if (Math.random() < 0.3 && bot.activeOrderIds.size > 0) {
      // Often cancels
      const iter = bot.activeOrderIds.values();
      const id = iter.next().value;
      if (id) this.cancelBotOrder(bot, id);
    } else {
      // Quotes both sides
      const qty = this.randomLot(50, 150);
      this.submitBotOrder(bot, OrderSide.BUY, OrderType.LIMIT, bestBid - this.tickSize, qty);
      this.submitBotOrder(bot, OrderSide.SELL, OrderType.LIMIT, bestAsk + this.tickSize, qty);
    }
  }

  private runContrarianStrategy(bot: BotInstance, bestBid: number, bestAsk: number): void {
    // The Contrarian: Buys panic, sells euphoria.
    const pos = bot.account.getPosition();

    if (this.marketPhase === MarketPhase.Markdown) {
      // Buys during panic drops
      this.submitBotOrder(bot, OrderSide.BUY, OrderType.LIMIT, bestBid - (this.tickSize * 2), this.randomLot(100, 500));
    } else if (this.marketPhase === MarketPhase.Markup && pos > 0) {
      // Sells during euphoria
      this.submitBotOrder(bot, OrderSide.SELL, OrderType.LIMIT, bestAsk + (this.tickSize * 2), Math.min(pos, this.randomLot(100, 500)));
    }
  }

  private runSwingTraderStrategy(bot: BotInstance, bestBid: number, bestAsk: number): void {
    // The Swing Trader: Rare entry, big position, big target.
    const pos = bot.account.getPosition();
    const avgBuy = bot.account.getAvgBuyPrice();

    if (pos > 0 && avgBuy > 0 && bestAsk > avgBuy + (this.tickSize * 5)) {
      // Big profit target reached
      this.submitBotOrder(bot, OrderSide.SELL, OrderType.LIMIT, bestAsk, Math.min(pos, this.randomLot(500, 2000)));
    } else if (pos === 0 && this.marketPhase === MarketPhase.Accumulation && Math.random() < 0.1) {
      // Rare, large entry
      this.submitBotOrder(bot, OrderSide.BUY, OrderType.LIMIT, bestBid, this.randomLot(1000, 5000));
    }
  }

  private runInstitutionStrategy(bot: BotInstance, bestBid: number, bestAsk: number): void {
    // The Institution: Execution algorithms (TWAP/VWAP style), splits big orders.
    // Avoids wiping offer. Aims for best average.
    
    // We simulate this by checking if we need to build position (Accumulation/Markup)
    // or reduce (Distribution/Markdown).
    const isAccumulating = this.marketPhase === MarketPhase.Accumulation || this.marketPhase === MarketPhase.Markup;
    
    if (isAccumulating) {
      // Buy small chunks at Bid to avoid slippage
      const qty = this.randomLot(50, 150); // Small chunks
      this.submitBotOrder(bot, OrderSide.BUY, OrderType.LIMIT, bestBid, qty);
    } else {
      // Distribute chunks at Ask
      const pos = bot.account.getPosition();
      if (pos > 0) {
        const qty = Math.min(pos, this.randomLot(50, 150));
        this.submitBotOrder(bot, OrderSide.SELL, OrderType.LIMIT, bestAsk, qty);
      }
    }
  }

  private runRetailStrategy(bot: BotInstance, bestBid: number, bestAsk: number): void {
    // Retail bots are noisy, emotional, and trade in small sizes
    const r = Math.random();
    const pos = bot.account.getPosition();
    
    // FOMO / Panic based on phase and randomness
    // Extreme FOMO chasing when price goes up (Markup or just randomly)
    if (this.marketPhase === MarketPhase.Markup || r < 0.2) {
      // Hajar Kanan! (Market Buy / Cross Spread) to chase price
      const chasePrice = bestAsk + this.tickSize; // willing to pay higher
      this.submitBotOrder(bot, OrderSide.BUY, OrderType.LIMIT, chasePrice, this.randomLot(1, 15));
    } 
    // Extreme Panic when price drops (Markdown or randomly)
    else if ((this.marketPhase === MarketPhase.Markdown && pos > 0) || (r > 0.8 && pos > 0)) {
      // Hajar Kiri! (Market Sell / Cross Spread) to dump price
      const panicPrice = Math.max(this.tickSize, bestBid - this.tickSize);
      this.submitBotOrder(bot, OrderSide.SELL, OrderType.LIMIT, panicPrice, Math.min(pos, this.randomLot(1, 15)));
    } 
    // Otherwise, place random limit orders (Noise Trading)
    else {
      const side = Math.random() > 0.5 ? OrderSide.BUY : OrderSide.SELL;
      const offset = Math.floor(Math.random() * 5); // 0 to 4 ticks away
      const price = side === OrderSide.BUY ? bestBid - offset * this.tickSize : bestAsk + offset * this.tickSize;
      
      if (price > 0) {
        this.submitBotOrder(bot, side, OrderType.LIMIT, price, this.randomLot(1, 20));
      }
    }
  }

  private randomLot(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
}
