import { Kysely, sql } from 'kysely';

/**
 * Migration 004: Defensive repair for task/tag schema.
 *
 * This migration safely restores the `tags` and `task_tags` tables (with their full
 * schema including FKs, cascade defaults, version/timestamps, and uniqueness)
 * even if migration metadata says 003 ran but the tables are absent.
 *
 * It uses `CREATE TABLE IF NOT EXISTS` and `CREATE [UNIQUE] INDEX IF NOT EXISTS`
 * to be idempotent when tables already exist (as they would after a healthy 003).
 *
 * `down` is a genuine no-op. Rolling back this repair does NOT destroy schema
 * owned by 003. Only 003's own `down` is responsible for cleanup.
 */
export async function up(db: Kysely<any>): Promise<void> {
  const dialect = process.env.DB_DIALECT || 'sqlite';

  // Create tags table (same schema as 003, safe to run if already present)
  if (dialect === 'postgres') {
    await sql`
      CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        normalized_name TEXT NOT NULL,
        color TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (now()),
        updated_at TEXT NOT NULL DEFAULT (now()),
        UNIQUE(user_id, normalized_name)
      );
    `.execute(db);
  } else {
    await sql`
      CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        normalized_name TEXT NOT NULL,
        color TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(user_id, normalized_name)
      );
    `.execute(db);
  }

  // Create task_tags junction table
  if (dialect === 'postgres') {
    await sql`
      CREATE TABLE IF NOT EXISTS task_tags (
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (now()),
        PRIMARY KEY (task_id, tag_id)
      );
    `.execute(db);
  } else {
    await sql`
      CREATE TABLE IF NOT EXISTS task_tags (
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (task_id, tag_id)
      );
    `.execute(db);
  }

  // Create indexes (all IF NOT EXISTS for idempotency)
  await sql`CREATE INDEX IF NOT EXISTS idx_tags_user_id ON tags(user_id)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_tags_normalized_name ON tags(normalized_name)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_task_tags_task_id ON task_tags(task_id)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_task_tags_tag_id ON task_tags(tag_id)`.execute(db);

  // Ensure uniqueness via `CREATE UNIQUE INDEX IF NOT EXISTS`
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_user_id_normalized_name
    ON tags(user_id, normalized_name)
  `.execute(db);
}

/**
 * Non-destructive `down`:
 *
 * Rolling back this repair does NOT destroy schema owned by 003.
 * This is a genuine no-op: leave the tables and indexes intact.
 * 003's `down` already drops tables if needed.
 */
export async function down(db: Kysely<any>): Promise<void> {
  // No-op: do not drop any tables or indexes. 003's down is responsible for cleanup.
  await sql`SELECT 1 WHERE 1 = 1`.execute(db); // no-op SQL to satisfy function call
}
