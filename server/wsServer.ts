// ============================================================
// WebSocket Server — Real-time communication layer
//
// Accounting rules are enforced by AccountEngine exclusively.
// wsServer only: receives messages → validates → calls AccountEngine
//                                  → sends response to clients.
//
// NO manual balance/position manipulation is done here.
// ============================================================

import { WebSocketServer, WebSocket } from 'ws';
import { Engine } from '../engine';
import {
  WSClientMessage,
  WSServerMessage,
  OrderSide,
  OrderType,
  Order,
  OrderStatus,
  PlayerStats,
  Timeframe,
} from '../engine/types';
import { authenticateUser, UserAccount, formatRupiah } from '../lib/users';
import { AccountEngine, AccountState } from '../engine/accountEngine';

// Simple throttle helper
function throttle(func: Function, limit: number) {
  let inThrottle: boolean;
  let lastArgs: any[];
  return function(this: any, ...args: any[]) {
    lastArgs = args;
    if (!inThrottle) {
      func.apply(this, lastArgs);
      inThrottle = true;
      setTimeout(() => {
        inThrottle = false;
        // if we received new args during the throttle period, fire once more
        if (lastArgs !== args) {
           func.apply(this, lastArgs);
        }
      }, limit);
    }
  }
}

// ── Helper: AccountState → PlayerStats (WS wire format) ──────

function stateToStats(s: AccountState): PlayerStats {
  return {
    initialBalance: s.initialBalance,
    cashBalance: s.cashBalance,
    activeBalance: s.activeBalance,
    availableBalance: s.availableBalance,
    stockPosition: s.stockPosition,
    avgBuyPrice: s.avgBuyPrice,
    portfolioValue: s.portfolioValue,
    totalEquity: s.totalEquity,
    unrealizedPnL: s.unrealizedPnL,
    realizedPnL: s.realizedPnL,
    returnPct: s.returnPct,
    totalTrades: s.totalTrades,
    totalBought: s.totalBought,
    totalSold: s.totalSold,
    winTrade: s.winTrade,
    lossTrade: s.lossTrade,
    winRate: s.winRate,
  };
}

// ── Persistent Session ────────────────────────────────────────

interface PlayerSession {
  account: AccountEngine;
}

interface ConnectedClient {
  ws: WebSocket;
  playerId: string;
  user: UserAccount | null;
  account: AccountEngine;
  isAlive: boolean;
}

function makeClient(ws: WebSocket, playerId: string): ConnectedClient {
  return {
    ws,
    playerId,
    user: null,
    account: new AccountEngine(0), // replaced on login
    isAlive: true,
  };
}

export class ArenaWSServer {
  private wss: WebSocketServer;
  private engine: Engine;
  private clients: Map<string, ConnectedClient> = new Map();
  private sessions: Map<string, PlayerSession> = new Map();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private leaderboardInterval: ReturnType<typeof setInterval> | null = null;
  private onlineUsers: Set<string> = new Set();

  constructor(serverOrPort: number | import('http').Server = 3001) {
    this.engine = new Engine(300);
    
    if (typeof serverOrPort === 'number') {
      this.wss = new WebSocketServer({ port: serverOrPort });
      console.log(`[Arena WS] WebSocket server started on port ${serverOrPort}`);
    } else {
      this.wss = new WebSocketServer({ server: serverOrPort });
      console.log(`[Arena WS] WebSocket server attached to HTTP server`);
    }

    this.setupEngineEvents();
    this.setupWebSocket();
    this.startHeartbeat();
    this.startLeaderboardBroadcast();
    this.engine.start();
  }

  getEngine(): Engine {
    return this.engine;
  }

  getPlayerCount(): number {
    return [...this.clients.values()].filter((c) => c.user !== null).length;
  }

