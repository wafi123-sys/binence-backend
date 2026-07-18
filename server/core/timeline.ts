import { MarketEvent, TimelineEntry, DetectorType } from './types';

/**
 * Timeline (Layer 7)
 * 
 * Maintains an ordered sequence of MarketEvents per symbol.
 * Filters noise (duplicate events at same price+type within short window).
 * Provides getRecent() for downstream layers (Sequence, Evidence).
 */

export class Timeline {
  private entries: Map<string, TimelineEntry[]> = new Map(); // symbol -> entries
  private MAX_ENTRIES = 2000;
  private DEDUP_WINDOW_MS = 5_000; // Don't allow same type+price within 5s

  append(event: MarketEvent) {
    if (!this.entries.has(event.symbol)) {
      this.entries.set(event.symbol, []);
    }
    const list = this.entries.get(event.symbol)!;

    // Dedup: check if same type+price exists within window
    const isDuplicate = list.some(e =>
      e.type === event.type &&
      Math.abs(e.price - event.price) / event.price < 0.001 && // Within 0.1% price
      Math.abs(e.time - event.time) < this.DEDUP_WINDOW_MS
    );

    if (isDuplicate) return;

    const entry: TimelineEntry = {
      eventId: event.id,
      symbol: event.symbol,
      time: event.time,
      type: event.type,
      price: event.price
    };

    list.push(entry);

    // Cap size
    if (list.length > this.MAX_ENTRIES) {
      list.splice(0, list.length - this.MAX_ENTRIES);
    }
  }

  getRecent(symbol: string, windowMs: number = 300_000): TimelineEntry[] {
    const list = this.entries.get(symbol) || [];
    const cutoff = Date.now() - windowMs;
    return list.filter(e => e.time >= cutoff);
  }

  getAll(symbol: string): TimelineEntry[] {
    return this.entries.get(symbol) || [];
  }

  getByType(symbol: string, type: DetectorType, windowMs: number = 300_000): TimelineEntry[] {
    return this.getRecent(symbol, windowMs).filter(e => e.type === type);
  }

  getCount(symbol: string, windowMs: number = 60_000): number {
    return this.getRecent(symbol, windowMs).length;
  }
}
