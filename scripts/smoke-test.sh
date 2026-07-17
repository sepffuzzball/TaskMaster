#!/bin/bash
set -e

echo "=== Smoke test for production packaging ==="

# Assign one unique temp SQLite path once near the top
DB_PATH=$(mktemp -t smoke-test-db-XXXXX.db)
# Use one trap covering all temp DB paths plus WAL/SHM
trap 'rm -f "${DB_PATH}" "${DB_PATH}-wal" "${DB_PATH}-shm"' EXIT

# 1. Build all packages
echo "1. Building packages..."
npm run build

# 2. Run compiled migrator once against fresh SQLite (use DB_PATH)
echo "2. Running compiled migrator (first pass)..."
# Capture stdout/stderr combine
FIRST_OUTPUT=$(DB_DIALECT=sqlite SQLITE_PATH="${DB_PATH}" node packages/db/dist/migrations/run.js 2>&1)
echo "${FIRST_OUTPUT}"

# Verify first pass applied all four migrations: 001-initial, 002-oidc-transactions, 003-task-tags, 004-ensure-task-tags
echo "${FIRST_OUTPUT}" | grep -q "applied: 001-initial" || (echo "FAIL: missing applied: 001-initial in output" && exit 1)
echo "${FIRST_OUTPUT}" | grep -q "applied: 002-oidc-transactions" || (echo "FAIL: missing applied: 002-oidc-transactions in output" && exit 1)
echo "${FIRST_OUTPUT}" | grep -q "applied: 003-task-tags" || (echo "FAIL: missing applied: 003-task-tags in output" && exit 1)
echo "${FIRST_OUTPUT}" | grep -q "applied: 004-ensure-task-tags" || (echo "FAIL: missing applied: 004-ensure-task-tags in output" && exit 1)
echo "First pass: All four migrations applied."

# 3. Run compiled migrator again (should skip already-applied migrations)
echo "3. Running compiled migrator (second pass)..."
SECOND_OUTPUT=$(DB_DIALECT=sqlite SQLITE_PATH="${DB_PATH}" node packages/db/dist/migrations/run.js 2>&1)
echo "${SECOND_OUTPUT}"

# Verify second pass applied nothing (no applied: lines) - all are already applied
echo "${SECOND_OUTPUT}" | grep -q "applied:" && (echo "FAIL: second pass applied something unexpected" && exit 1)
echo "Second pass: No new migrations applied (correct)."

# 4. Import compiled @taskmaster/db/shared from production-like node resolution location
echo "4. Testing compiled imports..."
node --input-type=module -e "
import { createDb } from '@taskmaster/db';
import 'kysely';
import { z } from 'zod';
"
echo "Import test passed."

# 5. Smoke-test compiled MCP routes ESM resolution (fail-fast on failure)
echo "5. Testing compiled MCP routes ESM resolution..."
node --input-type=module -e "
import('./apps/api/dist/routes/mcp.js').then(m => { console.log('MCP import OK'); }).catch(e => { console.error('MCP import FAILED:', e.message); process.exit(1); });
"

# 6. Smoke-test that compiled migrator with SQLite can apply all migrations and verify tags/task_tags exist
echo "6. Verifying compiled migrator produces correct schema..."
# Write inline test script to temp file and execute
TMP_TEST=$(mktemp -t smoke-test-verify-XXXXX.js)
# Use one trap covering both temp DB paths plus WAL/SHM; do not overwrite traps
trap 'rm -f "${TMP_TEST}" "${DB_PATH}" "${DB_PATH}-wal" "${DB_PATH}-shm"' EXIT
cat > "${TMP_TEST}" << 'TESTEOF'
import { createDb, migrateToLatest } from '@taskmaster/db';
import { sql } from 'kysely';

process.env.DB_DIALECT = 'sqlite';
process.env.SQLITE_PATH = process.argv[2] || '/tmp/smoke-test-db-verify.db';

const db = createDb();
migrateToLatest(db)
  .then((result) => {
    // result should be { results?, error? }
    // Verify no error
    if (result.error) {
      console.error('migrateToLatest returned error:', result.error);
      process.exit(1);
    }
    console.log('migrateToLatest results:', JSON.stringify(result.results));
    // Verify tags table exists
    return sql`SELECT name FROM sqlite_master WHERE type='table' AND name='tags'`.execute(db);
  })
  .then((result2) => {
    if (result2.rows.length === 0) {
      console.error('FAIL: tags table not found');
      process.exit(1);
    }
    console.log('Verified: tags table exists');
    return sql`SELECT name FROM sqlite_master WHERE type='table' AND name='task_tags'`.execute(db);
  })
  .then((result3) => {
    if (result3.rows.length === 0) {
      console.error('FAIL: task_tags table not found');
      process.exit(1);
    }
    console.log('Verified: task_tags table exists');
    // Also verify the unique index exists
    return sql`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_tags_user_id_normalized_name'`.execute(db);
  })
  .then((result4) => {
    if (result4.rows.length === 0) {
      console.error('FAIL: unique index idx_tags_user_id_normalized_name not found');
      process.exit(1);
    }
    console.log('Verified: unique index idx_tags_user_id_normalized_name exists');
    db.destroy();
  })
  .catch((e) => {
    console.error('migrateToLatest failed:', e.message);
    process.exit(1);
  });
TESTEOF
node --input-type=module - < "${TMP_TEST}" "${DB_PATH}"
echo "Migration verification passed."

echo "=== Smoke test completed ==="
