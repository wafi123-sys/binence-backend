// ============================================================
// Quick Order Panel — Compact Order entry with price/lot controls
// ============================================================

'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useMarket } from '../../hooks/useMarket';
import { useHotkeys } from '../../hooks/useHotkeys';
import { OrderSide, OrderType } from '../../engine/types';

interface QuickOrderPanelProps {
  price: number;
  setPrice: (price: number) => void;
  lot: number;
  setLot: (lot: number) => void;
  oneClickTrading: boolean;
  setOneClickTrading: (v: boolean) => void;
}

const QUICK_LOTS = [1, 5, 10, 50, 100];

function formatRp(v: number): string {
  if (Math.abs(v) >= 1_000_000_000) return `Rp ${(v / 1_000_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 1_000_000) return `Rp ${(v / 1_000_000).toFixed(1)}jt`;
  return `Rp ${Math.round(v).toLocaleString('id-ID')}`;
}

interface ExecToast {
  id: number;
  msg: string;
  side: 'buy' | 'sell' | 'info';
}

export default function QuickOrderPanel({
  price,
  setPrice,
  lot,
  setLot,
  oneClickTrading,
  setOneClickTrading,
}: QuickOrderPanelProps) {
  const { submitOrder, lastPrice, stats, serverError } = useMarket();
  const [lastAction, setLastAction] = useState<'buy' | 'sell' | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [toasts, setToasts] = useState<ExecToast[]>([]);
  const toastIdRef = useRef(0);

  useEffect(() => {
    if (price === 0 && lastPrice > 0) setPrice(lastPrice);
  }, [lastPrice]); // eslint-disable-line react-hooks/exhaustive-deps

  const addToast = useCallback((msg: string, side: 'buy' | 'sell' | 'info') => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, msg, side }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  }, []);

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
    addToast(`🟢 BUY: ${lot.toLocaleString()} lot @${price.toLocaleString()}`, 'buy');
    flash('buy');
  }, [price, lot, submitOrder, flash, showError, addToast]);

  const handleSell = useCallback(() => {
    if (lot <= 0) return;
    if (price <= 0) { showError('Masukkan harga terlebih dahulu'); return; }
    submitOrder(OrderSide.SELL, OrderType.LIMIT, price, lot);
    addToast(`🔴 SELL: ${lot.toLocaleString()} lot @${price.toLocaleString()}`, 'sell');
    flash('sell');
  }, [price, lot, submitOrder, flash, showError, addToast]);

  const handleReset = useCallback(() => {
    setPrice(lastPrice);
    setLot(10);
  }, [lastPrice, setPrice, setLot]);

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
  }, [setLot]);

  const estimatedValue = price * lot * 100;
  const canAffordBuy = stats.availableBalance >= estimatedValue;
  const canSell = stats.stockPosition >= lot;

  const pnlColor = stats.realizedPnL >= 0 ? 'text-[#00e676]' : 'text-[#ff1744]';
  const unrealizedColor = stats.unrealizedPnL >= 0 ? 'text-[#00e676]' : 'text-[#ff1744]';

  return (
    <div className="flex flex-col flex-none p-2 gap-2 border-b border-[#2a2a2a] bg-[#080b10] shrink-0">
      {/* Execution Toasts */}
      <div className="fixed top-2 right-2 z-50 flex flex-col gap-1 pointer-events-none">
        {toasts.map((t) => (
          <div key={t.id} className={`px-3 py-1.5 rounded text-[11px] font-bold font-mono border shadow-lg whitespace-nowrap animate-pulse ${t.side === 'buy' ? 'bg-[#00e676]/10 border-[#00e676]/50 text-[#00e676]' : (t.side === 'sell' ? 'bg-[#ff1744]/10 border-[#ff1744]/50 text-[#ff1744]' : 'bg-[#bb86fc]/10 border-[#bb86fc]/50 text-[#bb86fc]')}`}>
            {t.msg}
          </div>
        ))}
      </div>

      {/* Header & 1-Click Toggle */}
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest m-0">Quick Order</h3>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" className="hidden" checked={oneClickTrading} onChange={(e) => setOneClickTrading(e.target.checked)} />
          <div className={`w-6 h-3 rounded-full relative transition-colors ${oneClickTrading ? 'bg-[#00e5ff]' : 'bg-white/10'}`}>
            <div className={`absolute top-[1px] w-2.5 h-2.5 rounded-full transition-all ${oneClickTrading ? 'left-[13px] bg-black' : 'left-[1px] bg-slate-400'}`} />
          </div>
          <span className="text-[9px] text-slate-400">1-Click</span>
        </label>
      </div>

      {(errorMsg || serverError) && (
        <div className="px-2 py-1 bg-[#ff1744]/10 border border-[#ff1744]/30 rounded text-[10px] text-[#ff1744] text-center">
          {errorMsg || serverError}
        </div>
      )}

      {/* Stats - 3 columns, 2 rows */}
      <div className="grid grid-cols-3 gap-1">
        <div className="flex flex-col bg-white/5 border border-white/5 rounded px-2 py-1">
          <span className="text-[8px] uppercase text-slate-500 tracking-wider">Saldo</span>
          <span className="text-[10px] font-bold font-mono text-[#ffd700] truncate">{formatRp(stats.availableBalance)}</span>
        </div>
        <div className="flex flex-col bg-white/5 border border-white/5 rounded px-2 py-1">
          <span className="text-[8px] uppercase text-slate-500 tracking-wider">Lot Posisi</span>
          <span className="text-[10px] font-bold font-mono text-[#64b5f6] truncate">{stats.stockPosition.toLocaleString('id-ID')}</span>
        </div>
        <div className="flex flex-col bg-white/5 border border-white/5 rounded px-2 py-1">
          <span className="text-[8px] uppercase text-slate-500 tracking-wider">Avg Buy</span>
          <span className="text-[10px] font-bold font-mono text-white truncate">{stats.stockPosition > 0 ? stats.avgBuyPrice.toLocaleString('id-ID') : '—'}</span>
        </div>
        <div className="flex flex-col bg-white/5 border border-white/5 rounded px-2 py-1">
          <span className="text-[8px] uppercase text-slate-500 tracking-wider">Unrealized</span>
          <span className={`text-[10px] font-bold font-mono truncate ${unrealizedColor}`}>
            {stats.unrealizedPnL > 0 ? '+' : ''}{formatRp(stats.unrealizedPnL)}
          </span>
        </div>
        <div className="flex flex-col bg-white/5 border border-white/5 rounded px-2 py-1">
          <span className="text-[8px] uppercase text-slate-500 tracking-wider">Realized</span>
          <span className={`text-[10px] font-bold font-mono truncate ${pnlColor}`}>
            {stats.realizedPnL > 0 ? '+' : ''}{formatRp(stats.realizedPnL)}
          </span>
        </div>
        <div className="flex flex-col bg-white/5 border border-white/5 rounded px-2 py-1">
          <span className="text-[8px] uppercase text-slate-500 tracking-wider">Trades</span>
          <span className="text-[10px] font-bold font-mono text-white truncate">{stats.totalTrades}</span>
        </div>
      </div>

      {/* Input Row: Price | Lot | Value */}
      <div className="flex items-end gap-1.5" onWheel={handleWheel}>
        <div className="flex-1 flex flex-col gap-0.5">
          <label className="text-[8px] text-slate-400 uppercase tracking-widest pl-1">Price</label>
          <div className="flex bg-[#0d1117] border border-white/10 rounded h-6 overflow-hidden">
            <button className="w-5 bg-white/5 text-slate-400 hover:text-white hover:bg-white/10" onClick={() => setPrice(Math.max(1, price - 1))}>−</button>
            <input type="number" value={price} onChange={(e) => setPrice(Math.max(0, parseInt(e.target.value) || 0))} className="flex-1 bg-transparent text-center text-white font-mono text-[11px] outline-none" style={{ MozAppearance: 'textfield' }} />
            <button className="w-5 bg-white/5 text-slate-400 hover:text-white hover:bg-white/10" onClick={() => setPrice(price + 1)}>+</button>
          </div>
        </div>
        <div className="flex-1 flex flex-col gap-0.5">
          <label className="text-[8px] text-slate-400 uppercase tracking-widest pl-1">Lot</label>
          <div className="flex bg-[#0d1117] border border-white/10 rounded h-6 overflow-hidden">
            <button className="w-5 bg-white/5 text-slate-400 hover:text-white hover:bg-white/10" onClick={() => setLot(Math.max(1, lot - 1))}>−</button>
            <input type="number" value={lot} onChange={(e) => setLot(Math.max(1, parseInt(e.target.value) || 1))} className="flex-1 bg-transparent text-center text-white font-mono text-[11px] outline-none" style={{ MozAppearance: 'textfield' }} />
            <button className="w-5 bg-white/5 text-slate-400 hover:text-white hover:bg-white/10" onClick={() => setLot(lot + 1)}>+</button>
          </div>
        </div>
        <div className="flex-1 flex flex-col justify-center bg-[#0d1117] border border-white/10 rounded h-6 px-1.5 text-right">
          <div className="text-[7px] text-slate-500 uppercase leading-none">Est Value</div>
          <div className="text-[10px] font-bold font-mono text-white leading-tight truncate">{formatRp(estimatedValue)}</div>
        </div>
      </div>

      {/* Preset Lots */}
      <div className="flex gap-1">
        {QUICK_LOTS.map((q) => (
          <button key={q} onClick={() => setLot(q)} className={`flex-1 py-0.5 rounded text-[9px] font-bold transition-colors ${lot === q ? 'bg-[#00e5ff]/20 text-[#00e5ff] border border-[#00e5ff]/30' : 'bg-white/5 text-slate-400 border border-white/5 hover:text-white hover:bg-white/10'}`}>
            {q}
          </button>
        ))}
      </div>

      {/* Buy / Sell Buttons */}
      <div className="flex gap-1.5 mt-0.5">
        <button 
          className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded border transition-all ${!canAffordBuy ? 'border-yellow-600/50 opacity-60' : 'border-[#00e676]/40 bg-gradient-to-br from-[#00e676]/20 to-[#00e676]/5 hover:bg-[#00e676]/30 hover:-translate-y-[1px]'} ${lastAction === 'buy' ? 'scale-105' : ''}`}
          onClick={handleBuy} disabled={lot <= 0}
        >
          <span className="text-[12px] font-bold tracking-widest text-[#00e676]">BUY</span>
        </button>
        <button 
          className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded border transition-all ${!canSell ? 'border-yellow-600/50 opacity-60' : 'border-[#ff1744]/40 bg-gradient-to-br from-[#ff1744]/20 to-[#ff1744]/5 hover:bg-[#ff1744]/30 hover:-translate-y-[1px]'} ${lastAction === 'sell' ? 'scale-105' : ''}`}
          onClick={handleSell} disabled={lot <= 0}
        >
          <span className="text-[12px] font-bold tracking-widest text-[#ff1744]">SELL</span>
        </button>
      </div>
    </div>
  );
}
