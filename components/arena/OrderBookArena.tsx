// ============================================================
// Order Book Arena — Main layout
// Full-screen dark theme: Order Book | Chart | Quick Order
// ============================================================

'use client';

import React, { useState, useCallback } from 'react';
import { MarketProvider, useMarket } from '../../hooks/useMarket';
import OrderBookPanel from './OrderBookPanel';
import QuickOrderPanel from './QuickOrderPanel';
import RunningTradePanel from './RunningTradePanel';
import CandlestickChart from './CandlestickChart';
import MyOrdersPanel from './MyOrdersPanel';
import StatusBar from './StatusBar';
import SultanLeaderboard from './SultanLeaderboard';
import LoginModal from '../LoginModal';
import { OrderSide, OrderType } from '../../engine/types';

function ArenaContent() {
  const { submitOrder, lastPrice, isAuthenticated } = useMarket();

  const [orderPrice, setOrderPrice] = useState(0);
  const [orderLot, setOrderLot] = useState(10);
  const [oneClickTrading, setOneClickTrading] = useState(false);
  const [isLeaderboardOpen, setIsLeaderboardOpen] = useState(false);

  // Single click → fill price field
  const handlePriceClick = useCallback((price: number, _side: OrderSide) => {
    setOrderPrice(price);
  }, []);

  // Double click → one-click instant order if enabled, else fill price
  const handlePriceDoubleClick = useCallback(
    (price: number, side: OrderSide) => {
      if (oneClickTrading) {
        // BUY when clicking an ask price, SELL when clicking a bid price
        submitOrder(side, OrderType.LIMIT, price, orderLot);
      } else {
        setOrderPrice(price);
      }
    },
    [oneClickTrading, submitOrder, orderLot]
  );

  // Show login modal if not authenticated
  if (!isAuthenticated) {
    return (
      <>
        {/* Blurred arena background */}
        <div className="arena-layout" style={{ filter: 'blur(6px)', pointerEvents: 'none', opacity: 0.4 }}>
          <div className="arena-left" />
          <div className="arena-center" />
          <div className="arena-right" />
          <div className="arena-bottom" />
        </div>
        {/* Login modal always open */}
        <LoginModal isOpen={true} onClose={() => {}} />
      </>
    );
  }

  return (
    <div className="arena-layout">
      {/* ── Left: Quick Order + Order Book ── */}
      <div className="arena-left" style={{ overflowY: 'auto' }}>
        <QuickOrderPanel
          price={orderPrice}
          setPrice={setOrderPrice}
          lot={orderLot}
          setLot={setOrderLot}
          oneClickTrading={oneClickTrading}
          setOneClickTrading={setOneClickTrading}
        />
        <OrderBookPanel
          onPriceClick={handlePriceClick}
          onPriceDoubleClick={handlePriceDoubleClick}
          oneClickTrading={oneClickTrading}
          clickLot={orderLot}
        />
      </div>

      {/* ── Center: Candlestick Chart ── */}
      <div className="arena-center" style={{ position: 'relative' }}>
        <button 
          className="sultan-toggle-btn"
          onClick={() => setIsLeaderboardOpen(!isLeaderboardOpen)}
          style={{
            position: 'absolute', top: 10, right: 10, zIndex: 10,
            background: 'var(--color-surface-2)', border: '1px solid #ffd700',
            color: '#ffd700', padding: '6px 12px', borderRadius: '4px',
            fontSize: '12px', fontWeight: 'bold', cursor: 'pointer'
          }}
        >
          👑 TOP 10 SULTAN
        </button>
        <CandlestickChart />
        <SultanLeaderboard isOpen={isLeaderboardOpen} onClose={() => setIsLeaderboardOpen(false)} />
      </div>

      {/* ── Right: Running Trade + My Orders ── */}
      <div className="arena-right">
        <RunningTradePanel />
        <MyOrdersPanel />
      </div>

      {/* ── Bottom: Status Bar ── */}
      <div className="arena-bottom">
        <StatusBar />
      </div>
    </div>
  );
}

export default function OrderBookArena() {
  return (
    <MarketProvider>
      <ArenaContent />
    </MarketProvider>
  );
}
