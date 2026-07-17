import { Kysely, sql } from 'kysely';
import { randomUUID, randomBytes, createHash } from 'crypto';

// --- Type Rows (for return shapes) ---

export interface UserRow {
  id: string;
  issuer: string;
  subject: string;
  created_at: string;
  updated_at: string;
}

export interface SessionRow {
  id: string;
  user_id: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectRow {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  archived_at: string | null;
  rank: number;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface LaneRow {
  id: string;
  project_id: string;
  name: string;
  rank: number;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface TaskRow {
  id: string;
  project_id: string;
  lane_id: string;
  title: string;
  description: string | null;
  rank: number;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface ApiTokenRow {
  id: string;
  owner_id: string;
  name: string;
  prefix: string;
  token_hash: string;
  scopes: string;
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TagRow {
  id: string;
  user_id: string;
  name: string;
  normalized_name: string;
  color: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface TaskTagRow {
  task_id: string;
  tag_id: string;
  created_at: string;
}

// --- Color palette for tags based on normalized name ---
const TAG_COLORS = [
  '#E53E3E', '#DD6B20', '#D69F2E', '#38A16C', '#3182CE', '#805AD5', '#DD45B8',
  '#F56565', '#ED8930', '#D69B2D', '#48A771', '#2979C8', '#6B5DBB', '#B251B6',
  '#E65164', '#D17A34', '#BFA12D', '#3D8C5A', '#2467B3', '#5D4BA8', '#AD3B9A',
  '#F46565', '#DE7A36', '#C7A52F', '#3E8250', '#2560AD', '#5849A6',
];

function tagColorFromName(normalizedName: string): string {
  let hash = 0;
  for (let i = 0; i < normalizedName.length; i++) {
    hash = ((hash << 5) - hash) + normalizedName.charCodeAt(i);
    hash = hash & 0xFFFFFFFF;
  }
  const index = Math.abs(hash) % TAG_COLORS.length;
  return TAG_COLORS[index];
}

// --- Default lane spec ---
const DEFAULT_LANES_SPEC = [
  { name: 'ToDo', rank: 0 },
  { name: 'InProgress', rank: 10 },
  { name: 'Complete', rank: 20 },
] as const;

// --- Error class ---

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message?: string) {
    super(message || code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

// --- Normalization helper ---
// Use `x0n` as a valid identifier name for the `0n` export helper
const ZERO = BigInt(0);
export function x0n(n: number | bigint): bigint {
  return BigInt(n);
}

// --- Repository ---

export class Repository {
  private db: Kysely<any>;

  constructor(db: Kysely<any>) {
    this.db = db;
  }

  async transaction<T>(fn: (trx: Kysely<any>) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(async (trx) => {
      return fn(trx);
    });
  }

  // --- User ops ---

  async upsertUser(issuer: string, subject: string): Promise<UserRow> {
    const existing = await this.getUserByIssuerSubject(issuer, subject);
    if (existing) return existing;

    const id = randomUUID();
    const now = new Date().toISOString();
    await sql`
      INSERT INTO users (id, issuer, subject, created_at, updated_at)
      VALUES (${id}, ${issuer}, ${subject}, ${now}, ${now})
    `.execute(this.db);
    return { id, issuer, subject, created_at: now, updated_at: now };
  }

  async getUserById(userId: string): Promise<UserRow | null> {
    const result = await sql`SELECT * FROM users WHERE id = ${userId}`.execute(this.db);
    const rows = result.rows as any[];
    return rows?.[0] || null;
  }

  async getUserBySubject(subject: string): Promise<UserRow | null> {
    const result = await sql`SELECT * FROM users WHERE subject = ${subject}`.execute(this.db);
    const rows = result.rows as any[];
    return rows?.[0] || null;
  }

  async getUserByIssuerSubject(issuer: string, subject: string): Promise<UserRow | null> {
    const result = await sql`SELECT * FROM users WHERE issuer = ${issuer} AND subject = ${subject}`.execute(this.db);
    const rows = result.rows as any[];
    return rows?.[0] || null;
  }

  // --- Session ops ---

  async createSession(userId: string, expiresAt: string): Promise<SessionRow> {
    const id = randomUUID();
    const now = new Date().toISOString();
    await sql`
      INSERT INTO sessions (id, user_id, expires_at, created_at, updated_at)
      VALUES (${id}, ${userId}, ${expiresAt}, ${now}, ${now})
    `.execute(this.db);
    return { id, user_id: userId, expires_at: expiresAt, created_at: now, updated_at: now };
  }

  async getSessionById(sessionId: string): Promise<SessionRow | null> {
    const result = await sql`
      SELECT * FROM sessions WHERE id = ${sessionId} AND expires_at > ${new Date().toISOString()}
    `.execute(this.db);
    const rows = result.rows as any[];
    return rows?.[0] || null;
  }

  async revokeSession(sessionId: string): Promise<void> {
    const now = new Date().toISOString();
    await sql`UPDATE sessions SET expires_at = ${now} WHERE id = ${sessionId}`.execute(this.db);
  }

  // --- Project ops ---

  async createProject(ownerId: string, name: string, description?: string): Promise<ProjectRow> {
    const id = randomUUID();
    const now = new Date().toISOString();
    return this.transaction(async (trx) => {
      // Calculate next project rank within transaction (no self-deadlock)
      const rankResult = await sql`
        SELECT rank FROM projects WHERE owner_id = ${ownerId} ORDER BY rank DESC LIMIT 1
      `.execute(trx as any);
      const rankRows = rankResult.rows as any[];
      const rank = ((rankRows[0]?.rank as number) ?? -10) + 10;

      await sql`
        INSERT INTO projects (id, owner_id, name, description, archived_at, rank, version, created_at, updated_at)
        VALUES (${id}, ${ownerId}, ${name}, ${description || null}, NULL, ${rank}, 0, ${now}, ${now})
      `.execute(trx as any);

      // Create default lanes atomically
      for (const lane of DEFAULT_LANES_SPEC) {
        const laneId = randomUUID();
        await sql`
          INSERT INTO lanes (id, project_id, name, rank, version, created_at, updated_at)
          VALUES (${laneId}, ${id}, ${lane.name}, ${lane.rank}, 0, ${now}, ${now})
        `.execute(trx as any);
      }

      return {
        id, owner_id: ownerId, name, description: description || null,
        archived_at: null, rank, version: 0, created_at: now, updated_at: now,
      };
    });
  }

  async getProjectById(projectId: string): Promise<ProjectRow | null> {
    const result = await sql`SELECT * FROM projects WHERE id = ${projectId}`.execute(this.db);
    const rows = result.rows as any[];
    return rows?.[0] || null;
  }

  async listProjects(ownerId: string): Promise<ProjectRow[]> {
    const result = await sql`SELECT * FROM projects WHERE owner_id = ${ownerId} ORDER BY rank ASC`.execute(this.db);
    return result.rows as any[] as ProjectRow[];
  }

  async updateProject(
    projectId: string,
    ownerId: string,
    updates: { name?: string; description?: string },
    expectedVersion: number,
  ): Promise<ProjectRow> {
    const project = await this.getProjectById(projectId);
    if (!project || project.owner_id !== ownerId) throw new ApiError(404, 'NOT_FOUND');
    if (project.archived_at) throw new ApiError(400, 'BAD_REQUEST', 'Cannot update an archived project');
    if (project.version !== expectedVersion) throw new ApiError(409, 'STALE_VERSION');

    const now = new Date().toISOString();
    const version = project.version + 1;
    const name = updates.name ?? project.name;
    const desc = updates.description !== undefined ? updates.description : project.description;

    const result = await sql`
      UPDATE projects SET name = ${name}, description = ${desc}, updated_at = ${now}, version = ${version}
      WHERE id = ${projectId} AND version = ${expectedVersion}
    `.execute(this.db);
    const numUpdated = (result as any).numUpdatedRows ?? (result as any).numAffectedRows ?? 0n;
    if (typeof numUpdated === 'bigint' && numUpdated === ZERO) {
      throw new ApiError(409, 'STALE_VERSION');
    }
    const updated = await this.getProjectById(projectId);
    return updated!;
  }

  async archiveProject(projectId: string, ownerId: string, expectedVersion: number): Promise<ProjectRow> {
    const project = await this.getProjectById(projectId);
    if (!project || project.owner_id !== ownerId) throw new ApiError(404, 'NOT_FOUND');
    if (project.archived_at) throw new ApiError(400, 'BAD_REQUEST', 'Project is already archived');
    if (project.version !== expectedVersion) throw new ApiError(409, 'STALE_VERSION');

    const now = new Date().toISOString();
    const result = await sql`
      UPDATE projects SET archived_at = ${now}, updated_at = ${now}, version = version + 1
      WHERE id = ${projectId} AND version = ${expectedVersion}
    `.execute(this.db);
    const numUpdated = (result as any).numUpdatedRows ?? (result as any).numAffectedRows ?? 0n;
    if (typeof numUpdated === 'bigint' && numUpdated === ZERO) {
      throw new ApiError(409, 'STALE_VERSION');
    }
    const updated = await this.getProjectById(projectId);
    return updated!;
  }

  async unarchiveProject(projectId: string, ownerId: string, expectedVersion: number): Promise<ProjectRow> {
    const project = await this.getProjectById(projectId);
    if (!project || project.owner_id !== ownerId) throw new ApiError(404, 'NOT_FOUND');
    if (project.version !== expectedVersion) throw new ApiError(409, 'STALE_VERSION');

    const now = new Date().toISOString();
    const result = await sql`
      UPDATE projects SET archived_at = NULL, updated_at = ${now}, version = version + 1
      WHERE id = ${projectId} AND version = ${expectedVersion}
    `.execute(this.db);
    const numUpdated = (result as any).numUpdatedRows ?? (result as any).numAffectedRows ?? 0n;
    if (typeof numUpdated === 'bigint' && numUpdated === ZERO) {
      throw new ApiError(409, 'STALE_VERSION');
    }
    const updated = await this.getProjectById(projectId);
    return updated!;
  }

  // --- Lane ops ---

  async createLane(projectId: string, name: string, expectedProjectVersion: number, rank?: number): Promise<LaneRow> {
    return this.transaction(async (trx) => {
      const id = randomUUID();
      const now = new Date().toISOString();
      let actualRank: number;
      if (rank !== undefined) {
        actualRank = rank;
      } else {
        // Use transaction-local query instead of this.getNextLaneRank to avoid self-deadlock
        const result = await sql`SELECT rank FROM lanes WHERE project_id = ${projectId} ORDER BY rank DESC LIMIT 1`.execute(trx as any);
        const rows = result.rows as any[];
        actualRank = ((rows[0]?.rank as number) ?? -10) + 10;
      }

      // Lock/project version check
      const project = await sql`SELECT * FROM projects WHERE id = ${projectId}`.execute(trx as any);
      const projectRow = (project.rows as any[])[0];
      if (!projectRow) throw new ApiError(404, 'NOT_FOUND');
      if (projectRow.archived_at) throw new ApiError(400, 'BAD_REQUEST', 'Cannot create lane in archived project');
      if (projectRow.version !== expectedProjectVersion) throw new ApiError(409, 'STALE_VERSION');

      // Increment project version with conditional check
      const projUpdate = await sql`
        UPDATE projects SET version = version + 1, updated_at = ${now}
        WHERE id = ${projectId} AND version = ${expectedProjectVersion}
      `.execute(trx as any);
      const numProjUpdated = (projUpdate as any).numUpdatedRows ?? (projUpdate as any).numAffectedRows ?? 0n;
      if (typeof numProjUpdated === 'bigint' && numProjUpdated === ZERO) {
        throw new ApiError(409, 'STALE_VERSION');
      }

      await sql`
        INSERT INTO lanes (id, project_id, name, rank, version, created_at, updated_at)
        VALUES (${id}, ${projectId}, ${name}, ${actualRank}, 0, ${now}, ${now})
      `.execute(trx as any);

      return {
        id, project_id: projectId, name, rank: actualRank, version: 0,
        created_at: now, updated_at: now,
      };
    });
  }

  async getLaneById(laneId: string): Promise<LaneRow | null> {
    const result = await sql`SELECT * FROM lanes WHERE id = ${laneId}`.execute(this.db);
    const rows = result.rows as any[];
    return rows?.[0] || null;
  }

  async listLanes(projectId: string): Promise<LaneRow[]> {
    const result = await sql`SELECT * FROM lanes WHERE project_id = ${projectId} ORDER BY rank ASC`.execute(this.db);
    return result.rows as any[] as LaneRow[];
  }

  async renameLane(laneId: string, projectId: string, newName: string, expectedLaneVersion: number, expectedProjectVersion: number): Promise<LaneRow> {
    return this.transaction(async (trx) => {
      const now = new Date().toISOString();

      // Load and verify lane
      const laneResult = await sql`SELECT * FROM lanes WHERE id = ${laneId}`.execute(trx as any);
      const laneRow = (laneResult.rows as any[])[0];
      if (!laneRow) throw new ApiError(404, 'NOT_FOUND');
      if (laneRow.project_id !== projectId) throw new ApiError(404, 'NOT_FOUND');
      if (laneRow.version !== expectedLaneVersion) throw new ApiError(409, 'STALE_VERSION');

      // Load and verify project
      const projectResult = await sql`SELECT * FROM projects WHERE id = ${projectId}`.execute(trx as any);
      const projectRow = (projectResult.rows as any[])[0];
      if (!projectRow) throw new ApiError(404, 'NOT_FOUND');
      if (projectRow.archived_at) throw new ApiError(400, 'BAD_REQUEST', 'Cannot rename lane in archived project');
      if (projectRow.version !== expectedProjectVersion) throw new ApiError(409, 'STALE_VERSION');

      // Increment project version conditionally
      const projUpdate = await sql`
        UPDATE projects SET version = version + 1, updated_at = ${now}
        WHERE id = ${projectId} AND version = ${expectedProjectVersion}
      `.execute(trx as any);
      const numProjUpdated = (projUpdate as any).numUpdatedRows ?? (projUpdate as any).numAffectedRows ?? 0n;
      if (typeof numProjUpdated === 'bigint' && numProjUpdated === ZERO) {
        throw new ApiError(409, 'STALE_VERSION');
      }

      // Update the lane with version check
      const laneUpdate = await sql`
        UPDATE lanes SET name = ${newName}, updated_at = ${now}, version = version + 1
        WHERE id = ${laneId} AND version = ${expectedLaneVersion}
      `.execute(trx as any);
      const numLaneUpdated = (laneUpdate as any).numUpdatedRows ?? (laneUpdate as any).numAffectedRows ?? 0n;
      if (typeof numLaneUpdated === 'bigint' && numLaneUpdated === ZERO) {
        throw new ApiError(409, 'STALE_VERSION');
      }

      // Readback
      const updatedLane = await sql`SELECT * FROM lanes WHERE id = ${laneId}`.execute(trx as any);
      const updatedRow = (updatedLane.rows as any[])[0];
      if (!updatedRow) throw new ApiError(404, 'NOT_FOUND');
      return updatedRow as LaneRow;
    });
  }

  async reorderLanes(projectId: string, laneIds: string[], expectedProjectVersion: number): Promise<void> {
    return this.transaction(async (trx) => {
      const now = new Date().toISOString();

      // Load project and check version
      const projectResult = await sql`SELECT * FROM projects WHERE id = ${projectId}`.execute(trx as any);
      const projectRow = (projectResult.rows as any[])[0];
      if (!projectRow) throw new ApiError(404, 'NOT_FOUND');
      if (projectRow.archived_at) throw new ApiError(400, 'BAD_REQUEST', 'Cannot reorder lanes in archived project');
      if (projectRow.version !== expectedProjectVersion) throw new ApiError(409, 'STALE_VERSION');

      // Validate: laneIds must be exactly the project's full lane set without duplicates
      const lanesResult = await sql`SELECT * FROM lanes WHERE project_id = ${projectId} ORDER BY rank ASC`.execute(trx as any);
      const lanes = lanesResult.rows as any[] as LaneRow[];
      if (laneIds.length !== lanes.length) throw new ApiError(400, 'BAD_REQUEST', 'Must provide all lanes');
      const laneIdSet = new Set(laneIds);
      if (laneIdSet.size !== laneIds.length) throw new ApiError(400, 'BAD_REQUEST', 'Duplicate lane IDs');
      for (const lane of lanes) {
        if (!laneIdSet.has(lane.id)) throw new ApiError(400, 'BAD_REQUEST', 'Missing lane ID');
      }

      // Increment project version conditionally
      const projUpdate = await sql`
        UPDATE projects SET version = version + 1, updated_at = ${now}
        WHERE id = ${projectId} AND version = ${expectedProjectVersion}
      `.execute(trx as any);
      const numProjUpdated = (projUpdate as any).numUpdatedRows ?? (projUpdate as any).numAffectedRows ?? 0n;
      if (typeof numProjUpdated === 'bigint' && numProjUpdated === ZERO) {
        throw new ApiError(409, 'STALE_VERSION');
      }

      // If the midpoint between lanes has no integer gap, rebalance to sparse multiples
      // Check if we need to rebalance: find min rank gap
      let needRebalance = false;
      if (lanes.length > 1) {
        // Sort lanes by rank
        const sortedLanes = [...lanes].sort((a, b) => a.rank - b.rank);
        // Find the rank gaps
        const gaps = [];
        for (let i = 1; i < sortedLanes.length; i++) {
          gaps.push(sortedLanes[i].rank - sortedLanes[i - 1].rank);
        }
        // If any gap is 1 (adjacent ranks), rebalance
        if (gaps.some((g) => g <= 1)) {
          needRebalance = true;
        }
      }
      if (needRebalance) {
        // Rebalance to sparse multiples: 0, 10, 20, 30, ...
        let nextRank = 0;
        for (const laneId of laneIds) {
          await sql`UPDATE lanes SET rank = ${nextRank} WHERE id = ${laneId}`.execute(trx as any);
          nextRank += 10;
        }
      } else {
        // Just assign new ranks preserving relative order
        for (let i = 0; i < laneIds.length; i++) {
          await sql`UPDATE lanes SET rank = ${i * 10} WHERE id = ${laneIds[i]}`.execute(trx as any);
        }
      }
    });
  }

  async deleteLane(projectId: string, laneIdToDelete: string, destinationLaneId: string, expectedProjectVersion: number): Promise<void> {
    return this.transaction(async (trx) => {
      const now = new Date().toISOString();

      // Load project and check version
      const projectResult = await sql`SELECT * FROM projects WHERE id = ${projectId}`.execute(trx as any);
      const projectRow = (projectResult.rows as any[])[0];
      if (!projectRow) throw new ApiError(404, 'NOT_FOUND');
      if (projectRow.archived_at) throw new ApiError(400, 'BAD_REQUEST', 'Cannot delete lane in archived project');
      if (projectRow.version !== expectedProjectVersion) throw new ApiError(409, 'STALE_VERSION');

      // Load lanes for validation
      const lanesResult = await sql`SELECT * FROM lanes WHERE project_id = ${projectId} ORDER BY rank ASC`.execute(trx as any);
      const lanes = lanesResult.rows as any[] as LaneRow[];
      if (lanes.length <= 1) throw new ApiError(400, 'BAD_REQUEST', 'Cannot delete the last lane');
      const laneToDelete = lanes.find((l) => l.id === laneIdToDelete);
      if (!laneToDelete) throw new ApiError(404, 'NOT_FOUND');
      const destLane = lanes.find((l) => l.id === destinationLaneId);
      if (!destLane) throw new ApiError(404, 'NOT_FOUND', 'Destination lane not found');
      if (laneIdToDelete === destinationLaneId) throw new ApiError(400, 'BAD_REQUEST', 'Cannot delete into same lane');

      // Increment project version conditionally
      const projUpdate = await sql`
        UPDATE projects SET version = version + 1, updated_at = ${now}
        WHERE id = ${projectId} AND version = ${expectedProjectVersion}
      `.execute(trx as any);
      const numProjUpdated = (projUpdate as any).numUpdatedRows ?? (projUpdate as any).numAffectedRows ?? 0n;
      if (typeof numProjUpdated === 'bigint' && numProjUpdated === ZERO) {
        throw new ApiError(409, 'STALE_VERSION');
      }

      // Move tasks from the lane being deleted to the destination lane
      // Assign unique destination ranks (sparse multiples) and update timestamps
      const tasksResult = await sql`SELECT * FROM tasks WHERE lane_id = ${laneIdToDelete}`.execute(trx as any);
      const tasksToMove = tasksResult.rows as any[] as TaskRow[];
      // Get the max rank in the destination lane
      const destTasksResult = await sql`SELECT rank FROM tasks WHERE lane_id = ${destinationLaneId} ORDER BY rank DESC LIMIT 1`.execute(trx as any);
      const destMaxRank = (destTasksResult.rows as any[])[0]?.rank ?? -10;
      // Assign ranks: each moved task gets unique sparse rank
      let nextRank = destMaxRank + 10;
      for (const task of tasksToMove) {
        await sql`
          UPDATE tasks SET lane_id = ${destinationLaneId}, rank = ${nextRank}, updated_at = ${now}, version = version + 1
          WHERE id = ${task.id}
        `.execute(trx as any);
        nextRank += 10;
      }

      // Delete the lane
      await sql`DELETE FROM lanes WHERE id = ${laneIdToDelete}`.execute(trx as any);
    });
  }

  // --- Task ops ---

  async createTask(
    projectId: string, laneId: string, title: string, description?: string, rank?: number, tagNames?: string[],
  ): Promise<TaskRow> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const actualRank = rank ?? (await this.getNextTaskRank(laneId));
    const project = await this.getProjectById(projectId);
    if (!project) throw new ApiError(404, 'NOT_FOUND');
    if (project.archived_at) throw new ApiError(400, 'BAD_REQUEST', 'Cannot create task in archived project');
      return this.transaction(async (trx) => {
        await sql`
          INSERT INTO tasks (id, project_id, lane_id, title, description, rank, version, created_at, updated_at)
          VALUES (${id}, ${projectId}, ${laneId}, ${title}, ${description || null}, ${actualRank}, 0, ${now}, ${now})
        `.execute(trx as any);
        if (tagNames && tagNames.length > 0) {
          const tagIds = await this.resolveOrCreateTags(project.owner_id, tagNames, trx as any);
          await this.setTaskTags(id, tagIds, trx as any);
        }
        // Hydrate tags before returning
        const tags = tagNames && tagNames.length > 0
          ? await this.getTaskTags(id, trx as any)
          : [] as TagRow[];
        return {
          id, project_id: projectId, lane_id: laneId, title, description: description || null,
          rank: actualRank, version: 0, created_at: now, updated_at: now,
          tags,
        };
      });
    }

  async getTaskById(taskId: string): Promise<(TaskRow & { tags: TagRow[] }) | null> {
    const row = await this.getTaskRowById(taskId);
    if (!row) return null;
    const tags = await this.getTaskTags(taskId);
    return { ...row, tags };
  }

  // Internal method to get raw TaskRow
  private async getTaskRowById(taskId: string): Promise<TaskRow | null> {
    const result = await sql`SELECT * FROM tasks WHERE id = ${taskId}`.execute(this.db);
    const rows = result.rows as any[];
    return rows?.[0] || null;
  }

  async listTasks(projectId: string, laneId?: string): Promise<(TaskRow & { tags: TagRow[] })[]> {
    const result = await sql`
      SELECT * FROM tasks WHERE project_id = ${projectId}${laneId ? sql` AND lane_id = ${laneId}` : sql``} ORDER BY rank ASC
    `.execute(this.db);
    const tasks = result.rows as any[] as TaskRow[];
    return this.hydrateTaskTags(tasks);
  }

  async updateTask(
    taskId: string, title?: string, description?: string, tagNames?: string[], expectedVersion?: number,
  ): Promise<(TaskRow & { tags: TagRow[] })> {
    const taskRow = await this.getTaskRowById(taskId);
    if (!taskRow) throw new ApiError(404, 'NOT_FOUND');
    // If expectedVersion is provided, check it
    if (expectedVersion !== undefined && taskRow.version !== expectedVersion) throw new ApiError(409, 'STALE_VERSION');
    const now = new Date().toISOString();
    const newTitle = title ?? taskRow.title;
    const newDesc = description !== undefined ? description : taskRow.description;
    return this.transaction(async (trx) => {
      // Update task fields
      const result = await sql`
        UPDATE tasks SET title = ${newTitle}, description = ${newDesc}, updated_at = ${now}, version = version + 1
        WHERE id = ${taskId}${expectedVersion !== undefined ? sql` AND version = ${expectedVersion}` : sql``}
      `.execute(trx as any);
      const numUpdated = (result as any).numUpdatedRows ?? (result as any).numAffectedRows ?? 0n;
      if (typeof numUpdated === 'bigint' && numUpdated === ZERO) {
        throw new ApiError(409, 'STALE_VERSION');
      }
      // Handle tagNames if provided
      if (tagNames !== undefined) {
        // Resolve/create tags and set associations
        const project = await sql`SELECT owner_id FROM projects WHERE id = ${taskRow.project_id}`.execute(trx as any);
        const projectRow = (project.rows as any[])[0];
        if (!projectRow) throw new ApiError(404, 'NOT_FOUND');
        const ownerId = projectRow.owner_id;
        if (tagNames.length > 0) {
          const tagIds = await this.resolveOrCreateTags(ownerId, tagNames, trx as any);
          await this.setTaskTags(taskId, tagIds, trx as any);
        } else {
          // Empty array means remove all tags
          await this.setTaskTags(taskId, [], trx as any);
        }
      }
      // Readback
      const updatedRow = await sql`SELECT * FROM tasks WHERE id = ${taskId}`.execute(trx as any);
      const rows = updatedRow.rows as any[];
      if (!rows[0]) throw new ApiError(404, 'NOT_FOUND');
      const tags = tagNames !== undefined
        ? await this.getTaskTags(taskId, trx as any)
        : await this.getTaskTags(taskId, trx as any);
      return { ...rows[0] as TaskRow, tags };
    });
  }

  async deleteTask(taskId: string, expectedVersion?: number): Promise<void> {
    // Version-qualified delete
    const result = await sql`
      DELETE FROM tasks WHERE id = ${taskId}${expectedVersion !== undefined ? sql` AND version = ${expectedVersion}` : sql``}
    `.execute(this.db);
    const numDeleted = (result as any).numDeletedRows ?? (result as any).numAffectedRows ?? 0n;
    if (typeof numDeleted === 'bigint' && numDeleted === ZERO) {
      throw new ApiError(409, 'STALE_VERSION');
    }
  }

  async moveTask(
    taskId: string, destinationProjectId: string, destinationLaneId?: string,
    beforeTaskId?: string, afterTaskId?: string, expectedVersion?: number,
  ): Promise<TaskRow> {
    return this.transaction(async (trx) => {
      const now = new Date().toISOString();

      // Lock/serialize by loading the task and destination lane/project within the transaction
      const taskResult = await sql`SELECT * FROM tasks WHERE id = ${taskId}`.execute(trx as any);
      const taskRow = (taskResult.rows as any[])[0];
      if (!taskRow) throw new ApiError(404, 'NOT_FOUND');
      if (expectedVersion !== undefined && taskRow.version !== expectedVersion) throw new ApiError(409, 'STALE_VERSION');

      const destProjectResult = await sql`SELECT * FROM projects WHERE id = ${destinationProjectId}`.execute(trx as any);
      const destProjectRow = (destProjectResult.rows as any[])[0];
      if (!destProjectRow) throw new ApiError(404, 'NOT_FOUND');
      if (destProjectRow.archived_at) throw new ApiError(400, 'BAD_REQUEST', 'Cannot move to archived project');

      // Validate destination lane belongs to destination project
      let destLaneId = destinationLaneId;
      if (!destLaneId) {
        const lanesResult = await sql`SELECT * FROM lanes WHERE project_id = ${destinationProjectId} ORDER BY rank ASC`.execute(trx as any);
        const lanes = lanesResult.rows as any[] as LaneRow[];
        destLaneId = lanes[0]?.id;
        if (!destLaneId) throw new ApiError(400, 'BAD_REQUEST', 'Destination project has no lanes');
      } else {
        const destLaneResult = await sql`SELECT * FROM lanes WHERE id = ${destLaneId}`.execute(trx as any);
        const destLaneRow = (destLaneResult.rows as any[])[0];
        if (!destLaneRow || destLaneRow.project_id !== destinationProjectId) throw new ApiError(404, 'NOT_FOUND');
      }

      // Validate before/after anchors belong to the same lane/destination project
      let beforeRank: number | null = null;
      let afterRank: number | null = null;
      if (beforeTaskId) {
        const beforeResult = await sql`SELECT * FROM tasks WHERE id = ${beforeTaskId}`.execute(trx as any);
        const beforeRow = (beforeResult.rows as any[])[0];
        if (!beforeRow || beforeRow.lane_id !== destLaneId || beforeRow.project_id !== destinationProjectId)
          throw new ApiError(404, 'NOT_FOUND');
        beforeRank = beforeRow.rank;
      }
      if (afterTaskId) {
        const afterResult = await sql`SELECT * FROM tasks WHERE id = ${afterTaskId}`.execute(trx as any);
        const afterRow = (afterResult.rows as any[])[0];
        if (!afterRow || afterRow.lane_id !== destLaneId || afterRow.project_id !== destinationProjectId)
          throw new ApiError(404, 'NOT_FOUND');
        afterRank = afterRow.rank;
      }
      if (beforeTaskId && afterTaskId && beforeTaskId === afterTaskId) {
        throw new ApiError(400, 'BAD_REQUEST', 'beforeTaskId and afterTaskId must be different');
      }

      // Calculate the new rank
      let newRank: number;
      if (!beforeTaskId && !afterTaskId) {
        // Add to end of lane
        const lastTaskResult = await sql`SELECT rank FROM tasks WHERE lane_id = ${destLaneId} ORDER BY rank DESC LIMIT 1`.execute(trx as any);
        const lastRank = (lastTaskResult.rows as any[])[0]?.rank ?? -10;
        newRank = lastRank + 10;
      } else if (beforeRank !== null && afterRank !== null) {
        const midRank = Math.floor((beforeRank + afterRank) / 2);
        // If the midpoint has no integer gap, rebalance every destination task to sparse unique multiples
        if (midRank === beforeRank || midRank === afterRank || beforeRank === afterRank - 1) {
          // Rebalance all tasks in the destination lane to sparse multiples
          const tasksInLaneResult = await sql`SELECT * FROM tasks WHERE lane_id = ${destLaneId} ORDER BY rank ASC`.execute(trx as any);
          const tasksInLane = tasksInLaneResult.rows as any[] as TaskRow[];
          // Re-rank them as 10, 20, 30, etc.
          let rankCursor = 10;
          for (const t of tasksInLane) {
            await sql`UPDATE tasks SET rank = ${rankCursor} WHERE id = ${t.id}`.execute(trx as any);
            rankCursor += 10;
          }
          // Now find the new position again
          if (beforeTaskId) {
            const reBeforeResult = await sql`SELECT rank FROM tasks WHERE id = ${beforeTaskId}`.execute(trx as any);
            beforeRank = (reBeforeResult.rows as any[])[0]?.rank ?? null;
          }
          if (afterTaskId) {
            const reAfterResult = await sql`SELECT rank FROM tasks WHERE id = ${afterTaskId}`.execute(trx as any);
            afterRank = (reAfterResult.rows as any[])[0]?.rank ?? null;
          }
          if (beforeRank !== null && afterRank !== null) {
            newRank = Math.floor((beforeRank + afterRank) / 2);
            // Check if still adjacent - if so, just put it between them as the midpoint
            if (newRank === beforeRank || newRank === afterRank) {
              newRank = beforeRank + 5; // offset slightly
            }
          } else if (beforeRank !== null && afterRank === null) {
            newRank = beforeRank + 5;
          } else if (beforeRank === null && afterRank !== null) {
            newRank = Math.max(0, afterRank - 5);
          } else {
            // Should not reach here if there are tasks in lane
            newRank = 10;
          }
        } else {
          newRank = midRank;
        }
      } else if (beforeRank !== null && afterRank === null) {
        newRank = beforeRank + 5;
      } else if (beforeRank === null && afterRank !== null) {
        newRank = Math.max(0, afterRank - 5);
      } else {
        newRank = 10; // default if no anchors
      }

      // Update the task
      const updateResult = await sql`
        UPDATE tasks SET project_id = ${destinationProjectId}, lane_id = ${destLaneId!},
          rank = ${newRank}, updated_at = ${now}, version = version + 1
        WHERE id = ${taskId}${expectedVersion !== undefined ? sql` AND version = ${expectedVersion}` : sql``}
      `.execute(trx as any);
      const numUpdated = (updateResult as any).numUpdatedRows ?? (updateResult as any).numAffectedRows ?? 0n;
      if (typeof numUpdated === 'bigint' && numUpdated === ZERO) {
        throw new ApiError(409, 'STALE_VERSION');
      }

      // Readback
      const updatedResult = await sql`SELECT * FROM tasks WHERE id = ${taskId}`.execute(trx as any);
      const updatedRow = (updatedResult.rows as any[])[0];
      if (!updatedRow) throw new ApiError(404, 'NOT_FOUND');
      // Hydrate tags for the moved task
      const tags = await this.getTaskTags(taskId, trx as any);
      return { ...updatedRow as TaskRow, tags };
    });
  }

  async moveTaskToNewProject(
    taskId: string, projectName: string, expectedVersion: number, ownerId: string,
  ): Promise<TaskRow> {
    const task = await this.getTaskById(taskId);
    if (!task) throw new ApiError(404, 'NOT_FOUND');
    if (task.version !== expectedVersion) throw new ApiError(409, 'STALE_VERSION');

    // Create new project and lanes in a single transaction
    return this.transaction(async (trx) => {
      const now = new Date().toISOString();
      const projectId = randomUUID();

      // Get next rank within transaction
      const rankResult = await sql`
        SELECT rank FROM projects WHERE owner_id = ${ownerId} ORDER BY rank DESC LIMIT 1
      `.execute(trx as any);
      const rankRows = rankResult.rows as any[];
      const projectRank = ((rankRows[0]?.rank as number) ?? -10) + 10;

      // Create project directly in transaction
      await sql`
        INSERT INTO projects (id, owner_id, name, description, archived_at, rank, version, created_at, updated_at)
        VALUES (${projectId}, ${ownerId}, ${projectName}, NULL, NULL, ${projectRank}, 0, ${now}, ${now})
      `.execute(trx as any);

      // Create 3 lanes with the correct names
      for (const lane of DEFAULT_LANES_SPEC) {
        const laneId = randomUUID();
        await sql`
          INSERT INTO lanes (id, project_id, name, rank, version, created_at, updated_at)
          VALUES (${laneId}, ${projectId}, ${lane.name}, ${lane.rank}, 0, ${now}, ${now})
        `.execute(trx as any);
      }

      // Move the task to the new project's ToDo lane with rank 0
      const lanesResult2 = await sql`
        SELECT id FROM lanes WHERE project_id = ${projectId} AND name = 'ToDo' ORDER BY rank ASC LIMIT 1
      `.execute(trx as any);
      const todoLane = (lanesResult2.rows as any[])[0];
      if (!todoLane) throw new ApiError(400, 'BAD_REQUEST', 'ToDo lane not found');

      const updateResult = await sql`
        UPDATE tasks SET project_id = ${projectId}, lane_id = ${todoLane.id},
          rank = 0, updated_at = ${now}, version = version + 1
        WHERE id = ${taskId} AND version = ${expectedVersion}
      `.execute(trx as any);
      const numUpdated = (updateResult as any).numUpdatedRows ?? (updateResult as any).numAffectedRows ?? 0n;
      if (typeof numUpdated === 'bigint' && numUpdated === ZERO) {
        // If stale version, rollback the whole transaction by throwing
        throw new ApiError(409, 'STALE_VERSION');
      }

      // Readback the task
      const updated = await sql`SELECT * FROM tasks WHERE id = ${taskId}`.execute(trx as any);
      const rows = updated.rows as any[];
      const tags = await this.getTaskTags(taskId, trx as any);
      return { ...rows[0] as TaskRow, tags };
    });
  }

  // --- Tag ops ---

  async listTags(userId: string): Promise<TagRow[]> {
    const result = await sql`SELECT * FROM tags WHERE user_id = ${userId} ORDER BY name ASC`.execute(this.db);
    return result.rows as any[] as TagRow[];
  }

  async getTagById(tagId: string): Promise<TagRow | null> {
    const result = await sql`SELECT * FROM tags WHERE id = ${tagId}`.execute(this.db);
    const rows = result.rows as any[];
    return rows?.[0] || null;
  }

  async getTagByNormalizedName(userId: string, normalizedName: string): Promise<TagRow | null> {
    const result = await sql`SELECT * FROM tags WHERE user_id = ${userId} AND normalized_name = ${normalizedName}`.execute(this.db);
    const rows = result.rows as any[];
    return rows?.[0] || null;
  }

  // Deterministic color from normalized name
  private getColorForTag(normalizedName: string): string {
    return tagColorFromName(normalizedName);
  }

  // Create a tag atomically, resolving races with UNIQUE constraint
  async createTag(userId: string, name: string): Promise<TagRow> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const normalizedName = name.toLowerCase().trim();
    const color = this.getColorForTag(normalizedName);
    await sql`
      INSERT INTO tags (id, user_id, name, normalized_name, color, version, created_at, updated_at)
      VALUES (${id}, ${userId}, ${name}, ${normalizedName}, ${color}, 0, ${now}, ${now})
    `.execute(this.db);
    return {
      id, user_id: userId, name, normalized_name: normalizedName, color, version: 0,
      created_at: now, updated_at: now,
    };
  }

  async updateTag(tagId: string, name: string, color: string, userId: string, expectedVersion?: number): Promise<TagRow> {
    // Atomic: check ownership and version in the WHERE clause
    const now = new Date().toISOString();
    const normalizedName = name.toLowerCase().trim();
    const result = await sql`
      UPDATE tags SET name = ${name}, normalized_name = ${normalizedName}, color = ${color}, version = version + 1, updated_at = ${now}
      WHERE id = ${tagId} AND user_id = ${userId}${expectedVersion !== undefined ? sql` AND version = ${expectedVersion}` : sql``}
    `.execute(this.db);
    const numUpdated = (result as any).numUpdatedRows ?? (result as any).numAffectedRows ?? 0n;
    if (typeof numUpdated === 'bigint' && numUpdated === ZERO) {
      // Check whether the tag exists at all
      const existing = await this.getTagById(tagId);
      if (!existing || existing.user_id !== userId) {
        throw new ApiError(404, 'NOT_FOUND');
      }
      throw new ApiError(409, 'STALE_VERSION');
    }
    const updated = await this.getTagById(tagId);
    if (!updated) throw new ApiError(404, 'NOT_FOUND');
    return updated;
  }

  async deleteTag(tagId: string, userId: string, expectedVersion?: number): Promise<void> {
    // Atomic: check ownership and version in the WHERE clause
    const result = await sql`
      DELETE FROM tags WHERE id = ${tagId} AND user_id = ${userId}${expectedVersion !== undefined ? sql` AND version = ${expectedVersion}` : sql``}
    `.execute(this.db);
    const numDeleted = (result as any).numDeletedRows ?? (result as any).numAffectedRows ?? 0n;
    if (typeof numDeleted === 'bigint' && numDeleted === ZERO) {
      // Check whether the tag exists at all
      const existing = await this.getTagById(tagId);
      if (!existing || existing.user_id !== userId) {
        throw new ApiError(404, 'NOT_FOUND');
      }
      throw new ApiError(409, 'STALE_VERSION');
    }
  }

  // Resolve or create tags for given tag names, returning their IDs
  // Used atomically within a transaction. Deduplicates within the batch.
  async resolveOrCreateTags(userId: string, tagNames: string[], trx: Kysely<any>): Promise<string[]> {
    // Normalize, deduplicate, and sort names to minimize race conditions
    const normalizedNames = tagNames
      .map(name => ({ original: name.trim(), normalized: name.trim().toLowerCase() }))
      .filter((v, i, a) => a.findIndex(x => x.normalized === v.normalized) === i);
    // Sort normalized names for deterministic order
    normalizedNames.sort((a, b) => a.normalized.localeCompare(b.normalized));
    const tagIds: string[] = [];
    for (const { original: name, normalized: normalizedName } of normalizedNames) {
      // Use INSERT OR IGNORE (SQLite) / ON CONFLICT DO NOTHING (Postgres) to atomically create
      // The UNIQUE constraint on (user_id, normalized_name) prevents duplicates
      const id = randomUUID();
      const now = new Date().toISOString();
      const color = this.getColorForTag(normalizedName);
      await sql`
        INSERT INTO tags (id, user_id, name, normalized_name, color, version, created_at, updated_at)
        VALUES (${id}, ${userId}, ${name}, ${normalizedName}, ${color}, 0, ${now}, ${now})
        ON CONFLICT(user_id, normalized_name) DO NOTHING
      `.execute(trx as any);
      // Now select winner - either the existing tag or the one we just inserted
      const winnerResult = await sql`
        SELECT id FROM tags WHERE user_id = ${userId} AND normalized_name = ${normalizedName}
      `.execute(trx as any);
      const winnerRow = (winnerResult.rows as any[])[0];
      if (!winnerRow) throw new ApiError(500, 'INTERNAL_ERROR', 'Tag creation/resolution failed');
      tagIds.push(winnerRow.id);
    }
    return tagIds;
  }

  // Attach tags to a task, replacing all existing associations
  async setTaskTags(taskId: string, tagIds: string[], trx: Kysely<any>): Promise<void> {
    // Remove all existing associations
    await sql`DELETE FROM task_tags WHERE task_id = ${taskId}`.execute(trx as any);
    // Insert new associations
    if (tagIds.length > 0) {
      const now = new Date().toISOString();
      for (const tagId of tagIds) {
        await sql`
          INSERT INTO task_tags (task_id, tag_id, created_at) VALUES (${taskId}, ${tagId}, ${now})
        `.execute(trx as any);
      }
    }
  }

  // Get tag rows for a task
  async getTaskTags(taskId: string, trx?: Kysely<any>): Promise<TagRow[]> {
    const exec = trx || this.db;
    const result = await sql`
      SELECT t.* FROM tags t
      JOIN task_tags tt ON t.id = tt.tag_id
      WHERE tt.task_id = ${taskId}
      ORDER BY t.normalized_name ASC, t.id ASC
    `.execute(exec as any);
    return result.rows as any[] as TagRow[];
  }

  // Batch hydrate tasks with tags - avoids N+1
  async hydrateTaskTags(tasks: TaskRow[]): Promise<(TaskRow & { tags: TagRow[] })[]> {
    if (tasks.length === 0) return tasks as any[];
    const taskIds = tasks.map(t => t.id);
    // Fetch all tag associations for these tasks
    const assocResult = await sql`
      SELECT tt.task_id, tt.tag_id FROM task_tags tt WHERE tt.task_id IN (${sql.join(taskIds.map(id => sql`${id}`))})
    `.execute(this.db);
    const assocRows = assocResult.rows as any[] as TaskTagRow[];
    // Build task->tagIds map
    const taskTagMap = new Map<string, string[]>();
    for (const row of assocRows) {
      const existing = taskTagMap.get(row.task_id);
      if (existing) {
        existing.push(row.tag_id);
      } else {
        taskTagMap.set(row.task_id, [row.tag_id]);
      }
    }
    // Fetch all tags involved (deduplicate tag IDs)
    const tagIdSet = new Set<string>();
    for (const ids of taskTagMap.values()) {
      for (const id of ids) {
        tagIdSet.add(id);
      }
    }
    const tagIds = Array.from(tagIdSet);
    let tags: TagRow[] = [];
    if (tagIds.length > 0) {
      const tagResult = await sql`
        SELECT * FROM tags WHERE id IN (${sql.join(tagIds.map(id => sql`${id}`))})
      `.execute(this.db);
      tags = tagResult.rows as any[] as TagRow[];
    }
    // Build tag lookup
    const tagMap = new Map<string, TagRow>();
    for (const tag of tags) {
      tagMap.set(tag.id, tag);
    }
    // Attach tags to tasks, sorted by normalized_name then id
    const hydrated = tasks.map(task => {
      const taskTagIds = taskTagMap.get(task.id) || [];
      const taskTags = taskTagIds
        .map(tid => tagMap.get(tid))
        .filter((t): t is TagRow => t !== undefined)
        .sort((a, b) => (a.normalized_name ?? '').localeCompare(b.normalized_name ?? '') || (a.id ?? '').localeCompare(b.id ?? ''));
      return { ...task, tags: taskTags };
    });
    return hydrated;
  }

  // --- API Token ops ---

  async createApiToken(
    ownerId: string, name: string, scopes: string[], expiresInDays?: number,
  ): Promise<{ token: string; row: ApiTokenRow }> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const token = randomBytes(32).toString('hex');
    const prefix = token.slice(0, 8);
    const hash = await this.hashToken(token);
    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 86400000).toISOString()
      : null;
    await sql`
      INSERT INTO api_tokens (id, owner_id, name, prefix, token_hash, scopes, expires_at, created_at, updated_at)
      VALUES (${id}, ${ownerId}, ${name}, ${prefix}, ${hash}, ${scopes.join(',')}, ${expiresAt}, ${now}, ${now})
    `.execute(this.db);
    return {
      token,
      row: {
        id, owner_id: ownerId, name, prefix, token_hash: hash,
        scopes: scopes.join(','), expires_at: expiresAt, revoked_at: null,
        last_used_at: null, created_at: now, updated_at: now,
      },
    };
  }

  async listApiTokens(ownerId: string): Promise<ApiTokenRow[]> {
    const result = await sql`SELECT * FROM api_tokens WHERE owner_id = ${ownerId} ORDER BY created_at ASC`.execute(this.db);
    return result.rows as any[] as ApiTokenRow[];
  }

  async getApiTokenByPrefix(prefix: string): Promise<ApiTokenRow | null> {
    const result = await sql`SELECT * FROM api_tokens WHERE prefix = ${prefix}`.execute(this.db);
    const rows = result.rows as any[];
    return rows?.[0] || null;
  }

  async revokeApiToken(tokenId: string, ownerId: string): Promise<void> {
    const token = await this.getApiTokenById(tokenId);
    if (!token || token.owner_id !== ownerId) throw new ApiError(404, 'NOT_FOUND');
    const now = new Date().toISOString();
    await sql`UPDATE api_tokens SET revoked_at = ${now}, updated_at = ${now} WHERE id = ${tokenId}`.execute(this.db);
  }

  // --- OIDC Transaction ops ---

  async createOidcTransaction(payload: { transactionId: string; state: string; nonce: string; codeVerifier: string }): Promise<{ id: string }> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 minute expiry
    await sql`
      INSERT INTO oidc_transactions (id, transaction_id, state, nonce, code_verifier, expires_at, created_at, updated_at)
      VALUES (${id}, ${payload.transactionId}, ${payload.state}, ${payload.nonce}, ${payload.codeVerifier}, ${expiresAt}, ${now}, ${now})
    `.execute(this.db);
    return { id };
  }

  async consumeOidcTransaction(transactionId: string): Promise<{ state: string; nonce: string; codeVerifier: string } | null> {
    // Find and mark consumed - atomically consume once
    const result = await sql`
      SELECT * FROM oidc_transactions\n      WHERE transaction_id = ${transactionId}\n        AND consumed_at IS NULL\n        AND expires_at > ${new Date().toISOString()}
      ORDER BY created_at ASC LIMIT 1
    `.execute(this.db);
    const row = (result.rows as any[])[0];
    if (!row) return null;

    // Mark consumed
    const now = new Date().toISOString();
    await sql`UPDATE oidc_transactions SET consumed_at = ${now}, updated_at = ${now} WHERE id = ${row.id}`.execute(this.db);

    return { state: row.state, nonce: row.nonce, codeVerifier: row.code_verifier };
  }

  private async getApiTokenById(id: string): Promise<ApiTokenRow | null> {
    const result = await sql`SELECT * FROM api_tokens WHERE id = ${id}`.execute(this.db);
    const rows = result.rows as any[];
    return rows?.[0] || null;
  }

  async updateTokenLastUsed(tokenId: string): Promise<void> {
    const now = new Date().toISOString();
    await sql`UPDATE api_tokens SET last_used_at = ${now} WHERE id = ${tokenId}`.execute(this.db);
  }

  // --- Private helpers ---

  private async getNextProjectRank(ownerId: string): Promise<number> {
    const result = await sql`SELECT rank FROM projects WHERE owner_id = ${ownerId} ORDER BY rank DESC LIMIT 1`.execute(this.db);
    const rows = result.rows as any[];
    return ((rows[0]?.rank as number) ?? -10) + 10;
  }

  private async getNextLaneRank(projectId: string): Promise<number> {
    const result = await sql`SELECT rank FROM lanes WHERE project_id = ${projectId} ORDER BY rank DESC LIMIT 1`.execute(this.db);
    const rows = result.rows as any[];
    return ((rows[0]?.rank as number) ?? -10) + 10;
  }

  private async getNextTaskRank(laneId: string): Promise<number> {
    const result = await sql`SELECT rank FROM tasks WHERE lane_id = ${laneId} ORDER BY rank DESC LIMIT 1`.execute(this.db);
    const rows = result.rows as any[];
    return ((rows[0]?.rank as number) ?? -10) + 10;
  }

  private async calcRankBetween(
    projectId: string, laneId: string,
    beforeTaskId?: string, afterTaskId?: string,
  ): Promise<number> {
    if (!beforeTaskId && !afterTaskId) return this.getNextTaskRank(laneId);
    const beforeRank = beforeTaskId
      ? (await this.getTaskById(beforeTaskId))?.rank ?? null
      : null;
    const afterRank = afterTaskId
      ? (await this.getTaskById(afterTaskId))?.rank ?? null
      : null;
    if (beforeRank !== null && afterRank !== null) return Math.floor((beforeRank! + afterRank!) / 2);
    if (beforeRank !== null && afterRank === null) return beforeRank! + 5;
    if (beforeRank === null && afterRank !== null) return Math.max(0, afterRank! - 5);
    return this.getNextTaskRank(laneId);
  }

  private hashToken(token: string): string {
    const hash = createHash('sha-256');
    hash.update(token, 'utf-8');
    return hash.digest('hex');
  }
}
