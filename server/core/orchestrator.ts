import { BinanceStreamManager } from '../ingestion/binanceStreams';
import { IngestionEventQueue } from '../ingestion/eventQueue';
import { MarketEngine } from './marketEngine';
import { FeatureExtractor } from './featureExtractor';
import { ValidationEngine } from './validationEngine';
import { EventEngine } from './eventEngine';
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

import { WhaleDetector } from './detectors/whaleDetector';
import { WallDetector } from './detectors/wallDetector';
import { IcebergDetector } from './detectors/icebergDetector';
import { SpoofDetector } from './detectors/spoofDetector';
import { AbsorptionDetector } from './detectors/absorptionDetector';
import { MigrationDetector } from './detectors/migrationDetector';
import { TrapStopHuntDetector } from './detectors/trapStopHuntDetector';

export class AgnoiaOrchestrator {
  private symbols: string[];
  
  private streamManager: BinanceStreamManager;
  private eventQueue = IngestionEventQueue.getInstance();
  
  private marketEngine = new MarketEngine();
  private featureExtractor = new FeatureExtractor();
  
  private detectors = [
    new WhaleDetector(),
    new WallDetector(),
    new IcebergDetector(),
    new SpoofDetector(),
    new AbsorptionDetector(),
    new MigrationDetector(),
    new TrapStopHuntDetector()
  ];
  
  private validationEngine: ValidationEngine;
  private eventEngine = new EventEngine();
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

  constructor(symbols: string[] = ['btcusdt', 'ethusdt', 'solusdt', 'bnbusdt']) {
    this.symbols = symbols;
    this.streamManager = new BinanceStreamManager(this.symbols);
    this.validationEngine = new ValidationEngine(this.featureExtractor);
    
    this.setupPipeline();
  }

  public start() {
    console.log('[Agnoia V3] Starting Orchestrator pipeline...');
    this.streamManager.start();
  }

  public stop() {
    this.streamManager.stop();
  }

  private setupPipeline() {
    this.eventQueue.onTrade(trade => {
      // 1. Layer 2: Market State Update
      this.marketEngine.applyTrade(trade);
      
      // 2. Layer 3: Feature Extraction
      this.featureExtractor.applyTrade(trade);
      const state = this.marketEngine.getState(trade.symbol);
      const features = this.featureExtractor.compute(trade.symbol, state);
      
      // 3. Process Pipeline
      this.processTick(trade.symbol, features, trade);
    });

    this.eventQueue.onDepth(depth => {
      this.marketEngine.applyDepth(depth);
      const state = this.marketEngine.getState(depth.symbol);
      const features = this.featureExtractor.compute(depth.symbol, state);
      this.processTick(depth.symbol, features);
    });

    this.eventQueue.onFunding(fund => this.marketEngine.applyFunding(fund));
    this.eventQueue.onOpenInterest(oi => this.marketEngine.applyOpenInterest(oi));
    
    // We could also process liquidations directly into an event, but for now it's just raw ingestion
  }

  private processTick(symbol: string, features: any, trade?: any) {
    const state = this.marketEngine.getState(symbol);

    // Layer 4: Detectors
    const candidates = this.detectors.flatMap(d => d.evaluate(features, state, trade));
    
    if (candidates.length === 0) return; // Save CPU if nothing happened

    // Process each candidate through higher layers
    for (const candidate of candidates) {
      // Layer 5: Validation
      const validated = this.validationEngine.validate(candidate, features, state);
      if (!validated.isValid) continue; // Filter out noise

      // Layer 6: Event Wrapping
      const event = this.eventEngine.create(validated);
      globalJournal.logEvent(symbol, 'events', event);

      // Layer 7: Timeline
      this.timeline.append(event);
      const recentEvents = this.timeline.getRecent(symbol);

      // Layer 8: Sequences
      const sequences = this.sequenceEngine.update(symbol, recentEvents);
      globalJournal.logEvent(symbol, 'sequences', sequences.filter(s => s.status !== 'INVALIDATED'));

      // Layer 9: Market Memory
      this.marketMemory.update(symbol, [event], state.lastPrice);

      // Layer 10-13: Evidence, Conflict, Probability
      const context = this.contextEngine.compute(symbol, state, features);
      const evidence = this.evidenceEngine.compute(symbol, recentEvents, sequences, this.marketMemory, context);
      const conflict = this.conflictEngine.compute(evidence);
      const probability = this.probabilityEngine.compute(evidence, conflict);

      // Layer 14-15: Strategies & Entry Gate
      const recentSpoofs = this.timeline.getByType(symbol, 'SPOOF', 300_000).length;

      for (const strategy of this.strategies) {
        const decision = strategy.evaluate(probability, context, features);
        
        if (decision.direction !== 'none') {
          const entryDecision = this.entryGate.evaluate(decision, probability, conflict, context, features, recentSpoofs);
          
          if (entryDecision.allowed) {
            // FIRE TRADING SIGNAL
            console.log(`[ENTRY] ${symbol} | Strategy: ${strategy.name} | Dir: ${decision.direction.toUpperCase()} | Conf: ${decision.confidence.toFixed(1)}`);
            globalJournal.logDecision(symbol, decision, probability, conflict, context, entryDecision.checks);
            
            // NOTE: Here you would emit to WebSocket so the frontend can show it
          }
        }
      }
    }
  }
}
