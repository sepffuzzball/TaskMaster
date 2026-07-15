import { FastifyInstance } from 'fastify';
import { Services } from '../services/index.js';
import * as shared from '@taskmaster/shared';

export async function registerProjectRoutes(app: FastifyInstance) {
  const services = app.services as Services;

  // POST /projects - create
  app.post('/projects', async (request, reply) => {
    await app.requireAuth(request, reply);
    const project = await services.createProject(request.ownerId!, request.body as any);
    reply.status(201).send(project);
  });

  // GET /projects - list
  app.get('/projects', async (request, reply) => {
    await app.requireAuth(request, reply);
    const projects = await services.listProjects(request.ownerId!);
    reply.send(projects);
  });

  // GET /projects/:id - get
  app.get<{ Params: { id: string } }>('/projects/:id', async (request, reply) => {
    await app.requireAuth(request, reply);
    const result = await services.getProjectById(request.params.id, request.ownerId);
    if ((result as any).error) {
      reply.status((result as any).error).send({ errors: [{ code: (result as any).code, message: 'Project not found' }] });
      return;
    }
    reply.send((result as any).value);
  });

  // PUT /projects/:id - update
  app.put<{ Params: { id: string } }>('/projects/:id', async (request, reply) => {
    await app.requireAuth(request, reply);
    const project = await services.updateProject(request.params.id, request.ownerId!, request.body as any);
    reply.send(project);
  });

  // POST /projects/:id/archive
  app.post<{ Params: { id: string } }>('/projects/:id/archive', async (request, reply) => {
    await app.requireAuth(request, reply);
    const body = request.body as any;
    const project = await services.archiveProject(request.params.id, request.ownerId!, body?.expectedVersion);
    reply.send(project);
  });

  // POST /projects/:id/unarchive
  app.post<{ Params: { id: string } }>('/projects/:id/unarchive', async (request, reply) => {
    await app.requireAuth(request, reply);
    const body = request.body as any;
    const project = await services.unarchiveProject(request.params.id, request.ownerId!, body?.expectedVersion);
    reply.send(project);
  });
}
