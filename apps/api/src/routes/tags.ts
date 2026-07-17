import { FastifyInstance } from 'fastify';
import { Services } from '../services/index.js';
import * as shared from '@taskmaster/shared';

export async function registerTagRoutes(app: FastifyInstance) {
  const services = app.services as Services;

  // GET /tags - list tags for authenticated user
  app.get('/tags', async (request, reply) => {
    await app.requireAuth(request, reply);
    const tags = await services.listTags(request.ownerId!);
    reply.send(tags);
  });

  // PUT /tags/:tagId - update a tag
  app.put<{ Params: { tagId: string } }>('/tags/:tagId', async (request, reply) => {
    await app.requireAuth(request, reply);
    const input = shared.UpdateTagInput.parse(request.body as any);
    const tag = await services.updateTag(request.params.tagId, input, request.ownerId!);
    reply.send(tag);
  });

  // DELETE /tags/:tagId - delete a tag (requires expectedVersion as query parameter)
  app.delete<{ Params: { tagId: string }; Querystring: { expectedVersion: string } }>('/tags/:tagId', async (request, reply) => {
    await app.requireAuth(request, reply);
    const expectedVersionStr = request.query.expectedVersion;
    if (!expectedVersionStr || !(/^\d+$/.test(expectedVersionStr))) {
      reply.status(400).send({ errors: [{ code: 'BAD_REQUEST', message: 'expectedVersion must be a nonnegative integer' }] });
      return;
    }
    const expectedVersion = parseInt(expectedVersionStr, 10);
    await services.deleteTag(request.params.tagId, expectedVersion, request.ownerId!);
    reply.send({ success: true });
  });
}
