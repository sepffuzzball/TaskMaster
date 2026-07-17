#!/usr/bin/env node
/**
 * Migration runner - uses Kysely Migrator with a custom MigrationProvider
 * that only picks up migration modules (files with `up`/`down` exports)
 * matching a numeric pattern (e.g. `001-initial.ts`), ignoring run.js.
 *
 * Environment variables:
 *   DB_DIALECT (required) - 'sqlite' or 'postgres'
 *   SQLITE_PATH or DATABASE_URL (depending on dialect)
 */
import { Migrator, type Migration } from 'kysely/migration';
import { createDb } from '../db.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Kysely } from 'kysely';

/**
 * Custom MigrationProvider that filters filenames matching numeric migration
 * patterns and validates they export `up`/`down`.
 */
export class NumericFileMigrationProvider {
  private migrationFolder: string;

  constructor(folder: string) {
    this.migrationFolder = folder;
  }

  async getMigrations(): Promise<Record<string, Migration>> {
    const files = await fs.readdir(this.migrationFolder);
    const migrations: Record<string, Migration> = {};

    for (const file of files) {
      // Only include files starting with digits-hyphen and then alphanumeric/underscore/hyphen chars (e.g. 002-oidc-transactions.ts)
      if (!/^\d+-[-\w]+\.(?:ts|js)$/.test(file)) continue;

      const modulePath = path.resolve(this.migrationFolder, file);
      const moduleUrl = new URL('file://' + modulePath);
      const module = await import(moduleUrl.href);

      // Validate that the module exports up/down
      if (typeof module.up !== 'function' || typeof module.down !== 'function') {
        console.warn(`Skipping ${file}: no up/down exports`);
        continue;
      }

      migrations[file.replace(/\.(?:ts|js)$/, '')] = { up: module.up as Migration['up'], down: module.down as Migration['down'] };
    }

    return migrations;
  }
}

/**
 * Reusable migration function that runs migrations against the given DB handle
 * using the NumericFileMigrationProvider from an optionally provided folder.
 */
export async function migrateToLatest(
  db: Kysely<any>,
  migrationsFolder?: string,
): Promise<{ results?: { status: string; migrationName: string; direction: string }[]; error?: unknown }> {
  // Determine the migrations directory
  let migrationsDir: string;
  if (migrationsFolder) {
    migrationsDir = migrationsFolder;
  } else {
    const dirname = fileURLToPath(new URL('.', import.meta.url));
    migrationsDir = path.resolve(dirname, '.'); // Same directory as this file (compiled)
  }

  const migrator = new Migrator({
    db,
    provider: new NumericFileMigrationProvider(migrationsDir),
  });

  const result = await migrator.migrateToLatest();

  // Make failures fatal: throw the underlying error when present
  if (result.error) {
    throw result.error;
  }

  return result;
}

export async function run(): Promise<void> {
  // Determine the migrations directory from the compiled output
  const dirname = fileURLToPath(new URL('.', import.meta.url));
  const migrationsDir = path.resolve(dirname, '.'); // Same directory as this file (compiled)

  const db = createDb();
  const migrator = new Migrator({
    db,
    provider: new NumericFileMigrationProvider(migrationsDir),
  });

  // Use try/finally to ensure db.destroy always runs
  try {
    // Run `migrateToLatest`
    const { results, error } = await migrator.migrateToLatest();

    // Report each result
    for (const result of results || []) {
      if (result.status === 'Success') {
        console.log(`  applied: ${result.migrationName}`);
      } else if (result.status === 'Error') {
        console.error(`Migration error: ${result.migrationName}`);
      } else {
        console.log(`  not executed: ${result.migrationName}`);
      }
    }

    if (error) {
      console.error('Migration runner failed:', error);
      throw error;
    }
  } finally {
    await db.destroy();
  }
}

// Only auto-call run() when this module is the direct CLI entrypoint
const entrypoint = fileURLToPath(import.meta.url);
const args = process.argv[1];
if (args && entrypoint === path.resolve(args)) {
  run().catch((err) => {
    console.error('Fatal migration error:', err);
    process.exitCode = 1;
  });
}
