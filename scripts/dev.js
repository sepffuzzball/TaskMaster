#!/usr/bin/env node

/* global process, console */

/**
 * Development launcher: runs API dev server and web dev server concurrently.
 * Handles clean shutdown on SIGINT/SIGTERM.
 */

import { spawn } from 'node:child_process';

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

function startApi() {
  console.log('Starting API dev server...');
  const api = spawn('fastify', ['start', 'apps/api/src/index.ts', '--watch'], {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, PORT: String(PORT), HOST },
  });
  api.on('close', (code) => {
    if (code !== 0) console.error('API dev exited with code', code);
  });
  return api;
}

function startWeb() {
  console.log('Starting Vite dev server...');
  const web = spawn('npm', ['-w', 'apps/web', 'exec', 'vite'], {
    stdio: 'inherit',
    shell: true,
  });
  web.on('close', (code) => {
    if (code !== 0) console.error('Web dev exited with code', code);
  });
  return web;
}

// Trap signals for clean shutdown
function cleanup() {
  console.log('\nShutting down gracefully...');
  // Kill child processes
  api && api.kill('SIGTERM');
  web && web.kill('SIGTERM');
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

const api = startApi();
const web = startWeb();
