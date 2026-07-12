// ============================================================
// Custom Server — Runs Next.js + WebSocket on separate ports
// Next.js: port 3000  |  WebSocket: port 3001
// Follows the official Next.js custom server docs pattern.
// ============================================================

import { createServer } from 'http';
import next from 'next';
import { ArenaWSServer } from './wsServer';
import { WhaleTracker } from './whaleTracker';

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const nextPort = parseInt(process.env.PORT || '3000', 10);
const wsPort = parseInt(process.env.WS_PORT || '3001', 10);

const app = next({ dev, hostname, port: nextPort });
const handle = app.getRequestHandler();

// Start 24/7 Whale Engine
const whaleEngine = new WhaleTracker();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    if (req.url === '/api/whale-history') {
      res.setHeader('Content-Type', 'application/json');
      // Fix CORS for local dev if needed
      res.setHeader('Access-Control-Allow-Origin', '*'); 
      res.end(JSON.stringify(whaleEngine.getHistory()));
      return;
    }
    handle(req, res);
  });

  // Start WebSocket server attached to the SAME HTTP server (for Cloud hosting)
  const wsServer = new ArenaWSServer(server);

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
