import { FastifyInstance } from 'fastify';

export async function registerHealthRoute(app: FastifyInstance) {
  app.get('/health', async (request, reply) => {
    // Check DB readiness
    const db = app.db;
    try {
      await db.selectFrom('users').select('id').limit(1).execute();
    } catch (e) {
      reply.status(503).send({ status: 'unavailable', error: String(e) });
      return;
    }
    reply.send({ status: 'ok', timestamp: new Date().toISOString() });
  });
}
