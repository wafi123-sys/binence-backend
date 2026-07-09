// ============================================================
// WebSocket Server — Real-time communication layer
//
// Order accounting rules:
//  • BUY  placed  → reserve cash (cashBalance -= price × qty)
//  • BUY  active fill (aggressor, immediate) → credit position, refund overpay
//  • BUY  passive fill (resting order hit)   → credit position (cash already reserved)
//  • BUY  cancel  → refund remaining reserved cash
//
//  • SELL placed  → reserve position (stockPosition -= qty)
//  • SELL active fill  → credit cash + realize PnL
//  • SELL passive fill → credit cash + realize PnL
//  • SELL cancel  → restore remaining reserved position
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

interface ConnectedClient {
  ws: WebSocket;
  playerId: string;
  user: UserAccount | null;
  stats: PlayerStats;
  isAlive: boolean;

  // Resting BUY orders: orderId → reserved cash amount
  reservedCash: Map<string, number>;
  // Resting SELL orders: orderId → reserved position lots
  reservedPosition: Map<string, number>;
  // All resting orders: orderId → cumulative filledQty seen so far
  filledSoFar: Map<string, number>;
}

function makeInitialStats(balance: number): PlayerStats {
  return {
    cashBalance: balance,
    stockPosition: 0,
    avgBuyPrice: 0,
    realizedPnL: 0,
    unrealizedPnL: 0,
    totalTrades: 0,
    totalBought: 0,
    totalSold: 0,
  };
}

function makeClient(ws: WebSocket, playerId: string): ConnectedClient {
  return {
    ws,
    playerId,
    user: null,
    stats: makeInitialStats(0),
    isAlive: true,
    reservedCash: new Map(),
    reservedPosition: new Map(),
    filledSoFar: new Map(),
  };
}

export class ArenaWSServer {
  private wss: WebSocketServer;
  private engine: Engine;
  private clients: Map<string, ConnectedClient> = new Map();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private onlineUsers: Set<string> = new Set();

  constructor(wsPort: number = 3001) {
    this.engine = new Engine(5000);
    this.wss = new WebSocketServer({ port: wsPort });

    this.setupEngineEvents();
    this.setupWebSocket();
    this.startHeartbeat();
    this.engine.start();

    console.log(`[Arena WS] WebSocket server started on port ${wsPort}`);
  }

  getPlayerCount(): number {
    return [...this.clients.values()].filter((c) => c.user !== null).length;
  }

  shutdown(): void {
    this.engine.stop();
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.wss.close();
  }

  // ── Engine Events → Broadcast ─────────────────────────────

  private setupEngineEvents(): void {
    this.engine.setEvents({
      onExecution: (exec) => {
        this.broadcastAuth({ type: 'execution', payload: exec });
      },

      onOrderBookUpdate: (asks, bids) => {
        this.broadcastAuth({ type: 'order_book_update', payload: { asks, bids } });
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
        // Update unrealized PnL for all players with open positions
        this.updateUnrealizedPnL(snap.lastPrice);
      },

      onOHLCUpdate: (timeframe: Timeframe, bar) => {
        this.broadcastAuth({ type: 'ohlc_update', payload: { timeframe, bar } });
      },

      // ── Order update callback ─────────────────────────────
      // This fires for:
      //   1. PASSIVE fills: a resting player order was hit by an aggressor (bot or other player)
      //   2. ACTIVE fills:  the aggressor's own order (fires DURING engine.submitOrder())
      //
      // We only process PASSIVE fills here.
      // ACTIVE fills are handled in handleClientMessage after engine.submitOrder() returns.
      // DISTINCTION: passive orders are tracked in reservedCash/reservedPosition maps.
      onOrderUpdate: (order: Order) => {
        const client = this.clients.get(order.playerId);
        if (!client || !client.user) return;

        // Always send the order status update to the client
        this.send(client.ws, { type: 'my_order_update', payload: order });

        // Is this a passive fill? Check if this order is tracked as a resting order.
        const isPassiveBuy = client.reservedCash.has(order.id);
        const isPassiveSell = client.reservedPosition.has(order.id);

        if ((isPassiveBuy || isPassiveSell) && order.filledQty > 0) {
          this.processPassiveFill(client, order);
        }
      },
    });
  }

  // ── Passive fill processor ─────────────────────────────────
  // Called when a resting player order gets hit.
  // Uses filledSoFar delta to know exactly how many lots just filled.

