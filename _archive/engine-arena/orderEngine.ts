// ============================================================
// Order Engine — Validates and routes player orders
// Acts as the gateway between players and the Matching Engine.
// ============================================================

import { v4 as uuidv4 } from 'uuid';
import {
  Order,
  OrderSide,
  OrderType,
  OrderStatus,
} from './types';
import { MatchingEngine } from './matchingEngine';

export class OrderEngine {
  private matchingEngine: MatchingEngine;

  constructor(matchingEngine: MatchingEngine) {
    this.matchingEngine = matchingEngine;
  }

  /**
   * Submit a new order. Validates inputs, creates an Order object,
   * and passes it to the Matching Engine.
   */
  submitOrder(
    playerId: string,
    side: OrderSide,
    orderType: OrderType,
    price: number,
    quantity: number
  ): { order: Order; executions: import('./types').Execution[] } {
    // ── Validation ─────────────────────────────────────────
    if (quantity <= 0) {
      throw new Error('Quantity must be greater than 0');
    }

    if (orderType === OrderType.LIMIT && price <= 0) {
      throw new Error('Limit order price must be greater than 0');
    }

    if (orderType === OrderType.MARKET) {
      // Market order price is 0 (execute at best available)
      price = 0;
    }

    // ── Create Order ───────────────────────────────────────
    const order: Order = {
      id: uuidv4(),
      side,
      type: orderType,
      price,
      quantity,
      filledQty: 0,
      timestamp: Date.now(),
      playerId,
      status: OrderStatus.NEW,
    };

    // ── Route to Matching Engine ───────────────────────────
    const executions = this.matchingEngine.submitOrder(order);

    return { order, executions };
  }

  /**
   * Cancel an existing order.
   */
  cancelOrder(orderId: string, playerId: string): Order | null {
    return this.matchingEngine.cancelOrder(orderId, playerId);
  }

  /**
   * Modify an existing order (cancel + re-submit).
   */
  modifyOrder(
    orderId: string,
    playerId: string,
    newPrice?: number,
    newQuantity?: number
  ): { order: Order; executions: import('./types').Execution[] } | null {
    // Cancel old order
    const cancelled = this.matchingEngine.cancelOrder(orderId, playerId);
    if (!cancelled) return null;

    // Re-submit with new parameters
    const price = newPrice ?? cancelled.price;
    const quantity = newQuantity ?? cancelled.quantity;

    return this.submitOrder(
      playerId,
      cancelled.side,
      OrderType.LIMIT,
      price,
      quantity
    );
  }
}
