'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { generateOrderBook, type OrderBookData } from '@/lib/mockData';
import { BookOpen } from 'lucide-react';
import { formatNumber } from '@/lib/utils';

export default function OrderBook() {
  const [orderBook, setOrderBook] = useState<OrderBookData | null>(null);
  const midPriceRef = useRef(107250); // BTC mid-price approx
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const updateOrderBook = useCallback(() => {
    // Small random walk on mid price
    midPriceRef.current += (Math.random() - 0.5) * 50;
    const data = generateOrderBook(midPriceRef.current, 12);
    setOrderBook(data);
  }, []);

  useEffect(() => {
    updateOrderBook();
    intervalRef.current = setInterval(updateOrderBook, 500);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [updateOrderBook]);

  if (!orderBook) return null;

  const maxBidTotal = orderBook.bids[orderBook.bids.length - 1]?.total || 1;
  const maxAskTotal = orderBook.asks[orderBook.asks.length - 1]?.total || 1;

  return (
    <div className="glass-card p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Order Book</h2>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-text-secondary">BTC/USD</span>
          <div className="flex items-center gap-1.5 text-xs text-success">
            <div className="w-1.5 h-1.5 rounded-full bg-success animate-pulse-glow" />
            LIVE
          </div>
        </div>
      </div>

      {/* Spread info */}
      <div className="flex items-center justify-center gap-4 mb-4 py-2 border-y border-border">
        <span className="text-xs text-text-secondary">Spread</span>
        <span className="text-sm font-mono font-semibold text-foreground">
          ${formatNumber(orderBook.spread, 2)}
        </span>
        <span className="text-xs text-text-muted">
          ({orderBook.spreadPercent.toFixed(4)}%)
        </span>
      </div>

      {/* Order Book Grid */}
      <div className="grid grid-cols-2 gap-3">
        {/* Bids (Buy side) */}
        <div>
          <div className="grid grid-cols-2 gap-2 mb-2 px-2">
            <span className="text-xs font-medium text-text-secondary uppercase tracking-wider">Price</span>
            <span className="text-xs font-medium text-text-secondary uppercase tracking-wider text-right">Amount</span>
          </div>
          <div className="space-y-[2px]">
            {orderBook.bids.map((level, i) => (
              <div key={`bid-${i}`} className="relative px-2 py-1.5 rounded-md overflow-hidden">
                <div
                  className="depth-bar depth-bar-bid"
                  style={{ width: `${(level.total / maxBidTotal) * 100}%` }}
                />
                <div className="relative grid grid-cols-2 gap-2">
                  <span className="text-sm font-mono text-success">
                    {formatNumber(level.price, 2)}
                  </span>
                  <span className="text-sm font-mono text-foreground text-right">
                    {formatNumber(level.amount, 4)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Asks (Sell side) */}
        <div>
          <div className="grid grid-cols-2 gap-2 mb-2 px-2">
            <span className="text-xs font-medium text-text-secondary uppercase tracking-wider">Price</span>
            <span className="text-xs font-medium text-text-secondary uppercase tracking-wider text-right">Amount</span>
          </div>
          <div className="space-y-[2px]">
            {orderBook.asks.map((level, i) => (
              <div key={`ask-${i}`} className="relative px-2 py-1.5 rounded-md overflow-hidden">
                <div
                  className="depth-bar depth-bar-ask"
                  style={{ width: `${(level.total / maxAskTotal) * 100}%` }}
                />
                <div className="relative grid grid-cols-2 gap-2">
                  <span className="text-sm font-mono text-danger">
                    {formatNumber(level.price, 2)}
                  </span>
                  <span className="text-sm font-mono text-foreground text-right">
                    {formatNumber(level.amount, 4)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
