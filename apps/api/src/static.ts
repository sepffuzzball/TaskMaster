/**
 * Static file serving utilities for production.
 * Extracts static registration into an exported function so tests can configure a Fastify instance.
 */

import { resolve, join, dirname } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

const WEB_DIST_DIR = process.env.WEB_DIST
  ? resolve(process.env.WEB_DIST)
  : resolve(dirname(fileURLToPath(import.meta.url)), '../../web/dist');

/**
 * Register static file serving for the production server.
 * @param app - The Fastify instance
 * @param distPath - The path to the web dist directory (defaults to WEB_DIST_DIR)
 */
export async function registerWebStatic(app: FastifyInstance, distPath: string = WEB_DIST_DIR): Promise<void> {
  const webDistExists = existsSync(distPath.endsWith('/') ? distPath.slice(0, -1) : distPath);

  if (webDistExists) {
    // Register static file serving with @fastify/static
    //
    // Options:
    // - root: absolute path to web dist
    // - wildcard: false to avoid auto-serving all files; we handle routes manually
    // - index: false to avoid serving index.html automatically
    // - immutable: one-year caching for hashed assets (applies to all sendFile calls)
    // - maxAge: '1y' (one year) also applies to all sendFile calls
    await app.register(fastifyStatic, {
      root: distPath,
      wildcard: false,
      index: false,
      immutable: true,
      maxAge: '1y',
      globIgnore: ['assets/**'],
    });

    // Serve hashed assets with immutable one-year caching
    app.get('/assets/*', async (request, reply) => {
      // Prevent path traversal
      const requestedPath = String((request.params as any)['*'] || '').replace(/^\/+/, '');
      if (requestedPath.includes('..') || requestedPath.includes('//')) {
        return reply.status(404).send({ errors: [{ code: 'NOT_FOUND', message: 'File not found' }] });
      }
      const filePath = join(distPath, 'assets', requestedPath);
      try {
        const stat = statSync(filePath);
        if (!stat.isFile() || !filePath.startsWith(join(distPath, 'assets'))) {
          return reply.status(404).send({ errors: [{ code: 'NOT_FOUND', message: 'File not found' }] });
        }
      } catch {
        return reply.status(404).send({ errors: [{ code: 'NOT_FOUND', message: 'File not found' }] });
      }
      // sendFile with immutable caching header (plugin defaults apply)
      return reply.sendFile(requestedPath, join(distPath, 'assets'));
    });

    // SPA fallback: use not-found handler for non-API/MCP/DOCS routes
    app.setNotFoundHandler(async (request, reply) => {
      // Only handle GET/HEAD requests
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return reply.status(404).send({ errors: [{ code: 'NOT_FOUND', message: 'Route not found' }] });
      }
      // Check Accept header includes text/html
      const accept = request.headers.accept || '';
      if (!accept.includes('text/html')) {
        return reply.status(404).send({ errors: [{ code: 'NOT_FOUND', message: 'Route not found' }] });
      }
      const url = request.url;
      // Skip if URL starts with reserved prefixes
      if (url.startsWith('/api') || url.startsWith('/mcp') || url.startsWith('/docs') || url.startsWith('/documentation') || url.startsWith('/assets')) {
        return reply.status(404).send({ errors: [{ code: 'NOT_FOUND', message: 'Route not found' }] });
      }
      // Skip if URL has a file extension (means it's an asset or missing asset)
      if (url.split('/').pop()?.includes('.')) {
        return reply.status(404).send({ errors: [{ code: 'NOT_FOUND', message: 'Route not found' }] });
      }
      // Serve index.html with no caching (override plugin defaults)
      const indexPath = join(distPath, 'index.html');
      if (existsSync(indexPath)) {
        return reply.type('text/html').sendFile('index.html', distPath, { maxAge: 0, immutable: false });
      } else {
        return reply.status(404).send({ errors: [{ code: 'NOT_FOUND', message: 'Route not found' }] });
      }
    });
  }
}
