// ============================================================
// Status Bar — Connection, player info, PnL, market info
// ============================================================

'use client';

import React, { useState, useEffect } from 'react';
import { useMarket } from '../../hooks/useMarket';

function fmtRp(v: number): string {
  const abs = Math.abs(v);
  const sign = v >= 0 ? '+' : '-';
  if (abs >= 1_000_000_000) return `${sign}Rp ${(abs / 1_000_000_000).toFixed(2)}M`;
  if (abs >= 1_000_000) return `${sign}Rp ${(abs / 1_000_000).toFixed(1)}jt`;
  return `${sign}Rp ${Math.round(abs).toLocaleString('id-ID')}`;
}

function fmtBalance(v: number): string {
  if (v >= 1_000_000_000) return `Rp ${(v / 1_000_000_000).toFixed(1)}M`;
  if (v >= 1_000_000) return `Rp ${(v / 1_000_000).toFixed(0)}jt`;
  return `Rp ${Math.round(v).toLocaleString('id-ID')}`;
}

export default function StatusBar() {
  const { connectionStatus, playerCount, lastPrice, avatar, username, role, stats } = useMarket();
  const [time, setTime] = useState('');

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, []);

  const statusColor =
    connectionStatus === 'connected' ? '#00e676' :
    connectionStatus === 'reconnecting' ? '#ffab00' : '#ff1744';

  const statusLabel =
    connectionStatus === 'connected' ? 'Connected' :
    connectionStatus === 'reconnecting' ? 'Reconnecting...' : 'Disconnected';

  const pnlTotal = stats.realizedPnL + stats.unrealizedPnL;
  const pnlColor = pnlTotal >= 0 ? '#00e676' : '#ff1744';
  const realizedColor = stats.realizedPnL >= 0 ? '#00e676' : '#ff1744';

  return (
    <div className="status-bar">
      {/* Left: connection + players */}
      <div className="sb-left">
        <div className="sb-item">
          <div className="sb-dot" style={{ backgroundColor: statusColor }} />
          <span>{statusLabel}</span>
        </div>
        <div className="sb-divider" />
        <div className="sb-item">
          <span className="sb-label">Players</span>
          <span className="sb-value">{playerCount}</span>
        </div>
        <div className="sb-divider" />
        <div className="sb-item">
          <span className="sb-label">Last</span>
          <span className="sb-value sb-price">
            {lastPrice > 0 ? lastPrice.toLocaleString('id-ID') : '—'}
          </span>
        </div>
      </div>

      {/* Center: brand */}
      <div className="sb-center">
        <span className="sb-brand">ORDER BOOK ARENA</span>
      </div>

      {/* Right: PnL + user info */}
      <div className="sb-right">
        {/* Realized PnL */}
        <div className="sb-item">
          <span className="sb-label">Realized</span>
          <span className="sb-value" style={{ color: realizedColor, fontWeight: 600 }}>
            {fmtRp(stats.realizedPnL)}
          </span>
        </div>
        <div className="sb-divider" />
        {/* Total PnL */}
        <div className="sb-item">
          <span className="sb-label">Total PnL</span>
          <span className="sb-value" style={{ color: pnlColor, fontWeight: 700 }}>
            {fmtRp(pnlTotal)}
          </span>
        </div>
        <div className="sb-divider" />
        {/* Cash balance */}
        <div className="sb-item">
          <span className="sb-label">Saldo</span>
          <span className="sb-value" style={{ color: role === 'whale' ? '#ffd700' : '#e0e0e0' }}>
            {fmtBalance(stats.cashBalance)}
          </span>
        </div>
        <div className="sb-divider" />
        {/* Position */}
        {stats.stockPosition > 0 && (
          <>
            <div className="sb-item">
              <span className="sb-label">Posisi</span>
              <span className="sb-value" style={{ color: '#64b5f6' }}>
                {stats.stockPosition.toLocaleString('id-ID')} lot
              </span>
            </div>
            <div className="sb-divider" />
          </>
        )}
        {/* User identity */}
        <div className="sb-item" style={{ gap: '0.4rem' }}>
          <span style={{ fontSize: '1rem', lineHeight: 1 }}>{avatar ?? '👤'}</span>
          <span className="sb-value">{username ?? '—'}</span>
          {role === 'whale' && (
            <span style={{
              fontSize: '0.6rem', padding: '1px 5px', borderRadius: 4,
              background: '#ffd70033', color: '#ffd700',
              fontWeight: 700, letterSpacing: '0.04em',
            }}>
              WHALE
            </span>
          )}
        </div>
        <div className="sb-divider" />
        <div className="sb-item">
          <span className="sb-time">{time}</span>
        </div>
      </div>
    </div>
  );
}
