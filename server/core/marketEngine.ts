import { 
  RawTrade, RawDepthUpdate, RawFundingUpdate, RawOpenInterest, MarketState 
} from './types';

export class MarketEngine {
  private states: Map<string, MarketState> = new Map();

  public applyTrade(trade: RawTrade) {
    const state = this.getOrCreateState(trade.symbol);
    state.lastPrice = trade.price;
    state.vol24h += trade.qty; // Simplified 24h vol, real implementation should use a sliding window or Binance 24h ticker
    state.updatedAt = trade.localTime;
  }

  public applyDepth(depth: RawDepthUpdate) {
    const state = this.getOrCreateState(depth.symbol);
    
    // Process bids
    for (const [price, qty] of depth.bids) {
      if (qty === 0) {
        state.bids.delete(price);
      } else {
        state.bids.set(price, qty);
      }
    }
    
    // Process asks
    for (const [price, qty] of depth.asks) {
      if (qty === 0) {
        state.asks.delete(price);
      } else {
        state.asks.set(price, qty);
      }
    }
    
    state.updatedAt = depth.localTime;
  }

  public applyFunding(funding: RawFundingUpdate) {
    const state = this.getOrCreateState(funding.symbol);
    state.fundingRate = funding.fundingRate;
    state.markPrice = funding.markPrice;
    state.indexPrice = funding.indexPrice;
    state.updatedAt = funding.time;
  }

  public applyOpenInterest(oi: RawOpenInterest) {
    const state = this.getOrCreateState(oi.symbol);
    const prevOi = state.openInterest;
    state.openInterest = oi.openInterest;
    if (prevOi > 0) {
      state.openInterestDelta = oi.openInterest - prevOi;
    }
    state.updatedAt = oi.time;
  }

  public getState(symbol: string): MarketState {
    return this.getOrCreateState(symbol);
  }

  private getOrCreateState(symbol: string): MarketState {
    if (!this.states.has(symbol)) {
      this.states.set(symbol, {
        symbol,
        bids: new Map(),
        asks: new Map(),
        lastPrice: 0,
        markPrice: 0,
        indexPrice: 0,
        fundingRate: 0,
        openInterest: 0,
        openInterestDelta: 0,
        vol24h: 0,
        updatedAt: Date.now()
      });
    }
    return this.states.get(symbol)!;
  }
}
