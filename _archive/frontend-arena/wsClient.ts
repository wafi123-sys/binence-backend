// ============================================================
// WebSocket Client — Browser-side WebSocket wrapper
// Connects to the server, sends login + orders, receives market data.
// ============================================================

import {
  WSClientMessage,
  WSServerMessage,
  OrderSide,
  OrderType,
  OrderBookLevel,
  Execution,
  RunningTrade,
  OHLCBar,
  Timeframe,
  Order,
  MarketSnapshot,
  PlayerStats,
  SultanBotStats,
} from '../engine/types';

type EventCallback<T> = (data: T) => void;

interface WSClientEvents {
  onAuthRequired: EventCallback<{ message: string }>;
  onAuthError: EventCallback<{ message: string }>;
  onWelcome: EventCallback<{
    playerId: string;
    username: string;
    balance: number;
    role: 'player' | 'whale';
    avatar: string;
    stats: PlayerStats;
    snapshot: MarketSnapshot;
    ohlc: Record<Timeframe, OHLCBar[]>;
  }>;
  onStatsUpdate: EventCallback<PlayerStats>;
  onOrderBookUpdate: EventCallback<{ asks: OrderBookLevel[]; bids: OrderBookLevel[] }>;
  onExecution: EventCallback<Execution>;
  onRunningTrade: EventCallback<RunningTrade>;
  onOHLCUpdate: EventCallback<{ timeframe: Timeframe; bar: OHLCBar }>;
  onMyOrderUpdate: EventCallback<Order>;
  onMarketInfo: EventCallback<{
    lastPrice: number;
    lastVolume: number;
    lastSide: OrderSide | null;
    playerCount: number;
  }>;
  onError: EventCallback<{ message: string }>;
  onSultanLeaderboardUpdate: EventCallback<SultanBotStats[]>;
  onConnectionChange: EventCallback<'connected' | 'disconnected' | 'reconnecting'>;
}

export class WSClient {
  private ws: WebSocket | null = null;
  private url: string;
  private events: Partial<WSClientEvents> = {};
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 50;
  private shouldReconnect = true;

  // Stored credentials for auto-re-login after reconnect
  private pendingLogin: { username: string; password: string } | null = null;

  constructor(url?: string) {
    if (url) {
      this.url = url;
    } else if (typeof window !== 'undefined') {
      const hostname = window.location.hostname;
      // If deployed on Vercel, fallback to the ngrok URL. Otherwise use the current IP/localhost.
      if (hostname.includes('vercel.app')) {
        this.url = 'wss://essentially-receive-place-ebony.trycloudflare.com';
      } else {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        this.url = `${protocol}//${window.location.host}`;
      }
    } else {
      this.url = 'ws://localhost:3001';
    }
  }

  // ── Event Registration ────────────────────────────────────

  on<K extends keyof WSClientEvents>(event: K, callback: WSClientEvents[K]): void {
    this.events[event] = callback;
  }

  // ── Connection ────────────────────────────────────────────

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    this.shouldReconnect = true;

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log('[WSClient] Connected to arena');
        this.reconnectAttempts = 0;
        this.events.onConnectionChange?.('connected');
      };

      this.ws.onmessage = (event: MessageEvent) => {
        try {
          const msg: WSServerMessage = JSON.parse(event.data);
          this.handleMessage(msg);
        } catch (err) {
          console.error('[WSClient] Failed to parse message:', err);
        }
      };

      this.ws.onclose = () => {
        console.log('[WSClient] Disconnected');
        this.events.onConnectionChange?.('disconnected');
        this.attemptReconnect();
      };

      this.ws.onerror = (error: Event) => {
        console.error('[WSClient] WebSocket error:', error);
      };
    } catch (err) {
      console.error('[WSClient] Failed to connect:', err);
      this.attemptReconnect();
    }
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.pendingLogin = null;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  // ── Auth ──────────────────────────────────────────────────

  login(username: string, password: string): void {
    this.pendingLogin = { username, password };
    this.send({ type: 'login', payload: { username, password } });
  }

  // ── Send Commands ─────────────────────────────────────────

  submitOrder(side: OrderSide, orderType: OrderType, price: number, quantity: number): void {
    this.send({
      type: 'submit_order',
      payload: { side, orderType, price, quantity },
    });
  }

  cancelOrder(orderId: string): void {
    this.send({
      type: 'cancel_order',
      payload: { orderId },
    });
  }

  modifyOrder(orderId: string, newPrice?: number, newQuantity?: number): void {
    this.send({
      type: 'modify_order',
      payload: { orderId, newPrice, newQuantity },
    });
  }

  // ── State ─────────────────────────────────────────────────

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  // ── Private ───────────────────────────────────────────────

  private send(msg: WSClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      console.warn('[WSClient] Not connected. Message not sent:', msg.type);
    }
  }

  private handleMessage(msg: WSServerMessage): void {
    switch (msg.type) {
      case 'auth_required':
        if (this.pendingLogin) {
          this.send({ type: 'login', payload: this.pendingLogin });
        } else {
          this.events.onAuthRequired?.(msg.payload);
        }
        break;
      case 'auth_error':
        this.events.onAuthError?.(msg.payload);
        break;
      case 'welcome':
        this.events.onWelcome?.(msg.payload);
        break;
      case 'stats_update':
        this.events.onStatsUpdate?.(msg.payload);
        break;
      case 'order_book_update':
        this.events.onOrderBookUpdate?.(msg.payload);
        break;
      case 'execution':
        this.events.onExecution?.(msg.payload);
        break;
      case 'running_trade':
        this.events.onRunningTrade?.(msg.payload);
        break;
      case 'ohlc_update':
        this.events.onOHLCUpdate?.(msg.payload);
        break;
      case 'my_order_update':
        this.events.onMyOrderUpdate?.(msg.payload);
        break;
      case 'market_info':
        this.events.onMarketInfo?.(msg.payload);
        break;
      case 'sultan_leaderboard_update':
        this.events.onSultanLeaderboardUpdate?.(msg.payload);
        break;
      case 'error':
        this.events.onError?.(msg.payload);
        break;
    }
  }

  private attemptReconnect(): void {
    if (!this.shouldReconnect) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[WSClient] Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 10000);

    console.log(
      `[WSClient] Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts})`
    );
    this.events.onConnectionChange?.('reconnecting');

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }
}
