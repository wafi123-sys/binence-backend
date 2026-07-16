import * as fs from 'fs';
import * as path from 'path';

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

  /**
   * Logs an event (trade or snapshot) for a specific symbol.
   */
  public logEvent(symbol: string, type: LogEventType, data: any) {
    const key = `${symbol}_${type}`;
    if (!this.buffers.has(key)) {
      this.buffers.set(key, []);
    }
    
    // Attach current server timestamp if not present
    if (!data.local_time) {
      data.local_time = Date.now();
    }
    
    this.buffers.get(key)!.push(data);
  }

  /**
   * Flushes all buffered logs to daily files.
   */
  private flush() {
    if (this.buffers.size === 0) return;

    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    
    for (const [key, events] of this.buffers.entries()) {
      if (events.length === 0) continue;

      const [symbol, type] = key.split('_');
      const filename = path.join(this.logDir, `${symbol}_${type}_${today}.jsonl`);
      
      const lines = events.map(e => JSON.stringify(e)).join('\n') + '\n';
      
      fs.appendFile(filename, lines, (err) => {
        if (err) console.error(`[DataLogger] Failed to write to ${filename}:`, err);
      });

      // Clear the buffer
      events.length = 0;
    }
  }

  /**
   * Deletes log files that are older than 24 hours to save disk space.
   */
  private pruneOldFiles() {
    if (!fs.existsSync(this.logDir)) return;
    
    fs.readdir(this.logDir, (err, files) => {
      if (err) {
        console.error('[DataLogger] Error reading log dir for pruning:', err);
        return;
      }
      
      const now = Date.now();
      const ONE_DAY_MS = 24 * 60 * 60 * 1000;
      
      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue;
        
        const filePath = path.join(this.logDir, file);
        fs.stat(filePath, (err, stats) => {
          if (err) return;
          
          // Delete file if its last modification time is older than 24 hours
          if (now - stats.mtimeMs > ONE_DAY_MS) {
            fs.unlink(filePath, (err) => {
              if (err) {
                console.error(`[DataLogger] Failed to prune old file ${file}:`, err);
              } else {
                console.log(`[DataLogger] Pruned old log file: ${file}`);
              }
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

// Singleton instance export
export const globalDataLogger = new DataLogger({
  logDir: path.join(__dirname, '..', 'data_logs')
});
