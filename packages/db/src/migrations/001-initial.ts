import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  const dialect = process.env.DB_DIALECT || 'sqlite';

  // Create users table with composite unique constraint on (issuer, subject)
  if (dialect === 'postgres') {
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        issuer TEXT NOT NULL,
        subject TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (now()),
        updated_at TEXT NOT NULL DEFAULT (now()),
        UNIQUE(issuer, subject)
      );
    `.execute(db);
  } else {
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        issuer TEXT NOT NULL,
        subject TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(issuer, subject)
      );
    `.execute(db);
  }

  // Create sessions table
  if (dialect === 'postgres') {
    await sql`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (now()),
        updated_at TEXT NOT NULL DEFAULT (now())
      );
    `.execute(db);
  } else {
    await sql`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `.execute(db);
  }

  // Create projects table
  if (dialect === 'postgres') {
    await sql`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES users(id),
        name TEXT NOT NULL,
        description TEXT,
        archived_at TEXT,
        rank INTEGER NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (now()),
        updated_at TEXT NOT NULL DEFAULT (now())
      );
    `.execute(db);
  } else {
    await sql`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES users(id),
        name TEXT NOT NULL,
        description TEXT,
        archived_at TEXT,
        rank INTEGER NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `.execute(db);
  }

  // Create lanes table
  if (dialect === 'postgres') {
    await sql`
      CREATE TABLE IF NOT EXISTS lanes (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        name TEXT NOT NULL,
        rank INTEGER NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (now()),
        updated_at TEXT NOT NULL DEFAULT (now())
      );
    `.execute(db);
  } else {
    await sql`
      CREATE TABLE IF NOT EXISTS lanes (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        name TEXT NOT NULL,
        rank INTEGER NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `.execute(db);
  }

  // Create tasks table
  if (dialect === 'postgres') {
    await sql`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        lane_id TEXT NOT NULL REFERENCES lanes(id),
        title TEXT NOT NULL,
        description TEXT,
        rank INTEGER NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (now()),
        updated_at TEXT NOT NULL DEFAULT (now())
      );
    `.execute(db);
  } else {
    await sql`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        lane_id TEXT NOT NULL REFERENCES lanes(id),
        title TEXT NOT NULL,
        description TEXT,
        rank INTEGER NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `.execute(db);
  }

  // Create api_tokens table
  if (dialect === 'postgres') {
    await sql`
      CREATE TABLE IF NOT EXISTS api_tokens (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES users(id),
        name TEXT NOT NULL,
        prefix TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        scopes TEXT NOT NULL DEFAULT 'read',
        expires_at TEXT,
        revoked_at TEXT,
        last_used_at TEXT,
        created_at TEXT NOT NULL DEFAULT (now()),
        updated_at TEXT NOT NULL DEFAULT (now())
      );
    `.execute(db);
  } else {
    await sql`
      CREATE TABLE IF NOT EXISTS api_tokens (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES users(id),
        name TEXT NOT NULL,
        prefix TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        scopes TEXT NOT NULL DEFAULT 'read',
        expires_at TEXT,
        revoked_at TEXT,
        last_used_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `.execute(db);
  }

  // Create indexes (same for both dialects)
  await sql`CREATE INDEX IF NOT EXISTS idx_projects_owner_id ON projects(owner_id)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_lanes_project_id ON lanes(project_id)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_tasks_lane_id ON tasks(lane_id)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_api_tokens_owner_id ON api_tokens(owner_id)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_api_tokens_prefix ON api_tokens(prefix)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS api_tokens`.execute(db);
  await sql`DROP TABLE IF EXISTS tasks`.execute(db);
  await sql`DROP TABLE IF EXISTS lanes`.execute(db);
  await sql`DROP TABLE IF EXISTS projects`.execute(db);
  await sql`DROP TABLE IF EXISTS sessions`.execute(db);
  await sql`DROP TABLE IF EXISTS users`.execute(db);
}
