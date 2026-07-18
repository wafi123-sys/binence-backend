import WebSocket from 'ws';
import { globalDataLogger } from './dataLogger';

// Shared cache
export const globalBackgroundState = {
  liquidations: [] as any[],
  strategyHistory: [] as any[],
  probState: { acc: 25, dist: 25, trap: 25, neutral: 25 },
  aiPhase: 'NEUTRAL',
  entryScore: 50,
  exitScore: 50,
  aiScoreHistory: [] as any[]
};

export class BackgroundEngines {
  private liqWs: WebSocket | null = null;
  private stratTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.initLiquidationTracker();
  }

  private initLiquidationTracker() {
    this.liqWs = new WebSocket('wss://fstream.binance.com/ws/!forceOrder@arr');
    
    this.liqWs.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.o) {
           const o = msg.o;
           if (o.s === 'BTCUSDT' || o.s === 'ETHUSDT' || o.s === 'SOLUSDT' || o.s === 'BNBUSDT') {
              const liq = {
                 symbol: o.s,
                 side: o.S,
                 price: parseFloat(o.p),
                 qty: parseFloat(o.q),
                 time: msg.E
              };
               globalBackgroundState.liquidations.unshift(liq);
               if (globalBackgroundState.liquidations.length > 200) {
                  globalBackgroundState.liquidations.pop();
               }
               

            }
         }
       } catch(e) {}
    });

    this.liqWs.on('error', (err) => console.error('[BackgroundEngine] Liq WS error', err));
    this.liqWs.on('close', () => {
      setTimeout(() => this.initLiquidationTracker(), 5000);
    });
  }

}

export const globalBackgroundEngines = new BackgroundEngines();
