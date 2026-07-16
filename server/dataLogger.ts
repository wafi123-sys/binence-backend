import * as fs from 'fs';
import * as path from 'path';
import { db } from './db';

export type LogEventType = 'trade' | 'snapshot';

export interface DataLoggerConfig {
  logDir: string;
  flushIntervalMs?: number;
}

export class DataLogger {
  private logDir: string;
  private flushIntervalMs: number;
  private buffers: Map<string, any[]> = new Map();
  private flushTimer: NodeJS.Timeout;
  private isFlushing = false;

  constructor(config: DataLoggerConfig) {
    this.logDir = config.logDir;
    this.flushIntervalMs = config.flushIntervalMs || 5000;

    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }

    this.flushTimer = setInterval(() => this.flush(), this.flushIntervalMs);
    
    // Prune old files every hour
    setInterval(() => this.pruneOldFiles(), 60 * 60 * 1000);
    // Also prune on startup
    this.pruneOldFiles();
  }

  public logEvent(symbol: string, type: LogEventType, data: any) {
    const key = `${symbol}_${type}`;
    if (!this.buffers.has(key)) {
      this.buffers.set(key, []);
    }
    
    if (!data.local_time) {
      data.local_time = Date.now();
    }
    
    this.buffers.get(key)!.push(data);
  }

  private async flush() {
    if (this.buffers.size === 0 || this.isFlushing) return;
    this.isFlushing = true;

    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const useDb = !!process.env.DATABASE_URL;
    
    for (const [key, events] of this.buffers.entries()) {
      if (events.length === 0) continue;

      // Swap buffer to process
      const processingEvents = [...events];
      events.length = 0; // Clear immediately to allow new incoming events

      const [symbol, type] = key.split('_');

      if (useDb) {
        try {
          if (type === 'trade') {
            const values = [];
            const flatValues = [];
            let i = 1;
            for (const e of processingEvents) {
              values.push(`($${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++})`);
              flatValues.push(symbol, parseFloat(e.p), parseFloat(e.q), e.m, e.T, e.local_time);
            }
            const query = `INSERT INTO trades (symbol, price, qty, is_maker, trade_time, local_time) VALUES ${values.join(',')}`;
            await db.query(query, flatValues);
          } else if (type === 'snapshot') {
            const values = [];
            const flatValues = [];
            let i = 1;
            for (const e of processingEvents) {
              values.push(`($${i++}, $${i++}, $${i++}, $${i++})`);
              flatValues.push(symbol, JSON.stringify(e.b), JSON.stringify(e.a), e.local_time);
            }
            const query = `INSERT INTO snapshots (symbol, bids, asks, local_time) VALUES ${values.join(',')}`;
            await db.query(query, flatValues);
          }
        } catch (err) {
          console.error(`[DataLogger] DB Insert failed for ${key}:`, err);
        }
      } else {
        // Fallback to File Logging
        const filename = path.join(this.logDir, `${symbol}_${type}_${today}.jsonl`);
        const lines = processingEvents.map(e => JSON.stringify(e)).join('\n') + '\n';
        fs.appendFile(filename, lines, (err) => {
          if (err) console.error(`[DataLogger] Failed to write to ${filename}:`, err);
        });
      }
    }

    this.isFlushing = false;
  }

  private pruneOldFiles() {
    if (!fs.existsSync(this.logDir)) return;
    
    fs.readdir(this.logDir, (err, files) => {
      if (err) return;
      const now = Date.now();
      const ONE_DAY_MS = 24 * 60 * 60 * 1000;
      
      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue;
        const filePath = path.join(this.logDir, file);
        fs.stat(filePath, (err, stats) => {
          if (err) return;
          if (now - stats.mtimeMs > ONE_DAY_MS) {
            fs.unlink(filePath, () => {
              console.log(`[DataLogger] Pruned old log file: ${file}`);
            });
          }
        });
      }
    });
  }

  public shutdown() {
    clearInterval(this.flushTimer);
    this.flush();
  }
}

export const globalDataLogger = new DataLogger({
  logDir: path.join(__dirname, '..', 'data_logs')
});
