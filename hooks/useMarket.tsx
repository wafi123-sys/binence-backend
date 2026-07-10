// ============================================================
// useMarket — Central React hook for all market data
// ============================================================

'use client';

import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { WSClient } from '../lib/wsClient';
import {
  OrderBookLevel,
  RunningTrade,
  OrderSide,
  OrderType,
  OHLCBar,
  Timeframe,
  Order,
  PlayerStats,
  SultanBotStats,
} from '../engine/types';

// ── Market State Interface ──────────────────────────────────

interface MarketData {
  // Auth
  isAuthenticated: boolean;
  authError: string | null;
  login: (username: string, password: string) => void;

  // Player Info
  playerId: string | null;
  username: string | null;
  balance: number;         // starting balance (for display)
  role: 'player' | 'whale' | null;
  avatar: string | null;

  // Player Stats (live)
  stats: PlayerStats;

  // Connection
  connectionStatus: 'connected' | 'disconnected' | 'reconnecting';
  playerCount: number;

  // Order Book
  asks: OrderBookLevel[];
  bids: OrderBookLevel[];

  // Market Info
  lastPrice: number;
  lastVolume: number;
  lastSide: OrderSide | null;

  // Running Trades
  runningTrades: RunningTrade[];

  // OHLC
  ohlcData: Record<Timeframe, OHLCBar[]>;

  // Player's Orders
  myOrders: Order[];

  // Server error (from order rejection etc.)
  serverError: string | null;

  // Leaderboard
  sultanLeaderboard: SultanBotStats[];

  // Actions
  submitOrder: (side: OrderSide, orderType: OrderType, price: number, quantity: number) => void;
  cancelOrder: (orderId: string) => void;
  modifyOrder: (orderId: string, newPrice?: number, newQuantity?: number) => void;
}

const defaultStats: PlayerStats = {
  initialBalance: 0,
  cashBalance: 0,
  activeBalance: 0,
  availableBalance: 0,
  stockPosition: 0,
  avgBuyPrice: 0,
  portfolioValue: 0,
  totalEquity: 0,
  unrealizedPnL: 0,
  realizedPnL: 0,
  returnPct: 0,
  totalTrades: 0,
  totalBought: 0,
  totalSold: 0,
  winTrade: 0,
  lossTrade: 0,
  winRate: 0,
};

const defaultOhlc: Record<Timeframe, OHLCBar[]> = {
  tick: [], '1s': [], '5s': [], '15s': [], '30s': [],
  '1m': [], '5m': [], '15m': [], '30m': [], '1h': [], '1d': [], '1w': [],
};

const MarketContext = createContext<MarketData | null>(null);

// ── Provider ────────────────────────────────────────────────

