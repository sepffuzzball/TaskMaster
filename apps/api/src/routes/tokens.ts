import { FastifyInstance } from 'fastify';
import { Services } from '../services/index.js';
import * as shared from '@taskmaster/shared';

export async function registerTokenRoutes(app: FastifyInstance) {
  const services = app.services as Services;

  // POST /auth/tokens - create token
  app.post('/auth/tokens', async (request, reply) => {
    await app.requireAuth(request, reply);
    const result = await services.createApiToken(request.ownerId!, request.body as any);
    reply.status(201).send(result);
  });

  // GET /auth/tokens - list tokens
  app.get('/auth/tokens', async (request, reply) => {
    await app.requireAuth(request, reply);
    const tokens = await services.listApiTokens(request.ownerId!);
    reply.send(tokens);
  });

  // POST /auth/tokens/:tokenId/revoke - revoke token
  app.post<{ Params: { tokenId: string } }>('/auth/tokens/:tokenId/revoke', async (request, reply) => {
    await app.requireAuth(request, reply);
    await services.revokeApiToken(request.params.tokenId, request.ownerId!);
    reply.send({ success: true });
  });
}
