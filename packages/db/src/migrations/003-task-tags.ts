import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  const dialect = process.env.DB_DIALECT || 'sqlite';

  // Create tags table
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

  // Create indexes
  await sql`CREATE INDEX IF NOT EXISTS idx_tags_user_id ON tags(user_id)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_tags_normalized_name ON tags(normalized_name)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_task_tags_task_id ON task_tags(task_id)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_task_tags_tag_id ON task_tags(tag_id)`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS task_tags`.execute(db);
  await sql`DROP TABLE IF EXISTS tags`.execute(db);
}
