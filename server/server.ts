// ============================================================
// Custom Server — Runs Next.js + WebSocket on separate ports
// Next.js: port 3000  |  WebSocket: port 3001
// Follows the official Next.js custom server docs pattern.
// ============================================================

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import next from 'next';
import { AgnoiaOrchestrator } from './core/orchestrator';
import { BackgroundEngines, globalBackgroundState } from './backgroundEngines';
import { BacktestEngine, ALL_STRATEGIES, STRATEGY_VERIFIED_WALL_BOUNCE, STRATEGY_CVD_DIVERGENCE_FADE, STRATEGY_COMPOSITE_TRUST, STRATEGY_SCALPING_PULLBACK, STRATEGY_LIQUIDITY_SWEEP } from './backtest/engine';
import { GridSearchRunner } from './backtest/gridSearch';
import { loadTimeline, DEFAULT_LOG_DIR } from './backtest/datasetLoader';
import { DEFAULT_EXEC } from './backtest/types';
import { initDatabase } from './db';

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const nextPort = parseInt(process.env.PORT || '3000', 10);
const wsPort = parseInt(process.env.WS_PORT || '3001', 10);

const app = next({ dev, hostname, port: nextPort });
const handle = app.getRequestHandler();

// Start 24/7 Whale Engine (V3)
const agnoiaEngine = new AgnoiaOrchestrator();
agnoiaEngine.start();

