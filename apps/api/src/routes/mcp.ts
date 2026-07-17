import { FastifyInstance } from 'fastify';
import { Services } from '../services/index.js';
import * as shared from '@taskmaster/shared';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { randomUUID } from 'crypto';

// Helper to check write scope for mutation tools
function assertWriteScopes(authInfo: any, toolName: string) {
  const scopes = authInfo?.scopes;
  if (scopes && !scopes.includes('write')) {
    throw new Error(`FORBIDDEN: Read-only token cannot use mutation tool: ${toolName}`);
  }
}

export async function registerMcpRoutes(app: FastifyInstance) {
  const services = app.services as Services;

  // Session management
  const sessions = new Map<string, { transport: StreamableHTTPServerTransport; server: McpServer; ownerId: string; scopes: string[] }>();

  // Create Zod input schemas for tools
  const emptyInput = z.object({});
  const projectIdInput = z.object({ projectId: z.string(), expectedVersion: z.number().int().optional() });
  const createProjectInput = z.object({ name: z.string(), description: z.string().optional() });
  const createLaneInput = z.object({ projectId: z.string(), name: z.string(), rank: z.number().int().optional(), autoCollapse: z.boolean().optional(), expectedProjectVersion: z.number().int() });
  const renameLaneInput = z.object({ laneId: z.string(), projectId: z.string(), name: z.string().optional(), autoCollapse: z.boolean().optional(), expectedVersion: z.number().int(), expectedProjectVersion: z.number().int() });
  const reorderLanesInput = z.object({ projectId: z.string(), laneIds: z.array(z.string()), expectedProjectVersion: z.number().int() });
  const listTasksInput = z.object({ projectId: z.string(), laneId: z.string().optional() });
  const createTaskInput = z.object({ projectId: z.string(), laneId: z.string(), title: z.string(), description: z.string().optional(), tagNames: z.array(z.string()).optional() });
  const updateTaskInput = z.object({ taskId: z.string(), title: z.string().optional(), description: z.string().optional(), tagNames: z.array(z.string()).optional(), expectedVersion: z.number().int() });
  const moveTaskInput = z.object({ taskId: z.string(), destinationProjectId: z.string(), destinationLaneId: z.string().optional(), beforeTaskId: z.string().optional(), afterTaskId: z.string().optional(), expectedVersion: z.number().int() });
  const deleteLaneInput = z.object({ projectId: z.string(), laneId: z.string(), destinationLaneId: z.string(), expectedProjectVersion: z.number().int() });
  const moveTaskToNewProjectInput = z.object({ taskId: z.string(), projectName: z.string(), expectedVersion: z.number().int() });

  // Create initial server for tool registration (template)
  // Tools will be registered once and reused per session
  const createSessionServer = () => {
    const server = new McpServer({
      name: 'taskmaster-mcp',
      version: '1.0.0',
    });

    // Read-only tools
    server.registerTool('list_projects', {
      description: 'List all projects owned by the authenticated user',
      inputSchema: emptyInput,
    }, async (extra: any) => {
      const ownerId = extra.authInfo?.token || 'bypass';
      const projects = await services.listProjects(ownerId);
      return { content: [{ type: 'text', text: JSON.stringify(projects) }] };
    });

    server.registerTool('list_lanes', {
      description: 'List lanes in a project',
      inputSchema: projectIdInput,
    }, async (args: any, extra: any) => {
      const ownerId = extra.authInfo?.token || 'bypass';
      const lanes = await services.listLanes(args.projectId, ownerId);
      return { content: [{ type: 'text', text: JSON.stringify(lanes) }] };
    });

    server.registerTool('list_tasks', {
      description: 'List tasks in a project (optionally filtered by lane)',
      inputSchema: listTasksInput,
    }, async (args: any, extra: any) => {
      const ownerId = extra.authInfo?.token || 'bypass';
      const tasks = await services.listTasks(args.projectId, args.laneId, ownerId);
      return { content: [{ type: 'text', text: JSON.stringify(tasks) }] };
    });

    // Write-required tools
    server.registerTool('create_project', {
      description: 'Create a new project',
      inputSchema: createProjectInput,
    }, async (args: any, extra: any) => {
      assertWriteScopes(extra.authInfo, 'create_project');
      const ownerId = extra.authInfo?.token || 'bypass';
      const validated = shared.CreateProjectInput.parse(args);
      const project = await services.createProject(ownerId, validated);
      return { content: [{ type: 'text', text: JSON.stringify(project) }] };
    });

    server.registerTool('archive_project', {
      description: 'Archive a project',
      inputSchema: projectIdInput,
    }, async (args: any, extra: any) => {
      assertWriteScopes(extra.authInfo, 'archive_project');
      const ownerId = extra.authInfo?.token || 'bypass';
      const project = await services.archiveProject(args.projectId, ownerId, args.expectedVersion);
      return { content: [{ type: 'text', text: JSON.stringify(project) }] };
    });

    server.registerTool('unarchive_project', {
      description: 'Unarchive a project',
      inputSchema: projectIdInput,
    }, async (args: any, extra: any) => {
      assertWriteScopes(extra.authInfo, 'unarchive_project');
      const ownerId = extra.authInfo?.token || 'bypass';
      const project = await services.unarchiveProject(args.projectId, ownerId, args.expectedVersion);
      return { content: [{ type: 'text', text: JSON.stringify(project) }] };
    });

    server.registerTool('create_lane', {
      description: 'Create a lane in a project',
      inputSchema: createLaneInput,
    }, async (args: any, extra: any) => {
      assertWriteScopes(extra.authInfo, 'create_lane');
      const ownerId = extra.authInfo?.token || 'bypass';
      const validated = shared.CreateLaneInput.parse(args);
      const lane = await services.createLane(args.projectId, ownerId, validated);
      return { content: [{ type: 'text', text: JSON.stringify(lane) }] };
    });

    server.registerTool('rename_lane', {
      description: 'Rename or update a lane',
      inputSchema: renameLaneInput,
    }, async (args: any, extra: any) => {
      assertWriteScopes(extra.authInfo, 'rename_lane');
      const ownerId = extra.authInfo?.token || 'bypass';
      const validated = shared.UpdateLaneInput.parse({ name: args.name, autoCollapse: args.autoCollapse, expectedVersion: args.expectedVersion, expectedProjectVersion: args.expectedProjectVersion });
      const lane = await services.updateLane(args.laneId, args.projectId, ownerId, validated);
      return { content: [{ type: 'text', text: JSON.stringify(lane) }] };
    });

    server.registerTool('reorder_lane', {
      description: 'Reorder lanes in a project',
      inputSchema: reorderLanesInput,
    }, async (args: any, extra: any) => {
      assertWriteScopes(extra.authInfo, 'reorder_lane');
      const ownerId = extra.authInfo?.token || 'bypass';
      const validated = shared.ReorderLanesInput.parse({ laneIds: args.laneIds, expectedProjectVersion: args.expectedProjectVersion });
      await services.reorderLanes(args.projectId, ownerId, validated);
      return { content: [{ type: 'text', text: 'Success' }] };
    });

    server.registerTool('delete_lane', {
      description: 'Delete a lane (moving tasks to another lane first)',
      inputSchema: deleteLaneInput,
    }, async (args: any, extra: any) => {
      assertWriteScopes(extra.authInfo, 'delete_lane');
      const ownerId = extra.authInfo?.token || 'bypass';
      const validated = shared.DeleteLaneInput.parse({ targetLaneId: args.destinationLaneId, expectedProjectVersion: args.expectedProjectVersion });
      await services.deleteLane(args.projectId, ownerId, args.laneId, validated);
      return { content: [{ type: 'text', text: 'Success' }] };
    });

    server.registerTool('create_task', {
      description: 'Create a task in a lane',
      inputSchema: createTaskInput,
    }, async (args: any, extra: any) => {
      assertWriteScopes(extra.authInfo, 'create_task');
      const ownerId = extra.authInfo?.token || 'bypass';
      const validated = shared.CreateTaskInput.parse(args);
      const task = await services.createTask(args.projectId, args.laneId, ownerId, validated);
      return { content: [{ type: 'text', text: JSON.stringify(task) }] };
    });

    server.registerTool('update_task', {
      description: 'Update a task',
      inputSchema: updateTaskInput,
    }, async (args: any, extra: any) => {
      assertWriteScopes(extra.authInfo, 'update_task');
      const ownerId = extra.authInfo?.token || 'bypass';
      const validated = shared.UpdateTaskInput.parse(args);
      const task = await services.updateTask(args.taskId, ownerId, validated);
      return { content: [{ type: 'text', text: JSON.stringify(task) }] };
    });

    server.registerTool('move_task', {
      description: 'Move a task to another project or lane',
      inputSchema: moveTaskInput,
    }, async (args: any, extra: any) => {
      assertWriteScopes(extra.authInfo, 'move_task');
      const ownerId = extra.authInfo?.token || 'bypass';
      const validated = shared.MoveTaskInput.parse(args);
      const result = await services.moveTask(args.taskId, ownerId, validated);
      if ((result as any).error) {
        throw new Error((result as any).message || 'Move failed');
      }
      return { content: [{ type: 'text', text: JSON.stringify((result as any).value) }] };
    });

    server.registerTool('move_task_to_new_project', {
      description: 'Move a task to a new project (creating it with initial lanes)',
      inputSchema: moveTaskToNewProjectInput,
    }, async (args: any, extra: any) => {
      assertWriteScopes(extra.authInfo, 'move_task_to_new_project');
      const ownerId = extra.authInfo?.token || 'bypass';
      const validated = shared.MoveTaskToNewProjectInput.parse(args);
      const result = await services.moveTaskToNewProject(args.taskId, ownerId, validated);
      if ((result as any).error) {
        throw new Error((result as any).message || 'Move failed');
      }
      return { content: [{ type: 'text', text: JSON.stringify((result as any).value) }] };
    });

    return server;
  };

  // Handle all HTTP methods at `/mcp` - with prefix /mcp, route is / to make /mcp
  app.all('/', async (request, reply) => {
    // Auth: only API bearer token allowed (no cookie)
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      reply.status(401).send({
        errors: [{ code: 'UNAUTHORIZED', message: 'Bearer token required for MCP' }],
      });
      return;
    }
    const token = authHeader.slice(7);
    const prefix = token.slice(0, 8);
    const authResult = await services.authenticateApiToken(prefix, token);
    if (!authResult) {
      reply.status(401).send({
        errors: [{ code: 'UNAUTHORIZED', message: 'Invalid API token' }],
      });
      return;
    }

    const { ownerId, scopes } = authResult;

    // Determine session ID
    const sessionId = request.headers['mcp-session-id'] as string || randomUUID();
    let sessionData = sessions.get(sessionId);

    if (request.method === 'POST') {
      const body = request.body as any;
      const isInitialize = body?.method === 'initialize';

      if (isInitialize) {
        // Reject duplicate initialization for existing session
        if (sessionData) {
          reply.status(400).send({
            errors: [{ code: 'BAD_REQUEST', message: 'Session already initialized' }],
          });
          return;
        }
        // Create new transport and server for this session
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => sessionId,
          enableJsonResponse: true,
        });
        const server = createSessionServer();
        await server.connect(transport);
        sessionData = { transport, server, ownerId, scopes };
        sessions.set(sessionId, sessionData);

        // Handle request through transport
        const rawReq = request.raw as any;
        const rawRes = reply.raw as any;
        rawReq.auth = { token: ownerId, clientId: '', scopes };
        await transport.handleRequest(rawReq, rawRes, request.body);
        return;
      }

      // Non-initialization POST: delegate to existing session transport
      if (!sessionData) {
        reply.status(404).send({ errors: [{ code: 'NOT_FOUND', message: 'Session not found' }] });
        return;
      }
      // Compare principal: session's ownerId must match request's ownerId
      if (sessionData.ownerId !== ownerId) {
        reply.status(403).send({ errors: [{ code: 'FORBIDDEN', message: 'Principal mismatch' }] });
        return;
      }
      const postReq = request.raw as any;
      const postRes = reply.raw as any;
      postReq.auth = { token: ownerId, clientId: '', scopes };
      await sessionData.transport.handleRequest(postReq, postRes, request.body);
      return;
    }

    if (request.method === 'GET') {
      // SSE stream retrieval - delegate to session transport
      if (!sessionData) {
        reply.status(404).send({ errors: [{ code: 'NOT_FOUND', message: 'Session not found' }] });
        return;
      }
      // Compare principal
      if (sessionData.ownerId !== ownerId) {
        reply.status(403).send({ errors: [{ code: 'FORBIDDEN', message: 'Principal mismatch' }] });
        return;
      }
      const getReq = request.raw as any;
      const getRes = reply.raw as any;
      getReq.auth = { token: ownerId, clientId: '', scopes };
      await sessionData.transport.handleRequest(getReq, getRes);
      return;
    }

    if (request.method === 'DELETE') {
      // Session termination
      if (sessionData) {
        // Compare principal
        if (sessionData.ownerId !== ownerId) {
          reply.status(403).send({ errors: [{ code: 'FORBIDDEN', message: 'Principal mismatch' }] });
          return;
        }
        await sessionData.transport.close();
        sessions.delete(sessionId);
      }
      reply.send({ success: true });
      return;
    }

    reply.status(405).send({ errors: [{ code: 'BAD_REQUEST', message: 'Method not allowed' }] });
  });
}