  shutdown(): void {
    this.engine.stop();
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.leaderboardInterval) clearInterval(this.leaderboardInterval);
    this.wss.close();
  }

  // ── Engine Events → Broadcast ─────────────────────────────

  private setupEngineEvents(): void {
    // Throttle order book updates to max 10 per second (100ms)
    const throttledOrderBookBroadcast = throttle((asks: any, bids: any) => {
      this.broadcastAuth({ type: 'order_book_update', payload: { asks, bids } });
    }, 100);

    this.engine.setEvents({
      onExecution: (exec) => {
        this.broadcastAuth({ type: 'execution', payload: exec });
      },

      onOrderBookUpdate: (asks, bids) => {
        throttledOrderBookBroadcast(asks, bids);
      },

      onRunningTrade: (trade) => {
        this.broadcastAuth({ type: 'running_trade', payload: trade });
        const snap = this.engine.getSnapshot();
        this.broadcastAuth({
          type: 'market_info',
          payload: {
            lastPrice: snap.lastPrice,
            lastVolume: snap.lastVolume,
            lastSide: snap.lastSide,
            playerCount: this.getPlayerCount(),
          },
        });
        // Notify AccountEngine of new price for all players with open positions
        this.onPriceUpdate(snap.lastPrice);
      },

      onOHLCUpdate: (timeframe: Timeframe, bar) => {
        this.broadcastAuth({ type: 'ohlc_update', payload: { timeframe, bar } });
      },

      // ── PASSIVE fills: a resting player order was hit by an aggressor ──
      // Active (aggressor) fills are handled after engine.submitOrder() returns.
      onOrderUpdate: (order: Order) => {
        const client = this.clients.get(order.playerId);
        if (!client || !client.user) return;

        // Always send order status update
        this.send(client.ws, { type: 'my_order_update', payload: order });

        const isPassiveBuy = client.account.pendingBuyReserves.has(order.id);
        const isPassiveSell = client.account.pendingSellReserves.has(order.id);

        if ((isPassiveBuy || isPassiveSell) && order.filledQty > 0) {
          this.processPassiveFill(client, order);
        }
      },
    });
  }

  // ── Passive fill processor ────────────────────────────────
  // Called when a resting player order gets hit by another party.

  private processPassiveFill(client: ConnectedClient, order: Order): void {
    const acct = client.account;
    const snap = this.engine.getSnapshot();
    const lastPrice = snap.lastPrice > 0 ? snap.lastPrice : order.price;

    const previousFilled = acct.filledSoFar.get(order.id) ?? 0;
    const justFilled = order.filledQty - previousFilled;
    if (justFilled <= 0) return;

    const fillPrice = order.price;

    if (order.side === OrderSide.BUY) {
      acct.onBuyExecution(order.id, fillPrice, justFilled, lastPrice);
    } else if (order.side === OrderSide.SELL) {
      acct.onSellExecution(order.id, fillPrice, justFilled, lastPrice);
    }

    if (order.status === OrderStatus.FILLED) {
      acct.onOrderCompleted(order.id);
    }

    this.send(client.ws, { type: 'stats_update', payload: stateToStats(acct.getState()) });
  }

  // ── Price update broadcast ────────────────────────────────

  private onPriceUpdate(lastPrice: number): void {
    for (const [, client] of this.clients) {
      if (!client.user || client.account.getPosition() === 0) continue;
      client.account.onPriceUpdate(lastPrice);
      this.send(client.ws, {
        type: 'stats_update',
        payload: stateToStats(client.account.getState()),
      });
    }
  }

  // ── WebSocket Connection Setup ────────────────────────────

  private setupWebSocket(): void {
    this.wss.on('connection', (ws: WebSocket, req: any) => {
      const url = req.url || '';
      
      // BINANCE PROXY LOGIC (Bypasses ISP DPI Block in Browser)
      if (url.startsWith('/binance-proxy')) {
        let targetUrl = '';
        if (url.startsWith('/binance-proxy/fstream/')) {
          const binancePath = url.replace('/binance-proxy/fstream', '');
          targetUrl = `wss://stream.binancefuture.com${binancePath}`;
        } else {
          const binancePath = url.replace('/binance-proxy', '');
          targetUrl = `wss://data-stream.binance.vision${binancePath}`;
        }
        
        try {
          // Note: using the same 'ws' class already imported at top of file
          const { WebSocket: ClientWS } = require('ws');
          const binanceWs = new ClientWS(targetUrl);
          
          binanceWs.on('message', (data: any) => {
            if (ws.readyState === ws.OPEN) ws.send(data.toString());
          });
          
          binanceWs.on('close', () => {
            if (ws.readyState === ws.OPEN) ws.close();
          });
          
          binanceWs.on('error', (e: any) => {
            console.error('Binance proxy error:', e.message);
            if (ws.readyState === ws.OPEN) ws.close();
          });
          
          ws.on('message', (data: any) => {
            if (binanceWs.readyState === binanceWs.OPEN) binanceWs.send(data);
          });
          
          ws.on('close', () => {
            if (binanceWs.readyState === binanceWs.OPEN) binanceWs.close();
          });
          
        } catch (e) {
          ws.close();
        }
        return; // Skip standard game engine auth logic
      }

      const connId = `conn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      let currentId = connId;

      const client = makeClient(ws, currentId);
      this.clients.set(currentId, client);

      this.send(ws, {
        type: 'auth_required',
        payload: { message: 'Silakan login dengan username dan password.' },
      });

      ws.on('message', (data: Buffer) => {
        try {
          const msg: WSClientMessage = JSON.parse(data.toString());
          this.handleClientMessage(currentId, msg, (newId) => {
            currentId = newId;
          });
        } catch {
          this.send(ws, { type: 'error', payload: { message: 'Format pesan tidak valid.' } });
        }
      });

      ws.on('close', () => {
        const c = this.clients.get(currentId);
        if (c?.user) {
          this.onlineUsers.delete(c.user.id);
          console.log(`[Arena WS] Offline: ${c.user.username}`);
        }
        this.clients.delete(currentId);
      });

      ws.on('pong', () => {
        const c = this.clients.get(currentId);
        if (c) c.isAlive = true;
      });
    });
  }

  // ── Message Dispatch ──────────────────────────────────────

  private handleClientMessage(
    clientId: string,
    msg: WSClientMessage,
    onIdChanged: (newId: string) => void
  ): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    // ── LOGIN ─────────────────────────────────────────────
    if (msg.type === 'login') {
      const user = authenticateUser(msg.payload.username, msg.payload.password);

      if (!user) {
        this.send(client.ws, { type: 'auth_error', payload: { message: 'Username atau password salah.' } });
        return;
      }
      if (this.onlineUsers.has(user.id)) {
        this.send(client.ws, { type: 'auth_error', payload: { message: 'Akun ini sudah login di sesi lain.' } });
        return;
      }

      // Persistent session logic — keep account between reconnects
      let session = this.sessions.get(user.id);
      if (!session) {
        session = { account: new AccountEngine(user.balance) };
        this.sessions.set(user.id, session);
      }

      // Upgrade connection
      this.clients.delete(clientId);
      client.playerId = user.id;
      client.user = user;
      client.account = session.account;
      this.clients.set(user.id, client);
      this.onlineUsers.add(user.id);
      onIdChanged(user.id);

      console.log(`[Arena WS] ✅ Login: ${user.username} (${user.role}) — ${formatRupiah(user.balance)}`);

      const snapshot = this.engine.getSnapshot();
      const ohlc = this.engine.getOHLCData();

      // Sync unrealized with current price on reconnect
      if (snapshot.lastPrice > 0) {
        client.account.onPriceUpdate(snapshot.lastPrice);
      }

      this.send(client.ws, {
        type: 'welcome',
        payload: {
          playerId: user.id,
          username: user.username,
          balance: user.balance,
          role: user.role,
          avatar: user.avatar,
          stats: stateToStats(client.account.getState()),
          snapshot,
          ohlc,
        },
      });
      return;
    }

    // ── Require auth ──────────────────────────────────────
    if (!client.user) {
      this.send(client.ws, { type: 'auth_error', payload: { message: 'Anda belum login.' } });
      return;
    }

    // ── SUBMIT ORDER ──────────────────────────────────────
    if (msg.type === 'submit_order') {
      this.handleSubmitOrder(client, msg.payload);
      return;
    }

    // ── CANCEL ORDER ──────────────────────────────────────
    if (msg.type === 'cancel_order') {
      this.handleCancelOrder(client, msg.payload.orderId);
      return;
    }

    // ── MODIFY ORDER ─────────────────────────────────────
    if (msg.type === 'modify_order') {
      const { orderId, newPrice, newQuantity } = msg.payload;
      const result = this.engine.modifyOrder(orderId, client.user.id, newPrice, newQuantity);
      if (!result) {
        this.send(client.ws, { type: 'error', payload: { message: 'Order tidak ditemukan atau bukan milik Anda.' } });
      }
    }
  }

  // ── Submit Order Handler ──────────────────────────────────

  private handleSubmitOrder(
    client: ConnectedClient,
    payload: { side: OrderSide; orderType: OrderType; price: number; quantity: number }
  ): void {
    const { side, orderType, price, quantity } = payload;
    const acct = client.account;
    const snap = this.engine.getSnapshot();
    const lastPrice = snap.lastPrice;

    if (quantity <= 0) {
      this.send(client.ws, { type: 'error', payload: { message: 'Lot harus lebih dari 0.' } });
      return;
    }

    // ── BUY order ─────────────────────────────────────────
    if (side === OrderSide.BUY) {
      const reservePrice = orderType === OrderType.MARKET
        ? (lastPrice > 0 ? lastPrice : price)
        : price;

      // Check if player can afford this (without reserving yet)
      if (!acct.canAffordBuy(reservePrice, quantity)) {
        const required = reservePrice * quantity * 100;
        this.send(client.ws, {
          type: 'error',
          payload: {
            message: `Saldo tidak cukup. Butuh ${formatRupiah(required)}, tersedia ${formatRupiah(acct.getAvailableBalance())}.`,
          },
        });
        return;
      }

      // Submit to matching engine
      let result: ReturnType<Engine['submitOrder']>;
      try {
        result = this.engine.submitOrder(client.user!.id, side, orderType, price, quantity);
      } catch (err: unknown) {
        this.send(client.ws, {
          type: 'error',
          payload: { message: err instanceof Error ? err.message : 'Gagal submit order.' },
        });
        return;
      }

      const order = result.order;
      const executions = result.executions;

      // Process immediate (aggressor) fills
      let totalFillLots = 0;
      for (const exec of executions) {
        if (exec.buyOrderId === order.id) {
          acct.onBuyExecution(order.id, exec.price, exec.volume, lastPrice);
          totalFillLots += exec.volume;
        }
      }

      // If order is fully filled, clean up
      if (order.status === OrderStatus.FILLED) {
        acct.onOrderCompleted(order.id);
      } else {
        // Order is resting (NEW or PARTIAL) — reserve cash for remaining qty
        const remainingLots = quantity - totalFillLots;
        if (remainingLots > 0) {
          acct.reserveForBuy(order.id, reservePrice, remainingLots);
        }
      }

      acct.onPriceUpdate(lastPrice);
      this.send(client.ws, { type: 'stats_update', payload: stateToStats(acct.getState()) });
      this.send(client.ws, { type: 'my_order_update', payload: order });
      return;
    }

    // ── SELL order ─────────────────────────────────────────
    if (side === OrderSide.SELL) {
      // Check if player has enough position
      if (!acct.canAffordSell(quantity)) {
        this.send(client.ws, {
          type: 'error',
          payload: {
            message: `Posisi tidak cukup. Punya ${acct.getPosition()} lot, ingin jual ${quantity} lot.`,
          },
        });
        return;
      }

      // Submit to matching engine
      let result: ReturnType<Engine['submitOrder']>;
      try {
        result = this.engine.submitOrder(client.user!.id, side, orderType, price, quantity);
      } catch (err: unknown) {
        this.send(client.ws, {
          type: 'error',
          payload: { message: err instanceof Error ? err.message : 'Gagal submit order.' },
        });
        return;
      }

      const order = result.order;
      const executions = result.executions;

      // Process immediate (aggressor) fills
      let totalFillLots = 0;
      for (const exec of executions) {
        if (exec.sellOrderId === order.id) {
          acct.onSellExecution(order.id, exec.price, exec.volume, lastPrice);
          totalFillLots += exec.volume;
        }
      }

      // If order is fully filled, clean up
      if (order.status === OrderStatus.FILLED) {
        acct.onOrderCompleted(order.id);
      } else {
        // Order is resting — reserve position for remaining qty
        const remainingLots = quantity - totalFillLots;
        if (remainingLots > 0) {
          acct.reserveForSell(order.id, remainingLots);
        }
      }

      acct.onPriceUpdate(lastPrice);
      this.send(client.ws, { type: 'stats_update', payload: stateToStats(acct.getState()) });
      this.send(client.ws, { type: 'my_order_update', payload: order });
      return;
    }

    this.send(client.ws, { type: 'error', payload: { message: 'Side tidak valid.' } });
  }

  // ── Cancel Order Handler ──────────────────────────────────

  private handleCancelOrder(client: ConnectedClient, orderId: string): void {
    const result = this.engine.cancelOrder(orderId, client.user!.id);

    if (!result) {
      this.send(client.ws, {
        type: 'error',
        payload: { message: 'Order tidak ditemukan atau bukan milik Anda.' },
      });
      return;
    }

    const acct = client.account;
    acct.onOrderCancelled(orderId, result.side);

    const snap = this.engine.getSnapshot();
    if (snap.lastPrice > 0) acct.onPriceUpdate(snap.lastPrice);

    this.send(client.ws, {
      type: 'stats_update',
      payload: stateToStats(acct.getState()),
    });
    this.send(client.ws, { type: 'my_order_update', payload: result });
  }

  // ── Communication Helpers ─────────────────────────────────

  private send(ws: WebSocket, msg: WSServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  private broadcastAuth(msg: WSServerMessage): void {
    const data = JSON.stringify(msg);
    for (const [, client] of this.clients) {
      if (client.user && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(data);
      }
    }
  }

  // ── Heartbeat ─────────────────────────────────────────────

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      for (const [id, client] of this.clients) {
        if (!client.isAlive) {
          client.ws.terminate();
          if (client.user) this.onlineUsers.delete(client.user.id);
          this.clients.delete(id);
          continue;
        }
        client.isAlive = false;
        client.ws.ping();
      }
    }, 30000);
  }

  // ── Leaderboard Broadcast ─────────────────────────────────

  private startLeaderboardBroadcast(): void {
    this.leaderboardInterval = setInterval(() => {
      const leaderboard = this.engine.getSultanLeaderboard();
      this.broadcastAuth({ type: 'sultan_leaderboard_update', payload: leaderboard });
    }, 1000); // 1-second update
  }
}
