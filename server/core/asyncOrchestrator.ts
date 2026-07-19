import { EventEmitter } from 'events';
import { Timeline } from './timeline';
import { SequenceEngine } from './sequenceEngine';
import { MarketMemory } from './marketMemory';
import { ContextEngine } from './contextEngine';
import { EvidenceEngine } from './evidenceEngine';
import { ConflictEngine } from './conflictEngine';
import { ProbabilityEngine } from './probabilityEngine';
import { EntryGate } from '../strategy/entryGate';
import { TrendFollowingStrategy, MeanReversionStrategy } from '../strategy/baseStrategy';
import { globalJournal } from '../journal/logger';
import { TradeJournal, TradeRecord } from '../journal/tradeJournal';

export class AsyncOrchestrator {
  public events = new EventEmitter();
  
  private timeline = new Timeline();
  private sequenceEngine = new SequenceEngine();
  private marketMemory = new MarketMemory();
  private contextEngine = new ContextEngine();
  private evidenceEngine = new EvidenceEngine();
  private conflictEngine = new ConflictEngine();
  private probabilityEngine = new ProbabilityEngine();
  private entryGate = new EntryGate();
  
  private strategies = [
    new TrendFollowingStrategy(),
    new MeanReversionStrategy()
  ];
  
  public tradeJournal = new TradeJournal();

  private loopInterval: NodeJS.Timeout | null = null;
  private pendingEvents: any[] = [];
  
  // Shared state references
  private latestFeatures: any = null;
  private latestState: any = null;
  private lastPrice: number = 0;

  constructor() {}

  public pushValidatedEvent(symbol: string, event: any, state: any, features: any) {
    this.latestState = state;
    this.latestFeatures = features;
    this.lastPrice = state.lastPrice;
    
    // Layer 7: Timeline
    this.timeline.append(event);
    const recentEvents = this.timeline.getRecent(symbol);

    // Layer 8: Sequences
    const sequences = this.sequenceEngine.update(symbol, recentEvents);
    globalJournal.logEvent(symbol, 'sequences', sequences.filter(s => s.status !== 'INVALIDATED'));

    // Layer 9: Market Memory
    this.marketMemory.update(symbol, [event], state.lastPrice);
    
    this.pendingEvents.push(event);
  }

  public updateStateOnly(state: any, features: any) {
    this.latestState = state;
    this.latestFeatures = features;
    this.lastPrice = state.lastPrice;
  }

  public start(symbol: string) {
    console.log('[Agnoia V3] Starting AsyncOrchestrator pipeline for', symbol);
    
    // Manage exit conditions for open trades
    setInterval(() => {
      const openTrades = this.tradeJournal.getOpenTrades();
      for (const trade of openTrades) {
        if (trade.type === 'LONG') {
           if (this.lastPrice <= trade.entryPrice * 0.995 || this.lastPrice >= trade.entryPrice * 1.02) {
               const pnl = ((this.lastPrice - trade.entryPrice) / trade.entryPrice) * 100 * 10;
               this.tradeJournal.recordExit(trade.id, this.lastPrice, Date.now(), pnl);
           }
        } else {
           if (this.lastPrice >= trade.entryPrice * 1.005 || this.lastPrice <= trade.entryPrice * 0.98) {
               const pnl = ((trade.entryPrice - this.lastPrice) / trade.entryPrice) * 100 * 10;
               this.tradeJournal.recordExit(trade.id, this.lastPrice, Date.now(), pnl);
           }
        }
      }
    }, 1000);

    // Layers 10-15 loop (Decoupled from high-frequency tick ingestion)
    this.loopInterval = setInterval(() => {
      if (!this.latestState || !this.latestFeatures) return;
      
      const recentEvents = this.timeline.getRecent(symbol);
      const sequences = this.sequenceEngine.getActive(symbol);
      
      const context = this.contextEngine.compute(symbol, this.latestState, this.latestFeatures);
      const evidence = this.evidenceEngine.compute(symbol, recentEvents, sequences, this.marketMemory, context);
      const conflict = this.conflictEngine.compute(evidence);
      const probability = this.probabilityEngine.compute(evidence, conflict);

      const now = Date.now();
      
      // Broadcast state to UI
      this.events.emit('AI_STATE_UPDATE', { symbol, context, evidence, conflict, probability, timestamp: now });

      const hasNewEvents = this.pendingEvents.length > 0;
      this.pendingEvents = [];

      if (!hasNewEvents) return;

      // Layer 14-15: Strategies & Entry Gate (ONLY if new events occurred)
      const recentSpoofs = this.timeline.getByType(symbol, 'SPOOF', 300_000).length;

      for (const strategy of this.strategies) {
        const decision = strategy.evaluate(probability, context, this.latestFeatures);
        
        if (decision.direction !== 'none') {
          const entryDecision = this.entryGate.evaluate(decision, probability, conflict, context, this.latestFeatures, recentSpoofs);
          
          if (entryDecision.allowed) {
            // Only allow 1 open trade at a time for simplicity
            if (this.tradeJournal.getOpenTrades().length === 0) {
                console.log(`[ENTRY] ${symbol} | Strategy: ${strategy.name} | Dir: ${decision.direction.toUpperCase()}`);
                globalJournal.logDecision(symbol, decision, probability, conflict, context, entryDecision.checks);
                
                const trade: TradeRecord = {
                   id: Math.random().toString(36).substr(2, 9),
                   symbol,
                   type: decision.direction.toUpperCase() as 'LONG' | 'SHORT',
                   entryTime: now,
                   entryPrice: entryDecision.entryPrice || this.lastPrice,
                   status: 'OPEN',
                   evidenceScoreAtEntry: evidence.totalBullish - evidence.totalBearish,
                   accumulationPct: probability.accumulation,
                   distributionPct: probability.distribution
                };
                this.tradeJournal.recordEntry(trade);
                
                this.events.emit('ENTRY_SIGNAL', trade);
            }
          }
        }
      }
    }, 1000); // 1Hz processing loop
  }

  public stop() {
    if (this.loopInterval) clearInterval(this.loopInterval);
  }
}
