import { RawTrade, RawDepthUpdate, RawLiquidation, RawFundingUpdate, RawOpenInterest } from '../core/types';

export class IngestionValidator {
  
  static validateTrade(trade: any): RawTrade | null {
    if (!trade || !trade.symbol || !trade.price || !trade.qty || !trade.tradeTime) return null;
    const price = parseFloat(trade.price.toString());
    const qty = parseFloat(trade.qty.toString());
    if (isNaN(price) || price <= 0 || isNaN(qty) || qty <= 0) return null;
    
    // Sanity check time (not from future, not too old - say > 5 min old)
    const now = Date.now();
    if (trade.tradeTime > now + 60000 || trade.tradeTime < now - 300000) return null;

    return {
      symbol: trade.symbol,
      price,
      qty,
      isMaker: !!trade.isMaker,
      tradeTime: trade.tradeTime,
      localTime: now
    };
  }

  static validateDepth(depth: any): RawDepthUpdate | null {
    if (!depth || !depth.symbol || !Array.isArray(depth.bids) || !Array.isArray(depth.asks)) return null;
    
    const parseLevel = (level: any): [number, number] | null => {
      const p = parseFloat(level[0]);
      const q = parseFloat(level[1]);
      if (isNaN(p) || p <= 0 || isNaN(q) || q < 0) return null;
      return [p, q];
    };

    const bids = depth.bids.map(parseLevel).filter((l: any) => l !== null) as [number, number][];
    const asks = depth.asks.map(parseLevel).filter((l: any) => l !== null) as [number, number][];

    return {
      symbol: depth.symbol,
      bids,
      asks,
      localTime: Date.now()
    };
  }

  static validateLiquidation(liq: any): RawLiquidation | null {
    if (!liq || !liq.symbol || !liq.price || !liq.qty) return null;
    const price = parseFloat(liq.price.toString());
    const qty = parseFloat(liq.qty.toString());
    if (isNaN(price) || price <= 0 || isNaN(qty) || qty <= 0) return null;
    
    return {
      symbol: liq.symbol,
      side: liq.side === 'BUY' ? 'BUY' : 'SELL',
      price,
      qty,
      time: liq.time || Date.now()
    };
  }

  static validateFunding(fund: any): RawFundingUpdate | null {
    if (!fund || !fund.symbol || fund.fundingRate === undefined) return null;
    const rate = parseFloat(fund.fundingRate.toString());
    const mark = parseFloat(fund.markPrice?.toString() || '0');
    const index = parseFloat(fund.indexPrice?.toString() || '0');
    if (isNaN(rate)) return null;

    return {
      symbol: fund.symbol,
      fundingRate: rate,
      markPrice: mark,
      indexPrice: index,
      nextFundingTime: fund.nextFundingTime || 0,
      time: fund.time || Date.now()
    };
  }
}
