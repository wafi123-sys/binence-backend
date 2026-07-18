import * as fs from 'fs';
import * as path from 'path';
import { Timeframe, OHLCBar } from './types';
import { OHLCBuilder } from './ohlcBuilder';

export class DataManager {
  private dbPath = path.join(__dirname, '..', 'data');
  private ohlcFile = path.join(__dirname, '..', 'data', 'ohlc.json');
  private ohlcBuilder: OHLCBuilder;
  private saveInterval: NodeJS.Timeout | null = null;

  constructor(ohlcBuilder: OHLCBuilder) {
    this.ohlcBuilder = ohlcBuilder;
    this.ensureDbExists();
  }

  private ensureDbExists() {
    if (!fs.existsSync(this.dbPath)) fs.mkdirSync(this.dbPath, { recursive: true });
    if (!fs.existsSync(this.ohlcFile)) fs.writeFileSync(this.ohlcFile, JSON.stringify({}));
  }

  public loadOHLC() {
    try {
      const data = fs.readFileSync(this.ohlcFile, 'utf8');
      const parsedData = JSON.parse(data) as Record<string, OHLCBar[]>;
      
      const TWENTY_FOUR_HOURS_SEC = 24 * 60 * 60;
      const cutoffTimeSec = Math.floor(Date.now() / 1000) - TWENTY_FOUR_HOURS_SEC;
      
      let loadedRecords = 0;
      for (const [tf, bars] of Object.entries(parsedData)) {
        if (Array.isArray(bars)) {
          // Filter data older than 24 hours
          const filteredBars = bars.filter(b => b.time >= cutoffTimeSec);
          this.ohlcBuilder.seedHistoricalData(tf as Timeframe, filteredBars);
          loadedRecords += filteredBars.length;
        }
      }
      console.log(`[DataManager] Loaded ${loadedRecords} OHLC bars from DB.`);
      return loadedRecords > 0;
    } catch (e) {
      console.log('[DataManager] Could not load OHLC history, starting fresh.');
      return false;
    }
  }

  public saveOHLC() {
    try {
      const allBars = this.ohlcBuilder.getAllBars();
      const TWENTY_FOUR_HOURS_SEC = 24 * 60 * 60;
      const cutoffTimeSec = Math.floor(Date.now() / 1000) - TWENTY_FOUR_HOURS_SEC;
      
      // Filter outgoing data to clean up memory
      const filteredBars: Record<string, OHLCBar[]> = {};
      for (const [tf, bars] of Object.entries(allBars)) {
        const cleanedBars = bars.filter(b => b.time >= cutoffTimeSec);
        filteredBars[tf] = cleanedBars;
        
        // Also update the builder's memory to avoid memory leaks
        this.ohlcBuilder.seedHistoricalData(tf as Timeframe, cleanedBars);
      }
      
      fs.writeFileSync(this.ohlcFile, JSON.stringify(filteredBars));
    } catch (e) {
      console.error('[DataManager] Failed to save OHLC DB', e);
    }
  }

  public startAutoSave(intervalMs: number = 60000) {
    if (this.saveInterval) clearInterval(this.saveInterval);
    this.saveInterval = setInterval(() => this.saveOHLC(), intervalMs);
    console.log(`[DataManager] Auto-save started (${intervalMs}ms interval).`);
  }

  public stopAutoSave() {
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
      this.saveInterval = null;
    }
  }
}
