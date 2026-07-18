import WebSocket from 'ws';
import { IngestionValidator } from './validator';
import { IngestionEventQueue } from './eventQueue';

export class BinanceStreamManager {
  private spotWs: WebSocket | null = null;
  private futuresWs: WebSocket | null = null;
  private oiInterval: NodeJS.Timeout | null = null;
  private eventQueue = IngestionEventQueue.getInstance();

  constructor(private symbols: string[]) {}

  public start() {
    this.connectSpot();
    this.connectFutures();
    this.startOIPolling();
  }

  public stop() {
    if (this.spotWs) this.spotWs.close();
    if (this.futuresWs) this.futuresWs.close();
    if (this.oiInterval) clearInterval(this.oiInterval);
  }

  private connectSpot() {
    // We connect to aggTrade and depth for each symbol
    const streams = this.symbols.flatMap(s => {
      const lower = s.toLowerCase();
      return [`${lower}@aggTrade`, `${lower}@depth20@100ms`];
    }).join('/');
    
    const url = `wss://data-stream.binance.vision/stream?streams=${streams}`;
    this.spotWs = new WebSocket(url);
    
    this.spotWs.on('open', () => console.log(`[Ingestion] Spot WS connected for ${this.symbols.length} symbols.`));
    
    this.spotWs.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        if (!msg.data || !msg.stream) return;
        
        const stream = msg.stream;
        const d = msg.data;
        
        if (stream.endsWith('@aggTrade')) {
          const trade = IngestionValidator.validateTrade({
            symbol: d.s,
            price: d.p,
            qty: d.q,
            isMaker: d.m,
            tradeTime: d.T
          });
          if (trade) this.eventQueue.publishTrade(trade);
        } else if (stream.includes('@depth')) {
          const depth = IngestionValidator.validateDepth({
            symbol: d.s || stream.split('@')[0].toUpperCase(),
            bids: d.bids,
            asks: d.asks
          });
          if (depth) this.eventQueue.publishDepth(depth);
        }
      } catch (err) {}
    });

    this.spotWs.on('error', (err) => console.error('[Ingestion] Spot WS error:', err));
    this.spotWs.on('close', () => {
      console.log('[Ingestion] Spot WS closed, reconnecting in 5s...');
      setTimeout(() => this.connectSpot(), 5000);
    });
  }

  private connectFutures() {
    // We connect to forceOrder (liquidation) and markPrice (funding)
    // using futures stream
    const streams = this.symbols.flatMap(s => {
      const lower = s.toLowerCase();
      return [`${lower}@markPrice`]; // 1s update by default
    });
    // Global force order stream is !forceOrder@arr
    streams.push('!forceOrder@arr');
    
    const url = `wss://fstream.binance.com/stream?streams=${streams.join('/')}`;
    this.futuresWs = new WebSocket(url);
    
    this.futuresWs.on('open', () => console.log(`[Ingestion] Futures WS connected.`));
    
    this.futuresWs.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        if (!msg.data) return;
        const stream = msg.stream;
        const d = msg.data;

        if (stream === '!forceOrder@arr') {
          // d is array of force orders or a single force order obj wrapped
          const orders = Array.isArray(d) ? d : [d];
          for (const o of orders) {
            const fo = o.o;
            if (!fo) continue;
            // Only care if it's in our symbols list
            if (!this.symbols.includes(fo.s)) continue;
            const liq = IngestionValidator.validateLiquidation({
              symbol: fo.s,
              side: fo.S,
              price: fo.p,
              qty: fo.q,
              time: fo.T
            });
            if (liq) this.eventQueue.publishLiquidation(liq);
          }
        } else if (stream.endsWith('@markPrice')) {
          const fund = IngestionValidator.validateFunding({
            symbol: d.s,
            fundingRate: d.r,
            markPrice: d.p,
            indexPrice: d.i,
            nextFundingTime: d.T
          });
          if (fund) this.eventQueue.publishFunding(fund);
        }
      } catch (err) {}
    });

    this.futuresWs.on('error', (err) => console.error('[Ingestion] Futures WS error:', err));
    this.futuresWs.on('close', () => {
      console.log('[Ingestion] Futures WS closed, reconnecting in 5s...');
      setTimeout(() => this.connectFutures(), 5000);
    });
  }

  private startOIPolling() {
    // Poll every 30s
    this.oiInterval = setInterval(() => {
      this.symbols.forEach(async (sym) => {
        try {
          // Direct fetch from Binance FAPI
          const res = await fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${sym}`);
          if (!res.ok) return;
          const data = await res.json() as any;
          if (data && data.openInterest) {
            this.eventQueue.publishOpenInterest({
              symbol: data.symbol,
              openInterest: parseFloat(data.openInterest.toString()),
              time: data.time || Date.now()
            });
          }
        } catch (err) {
          // Silent catch to not spam logs on network blips
        }
      });
    }, 30000);
  }
}
