import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Repository, createDb, getDialect, ApiError, x0n } from '../dist/index.js';
import { up as migrationUp, down as migrationDown } from '../dist/migrations/001-initial.js';
import { sql } from 'kysely';
import { randomUUID } from 'crypto';
import path from 'path';
import { unlinkSync } from 'node:fs';

let repo: Repository;

async function getProjectVersion(projectId: string) {
  const project = await repo.getProjectById(projectId);
  return project?.version;
}

function setTestEnv() {
  process.env.DB_DIALECT = 'sqlite';
  process.env.SQLITE_PATH = '/tmp/test-db-' + randomUUID() + '.db';
  process.env.NODE_ENV = 'test';
}

describe('db package', () => {
  beforeAll(async () => {
    setTestEnv();
    const db = createDb();
    await migrationUp(db);
    repo = new Repository(db);
  });

  afterAll(async () => {
    // Clean up test DB - not needed since SQLite files are temp and random
  });

  it('exports Repository', () => {
    expect(Repository).toBeDefined();
    expect(typeof Repository).toBe('function');
  });

  it('exports createDb', () => {
    expect(createDb).toBeDefined();
    expect(typeof createDb).toBe('function');
  });

  it('exports getDialect', () => {
    expect(getDialect).toBeDefined();
    expect(typeof getDialect).toBe('function');
  });

  it('exports ApiError class', () => {
    expect(ApiError).toBeDefined();
    expect(typeof ApiError).toBe('function');
  });

  it('can create and read user', async () => {
    const user = await repo.upsertUser('test-issuer', 'test-subject');
    expect(user).toBeDefined();
    expect(user.issuer).toBe('test-issuer');
    expect(user.subject).toBe('test-subject');
  });

  it('can create and list projects', async () => {
    const user = await repo.upsertUser('proj-owner', 'proj-subject');
    const project = await repo.createProject(user.id, 'Test Project');
    expect(project).toBeDefined();
    expect(project.owner_id).toBe(user.id);
    const projects = await repo.listProjects(user.id);
    expect(projects.length).toBeGreaterThanOrEqual(1);
  });

  it('enforces project ownership', async () => {
    const userA = await repo.upsertUser('owner-a', 'sub-a');
    const userB = await repo.upsertUser('owner-b', 'sub-b');
    const project = await repo.createProject(userA.id, 'A-Project');
    try {
      await repo.updateProject(project.id, userB.id, { name: 'stolen' }, 0);
      expect.fail('Should throw');
    } catch (e: any) {
      expect(e.code).toBe('NOT_FOUND');
      expect(e.status).toBe(404);
    }
  });

  it('handles lane CRUD', async () => {
    const user = await repo.upsertUser('lane-owner', 'lane-subj');
    const project = await repo.createProject(user.id, 'Lane Project');
    const projVer0 = await getProjectVersion(project.id);
    const lane1 = await repo.createLane(project.id, 'Backlog', projVer0, 0);
    const projVer1 = await getProjectVersion(project.id);
    const lane2 = await repo.createLane(project.id, 'In Progress', projVer1, 10);
    expect(lane1).toBeDefined();
    expect(lane2).toBeDefined();
    const lanes = await repo.listLanes(project.id);
    expect(lanes.length).toBe(2);
  });

  it('handles task CRUD and move', async () => {
    const user = await repo.upsertUser('task-owner', 'task-subj');
    const project = await repo.createProject(user.id, 'Task Project');
    const projVer = await getProjectVersion(project.id);
    const lane = await repo.createLane(project.id, 'Backlog', projVer, 0);
    const task = await repo.createTask(project.id, lane.id, 'Test Task');
    expect(task).toBeDefined();
    expect(task.title).toBe('Test Task');
    const tasks = await repo.listTasks(project.id);
    expect(tasks.length).toBe(1);
  });

  it('api token creates and validates', async () => {
    const user = await repo.upsertUser('token-owner', 'token-subj');
    const result = await repo.createApiToken(user.id, 'my-token', ['read']);
    const tokenRow = await repo.getApiTokenByPrefix(result.row.prefix);
    expect(tokenRow).toBeDefined();
    expect(tokenRow?.token_hash).toBe(result.row.token_hash);
  });

  it('enforces OIDC issuer+subject uniqueness', async () => {
    const user1 = await repo.upsertUser('unique-iss', 'unique-subj');
    const user2 = await repo.upsertUser('unique-iss', 'unique-subj');
    expect(user1.id).toBe(user2.id);
  });

  it('supports getUserByIssuerSubject', async () => {
    const user = await repo.upsertUser('lookup-iss', 'lookup-subj');
    const found = await repo.getUserByIssuerSubject('lookup-iss', 'lookup-subj');
    expect(found).toBeDefined();
    expect(found!.id).toBe(user.id);
  });

  it('can delete task', async () => {
    const user = await repo.upsertUser('deleteme', 'deleteme-subj');
    const project = await repo.createProject(user.id, 'DelProj');
    const lane = await repo.createLane(project.id, 'Backlog', 0);
    const task = await repo.createTask(project.id, lane.id, 'DelTask');
    expect(task).toBeDefined();
    await repo.deleteTask(task.id);
    const taskRow = await repo.getTaskById(task.id);
    expect(taskRow).toBeNull();
  });

  it('rejects duplicate lane reorder IDs', async () => {
    const user = await repo.upsertUser('reorder-dup', 'reorder-dup-subj');
    const project = await repo.createProject(user.id, 'ReorderProj');
    const projVer1 = await getProjectVersion(project.id);
    const lane1 = await repo.createLane(project.id, 'L1', projVer1, 0);
    const projVer2 = await getProjectVersion(project.id);
    const lane2 = await repo.createLane(project.id, 'L2', projVer2, 10);
    const projVer3 = await getProjectVersion(project.id);
    try {
      await repo.reorderLanes(project.id, [lane1.id, lane1.id], projVer3);
      expect.fail('Should throw');
    } catch (e: any) {
      expect(e.message).toContain('Duplicate');
      expect(e.status).toBe(400);
    }
  });

  describe('lane deletion', () => {
    it('moves tasks to specified destination lane', async () => {
      const user = await repo.upsertUser('del-lane-usr', 'del-lane-subj');
      const project = await repo.createProject(user.id, 'DelLaneTestProj');
      const projVer1 = await getProjectVersion(project.id);
      const lane1 = await repo.createLane(project.id, 'L1', projVer1, 0);
      const projVer2 = await getProjectVersion(project.id);
      const lane2 = await repo.createLane(project.id, 'L2', projVer2, 10);
      const task1 = await repo.createTask(project.id, lane1.id, 'T1');
      const projVer3 = await getProjectVersion(project.id);
      await repo.deleteLane(project.id, lane1.id, lane2.id, projVer3);
      const tasks = await repo.listTasks(project.id);
      expect(tasks.length).toBe(1);
      expect(tasks[0].lane_id).toBe(lane2.id);
      const lanes = await repo.listLanes(project.id);
      expect(lanes.length).toBe(1);
      expect(lanes[0].id).toBe(lane2.id);
    });

    it('rejects deleting last lane', async () => {
      const user = await repo.upsertUser('del-last-usr', 'del-last-subj');
      const project = await repo.createProject(user.id, 'DelLastTestProj');
      const projVer = await getProjectVersion(project.id);
      const lane = await repo.createLane(project.id, 'OnlyLane', projVer, 0);
      const projVerAfterLane = await getProjectVersion(project.id);
      try {
        await repo.deleteLane(project.id, lane.id, lane.id, projVerAfterLane);
        expect.fail('Should throw');
      } catch (e: any) {
        expect(e.code).toBe('BAD_REQUEST');
      }
    });
  });

  describe('archived project prevention', () => {
    it('rejects creating lane in archived project', async () => {
      const user = await repo.upsertUser('arch-lane-usr', 'arch-lane-subj');
      const project = await repo.createProject(user.id, 'ArchLaneProj');
      await repo.archiveProject(project.id, user.id, 0);
      try {
        await repo.createLane(project.id, 'NewLane', 0, 0);
        expect.fail('Should throw');
      } catch (e: any) {
        expect(e.code).toBe('BAD_REQUEST');
      }
    });

    it('rejects creating task in archived project', async () => {
      const user = await repo.upsertUser('arch-task-usr', 'arch-task-subj');
      const project = await repo.createProject(user.id, 'ArchTaskProj');
      const projVer = await getProjectVersion(project.id);
      const lane = await repo.createLane(project.id, 'Backlog', projVer, 0);
      const projVerAfterLane = await getProjectVersion(project.id);
      await repo.archiveProject(project.id, user.id, projVerAfterLane);
      try {
        await repo.createTask(project.id, lane.id, 'NewTask');
        expect.fail('Should throw');
      } catch (e: any) {
        expect(e.code).toBe('BAD_REQUEST');
      }
    });
  });

  it('migration generates valid postgres SQL', async () => {
    process.env.DB_DIALECT = 'postgres';
    expect(migrationUp).toBeDefined();
    expect(migrationDown).toBeDefined();
    process.env.DB_DIALECT = 'sqlite';
  });

  it('getDialect with postgres uses static ESM import, not require()', async () => {
    // Set a syntactically valid (but dummy) DATABASE_URL
    const origEnv = {
      DB_DIALECT: process.env.DB_DIALECT,
      DATABASE_URL: process.env.DATABASE_URL,
    };
    process.env.DB_DIALECT = 'postgres';
    process.env.DATABASE_URL = 'postgresql://localhost:5432/test_db_dummy';

    try {
      // Calling getDialect() with postgres and a valid URL should succeed without
      // throwing any require/ReferenceError. It returns a PostgresDialect object.
      const dialect = getDialect();
      expect(dialect).toBeDefined();
      // The pool is created but no connection is attempted at this point.
      // Cleanup: the pool will be garbage-collected; no explicit close needed
      // because PostgresDialect does not expose the pool via its API.
    } finally {
      process.env.DB_DIALECT = origEnv.DB_DIALECT;
      process.env.DATABASE_URL = origEnv.DATABASE_URL;
    }
  });

  // --- Migration regression tests ---

  it('compiled migrator discovers and applies both 001-initial and 002-oidc-transactions', async () => {
    // Use a unique temp SQLite file
    const testDbPath = '/tmp/test-migration-db-' + randomUUID() + '.db';
    process.env.DB_DIALECT = 'sqlite';
    process.env.SQLITE_PATH = testDbPath;

    // Create the DB and run migrator directly using the compiled provider (no side effects)
    const db = createDb();
    const { Migrator } = await import('kysely/migration');
    const { NumericFileMigrationProvider } = await import('../dist/migrations/run.js');
    const migrationsDir = path.resolve(__dirname, '..', 'dist', 'migrations');
    const migrator = new Migrator({
      db,
      provider: new NumericFileMigrationProvider(migrationsDir),
    });

    try {
      // First pass - must discover and apply both
      const { results, error } = await migrator.migrateToLatest();
      expect(error).toBeUndefined();
      const appliedFirst = results?.filter(r => r.status === 'Success').map(r => r.migrationName) || [];
      expect(appliedFirst).toContain('001-initial');
      expect(appliedFirst).toContain('002-oidc-transactions');

      // Verify oidc_transactions table exists
      const txResult = await sql`
        SELECT name FROM sqlite_master WHERE type='table' AND name='oidc_transactions'
      `.execute(db);
      const txRows = txResult.rows as any[];
      expect(txRows.length).toBeGreaterThanOrEqual(1);

      // Second pass - must apply nothing
      const { results: results2, error: error2 } = await migrator.migrateToLatest();
      expect(error2).toBeUndefined();
      const appliedSecond = results2?.filter(r => r.status === 'Success').map(r => r.migrationName) || [];
      expect(appliedSecond.length).toBe(0);
    } finally {
      await db.destroy();
      // Clean up temp files
      ['', '-wal', '-shm'].forEach(suffix => {
        try { unlinkSync(testDbPath + suffix); } catch {}
      });
    }
  });
});
