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
import { EventEmitter } from 'events';

export class AgnoiaOrchestrator {
  public events = new EventEmitter();
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
  
  private lastBroadcastTime: number = 0;
  
  private strategies = [
    new TrendFollowingStrategy(),
    new MeanReversionStrategy()
  ];

  private asyncOrchestrator = new (require('./asyncOrchestrator').AsyncOrchestrator)();

  constructor(symbols: string[] = ['btcusdt', 'ethusdt', 'solusdt', 'bnbusdt']) {
    this.symbols = symbols;
    this.streamManager = new BinanceStreamManager(this.symbols);
    this.validationEngine = new ValidationEngine(this.featureExtractor);
    
    // Proxy events from AsyncOrchestrator out to server.ts
    this.asyncOrchestrator.events.on('AI_STATE_UPDATE', (data: any) => this.events.emit('AI_STATE_UPDATE', data));
    this.asyncOrchestrator.events.on('ENTRY_SIGNAL', (data: any) => this.events.emit('ENTRY_SIGNAL', data));
    
    this.setupPipeline();
  }

  public get tradeJournal() {
    return this.asyncOrchestrator.tradeJournal;
  }

  public start() {
    console.log('[Agnoia V3] Starting Orchestrator pipeline...');
    this.streamManager.start();
    this.symbols.forEach(sym => this.asyncOrchestrator.start(sym));
  }

  public stop() {
    this.streamManager.stop();
    this.asyncOrchestrator.stop();
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
      this.processTick(trade.symbol, features, state, trade);
    });

    this.eventQueue.onDepth(depth => {
      this.marketEngine.applyDepth(depth);
      const state = this.marketEngine.getState(depth.symbol);
      const features = this.featureExtractor.compute(depth.symbol, state);
      this.processTick(depth.symbol, features, state);
    });

    this.eventQueue.onFunding(fund => this.marketEngine.applyFunding(fund));
    this.eventQueue.onOpenInterest(oi => this.marketEngine.applyOpenInterest(oi));
  }

  private processTick(symbol: string, features: any, state: any, trade?: any) {
    // Layer 4: Detectors
    const candidates = this.detectors.flatMap(d => d.evaluate(features, state, trade));
    
    let hasNewEvents = false;

    // Process each candidate through higher layers
    for (const candidate of candidates) {
      // Layer 5: Validation
      const validated = this.validationEngine.validate(candidate, features, state);
      if (!validated.isValid) continue; // Filter out noise

      // Layer 6: Event Wrapping
      const event = this.eventEngine.create(validated);
      globalJournal.logEvent(symbol, 'events', event);

      // Pass down to Async Pipeline
      this.asyncOrchestrator.pushValidatedEvent(symbol, event, state, features);
      hasNewEvents = true;
    }

    if (!hasNewEvents) {
      // Keep Async Pipeline updated with latest state even if no events
      this.asyncOrchestrator.updateStateOnly(state, features);
    }
  }
}
