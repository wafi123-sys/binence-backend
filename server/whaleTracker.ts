import WebSocket from 'ws';
import * as fs from 'fs';
import * as path from 'path';

export interface WhaleEvent {
  time: number;
  price: number;
  qty: number;
  val: number;
  side: 'buy' | 'sell' | 'bid' | 'ask';
  exec: string;      
  status: string;
  score: number;
  type?: 'SINGLE' | 'SPLIT_DETECTED';
  journeyId?: string;
}

export interface JourneyTimelineEvent {
  time: string;
  action: string;
  size: string;
  desc: string;
}

export interface WhaleJourney {
  id: string;
  side: 'buy' | 'sell' | 'bid' | 'ask';
  startPrice: number;
  totalValue: number;
  orderCount: number;
  lastUpdate: number;
  execution: string;
  behavior: string;
  confidence: number;
  importanceScore: number;
  timeline: JourneyTimelineEvent[];
}

export interface PriceLevelMemory {
  price: number;
  bVol: number;
  sVol: number;
  bFreq: number;
  sFreq: number;
  firstSeen: number;
  lastUpdated: number;
  relevanceScore: number;
}

export interface CoinState {
  events: WhaleEvent[];
  journeys: Map<string, WhaleJourney>;
  volumeProfile: Map<number, PriceLevelMemory>;
  asks: Map<number, number>;
  bids: Map<number, number>;
  vol24h: number;
}

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

function getWhaleFloor(symbol: string, vol24h: number, avgTradeUsd: number): number {
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
}

const activeFingerprints = new Map<string, TradeFingerprint>(); 
const FINGERPRINT_WINDOW_MS = 45_000;   
const FINGERPRINT_PRICE_TOLERANCE = 0.004; 
const HALF_LIFE_MS = 6 * 60 * 60 * 1000; 

function decayLevel(mem: PriceLevelMemory, now: number) {
  const elapsed = now - mem.lastUpdated;
  if (elapsed < 0) return;
  const decayFactor = Math.pow(0.5, elapsed / HALF_LIFE_MS);
  mem.bVol *= decayFactor;
  mem.sVol *= decayFactor;
  mem.bFreq *= decayFactor;
  mem.sFreq *= decayFactor;
  mem.relevanceScore = decayFactor; 
  mem.lastUpdated = now;
}

export class WhaleTracker {
  private ws: WebSocket | null = null;
  private states = new Map<string, CoinState>();
  
  private dbPath = path.join(__dirname, '..', 'data');
  private dbFile = path.join(__dirname, '..', 'data', 'whales.json');

  constructor() {
    this.ensureDbExists();
    this.loadHistory();
    this.connectBinance();
    
    setInterval(() => this.saveHistory(), 60000);
  }

  private getState(symbol: string): CoinState {
    if (!this.states.has(symbol)) {
      this.states.set(symbol, {
        events: [],
        journeys: new Map(),
        volumeProfile: new Map(),
        asks: new Map(),
        bids: new Map(),
        vol24h: 0
      });
    }
    return this.states.get(symbol)!;
  }

  private ensureDbExists() {
    if (!fs.existsSync(this.dbPath)) fs.mkdirSync(this.dbPath, { recursive: true });
    if (!fs.existsSync(this.dbFile)) fs.writeFileSync(this.dbFile, JSON.stringify({}));
  }

  private loadHistory() {
    try {
      let data = JSON.parse(fs.readFileSync(this.dbFile, 'utf8'));
      
      if (data.events || data.journeys || data.volumeProfile) {
        if (!data.btcusdt && Array.isArray(data.events)) {
          data = { 'btcusdt': data };
        }
      }

      for (const [symbol, stateData] of Object.entries(data)) {
        const state = this.getState(symbol);
        state.events = (stateData as any).events || [];
        if ((stateData as any).journeys) {
          for (const j of (stateData as any).journeys) {
            state.journeys.set(j.id, j);
          }
        }
        if ((stateData as any).volumeProfile) {
          for (const b of (stateData as any).volumeProfile) {
            b.lastUpdated = b.lastUpdated || Date.now();
            b.relevanceScore = b.relevanceScore || 1.0;
            state.volumeProfile.set(b.price, b);
          }
        }
      }
      console.log(`[Whale Engine] Loaded history for ${this.states.size} coins.`);
    } catch (e) {
      console.log('[Whale Engine] Could not load history, starting fresh.');
    }
  }

