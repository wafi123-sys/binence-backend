// ============================================================
// Backtest Types — shared types for the Order-Flow Backtest Engine
// ============================================================

export interface RawTradeLog {
  e: 'aggTrade';
  p: string;           // price
  q: string;           // quantity
  m: boolean;          // isMaker
  T: number;           // trade time ms
  E: number;           // event time ms
  s: string;           // symbol
  local_time: number;
}

export interface SnapshotLog {
  time: number;
  b: [number, number][]; // [price, qty] top bids
  a: [number, number][]; // [price, qty] top asks
}

export interface TimelineEvent {
  type: 'trade' | 'snapshot';
  time: number;
  data: RawTradeLog | SnapshotLog;
}

export interface BacktestPosition {
  side: 'long' | 'short';
  entryPrice: number;
  entryTime: number;
  qty: number;         // qty in base currency
  cost: number;        // USDT committed
  strategyName: string;
}

export interface BacktestTrade {
  side: 'long' | 'short';
  entryPrice: number;
  exitPrice: number;
  entryTime: number;
  exitTime: number;
  grossPnl: number;
  netPnl: number;
  pct: number;
  feePaid: number;
  exitReason: 'SL' | 'TP' | 'Strategy' | 'EOD';
  strategyName: string;
}

export interface BacktestResult {
  strategyName: string;
  symbol: string;
  startTime: number;
  endTime: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  netReturn: number;
  netReturnPct: number;
  maxDrawdown: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  sharpeRatio: number;
  trades: BacktestTrade[];
  equity: { time: number; value: number }[];
}

export interface ExecutionAssumptions {
  makerFeeBps: number;       // e.g. 1 bps = 0.01%
  takerFeeBps: number;       // e.g. 5 bps = 0.05%
  signalLatencyMs: number;   // simulated delay from signal to order fill
  slippageBps: number;       // fixed slippage in bps
}

export const DEFAULT_EXEC: ExecutionAssumptions = {
  makerFeeBps: 1,
  takerFeeBps: 5,
  signalLatencyMs: 200,
  slippageBps: 3,
};
