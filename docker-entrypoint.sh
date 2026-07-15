#!/bin/bash
set -e

# This script runs database migrations then starts the production server.
# It is the Docker entrypoint.

# Determine which dialect the app expects (or let the environment decide)
export DB_DIALECT="${DB_DIALECT:-sqlite}"

# For SQLite, ensure the database path exists and is writable (no suppressed errors)
if [ "$DB_DIALECT" = "sqlite" ]; then
    export SQLITE_PATH="${SQLITE_PATH:-/data/taskmaster.db}"
    mkdir -p "$(dirname "$SQLITE_PATH")"
    # Ensure the user (node) can write to it
    touch "$SQLITE_PATH"
fi

# Run migrations: use the compiled TypeScript migrator
# The db package's compiled output is in packages/db/dist/migrations/run.js
echo "Running database migrations..."
node /app/packages/db/dist/migrations/run.js
echo "Migrations done."

# Start the API server
echo "Starting TaskMaster API server on ${HOST:-0.0.0.0}:${PORT:-3000}..."
exec node /app/apps/api/dist/server.js