  private saveHistory() {
    try {
      const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
      const cutoffTime = Date.now() - TWENTY_FOUR_HOURS;
      const dataToSave: any = {};

      for (const [symbol, state] of this.states.entries()) {
        const eventsToSave = state.events.slice(0, 1000);
        const journeysToSave = Array.from(state.journeys.values()).slice(-200);
        
        for (const [price, node] of state.volumeProfile.entries()) {
          if (node.firstSeen && node.firstSeen < cutoffTime) {
            state.volumeProfile.delete(price);
          }
        }

        const volumeNodesToSave = Array.from(state.volumeProfile.values())
          .sort((a: any, b: any) => (b.bVol + b.sVol) - (a.bVol + a.sVol))
          .slice(0, 200);
          
        dataToSave[symbol] = {
          events: eventsToSave,
          journeys: journeysToSave,
          volumeProfile: volumeNodesToSave
        };
      }

      fs.writeFileSync(this.dbFile, JSON.stringify(dataToSave));
    } catch (e) {
      console.error('[Whale Engine] Failed to save DB', e);
    }
  }

  public getHistory(symbol: string = 'btcusdt') {
    const state = this.getState(symbol.toLowerCase());
    const now = Date.now();
    
    // Decay all volume profiles before returning
    const scored = [...state.volumeProfile.entries()].map(([price, mem]) => {
      decayLevel(mem, now);
      const rawVol = mem.bVol + mem.sVol;
      return { price, mem, weightedVol: rawVol * mem.relevanceScore };
    });
    
    const topVolumeNodes = scored.sort((a, b) => b.weightedVol - a.weightedVol)
                                 .slice(0, 200)
                                 .map(n => n.mem);

    return {
      events: state.events.slice(0, 200),
      journeys: Array.from(state.journeys.values()),
      topVolumeNodes
    };
  }

