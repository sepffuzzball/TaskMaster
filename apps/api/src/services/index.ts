import { Repository, ApiError } from '@taskmaster/db';
import * as shared from '@taskmaster/shared';
import { createHash } from 'crypto';

export type AuthenticatedOwnerId = string;
export type AuthResult = { ownerId: string; scopes: string[] } | null;

export class Services {
  private repo: Repository;

  constructor(repo: Repository) {
    this.repo = repo;
  }

  // --- Auth-related ---

  async upsertUser(issuer: string, subject: string) {
    return this.repo.upsertUser(issuer, subject);
  }

  async getUserById(id: string) {
    return this.repo.getUserById(id);
  }

  async getUserBySubject(subject: string) {
    return this.repo.getUserBySubject(subject);
  }

  async createSession(userId: string, expiresAt: string) {
    return this.repo.createSession(userId, expiresAt);
  }

  async getSessionById(sessionId: string) {
    return this.repo.getSessionById(sessionId);
  }

  async revokeSession(sessionId: string) {
    return this.repo.revokeSession(sessionId);
  }

  // --- Project operations (owner-scoped) ---

  async createProject(ownerId: string, input: shared.CreateProjectInput) {
    const parsed = shared.CreateProjectInput.parse(input);
    const row = await this.repo.createProject(ownerId, parsed.name, parsed.description);
    return this.mapProject(row);
  }

  async getProjectById(projectId: string, ownerId?: string) {
    const row = await this.repo.getProjectById(projectId);
    if (!row || (ownerId && row.owner_id !== ownerId)) {
      return { error: 404, code: 'NOT_FOUND' };
    }
    return { value: this.mapProject(row) };
  }

  async listProjects(ownerId: string) {
    const rows = await this.repo.listProjects(ownerId);
    return rows.map(this.mapProject);
  }

  async updateProject(projectId: string, ownerId: string, input: shared.UpdateProjectInput) {
    const parsed = shared.UpdateProjectInput.parse(input);
    await this.ensureProjectOwnership(projectId, ownerId);
    const row = await this.repo.updateProject(projectId, ownerId, { name: parsed.name, description: parsed.description }, parsed.expectedVersion);
    return this.mapProject(row);
  }

  async archiveProject(projectId: string, ownerId: string, expectedVersion: number | undefined) {
    await this.ensureProjectOwnership(projectId, ownerId);
    if (expectedVersion === undefined) {
      throw new ApiError(400, 'BAD_REQUEST', 'expectedVersion required');
    }
    const row = await this.repo.archiveProject(projectId, ownerId, expectedVersion);
    return this.mapProject(row);
  }

  async unarchiveProject(projectId: string, ownerId: string, expectedVersion: number | undefined) {
    await this.ensureProjectOwnership(projectId, ownerId);
    if (expectedVersion === undefined) {
      throw new ApiError(400, 'BAD_REQUEST', 'expectedVersion required');
    }
    const row = await this.repo.unarchiveProject(projectId, ownerId, expectedVersion);
    return this.mapProject(row);
  }

  // --- Lane operations (scoped via project) ---

  async createLane(projectId: string, ownerId: string, input: shared.CreateLaneInput) {
    const parsed = shared.CreateLaneInput.parse(input);
    await this.ensureProjectOwnership(projectId, ownerId);
    const row = await this.repo.createLane(projectId, parsed.name, parsed.expectedProjectVersion, parsed.rank);
    return this.mapLane(row);
  }

  async listLanes(projectId: string, ownerId?: string) {
    await this.ensureProjectOwnership(projectId, ownerId);
    const rows = await this.repo.listLanes(projectId);
    return rows.map(this.mapLane);
  }

  async getLaneById(laneId: string, ownerId?: string) {
    const row = await this.repo.getLaneById(laneId);
    if (!row) return { error: 404, code: 'NOT_FOUND' };
    // Check project ownership
    const project = await this.repo.getProjectById(row.project_id);
    if (!project || (ownerId && project.owner_id !== ownerId)) {
      return { error: 404, code: 'NOT_FOUND' };
    }
    return { value: this.mapLane(row) };
  }

