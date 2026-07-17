import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  const dialect = process.env.DB_DIALECT || 'sqlite';

  // Check if column already exists
  let columnExists: boolean;
  if (dialect === 'postgres') {
    const result = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'lanes' AND column_name = 'auto_collapse'
        AND table_schema = current_schema()
    `.execute(db);
    columnExists = (result.rows as any[]).length > 0;
  } else {
    const result = await sql`
      SELECT name FROM pragma_table_info('lanes') WHERE name = 'auto_collapse'
    `.execute(db);
    columnExists = (result.rows as any[]).length > 0;
  }

  // Only add column and backfill if it does not exist
  if (!columnExists) {
    if (dialect === 'postgres') {
      await sql`
        ALTER TABLE lanes ADD COLUMN auto_collapse INTEGER NOT NULL DEFAULT 0 CHECK(auto_collapse IN (0,1))
      `.execute(db);
    } else {
      // SQLite supports CHECK on ALTER TABLE ADD COLUMN
      await sql`
        ALTER TABLE lanes ADD COLUMN auto_collapse INTEGER NOT NULL DEFAULT 0 CHECK(auto_collapse IN (0,1))
      `.execute(db);
    }

    // Backfill existing rows: lanes whose trimmed lower name equals 'complete' get auto_collapse=1
    await sql`
      UPDATE lanes SET auto_collapse = 1 WHERE LOWER(TRIM(name)) = 'complete'
    `.execute(db);
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE lanes DROP COLUMN auto_collapse
  `.execute(db);
}
