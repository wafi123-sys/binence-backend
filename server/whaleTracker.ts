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

export interface CoinState {
  events: WhaleEvent[];
  journeys: Map<string, WhaleJourney>;
  volumeProfile: Map<number, any>;
  asks: Map<number, number>;
  bids: Map<number, number>;
}

export class WhaleTracker {
  private ws: WebSocket | null = null;
  private states = new Map<string, CoinState>();
  
  // Storage paths
  private dbPath = path.join(__dirname, '..', 'data');
  private dbFile = path.join(__dirname, '..', 'data', 'whales.json');

  constructor() {
    this.ensureDbExists();
    this.loadHistory();
    this.connectBinance();
    
    // Save DB periodically (every 1 minute)
    setInterval(() => this.saveHistory(), 60000);
  }

  private getState(symbol: string): CoinState {
    if (!this.states.has(symbol)) {
      this.states.set(symbol, {
        events: [],
        journeys: new Map(),
        volumeProfile: new Map(),
        asks: new Map(),
        bids: new Map()
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
      
      // Backward compatibility (old format without symbols)
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
    return {
      events: state.events.slice(0, 200),
      journeys: Array.from(state.journeys.values()),
      topVolumeNodes: Array.from(state.volumeProfile.values()).sort((a: any, b: any) => (b.bVol + b.sVol) - (a.bVol + a.sVol)).slice(0, 200)
    };
  }

  private async connectBinance() {
    try {
      console.log('[Whale Engine] Fetching Top 100 USDT pairs from Binance...');
      const res = await fetch('https://api.binance.com/api/v3/ticker/24hr');
      const data: any = await res.json();
      
      const symbols = data
        .filter((d: any) => d.symbol.endsWith('USDT'))
        .sort((a: any, b: any) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
        .slice(0, 100)
        .map((d: any) => d.symbol.toLowerCase());
      
      if (!symbols.includes('btcusdt')) symbols.push('btcusdt');

      const streams = symbols.map((s: string) => `${s}@aggTrade/${s}@depth@100ms`).join('/');
      const url = `wss://data-stream.binance.vision/stream?streams=${streams}`;

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
      const val = price * qty;
      const isMaker = msg.m; // true if maker
      
      // Volume Profile Tracking (200x Zoom)
      const mag = Math.pow(10, Math.floor(Math.log10(price)));
      const step200 = mag * 0.0005 * 200; 
      const bucketPrice = Math.floor(price / step200) * step200;

      let bkt = state.volumeProfile.get(bucketPrice);
      if (!bkt) {
        bkt = { price: bucketPrice, bVol: 0, sVol: 0, bFreq: 0, sFreq: 0, firstSeen: Date.now() };
        state.volumeProfile.set(bucketPrice, bkt);
      }
      if (isMaker) {
         bkt.sVol += qty;
         bkt.sFreq += 1;
      } else {
         bkt.bVol += qty;
         bkt.bFreq += 1;
      }

      // Whale Threshold (e.g. > $100k)
      if (val >= 100000) {
        this.detectWhaleEvent(symbol, state, msg.E, price, qty, val, isMaker);
      }
    }
    else if (msg.e === 'depthUpdate') {
      for (const [p, q] of msg.b) state.bids.set(parseFloat(p), parseFloat(q));
      for (const [p, q] of msg.a) state.asks.set(parseFloat(p), parseFloat(q));
    }
  }

  private detectWhaleEvent(symbol: string, state: CoinState, timeMs: number, price: number, qty: number, val: number, isMaker: boolean) {
    let exec = 'Market';
    let status = 'AGGRESSIVE';
    let score = 70 + (val / 1000000) * 10;
    
    if (isMaker) {
      exec = 'Limit Hit';
      status = 'ABSORBING';
      score += 10;
    }

    if (val > 500000) score += 10;
    if (val > 1000000) score += 15;
    score = Math.min(99, score);

    const side = isMaker ? 'sell' : 'buy'; 

    const ev: WhaleEvent = {
      time: timeMs,
      price,
      qty,
      val,
      side,
      exec,
      status,
      score: Math.floor(score)
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