  private processPassiveFill(client: ConnectedClient, order: Order): void {
    const previousFilled = client.filledSoFar.get(order.id) ?? 0;
    const justFilled = order.filledQty - previousFilled;
    if (justFilled <= 0) return;

    const fillPrice = order.price; // limit orders always fill at their price
    const stats = client.stats;

    if (order.side === OrderSide.BUY) {
      // Cash was already reserved when order was placed — no cash change.
      // Just credit the stock position.
      const prevCost = stats.avgBuyPrice * stats.stockPosition;
      stats.stockPosition += justFilled;
      stats.avgBuyPrice = stats.stockPosition > 0
        ? (prevCost + fillPrice * justFilled) / stats.stockPosition
        : 0;
      stats.totalBought += justFilled;
      stats.totalTrades += 1;

    } else if (order.side === OrderSide.SELL) {
      // Credit cash proceeds + realize PnL
      const proceeds = fillPrice * justFilled;
      stats.cashBalance += proceeds;
      const pnl = (fillPrice - stats.avgBuyPrice) * justFilled;
      stats.realizedPnL += pnl;
      stats.totalSold += justFilled;
      stats.totalTrades += 1;
      if (stats.stockPosition <= 0) stats.avgBuyPrice = 0;
    }

    // Update unrealized PnL mark-to-market
    const snap = this.engine.getSnapshot();
    const lastPrice = snap.lastPrice > 0 ? snap.lastPrice : fillPrice;
    stats.unrealizedPnL = stats.stockPosition > 0
      ? (lastPrice - stats.avgBuyPrice) * stats.stockPosition
      : 0;

    // Update tracking maps
    if (order.status === OrderStatus.FILLED) {
      client.filledSoFar.delete(order.id);
      client.reservedCash.delete(order.id);
      client.reservedPosition.delete(order.id);
    } else {
      // Partial fill — update seen counter
      client.filledSoFar.set(order.id, order.filledQty);
    }

    this.send(client.ws, { type: 'stats_update', payload: { ...stats } });
  }

  // ── Unrealized PnL broadcast ──────────────────────────────

  private updateUnrealizedPnL(lastPrice: number): void {
    for (const [, client] of this.clients) {
      if (!client.user || client.stats.stockPosition === 0) continue;
      client.stats.unrealizedPnL =
        (lastPrice - client.stats.avgBuyPrice) * client.stats.stockPosition;
      this.send(client.ws, { type: 'stats_update', payload: { ...client.stats } });
    }
  }

  // ── WebSocket Connection Setup ─────────────────────────────

