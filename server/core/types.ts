// ── Layer 0-1: Raw & Ingested ──────────────────────────────
export interface RawTrade {
  symbol: string;
  price: number;
  qty: number;
  isMaker: boolean;      // true = taker sell hit bid / taker buy hit ask, sesuai semantik Binance
  tradeTime: number;     // ms epoch, dari exchange
  localTime: number;     // ms epoch, saat diterima server
}

export interface RawDepthUpdate {
  symbol: string;
  bids: [number, number][];   // [price, qty][]
  asks: [number, number][];
  localTime: number;
}

export interface RawLiquidation {
  symbol: string;
  side: 'BUY' | 'SELL';
  price: number;
  qty: number;
  time: number;
}

export interface RawFundingUpdate {
  symbol: string;
  fundingRate: number;
  markPrice: number;
  indexPrice: number;
  nextFundingTime: number;
  time: number;
}

export interface RawOpenInterest {
  symbol: string;
  openInterest: number;
  time: number;
}

// ── Layer 2: Market State ──────────────────────────────────
export interface MarketState {
  symbol: string;
  bids: Map<number, number>;
  asks: Map<number, number>;
  lastPrice: number;
  markPrice: number;
  indexPrice: number;
  fundingRate: number;
  openInterest: number;
  openInterestDelta: number;
  vol24h: number;
  updatedAt: number;
}

// ── Layer 3: Feature Snapshot (dihitung tiap tick/interval pendek) ──
export interface FeatureSnapshot {
  symbol: string;
  time: number;
  spread: number;
  depthBid: number;          // total qty N level teratas
  depthAsk: number;
  imbalance: number;         // (depthBid - depthAsk) / (depthBid + depthAsk), range -1..1
  delta: number;             // buyVol - sellVol dalam window
  cvd: number;               // cumulative delta
  vwap: number;
  volume: number;
  velocity: number;          // price change per second
  atr: number;
  volatility: number;
  liquidityDensity: number;  // qty per price-tick di sekitar mid price
  liquidityGap: number;      // jarak price kosong terdekat dari mid
}

// Per price-level, untuk order book microstructure checks
export interface PriceLevelState {
  price: number;
  qty: number;
  firstSeenAt: number;
  lastQty: number;
  refillCount: number;       // berapa kali qty naik lagi setelah turun (indikasi refill/iceberg)
  cancelCount: number;       // berapa kali level ini hilang tanpa trade match (indikasi spoof)
  fillCount: number;         // berapa kali level ini berkurang KARENA trade match
  lifetimeMs: number;
}

// ── Layer 4: Detector Output (CANDIDATE — belum tervalidasi) ──
export type DetectorType =
  | 'BUY_WALL' | 'SELL_WALL' | 'SPOOF' | 'WHALE' | 'ICEBERG'
  | 'ABSORPTION' | 'DISTRIBUTION' | 'MIGRATION'
  | 'TRAP' | 'STOP_HUNT' | 'FAKE_BREAKOUT'
  | 'PASSIVE_BUYER' | 'PASSIVE_SELLER';

export interface CandidateEvent {
  symbol: string;
  type: DetectorType;
  price: number;
  qty: number;
  usdValue: number;
  time: number;
  side: 'buy' | 'sell' | 'bid' | 'ask';
  rawConfidence: number;     // 0-100, skor mentah dari detector, SEBELUM validasi
  meta: Record<string, unknown>; // data tambahan spesifik tiap detector (mis. splittingSuspicion)
}

// ── Layer 5: Validation Result ──────────────────────────────
export interface ValidationCheckResult {
  name: string;              // 'lifetime' | 'refill' | 'cancelRatio' | 'fillRatio' | 'priceReaction' | 'marketContext' | 'volume' | 'timeframe' | 'marketCap'
  passed: boolean;
  score: number;             // 0-1, seberapa kuat check ini lolos (bukan cuma pass/fail biner)
  detail?: string;
}

export interface ValidatedEvent extends CandidateEvent {
  checks: ValidationCheckResult[];
  isValid: boolean;          // true hanya kalau SEMUA check wajib lolos
  finalConfidence: number;   // rawConfidence disesuaikan hasil validasi
}

// ── Layer 6: Event (final, tersimpan) ───────────────────────
export interface MarketEvent {
  id: string;                // uuid
  symbol: string;
  type: DetectorType;
  price: number;
  time: number;
  strength: number;          // 0-100
  confidence: number;        // 0-100
  side: 'buy' | 'sell' | 'bid' | 'ask';
  sourceChecks: ValidationCheckResult[];
}

// ── Layer 7-8: Timeline & Sequence ──────────────────────────
export interface TimelineEntry {
  eventId: string;
  symbol: string;
  time: number;
  type: DetectorType;
  price: number;
}

export interface Sequence {
  id: string;                // mis. "A-001"
  symbol: string;
  eventIds: string[];        // urut waktu
  pattern: string;           // deskripsi urutan, mis. "WHALE→BUY_WALL→ABSORPTION→MIGRATION→BREAKOUT"
  startTime: number;
  lastUpdate: number;
  strength: number;
  status: 'FORMING' | 'CONFIRMED' | 'INVALIDATED';
}

// ── Layer 9: Market Memory ──────────────────────────────────
export interface PriceLevelMemory {
  symbol: string;
  price: number;
  bVol: number;
  sVol: number;
  relevanceScore: number;    // hasil decay
  reactionHistory: { time: number; outcome: 'BOUNCE' | 'BREAK' }[];
  bounceRate: number;        // dihitung dari reactionHistory
  label?: string;            // mis. "Institutional Level"
}

// ── Layer 10: Context ────────────────────────────────────────
export interface MarketContext {
  symbol: string;
  capTier: 'MEGA' | 'LARGE' | 'MID' | 'SMALL' | 'MICRO';
  session: 'ASIA' | 'EUROPE' | 'US' | 'OVERLAP';
  trend: 'UP' | 'DOWN' | 'SIDEWAYS';
  volatilityTier: 'LOW' | 'MEDIUM' | 'HIGH';
  fundingBias: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
  oiBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  time: number;
}

// ── Layer 11-13: Evidence, Conflict, Probability ────────────
export interface EvidenceBreakdown {
  symbol: string;
  time: number;
  items: { source: string; direction: 'bullish' | 'bearish'; weight: number }[];
  totalBullish: number;
  totalBearish: number;
}

export interface ConflictResult {
  bullishPct: number;
  bearishPct: number;
  conflictScore: number;     // 0-100, makin tinggi makin banyak sinyal bertentangan
}

export interface ProbabilityResult {
  accumulation: number;      // persen
  distribution: number;
  trap: number;
  neutral: number;
}

// ── Layer 14-15: Strategy & Entry Gate ──────────────────────
export interface StrategyDecision {
  strategyName: string;
  confidence: number;
  direction: 'long' | 'short' | 'none';
}

export interface EntryGateCheck {
  name: string;              // 'evidence' | 'probability' | 'conflict' | 'spread' | 'spoof' | 'trap' | 'marketOpen' | 'riskReward'
  passed: boolean;
  value: number;
  threshold: number;
}

export interface EntryDecision {
  allowed: boolean;
  checks: EntryGateCheck[];
  entryPrice?: number;
  sl?: number;
  tp?: number;
  riskPct?: number;
}
