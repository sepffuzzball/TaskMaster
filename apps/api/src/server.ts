#!/usr/bin/env node

/**
 * Production server entry point.
 * Imports the built Fastify app from dist/index.js
 * and starts it with @fastify/static for production asset serving.
 */

import { fileURLToPath } from 'node:url';
import { resolve, dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { buildApp } from './index.js';
import fastifyStatic from '@fastify/static';

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// WEB_DIST should be an absolute path when set; otherwise resolve from server location
const WEB_DIST_DIR = process.env.WEB_DIST
  ? resolve(process.env.WEB_DIST)
  : resolve(dirname(fileURLToPath(import.meta.url)), '../../web/dist');

async function start() {
  const app = await buildApp();

  const distPath = WEB_DIST_DIR;
  const webDistExists = existsSync(distPath.endsWith('/') ? distPath.slice(0, -1) : distPath);

  if (webDistExists) {
    // Register static file serving with @fastify/static
    //
    // Options:
    // - root: absolute path to web dist
    // - wildcard: false to avoid auto-serving all files; we handle routes manually
    // - index: false to avoid serving index.html automatically
    // - immutable: one-year caching for assets
    await app.register(fastifyStatic, {
      root: distPath,
      wildcard: false,
      index: false,
      // We'll set cache headers ourselves for hashed assets
    });

    // Serve hashed assets with immutable one-year caching
    app.get('/assets/*', async (request, reply) => {
      // Prevent path traversal
      const requestedPath = String((request.params as any)['*'] || '').replace(/^\/+/, '');
      if (requestedPath.includes('..') || requestedPath.includes('//')) {
        reply.status(404).send({ errors: [{ code: 'NOT_FOUND', message: 'File not found' }] });
        return;
      }
      const filePath = join(distPath, 'assets', requestedPath);
      if (!existsSync(filePath) || !filePath.startsWith(join(distPath, 'assets'))) {
        reply.status(404).send({ errors: [{ code: 'NOT_FOUND', message: 'File not found' }] });
        return;
      }
      // sendFile with immutable caching header
      reply.sendFile(requestedPath, join(distPath, 'assets'), {
        immutable: true,
        maxAge: '1y',
      });
    });

    // SPA fallback: use not-found handler for non-API/MCP/DOCS routes
    app.setNotFoundHandler(async (request, reply) => {
      // Only handle GET/HEAD requests
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        reply.status(404).send({ errors: [{ code: 'NOT_FOUND', message: 'Route not found' }] });
        return;
      }
      // Check Accept header includes text/html
      const accept = request.headers.accept || '';
      if (!accept.includes('text/html')) {
        reply.status(404).send({ errors: [{ code: 'NOT_FOUND', message: 'Route not found' }] });
        return;
      }
      const url = request.url;
      // Skip if URL starts with reserved prefixes
      if (url.startsWith('/api') || url.startsWith('/mcp') || url.startsWith('/docs') || url.startsWith('/documentation')) {
        reply.status(404).send({ errors: [{ code: 'NOT_FOUND', message: 'Route not found' }] });
        return;
      }
      // Skip if URL has a file extension (means it's an asset or missing asset)
      if (url.split('/').pop()?.includes('.')) {
        reply.status(404).send({ errors: [{ code: 'NOT_FOUND', message: 'Route not found' }] });
        return;
      }
      // Serve index.html
      const indexPath = join(distPath, 'index.html');
      if (existsSync(indexPath)) {
        reply.type('text/html').sendFile('index.html', distPath);
      } else {
        reply.status(404).send({ errors: [{ code: 'NOT_FOUND', message: 'Route not found' }] });
      }
    });
  }

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
