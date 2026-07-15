#!/bin/bash
set -e

echo "=== Smoke test for production packaging ==="

# 1. Build all packages
echo "1. Building packages..."
npm run build

# 2. Run compiled migrator once against fresh SQLite
echo "2. Running compiled migrator (first pass)..."
DB_DIALECT=sqlite SQLITE_PATH=/tmp/smoke-test-$(date +%s).db node packages/db/dist/migrations/run.js

# 3. Run compiled migrator again (should skip already-applied migrations)
echo "3. Running compiled migrator (second pass)..."
DB_DIALECT=sqlite SQLITE_PATH=/tmp/smoke-test-$(date +%s).db node packages/db/dist/migrations/run.js

# 4. Import compiled @taskmaster/db/shared from production-like node resolution location
echo "4. Testing compiled imports..."
node -e "
import { createDb } from '@taskmaster/db';
import 'kysely';
import { z } from 'zod';
"
echo "Import test passed."

echo "=== Smoke test completed ==="
