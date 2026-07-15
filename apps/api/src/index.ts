import { fastify } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import { parseEnv } from './config.js';
import { Repository, createDb } from '@taskmaster/db';
import { Services } from './services/index.js';
import { authPlugin } from './plugins/auth.js';
import { errorHandlerPlugin } from './plugins/error-handler.js';
import { registerHealthRoute } from './routes/health.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerLaneRoutes } from './routes/lanes.js';
import { registerTaskRoutes } from './routes/tasks.js';
import { registerAiRoutes } from './routes/ai.js';
import { registerTokenRoutes } from './routes/tokens.js';
import { registerMcpRoutes } from './routes/mcp.js';
import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'crypto';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import fastifyCookie from '@fastify/cookie';

declare module 'fastify' {
  interface FastifyInstance {
    services: Services;
    db: any;
    requireAuth: Function;
  }
}

declare module '@fastify/cookie' {
  // Cookie types already declared
}

async function buildApp() {
  const env = parseEnv();
  const db = createDb();
  const repo = new Repository(db);
  const services = new Services(repo);

  const app = fastify({
    logger: false,
  });

  // Register plugins
  await app.register(fastifyPlugin((instance) => {
    instance.decorate('services', services);
    instance.decorate('db', db);
  }));
  await app.register(authPlugin, {});

  // Register error handler plugin
  await app.register(errorHandlerPlugin, {});

  // Swagger plugin - must register before routes
  await app.register(fastifySwagger, {
    mode: 'dynamic',
  });
  await app.register(fastifySwaggerUi, {
    routePrefix: '/docs',
  });
  await app.register(fastifyCookie, {
    secret: env.SESSION_SECRET || randomBytes(32).toString('hex'),
  });

  // Register routes under /api/v1 prefix
  await app.register((child) => registerHealthRoute(child as any), { prefix: '/api/v1' });
  await app.register((child) => registerAuthRoutes(child as any), { prefix: '/api/v1' });
  await app.register((child) => registerProjectRoutes(child as any), { prefix: '/api/v1' });
  await app.register((child) => registerLaneRoutes(child as any), { prefix: '/api/v1' });
  await app.register((child) => registerTaskRoutes(child as any), { prefix: '/api/v1' });
  await app.register((child) => registerAiRoutes(child as any), { prefix: '/api/v1' });
  await app.register((child) => registerTokenRoutes(child as any), { prefix: '/api/v1' });
  await app.register((child) => registerMcpRoutes(child as any), { prefix: '/mcp' });

  // OpenAPI metadata
  app.addSchema({
    $id: '#Project',
    type: 'object',
    properties: {
      id: { type: 'string' },
      ownerId: { type: 'string' },
      name: { type: 'string' },
      description: { type: 'string' },
      archivedAt: { type: 'string' },
      rank: { type: 'integer' },
      version: { type: 'integer' },
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
    },
  });

  // Graceful shutdown
  app.addHook('onClose', async (instance) => {
    instance.log.info('Shutting down...');
  });

  return app;
}

export { buildApp };
