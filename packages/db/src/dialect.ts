import { SqliteDialect, PostgresDialect } from 'kysely';
import Database from 'better-sqlite3';
import { Pool } from 'pg';

export function getDialect() {
  const dialect = process.env.DB_DIALECT;
  if (dialect === 'sqlite') {
    const path = process.env.SQLITE_PATH || '/data/taskmaster.db';
    const db = new Database(path);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    db.pragma('foreign_keys = ON');
    return new SqliteDialect({ database: db });
  }
  if (dialect === 'postgres') {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL not set for postgres dialect');
    const pool = new Pool({ connectionString: url });
    return new PostgresDialect({ pool });
  }
  throw new Error(`Unsupported DB_DIALECT: ${dialect}. Use 'sqlite' or 'postgres'.`);
}
