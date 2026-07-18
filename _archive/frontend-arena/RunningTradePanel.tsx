// ============================================================
// Running Trade Panel — Live trade feed from executions
// ============================================================

'use client';

import React, { useRef, useEffect } from 'react';
import { useMarket } from '../../hooks/useMarket';
import { OrderSide } from '../../engine/types';

export default function RunningTradePanel() {
  const { runningTrades } = useMarket();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to top on new trades
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [runningTrades.length]);

  const formatTime = (ts: number): string => {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <div className="running-trade-panel">
      <div className="rt-header">
        <h3>Running Trade</h3>
        <span className="rt-count">{runningTrades.length} trades</span>
      </div>

      <div className="rt-cols">
        <span>Time</span>
        <span>Price</span>
        <span>Vol</span>
        <span>Side</span>
      </div>

      <div className="rt-list" ref={scrollRef}>
        {runningTrades.length === 0 && (
          <div className="rt-empty">No trades yet</div>
        )}
        {runningTrades.map((trade, i) => (
          <div
            key={`${trade.time}-${i}`}
            className={`rt-row ${i === 0 ? 'rt-row-new' : ''}`}
          >
            <span className="rt-time">{formatTime(trade.time)}</span>
            <span className={`rt-price ${trade.side === OrderSide.BUY ? 'rt-buy' : 'rt-sell'}`}>
              {trade.price.toLocaleString('id-ID')}
            </span>
            <span className="rt-vol">{trade.volume}</span>
            <span className={`rt-side ${trade.side === OrderSide.BUY ? 'rt-buy' : 'rt-sell'}`}>
              {trade.side}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
