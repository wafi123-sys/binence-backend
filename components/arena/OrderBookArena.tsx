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
import LoginModal from '../LoginModal';
import { OrderSide, OrderType } from '../../engine/types';

function ArenaContent() {
  const { submitOrder, lastPrice, isAuthenticated } = useMarket();

  const [orderPrice, setOrderPrice] = useState(0);
  const [oneClickTrading, setOneClickTrading] = useState(false);
  // Default lot for one-click trades
  const [clickLot] = useState(100);

  // Single click → fill price field
  const handlePriceClick = useCallback((price: number, _side: OrderSide) => {
    setOrderPrice(price);
  }, []);

  // Double click → one-click instant order if enabled, else fill price
  const handlePriceDoubleClick = useCallback(
    (price: number, side: OrderSide) => {
      if (oneClickTrading) {
        // BUY when clicking an ask price, SELL when clicking a bid price
        submitOrder(side, OrderType.LIMIT, price, clickLot);
      } else {
        setOrderPrice(price);
      }
    },
    [oneClickTrading, submitOrder, clickLot]
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
      {/* ── Left: Order Book + Running Trade ── */}
      <div className="arena-left">
        <OrderBookPanel
          onPriceClick={handlePriceClick}
          onPriceDoubleClick={handlePriceDoubleClick}
          oneClickTrading={oneClickTrading}
        />
        <RunningTradePanel />
      </div>

      {/* ── Center: Candlestick Chart ── */}
      <div className="arena-center">
        <CandlestickChart />
      </div>

      {/* ── Right: Quick Order + My Orders ── */}
      <div className="arena-right">
        <QuickOrderPanel
          price={orderPrice}
          setPrice={setOrderPrice}
          oneClickTrading={oneClickTrading}
          setOneClickTrading={setOneClickTrading}
        />
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
