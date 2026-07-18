// ============================================================
// DatasetLoader — reads from PostgreSQL or JSONL fallback
// and merges trade + snapshot events into a single sorted timeline.
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { db } from '../db';
import { TimelineEvent, RawTradeLog, SnapshotLog } from './types';

export const DEFAULT_LOG_DIR = path.join(__dirname, '..', '..', 'data_logs');

export function listLogFiles(logDir: string, symbol: string): {
  tradeFiles: string[];
  snapshotFiles: string[];
} {
  if (!fs.existsSync(logDir)) {
    return { tradeFiles: [], snapshotFiles: [] };
  }
  const files = fs.readdirSync(logDir);
  const sym = symbol.toLowerCase();
  const tradeFiles = files
    .filter(f => f.startsWith(`${sym}_trade_`) && f.endsWith('.jsonl'))
    .map(f => path.join(logDir, f))
    .sort();
  const snapshotFiles = files
    .filter(f => f.startsWith(`${sym}_snapshot_`) && f.endsWith('.jsonl'))
    .map(f => path.join(logDir, f))
    .sort();
  return { tradeFiles, snapshotFiles };
}

async function* readJsonlFile(filePath: string): AsyncGenerator<any> {
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line);
    } catch {
      // skip malformed lines
    }
  }
}

export async function loadTimeline(
  logDir: string,
  symbol: string,
  fromMs?: number,
  toMs?: number
): Promise<TimelineEvent[]> {
  const sym = symbol.toLowerCase();
  const events: TimelineEvent[] = [];

  // Check if we use Database
  if (process.env.DATABASE_URL) {
    console.log(`[DatasetLoader] Querying PostgreSQL for ${sym.toUpperCase()}...`);
    
    // Construct time filter
    let timeFilter = '';
    const params: any[] = [sym];
    let pIdx = 2;
    if (fromMs) {
      timeFilter += ` AND local_time >= $${pIdx++}`;
      params.push(fromMs);
    }
    if (toMs) {
      timeFilter += ` AND local_time <= $${pIdx++}`;
      params.push(toMs);
    }

    try {
      // Query trades
      const tradesRes = await db.query(`
        SELECT price, qty, is_maker, trade_time, local_time 
        FROM trades 
        WHERE symbol = $1 ${timeFilter} 
        ORDER BY local_time DESC 
        LIMIT 5000
      `, params);
      for (const row of tradesRes.rows) {
        events.push({
          type: 'trade',
          time: Number(row.trade_time || row.local_time),
          data: {
            e: 'aggTrade',
            p: row.price.toString(),
            q: row.qty.toString(),
            m: row.is_maker,
            T: Number(row.trade_time),
            E: Number(row.local_time),
            s: sym.toUpperCase(),
            local_time: Number(row.local_time)
          } as RawTradeLog
        });
      }

      // Query snapshots
      const snapRes = await db.query(`
        SELECT bids, asks, local_time 
        FROM snapshots 
        WHERE symbol = $1 ${timeFilter} 
        ORDER BY local_time DESC 
        LIMIT 500
      `, params);
      for (const row of snapRes.rows) {
        events.push({
          type: 'snapshot',
          time: Number(row.local_time),
          data: {
            time: Number(row.local_time),
            b: typeof row.bids === 'string' ? JSON.parse(row.bids) : row.bids,
            a: typeof row.asks === 'string' ? JSON.parse(row.asks) : row.asks
          } as SnapshotLog
        });
      }

      if (events.length === 0) {
        throw new Error(`No data found in database for symbol "${symbol}".`);
      }

    } catch (err: any) {
      console.error(`[DatasetLoader] DB Error: ${err.message}. Falling back to file logging...`);
      return await loadTimelineFromFile(logDir, symbol, fromMs, toMs);
    }
  } else {
    // No DB configured, use files
    return await loadTimelineFromFile(logDir, symbol, fromMs, toMs);
  }

  // Sort chronologically
  events.sort((a, b) => a.time - b.time);
  
  console.log(`[DatasetLoader] Loaded ${events.length.toLocaleString()} events from Database for ${symbol.toUpperCase()}.`);
  return events;
}

// Original file loader fallback
async function loadTimelineFromFile(
  logDir: string,
  symbol: string,
  fromMs?: number,
  toMs?: number
): Promise<TimelineEvent[]> {
  const { tradeFiles, snapshotFiles } = listLogFiles(logDir, symbol);

  if (tradeFiles.length === 0) {
    throw new Error(
      `No trade log files found for symbol "${symbol}" in "${logDir}". ` +
      `Please ensure DataLogger has been running for at least a day.`
    );
  }

  const events: TimelineEvent[] = [];

  for (const file of tradeFiles) {
    for await (const raw of readJsonlFile(file)) {
      const t = (raw as RawTradeLog).T || raw.local_time;
      if (fromMs && t < fromMs) continue;
      if (toMs && t > toMs) continue;
      events.push({ type: 'trade', time: t, data: raw as RawTradeLog });
    }
  }

  for (const file of snapshotFiles) {
    for await (const raw of readJsonlFile(file)) {
      const t = (raw as SnapshotLog).time;
      if (fromMs && t < fromMs) continue;
      if (toMs && t > toMs) continue;
      events.push({ type: 'snapshot', time: t, data: raw as SnapshotLog });
    }
  }

  events.sort((a, b) => a.time - b.time);

  console.log(
    `[DatasetLoader] Loaded ${events.length.toLocaleString()} events from Files for ` +
    `${symbol.toUpperCase()} ` +
    `(${tradeFiles.length} trade file(s), ${snapshotFiles.length} snapshot file(s)).`
  );

  return events;
}
