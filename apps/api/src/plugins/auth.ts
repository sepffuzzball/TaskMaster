import fastifyPlugin from 'fastify-plugin';
import { FastifyRequest, FastifyReply } from 'fastify';
import { Services } from '../services/index.js';

declare module 'fastify' {
  interface FastifyRequest {
    ownerId?: string;
    tokenScopes?: string[];
  }
}

export const authPlugin = fastifyPlugin(async (fastify, opts) => {
  const services = fastify.services as Services;

  fastify.decorateRequest('ownerId', { getter() { return ''; }, setter(val) { Object.defineProperty(this, 'ownerId', { value: val, writable: true }); } });
  fastify.decorateRequest('tokenScopes', { getter() { return []; }, setter(val) { Object.defineProperty(this, 'tokenScopes', { value: val, writable: true }); } });

  fastify.decorate('requireAuth', async (request: FastifyRequest, reply: FastifyReply) => {
    // Check cookie session
    const sessionId = request.cookies['session'] as string;
    if (sessionId) {
      const session = await services.getSessionById(sessionId);
      if (session) {
        request.ownerId = session.user_id;
        return;
      }
    }
    // Check bearer token
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const prefix = token.slice(0, 8);
      const authResult = await services.authenticateApiToken(prefix, token);
      if (authResult) {
        const { ownerId, scopes } = authResult;
        // Check write scope before returning success for mutations
        const method = request.method;
        const isMutation = method === 'POST' || method === 'PUT' || method === 'DELETE';
        if (isMutation && !scopes.includes('write')) {
          reply.status(403).send({
            errors: [{ code: 'FORBIDDEN', message: 'Read-only token cannot perform mutation' }],
          });
          throw new Error('FORBIDDEN');
        }
        request.ownerId = ownerId;
        request.tokenScopes = scopes;
        return;
      }
    }
    // Dev bypass
    if (process.env.DEV_AUTH_BYPASS && process.env.NODE_ENV !== 'production') {
      const user = await services.getUserBySubject('dev-bypass');
      if (user) {
        request.ownerId = user.id;
        request.tokenScopes = ['read', 'write'];
        return;
      }
    }
    reply.status(401).send({
      errors: [{ code: 'UNAUTHORIZED', message: 'Authentication required' }],
    });
    // throw to stop execution
    throw new Error('UNAUTHORIZED');
  });
});
