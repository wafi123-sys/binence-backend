import { WebSocket } from 'ws';
import * as fs from 'fs';
import * as path from 'path';

// Types
export interface WhaleEvent {
  time: number;
  price: number;
  qty: number;
  val: number;
  side: string;
  exec: string;
  score: number;
  status: string;
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
  side: string;
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

export class WhaleTracker {
  private ws: WebSocket | null = null;
  private journeys = new Map<string, WhaleJourney>();
  private events: WhaleEvent[] = [];
  private volumeProfile = new Map<number, any>();
  
  // Storage paths
  private dbPath = path.join(__dirname, '..', 'data');
  private dbFile = path.join(__dirname, '..', 'data', 'whales.json');

  // Simple state for depth monitoring
  private asks = new Map<number, number>();
  private bids = new Map<number, number>();

  constructor() {
    this.ensureDbExists();
    this.loadHistory();
    this.connectBinance();
  }

  private ensureDbExists() {
    if (!fs.existsSync(this.dbPath)) fs.mkdirSync(this.dbPath, { recursive: true });
    if (!fs.existsSync(this.dbFile)) fs.writeFileSync(this.dbFile, JSON.stringify({ journeys: [], events: [] }));
  }

  private loadHistory() {
    try {
      const data = JSON.parse(fs.readFileSync(this.dbFile, 'utf8'));
      this.events = data.events || [];
      if (data.journeys) {
        for (const j of data.journeys) {
          this.journeys.set(j.id, j);
        }
      }
      if (data.volumeProfile) {
        for (const b of data.volumeProfile) {
          this.volumeProfile.set(b.price, b);
        }
      }
      console.log(`[Whale Engine] Loaded ${this.events.length} events, ${this.journeys.size} journeys, and ${this.volumeProfile.size} volume nodes from DB.`);
    } catch (e) {
      console.log('[Whale Engine] Could not load history, starting fresh.');
    }
  }

  private saveHistory() {
    try {
      // Keep only top 1000 events and top 200 journeys to prevent memory leak
      const eventsToSave = this.events.slice(0, 1000);
      const journeysToSave = Array.from(this.journeys.values()).slice(-200);
      
      const topVolumeNodes = Array.from(this.volumeProfile.values())
        .filter((n: any) => {
          const total = n.bVol + n.sVol;
          if (total === 0) return false;
          const imb = Math.abs(n.bVol - n.sVol) / total;
          return imb >= 0.8; // Imbalance di atas 80% (Accumulation / Distribution ekstrem)
        })
        .sort((a: any, b: any) => (b.bVol + b.sVol) - (a.bVol + a.sVol))
        .slice(0, 50);

      this.volumeProfile.clear();
      for (const node of topVolumeNodes) {
        this.volumeProfile.set(node.price, node);
      }
      
      fs.writeFileSync(this.dbFile, JSON.stringify({
        events: eventsToSave,
        journeys: journeysToSave,
        volumeProfile: topVolumeNodes
      }));
    } catch (e) {
      console.error('[Whale Engine] Failed to save DB', e);
    }
  }

  public getHistory() {
    return {
      events: this.events.slice(0, 200), // return last 200 to clients
      journeys: Array.from(this.journeys.values()),
      topVolumeNodes: Array.from(this.volumeProfile.values()).sort((a: any, b: any) => (b.bVol + b.sVol) - (a.bVol + a.sVol)).slice(0, 50)
    };
  }

  private connectBinance() {
    const url = 'wss://stream.binance.com:9443/ws/btcusdt@aggTrade/btcusdt@depth@100ms';
    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      console.log('[Whale Engine] Connected to Binance, scanning for whales 24/7...');
    });

    this.ws.on('message', (data: any) => {
      try {
        const msg = JSON.parse(data.toString());
        this.processBinanceMessage(msg);
      } catch (e) {}
    });

    this.ws.on('close', () => {
      console.log('[Whale Engine] Connection lost, reconnecting in 5s...');
      setTimeout(() => this.connectBinance(), 5000);
    });
    
    this.ws.on('error', () => {
      if (this.ws) this.ws.close();
    });

    // Save DB periodically (every 1 minute)
    setInterval(() => this.saveHistory(), 60000);
  }

  private processBinanceMessage(msg: any) {
    if (msg.e === 'aggTrade') {
      const price = parseFloat(msg.p);
      const qty = parseFloat(msg.q);
      const val = price * qty;
      const isMaker = msg.m; // true if maker
      
      // Volume Profile Tracking (50x Zoom)
      const mag = Math.pow(10, Math.floor(Math.log10(price)));
      const step50 = mag * 0.0005 * 50; 
      const bucketPrice = Math.floor(price / step50) * step50;

      let bkt = this.volumeProfile.get(bucketPrice);
      if (!bkt) {
        bkt = { price: bucketPrice, bVol: 0, sVol: 0, bFreq: 0, sFreq: 0, firstSeen: Date.now() };
        this.volumeProfile.set(bucketPrice, bkt);
      }
      if (isMaker) { // Buyer is maker = Seller initiated
         bkt.sVol += qty;
         bkt.sFreq += 1;
      } else { // Seller is maker = Buyer initiated
         bkt.bVol += qty;
         bkt.bFreq += 1;
      }

      // Whale Threshold (e.g. > $100k)
      if (val >= 100000) {
        this.detectWhaleEvent(msg.E, price, qty, val, isMaker);
      }
    }
    else if (msg.e === 'depthUpdate') {
      // Update local depth state to find spoofing/absorption
      for (const [p, q] of msg.b) this.bids.set(parseFloat(p), parseFloat(q));
      for (const [p, q] of msg.a) this.asks.set(parseFloat(p), parseFloat(q));
    }
  }

  private detectWhaleEvent(timeMs: number, price: number, qty: number, val: number, isMaker: boolean) {
    // 1. Determine execution logic (Market vs Limit/Iceberg)
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

    const side = isMaker ? 'sell' : 'buy'; // If buyer is maker, the trade was initiated by a seller hitting the bid.

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

    this.processJourney(ev);
  }

  private processJourney(ev: WhaleEvent) {
    let journeyFound: WhaleJourney | null = null;
    
    // Heuristic tracker
    for (const [id, j] of this.journeys.entries()) {
      const timeDiff = ev.time - j.lastUpdate;
      const priceDiff = Math.abs(ev.price - j.startPrice) / j.startPrice;
      
      // Match within 5 minutes and 0.1% price
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
      this.journeys.set(jId, newJourney);
      ev.journeyId = jId;
    }

    this.events.unshift(ev);
    if (this.events.length > 2000) this.events.pop(); // keep last 2000 in memory
    if (this.journeys.size > 500) {
      const firstKey = this.journeys.keys().next().value;
      this.journeys.delete(firstKey as string);
    }
  }
}
