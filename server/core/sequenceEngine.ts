import { TimelineEntry, Sequence, DetectorType } from './types';

/**
 * Sequence Engine (Layer 8)
 * 
 * Ported & expanded from `journeys` in whaleTracker.ts.
 * 
 * Detects multi-event patterns like:
 *   WHALE → BUY_WALL → ABSORPTION → MIGRATION → BREAKOUT
 * 
 * Unlike journeys (which only tracked whale-to-whale), this engine
 * correlates ACROSS event types to identify institutional sequences.
 */

// Known institutional patterns
const KNOWN_PATTERNS: { name: string; sequence: DetectorType[]; minMatch: number }[] = [
  { name: 'ACCUMULATION', sequence: ['WHALE', 'BUY_WALL', 'ABSORPTION', 'ICEBERG'], minMatch: 3 },
  { name: 'DISTRIBUTION', sequence: ['WHALE', 'SELL_WALL', 'ABSORPTION', 'ICEBERG'], minMatch: 3 },
  { name: 'SPOOF_TRAP', sequence: ['SPOOF', 'TRAP', 'WHALE'], minMatch: 2 },
  { name: 'WALL_MIGRATION', sequence: ['BUY_WALL', 'MIGRATION', 'BUY_WALL'], minMatch: 2 },
  { name: 'SWEEP_REVERSAL', sequence: ['STOP_HUNT', 'WHALE', 'BUY_WALL'], minMatch: 2 },
  { name: 'ICEBERG_ACCUMULATION', sequence: ['ICEBERG', 'WHALE', 'ABSORPTION'], minMatch: 2 },
];

export class SequenceEngine {
  private activeSequences: Map<string, Sequence[]> = new Map(); // symbol -> active sequences
  private sequenceCounter = 0;
  private MAX_SEQUENCES_PER_SYMBOL = 50;
  private SEQUENCE_TIMEOUT_MS = 600_000; // 10 min — if no new event in this window, sequence is stale

  update(symbol: string, recentEvents: TimelineEntry[]): Sequence[] {
    if (!this.activeSequences.has(symbol)) {
      this.activeSequences.set(symbol, []);
    }
    const sequences = this.activeSequences.get(symbol)!;
    const now = Date.now();

    // Try to extend existing sequences
    for (const event of recentEvents) {
      let matched = false;

      for (const seq of sequences) {
        if (seq.status === 'INVALIDATED') continue;
        if (seq.status === 'CONFIRMED') continue;
        
        // Check if this event could extend the sequence
        const lastEventType = this.getLastType(seq);
        if (this.isValidNextStep(lastEventType, event.type)) {
          seq.eventIds.push(event.eventId);
          seq.pattern += `→${event.type}`;
          seq.lastUpdate = event.time;
          seq.strength = Math.min(99, seq.strength + 10);

          // Check if sequence matches a known pattern
          const matchedPattern = this.matchKnownPattern(seq);
          if (matchedPattern) {
            seq.status = 'CONFIRMED';
            seq.pattern = matchedPattern;
            seq.strength = Math.min(99, seq.strength + 20);
          }

          matched = true;
          break;
        }
      }

      // If no existing sequence matched, start a new one
      if (!matched && this.isSequenceStarter(event.type)) {
        this.sequenceCounter++;
        const newSeq: Sequence = {
          id: `SEQ-${this.sequenceCounter.toString().padStart(4, '0')}`,
          symbol,
          eventIds: [event.eventId],
          pattern: event.type,
          startTime: event.time,
          lastUpdate: event.time,
          strength: 30,
          status: 'FORMING'
        };
        sequences.push(newSeq);
      }
    }

    // Expire old/stale sequences
    const active = sequences.filter(s => {
      if (s.status === 'INVALIDATED') return false;
      if (now - s.lastUpdate > this.SEQUENCE_TIMEOUT_MS) {
        s.status = 'INVALIDATED';
        return false;
      }
      return true;
    });

    // Cap
    if (active.length > this.MAX_SEQUENCES_PER_SYMBOL) {
      active.splice(0, active.length - this.MAX_SEQUENCES_PER_SYMBOL);
    }

    this.activeSequences.set(symbol, active);
    return active;
  }

  getActive(symbol: string): Sequence[] {
    return (this.activeSequences.get(symbol) || []).filter(s => s.status !== 'INVALIDATED');
  }

  getConfirmed(symbol: string): Sequence[] {
    return (this.activeSequences.get(symbol) || []).filter(s => s.status === 'CONFIRMED');
  }

  private getLastType(seq: Sequence): DetectorType {
    const parts = seq.pattern.split('→');
    return parts[parts.length - 1] as DetectorType;
  }

  private isSequenceStarter(type: DetectorType): boolean {
    // These event types can start a new sequence
    return ['WHALE', 'BUY_WALL', 'SELL_WALL', 'SPOOF', 'ICEBERG', 'STOP_HUNT'].includes(type);
  }

  private isValidNextStep(prevType: DetectorType, nextType: DetectorType): boolean {
    // Define valid transitions
    const transitions: Record<string, DetectorType[]> = {
      'WHALE': ['BUY_WALL', 'SELL_WALL', 'ABSORPTION', 'ICEBERG', 'MIGRATION', 'TRAP'],
      'BUY_WALL': ['ABSORPTION', 'SPOOF', 'MIGRATION', 'WHALE', 'ICEBERG'],
      'SELL_WALL': ['ABSORPTION', 'SPOOF', 'MIGRATION', 'WHALE', 'ICEBERG'],
      'SPOOF': ['TRAP', 'WHALE', 'BUY_WALL', 'SELL_WALL'],
      'ICEBERG': ['WHALE', 'ABSORPTION', 'MIGRATION', 'BUY_WALL', 'SELL_WALL'],
      'ABSORPTION': ['MIGRATION', 'WHALE', 'ICEBERG', 'TRAP'],
      'MIGRATION': ['BUY_WALL', 'SELL_WALL', 'WHALE', 'ABSORPTION'],
      'TRAP': ['WHALE', 'STOP_HUNT'],
      'STOP_HUNT': ['WHALE', 'BUY_WALL', 'SELL_WALL', 'TRAP'],
      'DISTRIBUTION': ['SELL_WALL', 'WHALE', 'SPOOF'],
      'FAKE_BREAKOUT': ['TRAP', 'WHALE'],
      'PASSIVE_BUYER': ['BUY_WALL', 'ABSORPTION', 'WHALE'],
      'PASSIVE_SELLER': ['SELL_WALL', 'ABSORPTION', 'WHALE'],
    };
    
    const allowed = transitions[prevType] || [];
    return allowed.includes(nextType);
  }

  private matchKnownPattern(seq: Sequence): string | null {
    const eventTypes = seq.pattern.split('→') as DetectorType[];
    
    for (const pattern of KNOWN_PATTERNS) {
      let matchCount = 0;
      let patternIdx = 0;
      
      for (const eventType of eventTypes) {
        if (patternIdx < pattern.sequence.length && eventType === pattern.sequence[patternIdx]) {
          matchCount++;
          patternIdx++;
        }
      }
      
      if (matchCount >= pattern.minMatch) {
        return pattern.name;
      }
    }
    
    return null;
  }
}
