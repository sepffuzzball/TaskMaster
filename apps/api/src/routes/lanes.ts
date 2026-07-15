import { FastifyInstance } from 'fastify';
import { Services } from '../services/index.js';
import * as shared from '@taskmaster/shared';

export async function registerLaneRoutes(app: FastifyInstance) {
  const services = app.services as Services;

  // POST /projects/:projectId/lanes - create lane
  app.post<{ Params: { projectId: string } }>('/projects/:projectId/lanes', async (request, reply) => {
    await app.requireAuth(request, reply);
    const lane = await services.createLane(request.params.projectId, request.ownerId!, request.body as any);
    reply.status(201).send(lane);
  });

  // GET /projects/:projectId/lanes - list lanes
  app.get<{ Params: { projectId: string } }>('/projects/:projectId/lanes', async (request, reply) => {
    await app.requireAuth(request, reply);
    const lanes = await services.listLanes(request.params.projectId, request.ownerId);
    reply.send(lanes);
  });

  // GET /projects/:projectId/lanes/:laneId - get lane
  app.get<{ Params: { projectId: string; laneId: string } }>('/projects/:projectId/lanes/:laneId', async (request, reply) => {
    await app.requireAuth(request, reply);
    const result = await services.getLaneById(request.params.laneId, request.ownerId);
    if ((result as any).error) {
      reply.status((result as any).error).send({ errors: [{ code: (result as any).code, message: 'Lane not found' }] });
      return;
    }
    reply.send((result as any).value);
  });

  // PUT /projects/:projectId/lanes/:laneId - rename lane
  app.put<{ Params: { projectId: string; laneId: string } }>('/projects/:projectId/lanes/:laneId', async (request, reply) => {
    await app.requireAuth(request, reply);
    const lane = await services.renameLane(request.params.laneId, request.params.projectId, request.ownerId!, request.body as any);
    reply.send(lane);
  });

  // POST /projects/:projectId/lanes/reorder - reorder lanes
  app.post<{ Params: { projectId: string } }>('/projects/:projectId/lanes/reorder', async (request, reply) => {
    await app.requireAuth(request, reply);
    await services.reorderLanes(request.params.projectId, request.ownerId!, request.body as any);
    reply.send({ success: true });
  });

  // DELETE /projects/:projectId/lanes/:laneId - delete lane (moves tasks)
  app.delete<{ Params: { projectId: string; laneId: string } }>('/projects/:projectId/lanes/:laneId', async (request, reply) => {
    await app.requireAuth(request, reply);
    const body = request.body as any;
    await services.deleteLane(request.params.projectId, request.ownerId!, request.params.laneId, {
      targetLaneId: body.targetLaneId,
      expectedProjectVersion: body.expectedProjectVersion,
    });
    reply.send({ success: true });
  });
}
