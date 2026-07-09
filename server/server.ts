// ============================================================
// Custom Server — Runs Next.js + WebSocket on separate ports
// Next.js: port 3000  |  WebSocket: port 3001
// Follows the official Next.js custom server docs pattern.
// ============================================================

import { createServer } from 'http';
import next from 'next';
import { ArenaWSServer } from './wsServer';

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const nextPort = parseInt(process.env.PORT || '3000', 10);
const wsPort = parseInt(process.env.WS_PORT || '3001', 10);

const app = next({ dev, hostname, port: nextPort });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    handle(req, res);
  });

  // Start WebSocket server on its own port (avoid HMR conflict)
  const wsServer = new ArenaWSServer(wsPort);

  server.listen(nextPort, () => {
    console.log(`\n🏟️  Order Book Arena`);
    console.log(`   App:       http://${hostname}:${nextPort}`);
    console.log(`   WebSocket: ws://${hostname}:${wsPort}`);
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
