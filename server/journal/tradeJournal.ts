import fs from 'fs';
import path from 'path';

export interface TradeRecord {
  id: string;
  symbol: string;
  type: 'LONG' | 'SHORT';
  entryTime: number;
  entryPrice: number;
  exitTime?: number;
  exitPrice?: number;
  pnl?: number;
  status: 'OPEN' | 'CLOSED';
  evidenceScoreAtEntry: number;
  accumulationPct: number;
  distributionPct: number;
}

export class TradeJournal {
  private filePath: string;
  private trades: TradeRecord[] = [];

  constructor(filename: string = 'trades.json') {
    this.filePath = path.join(__dirname, '..', '..', 'data', filename);
    this.ensureDirectoryExists();
    this.load();
  }

  private ensureDirectoryExists() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private load() {
    if (fs.existsSync(this.filePath)) {
      try {
        const data = fs.readFileSync(this.filePath, 'utf-8');
        this.trades = JSON.parse(data);
      } catch (e) {
        console.error('Failed to load trade journal:', e);
      }
    }
  }

  private save() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.trades, null, 2), 'utf-8');
    } catch (e) {
      console.error('Failed to save trade journal:', e);
    }
  }

  public recordEntry(trade: TradeRecord) {
    this.trades.push(trade);
    this.save();
  }

  public recordExit(id: string, exitPrice: number, exitTime: number, pnl: number) {
    const trade = this.trades.find(t => t.id === id && t.status === 'OPEN');
    if (trade) {
      trade.status = 'CLOSED';
      trade.exitPrice = exitPrice;
      trade.exitTime = exitTime;
      trade.pnl = pnl;
      this.save();
    }
  }

  public getHistory(): TradeRecord[] {
    return this.trades;
  }

  public getOpenTrades(): TradeRecord[] {
    return this.trades.filter(t => t.status === 'OPEN');
  }
}