  private setupWebSocket(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      const connId = `conn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      let currentId = connId; // Tracks the map key (changes to user.id after login)

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
            currentId = newId; // Update the ID when login succeeds
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

      // Upgrade connection to real player
      this.clients.delete(clientId);
      client.playerId = user.id;
      client.user = user;
      client.stats = makeInitialStats(user.balance);
      this.clients.set(user.id, client);
      this.onlineUsers.add(user.id);
      onIdChanged(user.id);

      console.log(`[Arena WS] ✅ Login: ${user.username} (${user.role}) — ${formatRupiah(user.balance)}`);

      const snapshot = this.engine.getSnapshot();
      const ohlc = this.engine.getOHLCData();

      this.send(client.ws, {
        type: 'welcome',
        payload: {
          playerId: user.id,
          username: user.username,
          balance: user.balance,
          role: user.role,
          avatar: user.avatar,
          stats: { ...client.stats },
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
    const stats = client.stats;

    if (quantity <= 0) {
      this.send(client.ws, { type: 'error', payload: { message: 'Lot harus lebih dari 0.' } });
      return;
    }

    // ── BUY order ────────────────────────────────────────
    if (side === OrderSide.BUY) {
      const snap = this.engine.getSnapshot();
      // For market orders, estimate using lastPrice; for limit, use limit price
      const reservePrice = orderType === OrderType.MARKET
        ? (snap.lastPrice > 0 ? snap.lastPrice : price)
        : price;
      const requiredCash = reservePrice * quantity;

      if (requiredCash > stats.cashBalance) {
        this.send(client.ws, {
          type: 'error',
          payload: { message: `Saldo tidak cukup. Butuh ${formatRupiah(requiredCash)}, tersedia ${formatRupiah(stats.cashBalance)}.` },
        });
        return;
      }

      // Reserve cash immediately
      stats.cashBalance -= requiredCash;

      let result: ReturnType<Engine['submitOrder']>;
      try {
        // NOTE: onOrderUpdate fires INSIDE here for the aggressor's own fill.
        // We do NOT process those in onOrderUpdate (reservedCash not set yet).
        result = this.engine.submitOrder(client.user!.id, side, orderType, price, quantity);
      } catch (err: unknown) {
        stats.cashBalance += requiredCash; // rollback
        this.send(client.ws, { type: 'error', payload: { message: err instanceof Error ? err.message : 'Gagal submit order.' } });
        return;
      }

      const order = result.order;
      const executions = result.executions;

      // ── Process ACTIVE (immediate) fills ─────────────
      // Use the returned executions for accurate accounting.
      let totalActiveCost = 0;
      let totalActiveQty = 0;
      for (const exec of executions) {
        if (exec.buyOrderId === order.id) {
          const prevCost = stats.avgBuyPrice * stats.stockPosition;
          stats.stockPosition += exec.volume;
          stats.avgBuyPrice = stats.stockPosition > 0
            ? (prevCost + exec.price * exec.volume) / stats.stockPosition
            : 0;
          stats.totalBought += exec.volume;
          stats.totalTrades += 1;
          totalActiveCost += exec.price * exec.volume;
          totalActiveQty += exec.volume;
        }
      }

      // Refund difference between reserved and actual fill cost
      const overpay = requiredCash - totalActiveCost;
      stats.cashBalance += overpay;

      // If order still has remaining qty resting on book, track it
      const remainingQty = quantity - totalActiveQty;
      if (remainingQty > 0 && order.status !== OrderStatus.FILLED) {
        client.reservedCash.set(order.id, reservePrice * remainingQty);
        client.filledSoFar.set(order.id, totalActiveQty);
      }

      // Update unrealized PnL
      const lastPx = this.engine.getSnapshot().lastPrice;
      stats.unrealizedPnL = stats.stockPosition > 0
        ? (lastPx - stats.avgBuyPrice) * stats.stockPosition
        : 0;

      this.send(client.ws, { type: 'stats_update', payload: { ...stats } });
      this.send(client.ws, { type: 'my_order_update', payload: order });
      return;
    }

    // ── SELL order ────────────────────────────────────────
    if (side === OrderSide.SELL) {
      if (quantity > stats.stockPosition) {
        this.send(client.ws, {
          type: 'error',
          payload: { message: `Posisi tidak cukup. Punya ${stats.stockPosition} lot, ingin jual ${quantity} lot.` },
        });
        return;
      }

      // Reserve position immediately
      stats.stockPosition -= quantity;

      let result: ReturnType<Engine['submitOrder']>;
      try {
        result = this.engine.submitOrder(client.user!.id, side, orderType, price, quantity);
      } catch (err: unknown) {
        stats.stockPosition += quantity; // rollback
        this.send(client.ws, { type: 'error', payload: { message: err instanceof Error ? err.message : 'Gagal submit order.' } });
        return;
      }

      const order = result.order;
      const executions = result.executions;

      // ── Process ACTIVE (immediate) fills ─────────────
      let totalActiveQty = 0;
      for (const exec of executions) {
        if (exec.sellOrderId === order.id) {
          const proceeds = exec.price * exec.volume;
          stats.cashBalance += proceeds;
          const pnl = (exec.price - stats.avgBuyPrice) * exec.volume;
          stats.realizedPnL += pnl;
          stats.totalSold += exec.volume;
          stats.totalTrades += 1;
          totalActiveQty += exec.volume;
        }
      }

      if (stats.stockPosition <= 0) stats.avgBuyPrice = 0;

      // If order still has remaining qty resting on book, track it
      const remainingQty = quantity - totalActiveQty;
      if (remainingQty > 0 && order.status !== OrderStatus.FILLED) {
        client.reservedPosition.set(order.id, remainingQty);
        client.filledSoFar.set(order.id, totalActiveQty);
      }

      // Update unrealized PnL
      const lastPx = this.engine.getSnapshot().lastPrice;
      stats.unrealizedPnL = stats.stockPosition > 0
        ? (lastPx - stats.avgBuyPrice) * stats.stockPosition
        : 0;

      this.send(client.ws, { type: 'stats_update', payload: { ...stats } });
      this.send(client.ws, { type: 'my_order_update', payload: order });
      return;
    }

    this.send(client.ws, { type: 'error', payload: { message: 'Side tidak valid.' } });
  }

  // ── Cancel Order Handler ──────────────────────────────────

  private handleCancelOrder(client: ConnectedClient, orderId: string): void {
    const result = this.engine.cancelOrder(orderId, client.user!.id);

    if (!result) {
      this.send(client.ws, { type: 'error', payload: { message: 'Order tidak ditemukan atau bukan milik Anda.' } });
      return;
    }

    const stats = client.stats;
    const remainingQty = result.quantity; // from matchingEngine: bookOrder.remainingQty

    if (client.reservedCash.has(orderId)) {
      // BUY order cancelled: refund reserved cash for remaining qty
      const refund = result.price * remainingQty;
      stats.cashBalance += refund;
      client.reservedCash.delete(orderId);
    }

    if (client.reservedPosition.has(orderId)) {
      // SELL order cancelled: restore reserved position for remaining qty
      stats.stockPosition += remainingQty;
      client.reservedPosition.delete(orderId);
    }

    client.filledSoFar.delete(orderId);

    this.send(client.ws, { type: 'stats_update', payload: { ...stats } });
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
}
