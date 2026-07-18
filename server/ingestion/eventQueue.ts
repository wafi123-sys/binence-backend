import { EventEmitter } from 'events';
import { RawTrade, RawDepthUpdate, RawLiquidation, RawFundingUpdate, RawOpenInterest } from '../core/types';

export class IngestionEventQueue extends EventEmitter {
  private static instance: IngestionEventQueue;
  
  private constructor() {
    super();
    // Aument max listeners since multiple detectors/engines might subscribe
    this.setMaxListeners(50);
  }

  static getInstance(): IngestionEventQueue {
    if (!IngestionEventQueue.instance) {
      IngestionEventQueue.instance = new IngestionEventQueue();
    }
    return IngestionEventQueue.instance;
  }

  publishTrade(trade: RawTrade) {
    this.emit('trade', trade);
  }

  publishDepth(depth: RawDepthUpdate) {
    this.emit('depth', depth);
  }

  publishLiquidation(liq: RawLiquidation) {
    this.emit('liquidation', liq);
  }

  publishFunding(fund: RawFundingUpdate) {
    this.emit('funding', fund);
  }

  publishOpenInterest(oi: RawOpenInterest) {
    this.emit('openInterest', oi);
  }

  onTrade(listener: (trade: RawTrade) => void) {
    this.on('trade', listener);
  }

  onDepth(listener: (depth: RawDepthUpdate) => void) {
    this.on('depth', listener);
  }

  onLiquidation(listener: (liq: RawLiquidation) => void) {
    this.on('liquidation', listener);
  }

  onFunding(listener: (fund: RawFundingUpdate) => void) {
    this.on('funding', listener);
  }

  onOpenInterest(listener: (oi: RawOpenInterest) => void) {
    this.on('openInterest', listener);
  }
}
