'use client';

import React from 'react';
import { useMarket } from '../../hooks/useMarket';

function fmtRp(v: number): string {
  const abs = Math.abs(v);
  const sign = v >= 0 ? '+' : '-';
  if (abs >= 1_000_000_000) return `${sign}Rp ${(abs / 1_000_000_000).toFixed(2)}M`;
  if (abs >= 1_000_000) return `${sign}Rp ${(abs / 1_000_000).toFixed(1)}jt`;
  return `${sign}Rp ${Math.round(abs).toLocaleString('id-ID')}`;
}

function fmtBal(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return `Rp ${(v / 1_000_000_000).toFixed(2)}M`;
  if (abs >= 1_000_000) return `Rp ${(v / 1_000_000).toFixed(0)}jt`;
  return `Rp ${Math.round(v).toLocaleString('id-ID')}`;
}

interface StatRow {
  label: string;
  value: React.ReactNode;
  highlight?: string;
}

export default function PnLStatsPanel({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { stats, lastPrice } = useMarket();

  if (!isOpen) return null;

  const pnlColor = (v: number) => v >= 0 ? '#00e676' : '#ff1744';
  const returnPct = stats.returnPct || 0;
  const winRate = stats.winRate || 0;
  const returnColor = returnPct >= 0 ? '#00e676' : '#ff1744';

  const rows: StatRow[] = [
    // ── Balance ──
    { label: 'Initial Balance', value: fmtBal(stats.initialBalance) },
    { label: 'Cash Balance', value: fmtBal(stats.cashBalance) },
    { label: 'Active Balance', value: fmtBal(stats.activeBalance), highlight: '#ffab00' },
    { label: 'Available Balance', value: fmtBal(stats.availableBalance), highlight: '#64b5f6' },
    // ── Position ──
    { label: 'Position', value: `${stats.stockPosition.toLocaleString('id-ID')} Lot`, highlight: '#64b5f6' },
    { label: 'Average Buy', value: stats.stockPosition > 0 ? stats.avgBuyPrice.toLocaleString('id-ID') : '—' },
    { label: 'Last Price', value: lastPrice > 0 ? lastPrice.toLocaleString('id-ID') : '—' },
    // ── Portfolio ──
    { label: 'Portfolio Value', value: fmtBal(stats.portfolioValue), highlight: '#bb86fc' },
    { label: 'Unrealized PnL', value: fmtRp(stats.unrealizedPnL), highlight: pnlColor(stats.unrealizedPnL) },
    { label: 'Realized PnL', value: fmtRp(stats.realizedPnL), highlight: pnlColor(stats.realizedPnL) },
    { label: 'Total Equity', value: fmtBal(stats.totalEquity), highlight: '#bb86fc' },
    // ── Stats ──
    { label: 'Total Trade', value: stats.totalTrades },
    { label: 'Win Trade', value: stats.winTrade, highlight: '#00e676' },
    { label: 'Loss Trade', value: stats.lossTrade, highlight: '#ff1744' },
    { label: 'Win Rate', value: `${winRate.toFixed(2)}%`, highlight: pnlColor(winRate - 50) },
    { label: 'Return', value: `${returnPct >= 0 ? '+' : ''}${returnPct.toFixed(2)}%`, highlight: returnColor },
  ];

  return (
    <div className="pnl-stats-drawer">
      <div className="pnl-stats-header">
        <h3>📊 Account Summary</h3>
        <button onClick={onClose} className="pnl-close-btn">×</button>
      </div>
      <div className="pnl-account-rows">
        {rows.map((row, i) => (
          <div key={i} className="pnl-account-row">
            <span className="pnl-row-label">{row.label}</span>
            <span className="pnl-row-value" style={{ color: row.highlight ?? '#e0e0e0' }}>
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
