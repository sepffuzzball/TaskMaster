/**
 * Production static serving regression tests.
 * Tests that Fastify properly waits for and returns sendFile responses
 * instead of completing async handlers with an empty 200.
 * Uses a temporary dist fixture folder.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fastify } from 'fastify';
import { registerWebStatic } from '../src/static.js';
import { resolve, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

// Create a temporary dist fixture
const tmpDir = resolve('/tmp', 'test-static-' + randomUUID());
const distPath = join(tmpDir, 'web', 'dist');
const assetsPath = join(distPath, 'assets');

beforeAll(() => {
  mkdirSync(distPath, { recursive: true });
  mkdirSync(assetsPath, { recursive: true });
  // Write index.html
  writeFileSync(join(distPath, 'index.html'), '<html><body>Test SPA</body></html>', 'utf-8');
  // Write a test asset
  writeFileSync(join(assetsPath, 'test.js'), 'console.log("test");', 'utf-8');
});

afterAll(() => {
  // Clean up
  // (rmSync would need recursive flag)
  import('node:fs').then(fs => { try { fs.rmSync(tmpDir, { recursive: true }); } catch {} });
});

async function buildTestApp() {
  const app = fastify({ logger: false });
  await registerWebStatic(app, distPath);
  await app.ready();
  return app;
}

describe('Production static serving', () => {
  let app: any;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET / with HTML Accept returns index HTML and nonzero body', async () => {
    const reply = await app.inject({
      url: '/',
      headers: { accept: 'text/html' },
    });
    expect(reply.statusCode).toBe(200);
    expect(reply.body).toBe('<html><body>Test SPA</body></html>');
    expect(reply.body.length).toBeGreaterThan(0);
    // index.html should have no caching (max-age=0)
    const cacheControl = reply.headers['cache-control'];
    expect(cacheControl).toMatch(/max-age=0/);
  });

  it('HEAD / with HTML Accept returns index HTML (head request)', async () => {
    const reply = await app.inject({
      url: '/',
      method: 'HEAD',
      headers: { accept: 'text/html' },
    });
    expect(reply.statusCode).toBe(200);
    expect(reply.body).toBe(''); // HEAD returns empty body
  });

  it('extensionless client route returns index HTML', async () => {
    const reply = await app.inject({
      url: '/some-client-route',
      headers: { accept: 'text/html' },
    });
    expect(reply.statusCode).toBe(200);
    expect(reply.body).toBe('<html><body>Test SPA</body></html>');
  });

  it('existing asset returns JS and immutable cache headers', async () => {
    const reply = await app.inject({
      url: '/assets/test.js',
    });
    expect(reply.statusCode).toBe(200);
    expect(reply.body).toBe('console.log("test");');
    // Check immutable cache header
    const cacheControl = reply.headers['cache-control'];
    expect(cacheControl).toBeDefined();
    expect(cacheControl).toMatch(/immutable/);
    expect(cacheControl).toMatch(/max-age=31536000/);
  });

  it('missing asset (including extensionless) returns 404', async () => {
    const reply = await app.inject({
      url: '/assets/missing.js',
    });
    expect(reply.statusCode).toBe(404);
    const body = JSON.parse(reply.body);
    expect(body.errors[0].code).toBe('NOT_FOUND');
  });

  it('reserved /api/unknown returns JSON 404', async () => {
    const reply = await app.inject({
      url: '/api/unknown',
      headers: { accept: 'text/html' },
    });
    expect(reply.statusCode).toBe(404);
    const body = JSON.parse(reply.body);
    expect(body.errors[0].code).toBe('NOT_FOUND');
  });

  it('reserved /mcp/unknown returns JSON 404', async () => {
    const reply = await app.inject({
      url: '/mcp/unknown',
      headers: { accept: 'text/html' },
    });
    expect(reply.statusCode).toBe(404);
    const body = JSON.parse(reply.body);
    expect(body.errors[0].code).toBe('NOT_FOUND');
  });

  it('reserved /docs/unknown returns JSON 404', async () => {
    const reply = await app.inject({
      url: '/docs/unknown',
      headers: { accept: 'text/html' },
    });
    expect(reply.statusCode).toBe(404);
    const body = JSON.parse(reply.body);
    expect(body.errors[0].code).toBe('NOT_FOUND');
  });

  it('non-HTML Accept root returns 404', async () => {
    const reply = await app.inject({
      url: '/',
      headers: { accept: 'application/json' },
    });
    expect(reply.statusCode).toBe(404);
  });

  it('exact /assets returns 404 (not SPA fallback)', async () => {
    const reply = await app.inject({
      url: '/assets',
      headers: { accept: 'text/html' },
    });
    expect(reply.statusCode).toBe(404);
    const body = JSON.parse(reply.body);
    expect(body.errors[0].code).toBe('NOT_FOUND');
  });

  it('/assets/ directory path returns 404', async () => {
    const reply = await app.inject({
      url: '/assets/',
      headers: { accept: 'text/html' },
    });
    expect(reply.statusCode).toBe(404);
    const body = JSON.parse(reply.body);
    expect(body.errors[0].code).toBe('NOT_FOUND');
  });
});
