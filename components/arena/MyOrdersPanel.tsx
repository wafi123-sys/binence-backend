// ============================================================
// My Orders Panel — Player's active orders with cancel/modify
// ============================================================

'use client';

import React from 'react';
import { useMarket } from '../../hooks/useMarket';
import { OrderSide, OrderStatus } from '../../engine/types';

export default function MyOrdersPanel() {
  const { myOrders, cancelOrder } = useMarket();

  // Filter to show only active orders
  const activeOrders = myOrders.filter(
    (o) => o.status === OrderStatus.NEW || o.status === OrderStatus.PARTIAL
  );

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
    <div className="my-orders-panel">
      <div className="mo-header">
        <h3>My Orders</h3>
        <span className="mo-count">{activeOrders.length} active</span>
      </div>

      {activeOrders.length === 0 ? (
        <div className="mo-empty">
          <span>No active orders</span>
          <span className="mo-hint">Use the Quick Order panel or click Order Book prices</span>
        </div>
      ) : (
        <div className="mo-list">
          {activeOrders.map((order) => (
            <div
              key={order.id}
              className={`mo-row ${order.side === OrderSide.BUY ? 'mo-row-buy' : 'mo-row-sell'}`}
            >
              <div className="mo-row-top">
                <span className={`mo-side ${order.side === OrderSide.BUY ? 'mo-buy' : 'mo-sell'}`}>
                  {order.side}
                </span>
                <span className="mo-price">
                  {order.price.toLocaleString('id-ID')}
                </span>
                <span className="mo-qty">
                  {order.quantity} lot
                </span>
                <button
                  className="mo-cancel"
                  onClick={() => cancelOrder(order.id)}
                  title="Cancel order"
                >
                  ✕
                </button>
              </div>
              <div className="mo-row-bottom">
                <span className="mo-time">{formatTime(order.timestamp)}</span>
                <span className={`mo-status mo-status-${order.status.toLowerCase()}`}>
                  {order.status}
                </span>
                {order.filledQty > 0 && (
                  <span className="mo-filled">
                    Filled: {order.filledQty}/{order.quantity}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
