#!/bin/bash
set -e

echo "=== Smoke test for production packaging ==="

# Assign one unique temp SQLite path once near the top
DB_PATH=$(mktemp -t smoke-test-db-XXXXX.db)
trap 'rm -f "${DB_PATH}" "${DB_PATH}-wal" "${DB_PATH}-shm"' EXIT

# 1. Build all packages
echo "1. Building packages..."
npm run build

# 2. Run compiled migrator once against fresh SQLite (use DB_PATH)
echo "2. Running compiled migrator (first pass)..."
DB_DIALECT=sqlite SQLITE_PATH="${DB_PATH}" node packages/db/dist/migrations/run.js

# 3. Run compiled migrator again (should skip already-applied migrations)
echo "3. Running compiled migrator (second pass)..."
DB_DIALECT=sqlite SQLITE_PATH="${DB_PATH}" node packages/db/dist/migrations/run.js

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

echo "=== Smoke test completed ==="
