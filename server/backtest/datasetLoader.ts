// ============================================================
// DatasetLoader — reads JSONL log files produced by DataLogger
// and merges trade + snapshot events into a single sorted timeline.
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { TimelineEvent, RawTradeLog, SnapshotLog } from './types';

export const DEFAULT_LOG_DIR = path.join(__dirname, '..', '..', 'data_logs');

/**
 * Lists available JSONL log files in the log directory matching
 * the pattern: {symbol}_{type}_{date}.jsonl
 */
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

/**
 * Reads a JSONL file line-by-line, yielding parsed JSON objects.
 * This is memory-efficient for large files.
 */
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

/**
 * Loads and chronologically merges trade + snapshot events
 * from JSONL files within an optional time window.
 *
 * Returns a single sorted array of TimelineEvents.
 * 
 * STRICT NO-LOOKAHEAD: all events are sorted by time ONLY using
 * the event's own timestamp, never future data.
 */
export async function loadTimeline(
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

  // Load trade events
  for (const file of tradeFiles) {
    for await (const raw of readJsonlFile(file)) {
      const t = (raw as RawTradeLog).T || raw.local_time;
      if (fromMs && t < fromMs) continue;
      if (toMs && t > toMs) continue;
      events.push({ type: 'trade', time: t, data: raw as RawTradeLog });
    }
  }

  // Load snapshot events
  for (const file of snapshotFiles) {
    for await (const raw of readJsonlFile(file)) {
      const t = (raw as SnapshotLog).time;
      if (fromMs && t < fromMs) continue;
      if (toMs && t > toMs) continue;
      events.push({ type: 'snapshot', time: t, data: raw as SnapshotLog });
    }
  }

  // Sort strictly by time — this is the critical no-lookahead guarantee
  events.sort((a, b) => a.time - b.time);

  console.log(
    `[DatasetLoader] Loaded ${events.length.toLocaleString()} events for ` +
    `${symbol.toUpperCase()} ` +
    `(${tradeFiles.length} trade file(s), ${snapshotFiles.length} snapshot file(s)).`
  );

  return events;
}
