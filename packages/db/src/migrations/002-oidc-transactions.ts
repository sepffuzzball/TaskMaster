import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  const dialect = process.env.DB_DIALECT || 'sqlite';

  if (dialect === 'postgres') {
    await sql`
      CREATE TABLE IF NOT EXISTS oidc_transactions (
        id TEXT PRIMARY KEY,
        transaction_id TEXT NOT NULL UNIQUE,
        state TEXT NOT NULL,
        nonce TEXT NOT NULL,
        code_verifier TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        consumed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (now()),
        updated_at TEXT NOT NULL DEFAULT (now())
      );
    `.execute(db);
  } else {
    await sql`
      CREATE TABLE IF NOT EXISTS oidc_transactions (
        id TEXT PRIMARY KEY,
        transaction_id TEXT NOT NULL UNIQUE,
        state TEXT NOT NULL,
        nonce TEXT NOT NULL,
        code_verifier TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        consumed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `.execute(db);
  }

  // Index for transaction_id lookups
  await sql`CREATE INDEX IF NOT EXISTS idx_oidc_transactions_tid ON oidc_transactions(transaction_id)`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS oidc_transactions`.execute(db);
}
