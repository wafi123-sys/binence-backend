'use client';

import React, { useState } from 'react';
import { useMarket } from '../../hooks/useMarket';
import { SultanBotStats } from '../../engine/types';

function formatRp(v: number): string {
  const abs = Math.abs(v);
  const sign = v >= 0 ? '+' : '-';
  if (abs >= 1_000_000_000) return `${sign}Rp ${(abs / 1_000_000_000).toFixed(2)}M`;
  if (abs >= 1_000_000) return `${sign}Rp ${(abs / 1_000_000).toFixed(1)}jt`;
  return `${sign}Rp ${Math.round(abs).toLocaleString('id-ID')}`;
}

function formatBal(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return `Rp ${(v / 1_000_000_000).toFixed(2)}M`;
  if (abs >= 1_000_000) return `Rp ${(v / 1_000_000).toFixed(0)}jt`;
  return `Rp ${Math.round(v).toLocaleString('id-ID')}`;
}

export default function SultanLeaderboard({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { sultanLeaderboard, lastPrice } = useMarket();
  const [sortBy, setSortBy] = useState<'equity' | 'return'>('equity');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (!isOpen) return null;

  const sortedBots = [...sultanLeaderboard].sort((a, b) => {
    if (sortBy === 'equity') return b.totalEquity - a.totalEquity;
    return b.returnPct - a.returnPct;
  });

  const pnlColor = (v: number) => v >= 0 ? '#00e676' : '#ff1744';

  return (
    <div className="sultan-drawer">
      <div className="sultan-header">
        <div className="sultan-header-title">
          <h3>👑 TOP 10 SULTAN</h3>
          <span className="sultan-subtitle">Professional Bot Traders</span>
        </div>
        <button onClick={onClose} className="sultan-close-btn">×</button>
      </div>

      <div className="sultan-sort-bar">
        <span className="sultan-sort-label">Urutkan berdasarkan:</span>
        <button 
          className={`sultan-sort-btn ${sortBy === 'equity' ? 'active' : ''}`}
          onClick={() => setSortBy('equity')}
        >
          Total Equity
        </button>
        <button 
          className={`sultan-sort-btn ${sortBy === 'return' ? 'active' : ''}`}
          onClick={() => setSortBy('return')}
        >
          Return %
        </button>
      </div>

      <div className="sultan-list">
        {sortedBots.map((bot, index) => {
          const isExpanded = expandedId === bot.id;
          const returnColor = bot.returnPct >= 0 ? '#00e676' : '#ff1744';
          const returnSign = bot.returnPct >= 0 ? '+' : '';

          return (
            <div key={bot.id} className="sultan-card">
              <div 
                className="sultan-card-main"
                onClick={() => setExpandedId(isExpanded ? null : bot.id)}
              >
                <div className="sultan-rank">
                  {index + 1 === 1 ? '🥇' : index + 1 === 2 ? '🥈' : index + 1 === 3 ? '🥉' : `#${index + 1}`}
                </div>
                <div className="sultan-info">
                  <div className="sultan-name">{bot.name}</div>
                  <div className="sultan-strategy">{bot.strategy}</div>
                </div>
                <div className="sultan-metrics">
                  <div className="sultan-metric-primary" style={{ color: '#bb86fc' }}>
                    {formatBal(bot.totalEquity)}
                  </div>
                  <div className="sultan-metric-secondary" style={{ color: returnColor }}>
                    {returnSign}{bot.returnPct.toFixed(2)}%
                  </div>
                </div>
                <div className="sultan-chevron">
                  {isExpanded ? '▲' : '▼'}
                </div>
              </div>

              {isExpanded && (
                <div className="sultan-card-detail">
                  <div className="sultan-detail-grid">
                    <div className="sultan-d-item">
                      <span className="sultan-d-label">Cash Balance</span>
                      <span className="sultan-d-value">{formatBal(bot.cashBalance)}</span>
                    </div>
                    <div className="sultan-d-item">
                      <span className="sultan-d-label">Available Balance</span>
                      <span className="sultan-d-value" style={{ color: '#64b5f6' }}>{formatBal(bot.availableBalance)}</span>
                    </div>
                    <div className="sultan-d-item">
                      <span className="sultan-d-label">Portfolio Value</span>
                      <span className="sultan-d-value">{formatBal(bot.portfolioValue)}</span>
                    </div>
                    <div className="sultan-d-item">
                      <span className="sultan-d-label">Realized PnL</span>
                      <span className="sultan-d-value" style={{ color: pnlColor(bot.realizedPnL) }}>{formatRp(bot.realizedPnL)}</span>
                    </div>
                    <div className="sultan-d-item">
                      <span className="sultan-d-label">Unrealized PnL</span>
                      <span className="sultan-d-value" style={{ color: pnlColor(bot.unrealizedPnL) }}>{formatRp(bot.unrealizedPnL)}</span>
                    </div>
                    <div className="sultan-d-item">
                      <span className="sultan-d-label">Posisi Lot</span>
                      <span className="sultan-d-value" style={{ color: '#64b5f6' }}>{bot.stockPosition.toLocaleString('id-ID')} Lot</span>
                    </div>
                    <div className="sultan-d-item">
                      <span className="sultan-d-label">Average Buy</span>
                      <span className="sultan-d-value">{bot.stockPosition > 0 ? bot.avgBuyPrice.toLocaleString('id-ID') : '—'}</span>
                    </div>
                    <div className="sultan-d-item">
                      <span className="sultan-d-label">Win Rate</span>
                      <span className="sultan-d-value" style={{ color: pnlColor(bot.winRate - 50) }}>{bot.winRate.toFixed(2)}% ({bot.winTrade}W/{bot.lossTrade}L)</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {sortedBots.length === 0 && (
          <div className="sultan-empty">Menunggu data Sultan Bot...</div>
        )}
      </div>
    </div>
  );
}
