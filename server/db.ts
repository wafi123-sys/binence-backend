import { Pool } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

// Create connection pool
export const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  // If undefined, pg will try to connect using PG* environment variables or local socket
  max: 20, // Max number of connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

/**
 * Initialize Database Schema
 */
export async function initDatabase() {
  if (!process.env.DATABASE_URL) {
    console.log('[DB] No DATABASE_URL found. Will fallback to file logging.');
    return false;
  }

  try {
    const client = await db.connect();
    
    // Create trades table
    await client.query(`
      CREATE TABLE IF NOT EXISTS trades (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(20) NOT NULL,
        price DOUBLE PRECISION NOT NULL,
        qty DOUBLE PRECISION NOT NULL,
        is_maker BOOLEAN NOT NULL,
        trade_time BIGINT NOT NULL,
        local_time BIGINT NOT NULL
      );
    `);

    // Create snapshots table
    await client.query(`
      CREATE TABLE IF NOT EXISTS snapshots (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(20) NOT NULL,
        bids JSONB NOT NULL,
        asks JSONB NOT NULL,
        local_time BIGINT NOT NULL
      );
    `);

    // Create indexes for fast querying
    await client.query(`CREATE INDEX IF NOT EXISTS idx_trades_symbol_time ON trades(symbol, local_time);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_snapshots_symbol_time ON snapshots(symbol, local_time);`);

    client.release();
    console.log('[DB] PostgreSQL Tables initialized successfully.');
    return true;
  } catch (error) {
    console.error('[DB] Failed to initialize database:', error);
    return false;
  }
}