  async renameLane(laneId: string, projectId: string, ownerId: string, input: shared.UpdateLaneInput) {
    const parsed = shared.UpdateLaneInput.parse(input);
    await this.ensureProjectOwnership(projectId, ownerId);
    // Verify lane belongs to this project
    const lane = await this.repo.getLaneById(laneId);
    if (!lane || lane.project_id !== projectId) {
      throw new ApiError(404, 'NOT_FOUND');
    }
    const row = await this.repo.renameLane(laneId, projectId, parsed.name!, parsed.expectedVersion, parsed.expectedProjectVersion);
    return this.mapLane(row);
  }

  async reorderLanes(projectId: string, ownerId: string, input: shared.ReorderLanesInput) {
    const parsed = shared.ReorderLanesInput.parse(input);
    await this.ensureProjectOwnership(projectId, ownerId);
    await this.repo.reorderLanes(projectId, parsed.laneIds, parsed.expectedProjectVersion);
    return { success: true };
  }

  async deleteLane(projectId: string, ownerId: string, laneIdToDelete: string, input: shared.DeleteLaneInput) {
    const parsed = shared.DeleteLaneInput.parse(input);
    await this.ensureProjectOwnership(projectId, ownerId);
    await this.repo.deleteLane(projectId, laneIdToDelete, parsed.targetLaneId, parsed.expectedProjectVersion);
    return { success: true };
  }

  // --- Task operations ---

  async createTask(projectId: string, laneId: string, ownerId: string, input: shared.CreateTaskInput) {
    const parsed = shared.CreateTaskInput.parse(input);
    await this.ensureProjectOwnership(projectId, ownerId);
    // Verify lane belongs to this project
    const lane = await this.repo.getLaneById(laneId);
    if (!lane || lane.project_id !== projectId) {
      throw new ApiError(404, 'NOT_FOUND', 'Lane not found in project');
    }
    const row = await this.repo.createTask(projectId, laneId, parsed.title, parsed.description, undefined, parsed.tagNames);
    // Fetch full task with tags since createTask does not return tags
    const taskWithTags = await this.repo.getTaskById(row.id);
    if (!taskWithTags) throw new ApiError(500, 'INTERNAL_ERROR');
    return this.mapTask(taskWithTags);
  }

  async listTasks(projectId: string, laneId?: string, ownerId?: string) {
    await this.ensureProjectOwnership(projectId, ownerId);
    const rows = await this.repo.listTasks(projectId, laneId);
    return rows.map(row => this.mapTask(row));
  }

  async getTaskById(taskId: string, ownerId?: string) {
    const row = await this.repo.getTaskById(taskId);
    if (!row) return { error: 404, code: 'NOT_FOUND' };
    // Check project ownership
    const project = await this.repo.getProjectById(row.project_id);
    if (!project || (ownerId && project.owner_id !== ownerId)) {
      return { error: 404, code: 'NOT_FOUND' };
    }
    return { value: this.mapTask(row) };
  }

  async updateTask(taskId: string, ownerId: string, input: shared.UpdateTaskInput) {
    const parsed = shared.UpdateTaskInput.parse(input);
    // Verify task ownership via project
    const task = await this.repo.getTaskById(taskId);
    if (!task) throw new ApiError(404, 'NOT_FOUND');
    const project = await this.repo.getProjectById(task.project_id);
    if (!project || project.owner_id !== ownerId) throw new ApiError(404, 'NOT_FOUND');
    if (project.archived_at) throw new ApiError(400, 'BAD_REQUEST', 'Cannot update task in archived project');
    const row = await this.repo.updateTask(taskId, parsed.title, parsed.description, parsed.tagNames, parsed.expectedVersion);
    return this.mapTask(row);
  }

  async deleteTask(taskId: string, ownerId: string, expectedVersion?: number) {
    // Verify task ownership via project
    const task = await this.repo.getTaskById(taskId);
    if (!task) throw new ApiError(404, 'NOT_FOUND');
    const project = await this.repo.getProjectById(task.project_id);
    if (!project || project.owner_id !== ownerId) throw new ApiError(404, 'NOT_FOUND');
    if (project.archived_at) throw new ApiError(400, 'BAD_REQUEST', 'Cannot delete task from archived project');
    // If expectedVersion is provided, check it and pass it to repo for version-qualified delete
    if (expectedVersion !== undefined && task.version !== expectedVersion) throw new ApiError(409, 'STALE_VERSION');
    await this.repo.deleteTask(taskId, expectedVersion);
    return { success: true };
  }

