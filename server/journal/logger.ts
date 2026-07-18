import * as fs from 'fs';
import * as path from 'path';

/**
 * Journaling (Layer 16)
 * 
 * Logs all decisions and outputs for continuous learning and backtesting.
 */

export class JournalLogger {
  private logDir = path.join(__dirname, '..', '..', 'logs');

  constructor() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  logEvent(symbol: string, category: string, data: any) {
    const today = new Date().toISOString().split('T')[0];
    const filename = path.join(this.logDir, `${symbol}_${category}_${today}.jsonl`);
    
    const payload = {
      timestamp: Date.now(),
      data
    };

    fs.appendFileSync(filename, JSON.stringify(payload) + '\n');
  }

  logDecision(symbol: string, decision: any, probability: any, conflict: any, context: any, checks: any) {
    this.logEvent(symbol, 'decisions', { decision, probability, conflict, context, checks });
  }

  logTrade(symbol: string, trade: any) {
    this.logEvent(symbol, 'trades', trade);
  }
}

export const globalJournal = new JournalLogger();
