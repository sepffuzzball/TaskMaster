import { FastifyInstance } from 'fastify';
import { Services } from '../services/index.js';
import * as shared from '@taskmaster/shared';

export async function registerAiRoutes(app: FastifyInstance) {
  const services = app.services as Services;

  // POST /ai/breakdown
  app.post('/ai/breakdown', async (request, reply) => {
    await app.requireAuth(request, reply);
    const result = await services.aiBreakdown(request.body as any);
    reply.send(result);
  });
}