  async moveTask(taskId: string, ownerId: string, input: shared.MoveTaskInput) {
    const parsed = shared.MoveTaskInput.parse(input);
    // Validate source task ownership
    const task = await this.repo.getTaskById(taskId);
    if (!task) return { error: 404, code: 'NOT_FOUND' };
    const srcProject = await this.repo.getProjectById(task.project_id);
    if (!srcProject || srcProject.owner_id !== ownerId) {
      return { error: 404, code: 'NOT_FOUND' };
    }
    if (srcProject.archived_at) {
      return { error: 400, code: 'BAD_REQUEST', message: 'Cannot move from archived project' };
    }
    // Validate destination project ownership
    const destProject = await this.repo.getProjectById(parsed.destinationProjectId);
    if (!destProject || (destProject.owner_id !== ownerId)) {
      return { error: 404, code: 'NOT_FOUND' };
    }
    if (destProject.archived_at) {
      return { error: 400, code: 'BAD_REQUEST', message: 'Cannot move to archived project' };
    }
    const row = await this.repo.moveTask(
      taskId,
      parsed.destinationProjectId,
      parsed.destinationLaneId,
      parsed.beforeTaskId,
      parsed.afterTaskId,
      parsed.expectedVersion
    );
    return { value: this.mapTask(row) };
  }

  async moveTaskToNewProject(taskId: string, ownerId: string, input: shared.MoveTaskToNewProjectInput) {
    const parsed = shared.MoveTaskToNewProjectInput.parse(input);
    // Verify source task ownership
    const task = await this.repo.getTaskById(taskId);
    if (!task) return { error: 404, code: 'NOT_FOUND' };
    const srcProject = await this.repo.getProjectById(task.project_id);
    if (!srcProject || srcProject.owner_id !== ownerId) {
      return { error: 404, code: 'NOT_FOUND' };
    }
    if (srcProject.archived_at) {
      return { error: 400, code: 'BAD_REQUEST', message: 'Cannot move from archived project' };
    }
    const row = await this.repo.moveTaskToNewProject(taskId, parsed.projectName, parsed.expectedVersion, ownerId);
    return { value: this.mapTask(row) };
  }

  // --- API Token operations (owner-scoped) ---

  async createApiToken(ownerId: string, input: shared.CreateApiTokenInput) {
    const parsed = shared.CreateApiTokenInput.parse(input);
    const result = await this.repo.createApiToken(ownerId, parsed.name, parsed.scopes, parsed.expiresInDays);
    // Return token only on create, hash omitted from public DTO
    return { token: result.token, apiToken: this.mapApiToken(result.row) };
  }

  async listApiTokens(ownerId: string) {
    const rows = await this.repo.listApiTokens(ownerId);
    return rows.map(this.mapApiToken);
  }

  async revokeApiToken(tokenId: string, ownerId: string) {
    await this.repo.revokeApiToken(tokenId, ownerId);
    return { success: true };
  }

  // --- AI Breakdown ---

