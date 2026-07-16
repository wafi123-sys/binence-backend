// ============================================================
// Custom Server — Runs Next.js + WebSocket on separate ports
// Next.js: port 3000  |  WebSocket: port 3001
// Follows the official Next.js custom server docs pattern.
// ============================================================

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import next from 'next';
import { ArenaWSServer } from './wsServer';
import { WhaleTracker } from './whaleTracker';
import { BacktestEngine, ALL_STRATEGIES, STRATEGY_VERIFIED_WALL_BOUNCE, STRATEGY_CVD_DIVERGENCE_FADE, STRATEGY_COMPOSITE_TRUST, STRATEGY_SCALPING_PULLBACK } from './backtest/engine';
import { loadTimeline, DEFAULT_LOG_DIR } from './backtest/datasetLoader';
import { DEFAULT_EXEC } from './backtest/types';
import { initDatabase } from './db';

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const nextPort = parseInt(process.env.PORT || '3000', 10);
const wsPort = parseInt(process.env.WS_PORT || '3001', 10);

const app = next({ dev, hostname, port: nextPort });
const handle = app.getRequestHandler();

// Start 24/7 Whale Engine
const whaleEngine = new WhaleTracker();

app.prepare().then(async () => {
  await initDatabase();
  let wsServer: ArenaWSServer | null = null;

  const server = createServer((req, res) => {
    if (req.url && req.url.startsWith('/api/whale-history')) {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const symbol = url.searchParams.get('symbol') || 'btcusdt';
      res.setHeader('Content-Type', 'application/json');
      // Fix CORS for local dev if needed
      res.setHeader('Access-Control-Allow-Origin', '*'); 
      res.end(JSON.stringify(whaleEngine.getHistory(symbol)));
      return;
    }
    // ── /api/backtest ─────────────────────────────────────────
    if (req.url && req.url.startsWith('/api/backtest')) {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      if (req.method !== 'POST') {
        res.writeHead(405);
        res.end(JSON.stringify({ error: 'Method Not Allowed. Use POST.' }));
        return;
      }

      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', async () => {
        try {
          const { symbol = 'btcusdt', strategy = 'all', capital = 10000, interval = '1m' } = JSON.parse(body || '{}');
          const sym = symbol.toLowerCase();
          const logDir = process.env.DATA_LOG_DIR || DEFAULT_LOG_DIR;

          let timeline;
          try {
            timeline = await loadTimeline(logDir, sym);
          } catch (e: any) {
            res.writeHead(200);
            res.end(JSON.stringify({
              status: 'no_data',
              message: `Data log untuk ${sym.toUpperCase()} belum tersedia. DataLogger baru mulai merekam — harap tunggu setidaknya 1 hari agar data terkumpul.`,
              symbol: sym.toUpperCase(),
              eventsExpected: 'Mulai tersedia setelah DataLogger aktif 24 jam.'
            }));
            return;
          }

          const strategies = strategy === 'all'        ? ALL_STRATEGIES
            : strategy === 'wall_bounce'               ? [STRATEGY_VERIFIED_WALL_BOUNCE]
            : strategy === 'cvd_fade'                  ? [STRATEGY_CVD_DIVERGENCE_FADE]
            : strategy === 'composite'                 ? [STRATEGY_COMPOSITE_TRUST]
            : strategy === 'scalping_pullback'         ? [STRATEGY_SCALPING_PULLBACK]
            : ALL_STRATEGIES;

          const engine = new BacktestEngine(DEFAULT_EXEC);
          const results = [];
          for (const strat of strategies) {
            const result = await engine.run(sym, timeline, strat, parseFloat(capital), interval);
            // Trim equity array (don't send 100k points to browser)
            const equityThin = result.equity.filter((_, i) => i % Math.max(1, Math.floor(result.equity.length / 300)) === 0);
            results.push({ ...result, equity: equityThin });
          }

          res.writeHead(200);
          res.end(JSON.stringify({ status: 'ok', results, eventCount: timeline.length }));
        } catch (err: any) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }
    if (req.url === '/api/market-data') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*'); 
      if (wsServer) {
        res.end(JSON.stringify(wsServer.getEngine().getOHLCData()));
      } else {
        res.end(JSON.stringify({ error: 'Server not ready' }));
      }
      return;
    }
    if (req.url === '/openapi.json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*'); 
      res.end(JSON.stringify({
        openapi: "3.0.0",
        info: {
          title: "Agnoia Terminal API",
          version: "1.0.0",
          description: "API for accessing Market Data and Whale Order Monitor."
        },
        servers: [
          { url: "https://binance-backend-production.up.railway.app", description: "Production Server" }
        ],
        paths: {
          "/api/market-data": {
            get: {
              summary: "Get Market Data (OHLC)",
              description: "Returns candlestick history data.",
              responses: {
                "200": {
                  description: "Successful response"
                }
              }
            }
          },
          "/api/whale-history": {
            get: {
              summary: "Get Whale History",
              description: "Returns a list of large whale order events.",
              responses: {
                "200": {
                  description: "Successful response"
                }
              }
            }
          }
        }
      }));
      return;
    }
    handle(req, res);
  });

  // Setup Binance WebSocket Proxy
  const binanceProxyWss = new WebSocketServer({ noServer: true });
  binanceProxyWss.on('connection', (ws, req) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const streamPath = url.searchParams.get('stream');
    const origin = url.searchParams.get('origin') || 'data-stream.binance.vision';
    if (!streamPath) {
      ws.close();
      return;
    }
    const targetUrl = `wss://${origin}${streamPath}`;
    const binanceWs = new WebSocket(targetUrl);
    
    binanceWs.on('message', (data, isBinary) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data, { binary: isBinary });
    });
    binanceWs.on('close', () => ws.close());
    binanceWs.on('error', err => { ws.close(); });
    
    ws.on('message', (data, isBinary) => {
      if (binanceWs.readyState === WebSocket.OPEN) binanceWs.send(data, { binary: isBinary });
    });
    ws.on('close', () => binanceWs.close());
    ws.on('error', () => binanceWs.close());
  });

  // Start Arena WS with noServer
  wsServer = new ArenaWSServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    if (url.pathname === '/binance-proxy') {
      binanceProxyWss.handleUpgrade(req, socket, head, ws => {
        binanceProxyWss.emit('connection', ws, req);
      });
    } else {
      if (wsServer) {
        wsServer.getWss().handleUpgrade(req, socket, head, ws => {
          wsServer!.getWss().emit('connection', ws, req);
        });
      }
    }
  });

  server.listen(nextPort, () => {
    console.log(`\n🏟️  Order Book Arena (Cloud Ready)`);
    console.log(`   URL:       http://${hostname}:${nextPort}`);
    console.log(`   WebSocket: ws://${hostname}:${nextPort}`);
    console.log(`   Mode:      ${dev ? 'development' : 'production'}\n`);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n[Server] Shutting down...');
    wsServer.shutdown();
    server.close(() => process.exit(0));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
});