export function MarketProvider({ children }: { children: ReactNode }) {
  const wsRef = useRef<WSClient | null>(null);

  // Auth
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [balance, setBalance] = useState(0);
  const [role, setRole] = useState<'player' | 'whale' | null>(null);
  const [avatar, setAvatar] = useState<string | null>(null);

  // Stats
  const [stats, setStats] = useState<PlayerStats>(defaultStats);

  // Connection
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'reconnecting'>('disconnected');
  const [playerCount, setPlayerCount] = useState(0);

  // Market
  const [asks, setAsks] = useState<OrderBookLevel[]>([]);
  const [bids, setBids] = useState<OrderBookLevel[]>([]);
  const [lastPrice, setLastPrice] = useState(0);
  const [lastVolume, setLastVolume] = useState(0);
  const [lastSide, setLastSide] = useState<OrderSide | null>(null);
  const [runningTrades, setRunningTrades] = useState<RunningTrade[]>([]);
  const [ohlcData, setOhlcData] = useState<Record<Timeframe, OHLCBar[]>>(defaultOhlc);
  const [myOrders, setMyOrders] = useState<Order[]>([]);
  const [sultanLeaderboard, setSultanLeaderboard] = useState<SultanBotStats[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);
  const serverErrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let wsUrl: string | undefined = undefined;
    if (typeof window !== 'undefined') {
      const isNative = (window as any).Capacitor?.isNative;
      const isRemote = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
      
      if (isNative || isRemote) {
        // Read from query param if provided
        const params = new URLSearchParams(window.location.search);
        const urlWs = params.get('ws');
        if (urlWs) {
           localStorage.setItem('arena_ws_url', urlWs);
        }

        const savedUrl = localStorage.getItem('arena_ws_url');
        if (savedUrl) {
          if (savedUrl.startsWith('ws://') || savedUrl.startsWith('wss://')) {
             wsUrl = savedUrl;
          } else {
             let clean = savedUrl.replace('http://', '').replace('https://', '').replace(/\/$/, '');
             wsUrl = `wss://${clean}`;
          }
        } else {
          // Default remote url if deployed without specifying
          wsUrl = `wss://your-production-backend.up.railway.app`;
        }
      }
    }

    const ws = new WSClient(wsUrl);
    wsRef.current = ws;

    // Track stored credentials so we can re-login after reconnect
    const credRef = { current: null as { username: string; password: string } | null };

    ws.on('onAuthRequired', () => {
      // Server asked us to authenticate — if we have stored creds, auto-login
      if (credRef.current) {
        ws.login(credRef.current.username, credRef.current.password);
      } else {
        setIsAuthenticated(false);
      }
    });

    ws.on('onAuthError', (data) => {
      setAuthError(data.message);
    });

    ws.on('onWelcome', (data) => {
      // Store creds in ref for auto-relogin on reconnect
      credRef.current = { username: data.username, password: '' }; // username available; password stored in WSClient
      setIsAuthenticated(true);
      setAuthError(null);
      setPlayerId(data.playerId);
      setUsername(data.username);
      setBalance(data.balance);
      setRole(data.role);
      setAvatar(data.avatar);
      setStats(data.stats);
      setAsks(data.snapshot.asks);
      setBids(data.snapshot.bids);
      setLastPrice(data.snapshot.lastPrice);
      setLastVolume(data.snapshot.lastVolume);
      setLastSide(data.snapshot.lastSide);
      setRunningTrades(data.snapshot.runningTrades);
      setOhlcData(data.ohlc);
      // Reset orders on new login
      setMyOrders([]);
    });

    ws.on('onStatsUpdate', (s) => {
      setStats(s);
    });

    ws.on('onOrderBookUpdate', (data) => {
      setAsks(data.asks);
      setBids(data.bids);
    });

    ws.on('onRunningTrade', (trade) => {
      setRunningTrades((prev) => {
        const next = [trade, ...prev];
        return next.length > 200 ? next.slice(0, 200) : next;
      });
    });

    ws.on('onOHLCUpdate', ({ timeframe, bar }) => {
      setOhlcData((prev) => {
        const bars = [...(prev[timeframe] || [])];
        if (bars.length > 0 && bars[bars.length - 1].time === bar.time) {
          bars[bars.length - 1] = bar;
        } else {
          bars.push(bar);
        }
        return { ...prev, [timeframe]: bars };
      });
    });

    ws.on('onMarketInfo', (info) => {
      setLastPrice(info.lastPrice);
      setLastVolume(info.lastVolume);
      setLastSide(info.lastSide);
      setPlayerCount(info.playerCount);
    });

    ws.on('onMyOrderUpdate', (order) => {
      setMyOrders((prev) => {
        const existing = prev.findIndex((o) => o.id === order.id);
        if (existing >= 0) {
          const next = [...prev];
          next[existing] = order;
          return next;
        }
        return [order, ...prev];
      });
    });

    ws.on('onSultanLeaderboardUpdate', (leaderboard) => {
      setSultanLeaderboard(leaderboard);
    });

    ws.on('onConnectionChange', (status) => {
      setConnectionStatus(status);
      // Do NOT reset isAuthenticated here.
      // The WSClient auto-re-sends login on reconnect via pendingLogin.
      // We only show the login modal if auth_required fires without stored creds.
    });

    ws.on('onError', (err) => {
      console.error('[Market] Server error:', err.message);
      // Show error to user
      if (serverErrorTimer.current) clearTimeout(serverErrorTimer.current);
      setServerError(err.message);
      serverErrorTimer.current = setTimeout(() => setServerError(null), 4000);
    });

    ws.connect();
    return () => { ws.disconnect(); };
  }, []);

  // ── Actions ───────────────────────────────────────────────

  const login = useCallback((u: string, p: string) => {
    setAuthError(null);
    wsRef.current?.login(u, p);
  }, []);

  const submitOrder = useCallback(
    (side: OrderSide, orderType: OrderType, price: number, quantity: number) => {
      console.log('[Market] submitOrder called:', { side, orderType, price, quantity });
      wsRef.current?.submitOrder(side, orderType, price, quantity);
    }, []
  );

  const cancelOrder = useCallback((orderId: string) => {
    wsRef.current?.cancelOrder(orderId);
  }, []);

  const modifyOrder = useCallback(
    (orderId: string, newPrice?: number, newQuantity?: number) => {
      wsRef.current?.modifyOrder(orderId, newPrice, newQuantity);
    }, []
  );

  const value: MarketData = {
    isAuthenticated, authError, login,
    playerId, username, balance, role, avatar,
    stats, connectionStatus, playerCount,
    asks, bids, lastPrice, lastVolume, lastSide,
    runningTrades, ohlcData, myOrders, serverError,
    sultanLeaderboard,
    submitOrder,
    cancelOrder,
    modifyOrder,
  };

  return (
    <MarketContext.Provider value={value}>
      {children}
    </MarketContext.Provider>
  );
}

// ── Hook ────────────────────────────────────────────────────

export function useMarket(): MarketData {
  const ctx = useContext(MarketContext);
  if (!ctx) throw new Error('useMarket must be used within a MarketProvider');
  return ctx;
}
