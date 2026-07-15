import { FastifyInstance } from 'fastify';
import { Services } from '../services/index.js';
import * as shared from '@taskmaster/shared';

export async function registerTaskRoutes(app: FastifyInstance) {
  const services = app.services as Services;

  // POST /projects/:projectId/lanes/:laneId/tasks - create task
  app.post<{ Params: { projectId: string; laneId: string } }>('/projects/:projectId/lanes/:laneId/tasks', async (request, reply) => {
    await app.requireAuth(request, reply);
    const task = await services.createTask(request.params.projectId, request.params.laneId, request.ownerId!, request.body as any);
    reply.status(201).send(task);
  });

  // GET /projects/:projectId/tasks - list tasks (optionally filtered by lane)
  app.get<{ Params: { projectId: string } }>('/projects/:projectId/tasks', async (request, reply) => {
    await app.requireAuth(request, reply);
    const query = request.query as { laneId?: string };
    const tasks = await services.listTasks(request.params.projectId, query.laneId, request.ownerId);
    reply.send(tasks);
  });

  // GET /projects/:projectId/tasks/:taskId - get task
  app.get<{ Params: { projectId: string; taskId: string } }>('/projects/:projectId/tasks/:taskId', async (request, reply) => {
    await app.requireAuth(request, reply);
    const result = await services.getTaskById(request.params.taskId, request.ownerId);
    if ((result as any).error) {
      reply.status((result as any).error).send({ errors: [{ code: (result as any).code, message: 'Task not found' }] });
      return;
    }
    reply.send((result as any).value);
  });

  // PUT /projects/:projectId/tasks/:taskId - update task
  app.put<{ Params: { projectId: string; taskId: string } }>('/projects/:projectId/tasks/:taskId', async (request, reply) => {
    await app.requireAuth(request, reply);
    const task = await services.updateTask(request.params.taskId, request.ownerId!, request.body as any);
    reply.send(task);
  });

  // POST /tasks/:taskId/move - move task
  app.post<{ Params: { taskId: string } }>('/tasks/:taskId/move', async (request, reply) => {
    await app.requireAuth(request, reply);
    const result = await services.moveTask(request.params.taskId, request.ownerId!, request.body as any);
    if ((result as any).error) {
      reply.status((result as any).error).send({ errors: [{ code: (result as any).code, message: (result as any).message || 'Move failed' }] });
      return;
    }
    reply.send((result as any).value);
  });

  // POST /tasks/:taskId/move-to-new-project
  app.post<{ Params: { taskId: string } }>('/tasks/:taskId/move-to-new-project', async (request, reply) => {
    await app.requireAuth(request, reply);
    const result = await services.moveTaskToNewProject(request.params.taskId, request.ownerId!, request.body as any);
    if ((result as any).error) {
      reply.status((result as any).error).send({ errors: [{ code: (result as any).code, message: (result as any).message || 'Move failed' }] });
      return;
    }
    reply.send((result as any).value);
  });

  // DELETE /api/v1/tasks/:id - delete task
  app.delete<{ Params: { taskId: string } }>('/tasks/:taskId', async (request, reply) => {
    await app.requireAuth(request, reply);
    const body = request.body as any;
    const expectedVersion = body?.expectedVersion;
    const result = await services.deleteTask(request.params.taskId, request.ownerId!, expectedVersion);
    reply.send(result);
  });
}
