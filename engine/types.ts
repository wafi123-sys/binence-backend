// ============================================================
// Order Book Arena — Shared Types & Enums
// All engine modules and UI components reference these types.
// ============================================================

// ── Enums ────────────────────────────────────────────────────

export enum OrderSide {
  BUY = 'BUY',
  SELL = 'SELL',
}

export enum OrderType {
  LIMIT = 'LIMIT',
  MARKET = 'MARKET',
}

export enum OrderStatus {
  NEW = 'NEW',
  PARTIAL = 'PARTIAL',
  FILLED = 'FILLED',
  CANCELLED = 'CANCELLED',
}

// ── Core Data Structures ─────────────────────────────────────

export interface Order {
  id: string;
  side: OrderSide;
  type: OrderType;
  price: number;        // 0 for market orders
  quantity: number;     // total lots
  filledQty: number;    // lots already filled
  timestamp: number;    // ms since epoch
  playerId: string;
  status: OrderStatus;
}

export interface Execution {
  id: string;
  price: number;
  volume: number;       // lots traded
  buyOrderId: string;
  sellOrderId: string;
  timestamp: number;
  aggressor: OrderSide; // who initiated the trade
}

export interface OrderBookLevel {
  price: number;
  totalLot: number;
  frequency: number;    // number of orders at this price
  orders: OrderQueueEntry[];
}

export interface OrderQueueEntry {
  orderId: string;
  playerId: string;
  remainingQty: number;
  timestamp: number;
}

export interface OHLCBar {
  time: number;         // bar open time (epoch seconds for LW Charts)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface RunningTrade {
  time: number;         // epoch ms
  price: number;
  volume: number;
  side: OrderSide;      // aggressor side
}

export interface MarketSnapshot {
  asks: OrderBookLevel[];   // sorted ascending by price (best ask first)
  bids: OrderBookLevel[];   // sorted descending by price (best bid first)
  lastPrice: number;
  lastVolume: number;
  lastSide: OrderSide | null;
  runningTrades: RunningTrade[];
}

// ── Timeframes ───────────────────────────────────────────────

export type Timeframe =
  | 'tick'
  | '1s'
  | '5s'
  | '15s'
  | '30s'
  | '1m'
  | '5m'
  | '15m'
  | '30m'
  | '1h'
  | '1d';

export const TIMEFRAME_MS: Record<Timeframe, number> = {
  tick: 0,        // every trade is a bar
  '1s': 1000,
  '5s': 5000,
  '15s': 15000,
  '30s': 30000,
  '1m': 60000,
  '5m': 300000,
  '15m': 900000,
  '30m': 1800000,
  '1h': 3600000,
  '1d': 86400000,
};

// ── Player Stats ─────────────────────────────────────────────

export interface PlayerStats {
  cashBalance: number;      // available cash
  stockPosition: number;    // lots currently held (net long)
  avgBuyPrice: number;      // weighted average buy price
  realizedPnL: number;      // cumulative realized PnL (IDR)
  unrealizedPnL: number;    // mark-to-market PnL on open position
  totalTrades: number;      // number of fills
  totalBought: number;      // total lots bought (lifetime)
  totalSold: number;        // total lots sold (lifetime)
}

// ── WebSocket Message Types ──────────────────────────────────

export type WSClientMessage =
  | { type: 'login'; payload: { username: string; password: string } }
  | { type: 'submit_order'; payload: { side: OrderSide; orderType: OrderType; price: number; quantity: number } }
  | { type: 'cancel_order'; payload: { orderId: string } }
  | { type: 'modify_order'; payload: { orderId: string; newPrice?: number; newQuantity?: number } };

export type WSServerMessage =
  | {
      type: 'welcome';
      payload: {
        playerId: string;
        username: string;
        balance: number;
        role: 'player' | 'whale';
        avatar: string;
        stats: PlayerStats;
        snapshot: MarketSnapshot;
        ohlc: Record<Timeframe, OHLCBar[]>;
      };
    }
  | { type: 'auth_required'; payload: { message: string } }
  | { type: 'auth_error'; payload: { message: string } }
  | { type: 'stats_update'; payload: PlayerStats }
  | { type: 'order_book_update'; payload: { asks: OrderBookLevel[]; bids: OrderBookLevel[] } }
  | { type: 'execution'; payload: Execution }
  | { type: 'running_trade'; payload: RunningTrade }
  | { type: 'ohlc_update'; payload: { timeframe: Timeframe; bar: OHLCBar } }
  | { type: 'my_order_update'; payload: Order }
  | { type: 'market_info'; payload: { lastPrice: number; lastVolume: number; lastSide: OrderSide | null; playerCount: number } }
  | { type: 'error'; payload: { message: string } };