  async aiBreakdown(input: shared.AiBreakdownInput) {
    const parsed = shared.AiBreakdownInput.parse(input);
    // Call OpenAI-compatible API
    const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL || 'gpt-4o';
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY not set');
    }
    // Use AbortController with timeout
    const controller = new AbortController();
    const timeout = 60000; // 60 second timeout
    let timeoutId: NodeJS.Timeout | null = setTimeout(() => controller.abort(), timeout);
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: 'Break down a task into subtasks. Provide JSON output with cards array of {title, description}.' },
            { role: 'user', content: `Title: ${parsed.title}\nContext: ${parsed.context || ''}` },
          ],
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body: any = await response.json().catch(() => ({}));
        // If the error indicates unsupported structured output, retry without response_format
        if (response.status === 400 && body.error?.type === 'unsupported_structure') {
          // Clear the controller signal and create new request without response_format
          controller.abort(); // Abort the first attempt; ignore the timeout
          const retryController = new AbortController();
          timeoutId = setTimeout(() => retryController.abort(), timeout);
          response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model,
              messages: [
                { role: 'system', content: 'Break down a task into subtasks. Provide JSON output with cards array of {title, description}.' },
                { role: 'user', content: `Title: ${parsed.title}\nContext: ${parsed.context || ''}` },
              ],
            }),
            signal: retryController.signal,
          });
        } else {
          throw new Error(`AI request failed: ${response.status} ${JSON.stringify(body)}`);
        }
      }
    } finally {
      // Clear timeout
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }

    const data: any = await response.json();
    let rawCards = data.choices?.[0]?.message?.content;
    if (!rawCards) {
      throw new Error('AI returned no content');
    }
    // Some providers don't support structured output; try to parse JSON
    let parsedCards;
    try {
      parsedCards = JSON.parse(rawCards);
    } catch {
      // Try to extract JSON from markdown code block
      const match = rawCards.match(/```json\n([\s\S]*)\n```/);
      if (match) parsedCards = JSON.parse(match[1]);
      else throw new Error('AI response not valid JSON');
    }
    if (!parsedCards.cards || !Array.isArray(parsedCards.cards)) {
      throw new Error('AI response missing cards array');
    }
    const validated = shared.AiBreakdownOutput.parse({ cards: parsedCards.cards });
    return validated;
  }

  // --- Tag operations (owner-scoped) ---

  async listTags(ownerId: string) {
    const rows = await this.repo.listTags(ownerId);
    return rows.map(this.mapTag);
  }

  async getTagById(tagId: string, ownerId: string) {
    const row = await this.repo.getTagById(tagId);
    if (!row || row.user_id !== ownerId) {
      return { error: 404, code: 'NOT_FOUND' };
    }
    return { value: this.mapTag(row) };
  }

  async updateTag(tagId: string, input: shared.UpdateTagInput, ownerId: string) {
    const parsed = shared.UpdateTagInput.parse(input);
    const row = await this.repo.updateTag(tagId, parsed.name ?? '', parsed.color ?? '', ownerId, parsed.expectedVersion);
    return this.mapTag(row);
  }

  async deleteTag(tagId: string, expectedVersion: number | undefined, ownerId: string) {
    if (expectedVersion === undefined || expectedVersion === null) {
      throw new ApiError(400, 'BAD_REQUEST', 'expectedVersion required');
    }
    await this.repo.deleteTag(tagId, ownerId, expectedVersion);
    return { success: true };
  }

  // --- Token-based authentication ---

  async authenticateApiToken(prefix: string, token: string): Promise<{ ownerId: string; scopes: string[] } | null> {
    const row = await this.repo.getApiTokenByPrefix(prefix);
    if (!row) return null;
    if (row.revoked_at) return null;
    if (row.expires_at && new Date(row.expires_at) < new Date()) return null;
    const hash = this.hashToken(token);
    if (hash !== row.token_hash) return null;
    await this.repo.updateTokenLastUsed(row.id);
    return { ownerId: row.owner_id, scopes: row.scopes.split(',') };
  }

  // --- Helpers ---

  private async ensureProjectOwnership(projectId: string, ownerId?: string) {
    if (!ownerId) return;
    const project = await this.repo.getProjectById(projectId);
    if (!project || project.owner_id !== ownerId) {
      throw new ApiError(404, 'NOT_FOUND');
    }
  }

  private mapProject(row: any): shared.Project {
    return {
      id: row.id,
      ownerId: row.owner_id,
      name: row.name,
      description: row.description || undefined,
      archivedAt: row.archived_at || undefined,
      rank: row.rank,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapLane(row: any): shared.Lane {
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      rank: row.rank,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapTask(row: any): shared.Task {
    return {
      id: row.id,
      projectId: row.project_id,
      laneId: row.lane_id,
      title: row.title,
      description: row.description || undefined,
      rank: row.rank,
      version: row.version,
      tags: row.tags ? row.tags.map((t: any) => this.mapTag(t)) : [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapApiToken(row: any): shared.ApiToken {
    return {
      id: row.id,
      ownerId: row.owner_id,
      name: row.name,
      prefix: row.prefix,
      scopes: row.scopes.split(','),
      expiresAt: row.expires_at || undefined,
      revokedAt: row.revoked_at || undefined,
      lastUsedAt: row.last_used_at || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapTag(row: any): shared.Tag {
    return {
      id: row.id,
      name: row.name,
      color: row.color,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // --- OIDC Transaction helpers ---

  async createOidcTransaction(payload: { transactionId: string; state: string; nonce: string; codeVerifier: string }) {
    return this.repo.createOidcTransaction(payload);
  }

  async consumeOidcTransaction(transactionId: string) {
    return this.repo.consumeOidcTransaction(transactionId);
  }

  private hashToken(token: string): string {
    const hash = createHash('sha-256');
    hash.update(token, 'utf-8');
    return hash.digest('hex');
  }
}
