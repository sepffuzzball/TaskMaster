#!/usr/bin/env node

/**
 * Production server entry point.
 * Imports the built Fastify app from dist/index.js
 * and starts it with @fastify/static for production asset serving.
 */

import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { buildApp } from './index.js';
import { registerWebStatic } from './static.js';

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// WEB_DIST should be an absolute path when set; otherwise resolve from server location
const WEB_DIST_DIR = process.env.WEB_DIST
  ? resolve(process.env.WEB_DIST)
  : resolve(dirname(fileURLToPath(import.meta.url)), '../../web/dist');

async function start() {
  const app = await buildApp();

  await registerWebStatic(app, WEB_DIST_DIR);

  app.listen({ port: PORT, host: HOST }, (err) => {
    if (err) {
      console.error('Failed to start server:', err);
      process.exit(1);
    }
    console.log(`Server running on http://${HOST}:${PORT}`);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    app.close().then(() => {
      console.log('Shutting down (SIGTERM)...');
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    app.close().then(() => {
      console.log('Shutting down (SIGINT)...');
      process.exit(0);
    });
  });
}

start().catch((err) => {
  console.error('Failed to start production server:', err);
  process.exit(1);
});
