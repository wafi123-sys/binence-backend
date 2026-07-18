import { Detector } from './index';
import { FeatureSnapshot, MarketState, CandidateEvent, RawTrade } from '../types';

interface VolTier {
  name: string;
  minVol: number;      
  whaleFloor: number;  
}

const VOL_TIERS: VolTier[] = [
  { name: 'MEGA',  minVol: 1_000_000_000, whaleFloor: 150_000 },
  { name: 'LARGE', minVol:   100_000_000, whaleFloor:  50_000 },
  { name: 'MID',   minVol:    10_000_000, whaleFloor:  15_000 },
  { name: 'SMALL', minVol:     1_000_000, whaleFloor:   5_000 },
  { name: 'MICRO', minVol:             0, whaleFloor:   1_200 },
];

function getWhaleFloor(vol24h: number, avgTradeUsd: number): number {
  const tier = VOL_TIERS.find(t => vol24h >= t.minVol) ?? VOL_TIERS[VOL_TIERS.length - 1];
  return Math.max(tier.whaleFloor, avgTradeUsd * 20);
}

interface TradeFingerprint {
  side: 'buy' | 'sell';
  priceband: number;       
  trades: { price: number; qty: number; time: number }[];
  totalUsd: number;
  firstSeen: number;
  lastSeen: number;
  isMaker: boolean; // Using the first trade's maker status for simplicity
}

export class WhaleDetector implements Detector {
  private activeFingerprints = new Map<string, TradeFingerprint>();
  private FINGERPRINT_WINDOW_MS = 45_000;   
  private FINGERPRINT_PRICE_TOLERANCE = 0.004; 

  evaluate(features: FeatureSnapshot, state: MarketState, trade?: RawTrade): CandidateEvent[] {
    if (!trade) return [];

    const usd = trade.price * trade.qty;
    const isBuy = !trade.isMaker; // taker buy hits ask -> !isMaker
    const priceband = Math.round(trade.price / (trade.price * this.FINGERPRINT_PRICE_TOLERANCE));
    const key = `${trade.symbol}:${isBuy ? 'buy' : 'sell'}:${priceband}`;

    let fp = this.activeFingerprints.get(key);
    if (!fp || trade.tradeTime - fp.lastSeen > this.FINGERPRINT_WINDOW_MS) {
      fp = { 
        side: isBuy ? 'buy' : 'sell', 
        priceband, 
        trades: [], 
        totalUsd: 0, 
        firstSeen: trade.tradeTime, 
        lastSeen: trade.tradeTime,
        isMaker: trade.isMaker 
      };
      this.activeFingerprints.set(key, fp);
    }
    
    fp.trades.push({ price: trade.price, qty: trade.qty, time: trade.tradeTime });
    fp.totalUsd += usd;
    fp.lastSeen = trade.tradeTime;

    const whaleFloor = getWhaleFloor(state.vol24h, 1000); 

    const events: CandidateEvent[] = [];

    if (usd > whaleFloor) {
      events.push(this.createEvent(trade.symbol, fp, 'WHALE', usd, trade.tradeTime, trade.price, trade.qty, trade.isMaker));
      return events;
    }

    const suspicionScore = this.computeSplittingSuspicion(fp);
    if (fp.totalUsd > whaleFloor && fp.trades.length >= 4 && suspicionScore > 0.6) {
      events.push(this.createEvent(trade.symbol, fp, 'WHALE', fp.totalUsd, trade.tradeTime, trade.price, fp.totalUsd / trade.price, fp.isMaker, suspicionScore, 'SPLIT_DETECTED'));
      this.activeFingerprints.delete(key); 
    }

    return events;
  }

  private computeSplittingSuspicion(fp: TradeFingerprint): number {
    if (fp.trades.length < 4) return 0;
    const intervals: number[] = [];
    const sizes: number[] = [];
    for (let i = 1; i < fp.trades.length; i++) {
      intervals.push(fp.trades[i].time - fp.trades[i - 1].time);
      sizes.push(fp.trades[i].qty);
    }
    const cv = (arr: number[]) => {
      const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
      if (mean === 0) return 1;
      const variance = arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length;
      return Math.sqrt(variance) / mean; 
    };
    const intervalCV = cv(intervals);
    const sizeCV = cv(sizes);
    return 1 - Math.min(1, (intervalCV + sizeCV) / 2);
  }

  private createEvent(symbol: string, fp: TradeFingerprint, type: 'WHALE', usd: number, time: number, price: number, qty: number, isMaker: boolean, suspicionScore: number = 0, subType: string = 'SINGLE'): CandidateEvent {
    let rawConfidence = 70;
    rawConfidence += Math.floor(usd / 1_000_000) * 10;
    if (usd > 500_000) rawConfidence += 10;
    if (subType === 'SPLIT_DETECTED') rawConfidence += Math.round(suspicionScore * 10); 
    rawConfidence = Math.min(99, rawConfidence);

    // If taker sell hits bid (isMaker=true), the whale is the maker (buy side)
    const side = isMaker ? (fp.side === 'buy' ? 'ask' : 'bid') : fp.side; 

    return {
      symbol,
      type,
      price,
      qty,
      usdValue: usd,
      time,
      side: side as any,
      rawConfidence,
      meta: { subType, splittingSuspicion: suspicionScore, isMaker }
    };
  }
}