  private async connectBinance() {
    try {
      console.log('[Whale Engine] Fetching Top 100 USDT pairs from Binance...');
      const res = await fetch('https://api.binance.com/api/v3/ticker/24hr');
      const data: any = await res.json();
      
      const sortedData = data
        .filter((d: any) => d.symbol.endsWith('USDT'))
        .sort((a: any, b: any) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));
        
      const symbols = sortedData.slice(0, 100).map((d: any) => d.symbol.toLowerCase());
      
      // Store 24h volume
      for (const d of sortedData) {
        const sym = d.symbol.toLowerCase();
        const state = this.getState(sym);
        state.vol24h = parseFloat(d.quoteVolume);
      }
      
      if (!symbols.includes('btcusdt')) symbols.push('btcusdt');

      const streams = symbols.map((s: string) => `${s}@aggTrade/${s}@depth@100ms`).join('/');
      const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;

      this.ws = new WebSocket(url);

      this.ws.on('open', () => {
        console.log(`[Whale Engine] Connected to Binance, scanning ${symbols.length} coins 24/7...`);
      });

      this.ws.on('message', (data: any) => {
        try {
          const payload = JSON.parse(data.toString());
          const msg = payload.data ? payload.data : payload;
          if (msg.s) {
            this.processBinanceMessage(msg.s.toLowerCase(), msg);
          }
        } catch (e) {}
      });

      this.ws.on('close', () => {
        console.log('[Whale Engine] Connection lost, reconnecting in 5s...');
        setTimeout(() => this.connectBinance(), 5000);
      });
      
      this.ws.on('error', () => {
        if (this.ws) this.ws.close();
      });
    } catch (e) {
      console.error('[Whale Engine] Failed to connect', e);
      setTimeout(() => this.connectBinance(), 5000);
    }
  }

  private processBinanceMessage(symbol: string, msg: any) {
    const state = this.getState(symbol);

    if (msg.e === 'aggTrade') {
      const price = parseFloat(msg.p);
      const qty = parseFloat(msg.q);
      const isMaker = msg.m; 
      const time = msg.E;
      
      const mag = Math.pow(10, Math.floor(Math.log10(price)));
      const step200 = mag * 0.0005 * 200; 
      const bucketPrice = Math.floor(price / step200) * step200;

      let bkt = state.volumeProfile.get(bucketPrice);
      if (!bkt) {
        bkt = { price: bucketPrice, bVol: 0, sVol: 0, bFreq: 0, sFreq: 0, firstSeen: Date.now(), lastUpdated: Date.now(), relevanceScore: 1.0 };
        state.volumeProfile.set(bucketPrice, bkt);
      }
      
      decayLevel(bkt, Date.now());

      if (isMaker) {
         bkt.sVol += qty;
         bkt.sFreq += 1;
      } else {
         bkt.bVol += qty;
         bkt.bFreq += 1;
      }
      
      // Ingest Trade for Anti-Order-Splitting
      this.ingestTrade(symbol, state, price, qty, !isMaker, time, isMaker);
      
    }
    else if (msg.e === 'depthUpdate') {
      for (const [p, q] of msg.b) state.bids.set(parseFloat(p), parseFloat(q));
      for (const [p, q] of msg.a) state.asks.set(parseFloat(p), parseFloat(q));
    }
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
    const uniformityScore = 1 - Math.min(1, (intervalCV + sizeCV) / 2);
    return uniformityScore;
  }

  private calcWhaleScore(totalUsd: number, type: 'SINGLE' | 'SPLIT_DETECTED', suspicion = 0): number {
    let score = 70;
    score += Math.floor(totalUsd / 1_000_000) * 10;
    if (totalUsd > 500_000) score += 10;
    if (type === 'SPLIT_DETECTED') score += Math.round(suspicion * 10); 
    return Math.min(99, score);
  }
  
  private classifyMakerWall(priceLevel: number, initialQty: number, symbol: string, state: CoinState, isBuyWall: boolean): 'ABSORBING' | 'SUSPECTED_LAYERING' | 'PENDING' {
    const book = isBuyWall ? state.bids : state.asks;
    const remaining = book.get(priceLevel) || 0;
    // Simple heuristic without full lifespan tracking
    if (remaining > initialQty * 0.15) return 'ABSORBING';
    if (remaining === 0) return 'SUSPECTED_LAYERING';
    return 'PENDING';
  }

  private ingestTrade(symbol: string, state: CoinState, price: number, qty: number, isBuy: boolean, time: number, isMaker: boolean) {
    const usd = price * qty;
    const priceband = Math.round(price / (price * FINGERPRINT_PRICE_TOLERANCE));
    const key = `${symbol}:${isBuy ? 'buy' : 'sell'}:${priceband}`;

    let fp = activeFingerprints.get(key);
    if (!fp || time - fp.lastSeen > FINGERPRINT_WINDOW_MS) {
      fp = { side: isBuy ? 'buy' : 'sell', priceband, trades: [], totalUsd: 0, firstSeen: time, lastSeen: time };
      activeFingerprints.set(key, fp);
    }
    fp.trades.push({ price, qty, time });
    fp.totalUsd += usd;
    fp.lastSeen = time;

    // Use default 1000 for avgTradeUsd if not available
    const whaleFloor = getWhaleFloor(symbol, state.vol24h, 1000); 

    if (usd > whaleFloor) {
      this.emitWhaleEvent(symbol, state, fp, 'SINGLE', usd, time, price, qty, isMaker);
      return;
    }

    const suspicionScore = this.computeSplittingSuspicion(fp);
    if (fp.totalUsd > whaleFloor && fp.trades.length >= 4 && suspicionScore > 0.6) {
      this.emitWhaleEvent(symbol, state, fp, 'SPLIT_DETECTED', fp.totalUsd, time, price, qty, isMaker, suspicionScore);
      activeFingerprints.delete(key); 
    }
  }

  private emitWhaleEvent(symbol: string, state: CoinState, fp: TradeFingerprint, type: 'SINGLE' | 'SPLIT_DETECTED', usd: number, timeMs: number, price: number, qty: number, isMaker: boolean, suspicionScore: number = 0) {
    let exec = 'Market';
    let status = 'AGGRESSIVE';
    
    // In aggTrade, if isMaker is true, the buyer is maker (Sell hitting Buy Wall) or seller is maker (Buy hitting Sell Wall)
    // Actually, m=true means maker. If fp.side === 'sell' (taker sell), it hit a Buy Wall (maker buy).
    if (isMaker) {
      exec = 'Limit Hit';
      const isBuyWall = fp.side === 'sell'; 
      status = this.classifyMakerWall(price, qty, symbol, state, isBuyWall);
    }

    const score = this.calcWhaleScore(usd, type, suspicionScore);
    const side = isMaker ? (fp.side === 'buy' ? 'ask' : 'bid') : fp.side; 
    
    // Fallback side logic mapping
    let finalSide: 'buy' | 'sell' | 'bid' | 'ask' = 'buy';
    if (!isMaker && fp.side === 'buy') finalSide = 'buy';
    if (!isMaker && fp.side === 'sell') finalSide = 'sell';
    if (isMaker && fp.side === 'sell') finalSide = 'bid'; // Sell hit buy wall
    if (isMaker && fp.side === 'buy') finalSide = 'ask';  // Buy hit sell wall

    const ev: WhaleEvent = {
      time: timeMs,
      price,
      qty: type === 'SPLIT_DETECTED' ? (usd / price) : qty,
      val: usd,
      side: finalSide,
      exec,
      status,
      score,
      type
    };

    this.processJourney(symbol, state, ev);
  }

  private processJourney(symbol: string, state: CoinState, ev: WhaleEvent) {
    let journeyFound: WhaleJourney | null = null;
    
    for (const [id, j] of state.journeys.entries()) {
      const timeDiff = ev.time - j.lastUpdate;
      const priceDiff = Math.abs(ev.price - j.startPrice) / j.startPrice;
      
      if (j.side === ev.side && timeDiff < 300000 && priceDiff < 0.001) {
        journeyFound = j;
        break;
      }
    }

    const isBuy = ev.side === 'buy' || ev.side === 'bid';
    const d = new Date(ev.time);
    const tFmt = `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}:${d.getSeconds().toString().padStart(2,'0')}`;
    
    if (journeyFound) {
      journeyFound.totalValue += ev.val;
      journeyFound.orderCount += 1;
      journeyFound.lastUpdate = ev.time;
      journeyFound.timeline.push({
        time: tFmt,
        action: isBuy ? 'BUY' : 'SELL',
        size: (ev.qty >= 1000 ? (ev.qty/1000).toFixed(1)+'K' : ev.qty.toFixed(0)),
        desc: ev.exec + (ev.status ? ' / '+ev.status : '')
      });
      if (journeyFound.orderCount > 3 && journeyFound.execution !== 'Iceberg') {
        journeyFound.execution = 'Iceberg / Reload';
        journeyFound.confidence = Math.min(99, journeyFound.confidence + 5);
        journeyFound.importanceScore = Math.min(99, journeyFound.importanceScore + 10);
      }
      ev.journeyId = journeyFound.id;
    } else {
      const jId = Math.random().toString(36).substring(2, 6).toUpperCase();
      const newJourney: WhaleJourney = {
        id: jId,
        side: isBuy ? 'buy' : 'sell',
        startPrice: ev.price,
        totalValue: ev.val,
        orderCount: 1,
        lastUpdate: ev.time,
        execution: ev.exec,
        behavior: ev.status || 'Active',
        confidence: Math.floor(ev.score || (80 + Math.random()*20)),
        importanceScore: Math.floor(ev.score || (70 + Math.random()*30)),
        timeline: [{
          time: tFmt,
          action: isBuy ? 'BUY' : 'SELL',
          size: (ev.qty >= 1000 ? (ev.qty/1000).toFixed(1)+'K' : ev.qty.toFixed(0)),
          desc: 'Initial ' + ev.exec
        }]
      };
      state.journeys.set(jId, newJourney);
      ev.journeyId = jId;
    }

    state.events.unshift(ev);
    if (state.events.length > 2000) state.events.pop();
    if (state.journeys.size > 500) {
      const firstKey = state.journeys.keys().next().value;
      if (firstKey) state.journeys.delete(firstKey);
    }
  }
}
