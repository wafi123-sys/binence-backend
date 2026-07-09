// ============================================================
// Order Book Panel — 10-level bid/ask with animations
// ============================================================

'use client';

import React, { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import { useMarket } from '../../hooks/useMarket';
import { OrderBookLevel, OrderSide } from '../../engine/types';

interface OrderBookPanelProps {
  onPriceClick: (price: number, side: OrderSide) => void;
  onPriceDoubleClick: (price: number, side: OrderSide) => void;
  oneClickTrading?: boolean;
}

export default function OrderBookPanel({
  onPriceClick,
  onPriceDoubleClick,
  oneClickTrading = false,
}: OrderBookPanelProps) {
  const { asks, bids, lastPrice, lastSide, lastVolume } = useMarket();

  // Track previous lots for flash animations using refs (avoid stale closures)
  const prevLotsRef = useRef<Map<number, number>>(new Map());
  const [flashMap, setFlashMap] = useState<Map<number, 'green' | 'red'>>(new Map());

  useEffect(() => {
    const newFlash = new Map<number, 'green' | 'red'>();
    const prev = prevLotsRef.current;
    const next = new Map<number, number>();

    [...asks, ...bids].forEach((level) => {
      next.set(level.price, level.totalLot);
      const prevLot = prev.get(level.price);
      if (prevLot !== undefined && prevLot !== level.totalLot) {
        newFlash.set(level.price, level.totalLot > prevLot ? 'green' : 'red');
      }
    });

    prevLotsRef.current = next;

    if (newFlash.size > 0) {
      setFlashMap(newFlash);
      const t = setTimeout(() => setFlashMap(new Map()), 400);
      return () => clearTimeout(t);
    }
  }, [asks, bids]);

  // Max lot for depth bar width calculation
  const maxLot = useMemo(() => {
    let m = 1;
    for (const l of asks) if (l.totalLot > m) m = l.totalLot;
    for (const l of bids) if (l.totalLot > m) m = l.totalLot;
    return m;
  }, [asks, bids]);

  // Asks displayed highest-first (reverse of the sorted ascending array)
  const displayAsks = useMemo(() => [...asks].reverse(), [asks]);

  return (
    <div className="order-book-panel">
      {/* Header */}
      <div className="ob-header">
        <h3>Order Book</h3>
        <div className="ob-header-cols">
          <span>Price</span>
          <span>Lot</span>
          <span>Freq</span>
        </div>
      </div>

      {/* Ask rows (Offer) */}
      <div className="ob-asks">
        {displayAsks.length === 0 && (
          <div className="ob-empty">No offers</div>
        )}
        {displayAsks.map((level) => (
          <BookRow
            key={`ask-${level.price}`}
            level={level}
            side="ask"
            maxLot={maxLot}
            flash={flashMap.get(level.price)}
            onClick={() => onPriceClick(level.price, OrderSide.BUY)}
            onDoubleClick={() => onPriceDoubleClick(level.price, OrderSide.BUY)}
          />
        ))}
      </div>

      {/* Spread / Last Price band */}
      <div className="ob-spread">
        <div className="ob-last-price">
          <span
            className={`ob-last-value ${
              lastSide === OrderSide.BUY ? 'ob-last-buy' :
              lastSide === OrderSide.SELL ? 'ob-last-sell' : ''
            }`}
          >
            {lastPrice > 0 ? lastPrice.toLocaleString('id-ID') : '—'}
          </span>
          {lastVolume > 0 && (
            <span className="ob-last-vol">{lastVolume} lot</span>
          )}
        </div>
        {asks.length > 0 && bids.length > 0 && (
          <div className="ob-spread-value">
            spread {(asks[0].price - bids[0].price).toFixed(0)}
          </div>
        )}
      </div>

      {/* Bid rows */}
      <div className="ob-bids">
        {bids.length === 0 && (
          <div className="ob-empty">No bids</div>
        )}
        {bids.map((level) => (
          <BookRow
            key={`bid-${level.price}`}
            level={level}
            side="bid"
            maxLot={maxLot}
            flash={flashMap.get(level.price)}
            onClick={() => onPriceClick(level.price, OrderSide.SELL)}
            onDoubleClick={() => onPriceDoubleClick(level.price, OrderSide.SELL)}
          />
        ))}
      </div>
    </div>
  );
}

// ── Individual Row ────────────────────────────────────────────

interface BookRowProps {
  level: OrderBookLevel;
  side: 'bid' | 'ask';
  maxLot: number;
  flash?: 'green' | 'red';
  onClick: () => void;
  onDoubleClick: () => void;
}

function BookRow({ level, side, maxLot, flash, onClick, onDoubleClick }: BookRowProps) {
  const depthPct = (level.totalLot / maxLot) * 100;
  const flashClass = flash === 'green' ? 'ob-flash-green' : flash === 'red' ? 'ob-flash-red' : '';

  return (
    <div
      className={`ob-row ob-row-${side} ${flashClass}`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      role="button"
      tabIndex={0}
    >
      <div
        className={`ob-depth ob-depth-${side}`}
        style={{ width: `${depthPct}%` }}
      />
      <div className="ob-row-content">
        <span className="ob-action">{side === 'ask' ? '▶' : '◀'}</span>
        <span className={`ob-price ob-price-${side}`}>
          {level.price.toLocaleString('id-ID')}
        </span>
        <span className="ob-lot">
          {level.totalLot.toLocaleString('id-ID')}
        </span>
        <span className="ob-freq">{level.frequency}</span>
      </div>
    </div>
  );
}
