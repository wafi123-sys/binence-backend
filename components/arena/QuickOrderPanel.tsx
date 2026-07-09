// ============================================================
// Quick Order Panel — Order entry with price/lot controls
// ============================================================

'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { useMarket } from '../../hooks/useMarket';
import { useHotkeys } from '../../hooks/useHotkeys';
import { OrderSide, OrderType } from '../../engine/types';

interface QuickOrderPanelProps {
  price: number;
  setPrice: (price: number) => void;
  oneClickTrading: boolean;
  setOneClickTrading: (v: boolean) => void;
}

const QUICK_LOTS = [1, 5, 10, 25, 50, 100, 250, 500, 1000];

function formatRp(v: number): string {
  if (Math.abs(v) >= 1_000_000_000) return `Rp ${(v / 1_000_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 1_000_000) return `Rp ${(v / 1_000_000).toFixed(1)}jt`;
  return `Rp ${Math.round(v).toLocaleString('id-ID')}`;
}

export default function QuickOrderPanel({
  price,
  setPrice,
  oneClickTrading,
  setOneClickTrading,
}: QuickOrderPanelProps) {
  const { submitOrder, lastPrice, stats, serverError } = useMarket();
  const [lot, setLot] = useState(100);
  const [lastAction, setLastAction] = useState<'buy' | 'sell' | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Set initial price from market on first load
  useEffect(() => {
    if (price === 0 && lastPrice > 0) setPrice(lastPrice);
  }, [lastPrice]); // eslint-disable-line react-hooks/exhaustive-deps

  const flash = useCallback((side: 'buy' | 'sell') => {
    setLastAction(side);
    setTimeout(() => setLastAction(null), 300);
  }, []);

  const showError = useCallback((msg: string) => {
    setErrorMsg(msg);
    setTimeout(() => setErrorMsg(null), 3000);
  }, []);

  const handleBuy = useCallback(() => {
    if (lot <= 0) return;
    if (price <= 0) { showError('Masukkan harga terlebih dahulu'); return; }
    submitOrder(OrderSide.BUY, OrderType.LIMIT, price, lot);
    flash('buy');
  }, [price, lot, submitOrder, flash, showError]);

  const handleSell = useCallback(() => {
    if (lot <= 0) return;
    if (price <= 0) { showError('Masukkan harga terlebih dahulu'); return; }
    submitOrder(OrderSide.SELL, OrderType.LIMIT, price, lot);
    flash('sell');
  }, [price, lot, submitOrder, flash, showError]);

  const handleReset = useCallback(() => {
    setPrice(lastPrice);
    setLot(100);
  }, [lastPrice, setPrice]);

  useHotkeys({
    onBuy: handleBuy,
    onSell: handleSell,
    onSubmit: handleBuy,
    onCancel: handleReset,
    onPriceUp: () => setPrice(price + 1),
    onPriceDown: () => setPrice(Math.max(1, price - 1)),
  });

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 5 : -5;
    setLot((prev) => Math.max(1, prev + delta));
  }, []);

  // estimated value = price × lot
  const estimatedValue = price * lot;

  // Client-side hints (informational only — server also validates)
  const canAffordBuy = stats.cashBalance <= 0 || stats.cashBalance >= estimatedValue;
  const canSell = stats.stockPosition === 0 || stats.stockPosition >= lot;

  const pnlColor = stats.realizedPnL >= 0 ? '#00e676' : '#ff1744';
  const unrealizedColor = stats.unrealizedPnL >= 0 ? '#00e676' : '#ff1744';

  return (
    <div className="quick-order-panel">
      {/* Header + One Click toggle */}
      <div className="qo-header">
        <h3>Quick Order</h3>
        <label className="qo-one-click">
          <input
            type="checkbox"
            checked={oneClickTrading}
            onChange={(e) => setOneClickTrading(e.target.checked)}
          />
          <span className="qo-toggle" />
          <span className="qo-label">1-Click</span>
        </label>
      </div>

      {/* Error toast — shows local validation OR server rejection */}
      {(errorMsg || serverError) && (
        <div className="qo-error">{errorMsg || serverError}</div>
      )}
      {/* Player Stats Summary */}
      <div className="qo-stats">
        <div className="qo-stat-row">
          <span className="qo-stat-label">Saldo</span>
          <span className="qo-stat-value">{formatRp(stats.cashBalance)}</span>
        </div>
        <div className="qo-stat-row">
          <span className="qo-stat-label">Posisi</span>
          <span className="qo-stat-value">{stats.stockPosition.toLocaleString('id-ID')} lot</span>
        </div>
        {stats.stockPosition > 0 && (
          <div className="qo-stat-row">
            <span className="qo-stat-label">Avg Buy</span>
            <span className="qo-stat-value">{stats.avgBuyPrice.toLocaleString('id-ID')}</span>
          </div>
        )}
        <div className="qo-stat-row">
          <span className="qo-stat-label">Unrealized</span>
          <span className="qo-stat-value" style={{ color: unrealizedColor }}>
            {stats.unrealizedPnL >= 0 ? '+' : ''}{formatRp(stats.unrealizedPnL)}
          </span>
        </div>
        <div className="qo-stat-row">
          <span className="qo-stat-label">Realized PnL</span>
          <span className="qo-stat-value" style={{ color: pnlColor, fontWeight: 600 }}>
            {stats.realizedPnL >= 0 ? '+' : ''}{formatRp(stats.realizedPnL)}
          </span>
        </div>
        <div className="qo-stat-row">
          <span className="qo-stat-label">Trades</span>
          <span className="qo-stat-value">{stats.totalTrades}</span>
        </div>
      </div>

      {/* Price */}
      <div className="qo-field">
        <label>Price</label>
        <div className="qo-input-group">
          <button className="qo-btn-sm" onClick={() => setPrice(Math.max(1, price - 1))}>−</button>
          <input
            type="number"
            value={price}
            onChange={(e) => setPrice(Math.max(0, parseInt(e.target.value) || 0))}
            className="qo-input"
          />
          <button className="qo-btn-sm" onClick={() => setPrice(price + 1)}>+</button>
        </div>
      </div>

      {/* Lot */}
      <div className="qo-field" onWheel={handleWheel}>
        <label>Lot</label>
        <div className="qo-input-group">
          <button className="qo-btn-sm" onClick={() => setLot(Math.max(1, lot - 1))}>−</button>
          <input
            type="number"
            value={lot}
            onChange={(e) => setLot(Math.max(1, parseInt(e.target.value) || 1))}
            className="qo-input"
          />
          <button className="qo-btn-sm" onClick={() => setLot(lot + 1)}>+</button>
        </div>
      </div>

      {/* Quick lot presets */}
      <div className="qo-quick-lots">
        {QUICK_LOTS.map((q) => (
          <button
            key={q}
            className={`qo-quick-lot ${lot === q ? 'qo-quick-lot-active' : ''}`}
            onClick={() => setLot(q)}
          >
            {q}
          </button>
        ))}
      </div>

      {/* Estimated value */}
      <div className="qo-estimate">
        <span className="qo-estimate-label">Est. Value</span>
        <span className="qo-estimate-value">{formatRp(estimatedValue)}</span>
      </div>

      {/* BUY / SELL */}
      <div className="qo-actions">
        <button
          id="btn-buy"
          className={`qo-btn-buy ${lastAction === 'buy' ? 'qo-btn-flash' : ''} ${!canAffordBuy ? 'qo-btn-warn' : ''}`}
          onClick={handleBuy}
          disabled={lot <= 0}
          title={!canAffordBuy ? `Saldo mungkin tidak cukup (est. ${formatRp(estimatedValue)})` : 'BUY — Ctrl+B'}
        >
          <span className="qo-btn-label">BUY</span>
          <span className="qo-btn-shortcut">Ctrl+B</span>
        </button>
        <button
          id="btn-sell"
          className={`qo-btn-sell ${lastAction === 'sell' ? 'qo-btn-flash' : ''} ${!canSell ? 'qo-btn-warn' : ''}`}
          onClick={handleSell}
          disabled={lot <= 0}
          title={!canSell ? `Posisi tidak cukup (${stats.stockPosition} lot)` : 'SELL — Ctrl+S'}
        >
          <span className="qo-btn-label">SELL</span>
          <span className="qo-btn-shortcut">Ctrl+S</span>
        </button>
      </div>

      {/* Hotkey hints */}
      <div className="qo-hotkeys">
        <div className="qo-hotkey"><kbd>↑↓</kbd> Price</div>
        <div className="qo-hotkey"><kbd>Scroll</kbd> Lot</div>
        <div className="qo-hotkey"><kbd>Esc</kbd> Reset</div>
      </div>
    </div>
  );
}