app.prepare().then(async () => {
  await initDatabase();
  const bgEngines = new BackgroundEngines(); // Starts probability simulation

  const server = createServer((req, res) => {
    if (req.url && req.url.startsWith('/api/whale-history')) {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const symbol = url.searchParams.get('symbol') || 'btcusdt';
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*'); 
      res.end(JSON.stringify({ 
        events: [], 
        journeys: [], 
        topVolumeNodes: [],
        message: "Endpoint disabled in V3 migration. Frontend uses WebSocket."
      }));
      return;
    }
    // ── /api/strategy-state ──────────────────────────────
    if (req.url && req.url.startsWith('/api/strategy-state')) {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      
      const history = agnoiaEngine.tradeJournal.getHistory();
      const openTrades = agnoiaEngine.tradeJournal.getOpenTrades();
      
      const responseData = {
        type: openTrades.length > 0 ? openTrades[0].type : 'NONE',
        history: [...history].reverse(), // Send newest first
        probState: globalBackgroundState.probState,
        aiPhase: globalBackgroundState.aiPhase,
        entryScore: globalBackgroundState.entryScore,
        exitScore: globalBackgroundState.exitScore,
        liquidations: globalBackgroundState.liquidations,
        aiScoreHistory: globalBackgroundState.aiScoreHistory

      };
      res.end(JSON.stringify(responseData));
      return;
    }
    if (req.url && req.url.startsWith('/api/liquidations')) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(globalBackgroundState.liquidations));
      return;
    }

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
          const bodyData = JSON.parse(body || '{}');
          const { symbol = 'btcusdt', capital = 10000, interval = '1m', slippageBps, feeBps } = bodyData;
          const sym = symbol.toLowerCase();
          const logDir = process.env.DATA_LOG_DIR || DEFAULT_LOG_DIR;

          let timeline;
          try {
            timeline = await loadTimeline(logDir, sym);
          } catch (e: any) {
            res.writeHead(200);
            res.end(JSON.stringify({
              status: 'no_data',
              message: `Data log untuk ${sym.toUpperCase()} belum tersedia.`,
              symbol: sym.toUpperCase()
            }));
            return;
          }

          const customExec = { ...DEFAULT_EXEC };
          if (slippageBps !== undefined) customExec.slippageBps = Number(slippageBps);
          if (feeBps !== undefined) {
            customExec.makerFeeBps = Number(feeBps);
            customExec.takerFeeBps = Number(feeBps);
          }

          // ── GRID SEARCH ROUTE ──
          if (req.url === '/api/backtest/grid') {
            const { strategy = 'wall_bounce', slRange, tpRange } = bodyData;
            const baseStrat = ALL_STRATEGIES.find(s => s.name.toLowerCase().includes(strategy.replace('_',' '))) || STRATEGY_VERIFIED_WALL_BOUNCE;
            
            const gridConfig = {
              symbol: sym,
              interval,
              capital: parseFloat(capital),
              baseStrategy: baseStrat,
              execAssumptions: customExec,
              slRange: slRange || { min: 1, max: 5, step: 1 },
              tpRange: tpRange || { min: 2, max: 10, step: 2 }
            };

            const gridResults = await GridSearchRunner.run(gridConfig, timeline);
            res.writeHead(200);
            res.end(JSON.stringify({ status: 'ok', results: gridResults.slice(0, 10), eventCount: timeline.length }));
            return;
          }

          // ── NORMAL SINGLE BACKTEST ROUTE ──
          const { strategy = 'all', slPct, tpPct } = bodyData;
          const strategies = strategy === 'all'        ? ALL_STRATEGIES
            : strategy === 'wall_bounce'               ? [STRATEGY_VERIFIED_WALL_BOUNCE]
            : strategy === 'cvd_fade'                  ? [STRATEGY_CVD_DIVERGENCE_FADE]
            : strategy === 'composite'                 ? [STRATEGY_COMPOSITE_TRUST]
            : strategy === 'scalping_pullback'         ? [STRATEGY_SCALPING_PULLBACK]
            : strategy === 'liquidity_sweep'           ? [STRATEGY_LIQUIDITY_SWEEP]
            : ALL_STRATEGIES;

          const engine = new BacktestEngine(customExec);
          const results = [];
          for (const strat of strategies) {
            const customStrat = { ...strat };
            if (slPct !== undefined) customStrat.slPct = Number(slPct);
            if (tpPct !== undefined) customStrat.tpPct = Number(tpPct);

            const result = await engine.run(sym, timeline, customStrat, parseFloat(capital), interval);
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
      res.end(JSON.stringify({ error: 'Market data simulator is deprecated.' }));
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
    // ── /api/binance-rest  — Proxy ke api.binance.com ─────────────────────────
    if (req.url && (req.url.startsWith('/api/binance-rest') || req.url.startsWith('/api/binance-fapi'))) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

      let binancePath = req.url;
      let targetHost = 'data-api.binance.vision';
      if (req.url.startsWith('/api/binance-fapi')) {
        binancePath = req.url.replace('/api/binance-fapi', '');
        targetHost = 'fapi.binance.com';
      } else {
        binancePath = req.url.replace('/api/binance-rest', '');
        targetHost = binancePath.startsWith('/fapi/') ? 'fapi.binance.com' : 'data-api.binance.vision';
      }
      
      const targetUrl = `https://${targetHost}${binancePath}`;
      console.log(`[REST Proxy] -> ${targetUrl}`);

      import('https').then(({ default: https }) => {
        const proxyReq = https.get(targetUrl, {
          timeout: 4000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json',
          },
        }, (proxyRes) => {
          res.writeHead(proxyRes.statusCode || 200, {
            'Content-Type': proxyRes.headers['content-type'] || 'application/json',
            'Access-Control-Allow-Origin': '*',
          });
          proxyRes.pipe(res);
        });
        proxyReq.on('error', (err) => {
          console.error(`[REST Proxy] Error: ${err.message}`);
          res.writeHead(502);
          res.end(JSON.stringify({ error: 'Proxy error', detail: err.message }));
        });
        proxyReq.on('timeout', () => {
          proxyReq.destroy();
          res.writeHead(504);
          res.end(JSON.stringify({ error: 'Gateway Timeout (Binance blocked IP)' }));
        });
        proxyReq.end();
      });
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
      ws.close(1008, 'Missing stream parameter');
      return;
    }

    const host = origin;
    const targetUrl = `wss://${host}${streamPath}`;
    console.log(`[Proxy] Connecting to: ${targetUrl}`);


    // Add browser-like headers so Binance doesn't reject the connection
    const binanceWs = new WebSocket(targetUrl, {
      headers: {
        'Origin': 'https://www.binance.com',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
      },
    });
    
    binanceWs.on('open', () => {
      console.log(`[Proxy] Connected to Binance: ${targetUrl}`);
    });

    binanceWs.on('ping', (data) => {
      // Respond to Binance pings so connection stays alive
      binanceWs.pong(data);
    });

    binanceWs.on('message', (data, isBinary) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data, { binary: isBinary });
    });
    binanceWs.on('close', (code, reason) => {
      console.log(`[Proxy] Binance closed: ${code} ${reason}`);
      ws.close();
    });
    binanceWs.on('error', err => {
      console.error(`[Proxy] Binance error: ${err.message}`);
      ws.close();
    });
    
    ws.on('ping', (data) => ws.pong(data));
    ws.on('message', (data, isBinary) => {
      if (binanceWs.readyState === WebSocket.OPEN) binanceWs.send(data, { binary: isBinary });
    });
    ws.on('close', () => binanceWs.close());
    ws.on('error', () => binanceWs.close());
  });


  // ── AGNOIA SIGNAL WebSocket ──────────────────────────────────
  // Broadcasts AI entry signals from Orchestrator to all connected browsers
  const signalWss = new WebSocketServer({ noServer: true });
  const signalClients = new Set<WebSocket>();

  signalWss.on('connection', (ws) => {
    signalClients.add(ws);
    console.log(`[SignalWS] Client connected (${signalClients.size} total)`);
    
    // Send connection confirmation
    ws.send(JSON.stringify({ type: 'CONNECTED', message: 'AGNOIA Signal Feed Active', timestamp: Date.now() }));

    ws.on('close', () => {
      signalClients.delete(ws);
      console.log(`[SignalWS] Client disconnected (${signalClients.size} remaining)`);
    });
    ws.on('error', () => signalClients.delete(ws));
  });

  // Wire Orchestrator events → WebSocket broadcast
  agnoiaEngine.events.on('AI_STATE_UPDATE', (stateUpdate: any) => {
    // 1. Persist to global background state for /api/strategy-state
    const score = stateUpdate.evidence.totalBullish - stateUpdate.evidence.totalBearish;
    globalBackgroundState.aiScoreHistory.push({ score, time: stateUpdate.timestamp });
    if (globalBackgroundState.aiScoreHistory.length > 300) globalBackgroundState.aiScoreHistory.shift();
    
    globalBackgroundState.probState = stateUpdate.probability;
    
    // Determine Phase based on Highest Probability
    const probs = [
      { name: 'ACCUMULATION', val: stateUpdate.probability.accumulation },
      { name: 'DISTRIBUTION', val: stateUpdate.probability.distribution },
      { name: 'TRAP', val: stateUpdate.probability.trap },
      { name: 'RANGING', val: stateUpdate.probability.neutral }
    ];
    probs.sort((a,b) => b.val - a.val);
    globalBackgroundState.aiPhase = probs[0].name;

    globalBackgroundState.entryScore = stateUpdate.probability.accumulation;
    globalBackgroundState.exitScore = stateUpdate.probability.distribution;
    
    // 2. Broadcast to clients
    const payload = JSON.stringify({ type: 'AI_STATE_UPDATE', data: stateUpdate });
    for (const client of signalClients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  });

  agnoiaEngine.events.on('ENTRY_SIGNAL', (signal: any) => {
    const payload = JSON.stringify({ type: 'ENTRY_SIGNAL', data: signal });
    console.log(`[SignalWS] Broadcasting ENTRY: ${signal.symbol} ${signal.direction} (${signalClients.size} clients)`);
    for (const client of signalClients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  });

  // Route upgrade requests
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    if (url.pathname === '/binance-proxy') {
      binanceProxyWss.handleUpgrade(req, socket, head, ws => {
        binanceProxyWss.emit('connection', ws, req);
      });
    } else if (url.pathname === '/agnoia-signals') {
      signalWss.handleUpgrade(req, socket, head, ws => {
        signalWss.emit('connection', ws, req);
      });
    } else {
      socket.destroy();
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
    server.close(() => process.exit(0));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
});
