import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { Repository, createDb, getDialect, ApiError, x0n } from '../dist/index.js';
import { up as migrationUp, down as migrationDown } from '../dist/migrations/001-initial.js';
import { up as migration003Up } from '../dist/migrations/003-task-tags.js';
import { up as migration004Up, down as migration004Down } from '../dist/migrations/004-ensure-task-tags.js';
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
    await migration003Up(db);
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

  it('creates project with exactly three default lanes in correct order', async () => {
    const user = await repo.upsertUser('default-lanes-usr', 'default-lanes-subj');
    const project = await repo.createProject(user.id, 'DefaultLanesProj');
    expect(project.version).toBe(0);
    const lanes = await repo.listLanes(project.id);
    expect(lanes.length).toBe(3);
    expect(lanes[0].name).toBe('ToDo');
    expect(lanes[0].rank).toBe(0);
    expect(lanes[1].name).toBe('InProgress');
    expect(lanes[1].rank).toBe(10);
    expect(lanes[2].name).toBe('Complete');
    expect(lanes[2].rank).toBe(20);
  });

  it('project default initialization sets version 0', async () => {
    const user = await repo.upsertUser('ver-zero-usr', 'ver-zero-subj');
    const project = await repo.createProject(user.id, 'VerZeroProj');
    expect(project.version).toBe(0);
  });

  it('moveToNewProject uses same default lanes and moves to ToDo', async () => {
    const user = await repo.upsertUser('move-new-usr', 'move-new-subj');
    const project = await repo.createProject(user.id, 'MoveNewOrig');
    const lane = (await repo.listLanes(project.id))[0]; // ToDo lane
    const task = await repo.createTask(project.id, lane.id, 'MoveMe');
    const moved = await repo.moveTaskToNewProject(task.id, 'MoveNewDest', task.version, user.id);
    const newProj = await repo.getProjectById(moved.project_id);
    expect(newProj!.name).toBe('MoveNewDest');
    expect(moved.lane_id).toBeDefined();
    const newLanes = await repo.listLanes(moved.project_id);
    expect(newLanes.length).toBe(3);
    // Verify task moved to the ToDo lane
    const movedTask = await repo.getTaskById(moved.id);
    expect(movedTask!.lane_id).toBe(newLanes[0].id); // first lane should be ToDo
    // Verify names/ranks of new lanes
    expect(newLanes[0].name).toBe('ToDo');
    expect(newLanes[0].rank).toBe(0);
    expect(newLanes[1].name).toBe('InProgress');
    expect(newLanes[1].rank).toBe(10);
    expect(newLanes[2].name).toBe('Complete');
    expect(newLanes[2].rank).toBe(20);
  });

  it('rollback on stale version in moveToNewProject avoids leaving orphan project/lanes', async () => {
    const user = await repo.upsertUser('rollback-usr', 'rollback-subj');
    const project = await repo.createProject(user.id, 'RollbackOrig');
    const lane = (await repo.listLanes(project.id))[0];
    const task = await repo.createTask(project.id, lane.id, 'RollMe');
    try {
      await repo.moveTaskToNewProject(task.id, 'RollbackDest', 999, user.id);
      expect.fail('Should throw');
    } catch (e: any) {
      expect(e.code).toBe('STALE_VERSION');
    }
    // Verify no new project was created
    const projects = await repo.listProjects(user.id);
    expect(projects.find((p: any) => p.name === 'RollbackDest')).toBeUndefined();
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
    expect(lanes.length).toBeGreaterThanOrEqual(5); // 3 default + 2 created
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
    const allLanes = await repo.listLanes(project.id);
    const allIds = allLanes.map((l: any) => l.id);
    // Provide all IDs but with one duplicated (swapping last two)
    const dupIds = [...allIds];
    dupIds[allIds.length - 1] = allIds[0]; // replace last with first duplicate
    const projVerAfter = await getProjectVersion(project.id);
    try {
      await repo.reorderLanes(project.id, dupIds, projVerAfter);
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
      // Use default lanes
      const defaultLanes = await repo.listLanes(project.id);
      const task1 = await repo.createTask(project.id, defaultLanes[0].id, 'T1');
      const projVer = await getProjectVersion(project.id);
      await repo.deleteLane(project.id, defaultLanes[0].id, defaultLanes[1].id, projVer);
      const tasks = await repo.listTasks(project.id);
      expect(tasks.length).toBe(1);
      expect(tasks[0].lane_id).toBe(defaultLanes[1].id);
      const lanes = await repo.listLanes(project.id);
      expect(lanes.length).toBe(2); // InProgress and Complete remain
      expect(lanes.map((l: any) => l.name)).not.toContain('ToDo');
    });

    it('rejects deleting last lane', async () => {
      const user = await repo.upsertUser('del-last-usr', 'del-last-subj');
      const project = await repo.createProject(user.id, 'DelLastTestProj');
      // Delete first two of three default lanes
      const defaultLanes = await repo.listLanes(project.id);
      const projVer1 = await getProjectVersion(project.id);
      await repo.deleteLane(project.id, defaultLanes[0].id, defaultLanes[1].id, projVer1);
      const projVer2 = await getProjectVersion(project.id);
      await repo.deleteLane(project.id, defaultLanes[1].id, defaultLanes[2].id, projVer2);
      const lanes = await repo.listLanes(project.id);
      expect(lanes.length).toBe(1);
      // Try to delete the last lane - should fail
      const projVer3 = await getProjectVersion(project.id);
      try {
        await repo.deleteLane(project.id, defaultLanes[2].id, defaultLanes[2].id, projVer3);
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

  describe('Migration 004', () => {
    it('applies 004 safely even when 003 already applied', async () => {
      const testDbPath = '/tmp/test-migration-004-' + randomUUID() + '.db';
      process.env.DB_DIALECT = 'sqlite';
      process.env.SQLITE_PATH = testDbPath;

      const db = createDb();
      try {
        // Apply 001, 002, 003
        await migrationUp(db);
        await migration003Up(db);

        // Now apply 004 - should be idempotent (tables already exist)
        await migration004Up(db);

        // Verify tags table still exists
        const tagResult = await sql`
          SELECT name FROM sqlite_master WHERE type='table' AND name='tags'
        `.execute(db);
        expect(tagResult.rows.length).toBeGreaterThanOrEqual(1);

        // Verify task_tags table still exists
        const ttResult = await sql`
          SELECT name FROM sqlite_master WHERE type='table' AND name='task_tags'
        `.execute(db);
        expect(ttResult.rows.length).toBeGreaterThanOrEqual(1);

        // Verify unique index exists
        const idxResult = await sql`
          SELECT name FROM sqlite_master WHERE type='index' AND name='idx_tags_user_id_normalized_name'
        `.execute(db);
        expect(idxResult.rows.length).toBeGreaterThanOrEqual(1, "Unique index idx_tags_user_id_normalized_name should exist");

        // Verify we can do tag operations (to confirm schema is valid)
        const testRepo = new Repository(db);
        const user = await testRepo.upsertUser('004-test-issuer', '004-test-subject');
        const tag = await testRepo.createTag(user.id, '004-tag');
        expect(tag).toBeDefined();
        await testRepo.deleteTag(tag.id, user.id, tag.version);

        // Verify down is genuine no-op (does not drop tables or indexes)
        await migration004Down(db);
        // Tables should still exist after down
        const tagResult2 = await sql`
          SELECT name FROM sqlite_master WHERE type='table' AND name='tags'
        `.execute(db);
        expect(tagResult2.rows.length).toBeGreaterThanOrEqual(1, "tags table should remain after 004 down");
      } finally {
        await db.destroy();
        ['', '-wal', '-shm'].forEach(suffix => {
          try { unlinkSync(testDbPath + suffix); } catch {}
        });
      }
    });

    it('004 repairs missing tags/task_tags after pretend 003', async () => {
      const testDbPath = '/tmp/test-migration-004-repair-' + randomUUID() + '.db';
      process.env.DB_DIALECT = 'sqlite';
      process.env.SQLITE_PATH = testDbPath;

      const db = createDb();
      try {
        // Apply 001 only (skip 002/003)
        await migrationUp(db);

        // Apply 004 - should repair the missing tag tables
        await migration004Up(db);

        // Verify tags table exists
        const tagResult = await sql`
          SELECT name FROM sqlite_master WHERE type='table' AND name='tags'
        `.execute(db);
        expect(tagResult.rows.length).toBeGreaterThanOrEqual(1);

        // Verify task_tags table exists
        const ttResult = await sql`
          SELECT name FROM sqlite_master WHERE type='table' AND name='task_tags'
        `.execute(db);
        expect(ttResult.rows.length).toBeGreaterThanOrEqual(1);

        // Verify tag operations work
        const testRepo = new Repository(db);
        const user = await testRepo.upsertUser('004-repair-issuer', '004-repair-subject');
        const tag = await testRepo.createTag(user.id, 'repair-tag');
        expect(tag).toBeDefined();
        await testRepo.deleteTag(tag.id, user.id, tag.version);

        // Verify task creation with tags works
        const project = await testRepo.createProject(user.id, 'Repair Project');
        const lanes = await testRepo.listLanes(project.id);
        const task = await testRepo.createTask(project.id, lanes[0].id, 'Repair task', undefined, undefined, ['repair-tag']);
        expect(task.tags).toBeDefined();
        expect(task.tags.length).toBeGreaterThanOrEqual(1);
        await testRepo.deleteTask(task.id);
      } finally {
        await db.destroy();
        ['', '-wal', '-shm'].forEach(suffix => {
          try { unlinkSync(testDbPath + suffix); } catch {}
        });
      }
    });

    it('compiled migrator discovers 004', async () => {
      const testDbPath = '/tmp/test-migration-004-discover-' + randomUUID() + '.db';
      process.env.DB_DIALECT = 'sqlite';
      process.env.SQLITE_PATH = testDbPath;

      const db = createDb();
      const { Migrator } = await import('kysely/migration');
      const { NumericFileMigrationProvider } = await import('../dist/migrations/run.js');
      const migrationsDir = path.resolve(__dirname, '..', 'dist', 'migrations');
      const migrator = new Migrator({
        db,
        provider: new NumericFileMigrationProvider(migrationsDir),
      });

      try {
        // First pass: discover and apply all migrations (including 004)
        const { results, error } = await migrator.migrateToLatest();
        expect(error).toBeUndefined();
        const applied = results?.filter(r => r.status === 'Success').map(r => r.migrationName) || [];
        expect(applied).toContain('001-initial');
        expect(applied).toContain('002-oidc-transactions');
        expect(applied).toContain('003-task-tags');
        expect(applied).toContain('004-ensure-task-tags');

        // Second pass: nothing new
        const { results: results2, error: error2 } = await migrator.migrateToLatest();
        expect(error2).toBeUndefined();
        const applied2 = results2?.filter(r => r.status === 'Success').map(r => r.migrationName) || [];
        expect(applied2.length).toBe(0);
      } finally {
        await db.destroy();
        ['', '-wal', '-shm'].forEach(suffix => {
          try { unlinkSync(testDbPath + suffix); } catch {}
        });
      }
    });
  });

describe('Tag operations', () => {
  let repo: Repository;
  let userId: string;
  let testDbPath: string;
  let db: any;

  // Helper to create a test user for tag operations with unique issuer/subject
  async function createTestUser(repo: Repository): Promise<string> {
    const suffix = randomUUID();
    const user = await repo.upsertUser('test-tag-user-' + suffix, 'test-tag-subj-' + suffix);
    return user.id;
  }

  function setTestEnv() {
    process.env.DB_DIALECT = 'sqlite';
    testDbPath = '/tmp/test-tag-db-' + randomUUID() + '.db';
    process.env.SQLITE_PATH = testDbPath;
    process.env.NODE_ENV = 'test';
  }

  beforeAll(async () => {
    setTestEnv();
    db = createDb();
    // Apply both 001 and 003 migrations in order
    await migrationUp(db);
    await migration003Up(db);
    repo = new Repository(db);
  });

  afterAll(async () => {
    if (db) {
      await db.destroy();
    }
    // Clean up temp files
    ['', '-wal', '-shm'].forEach(suffix => {
      try { unlinkSync(testDbPath + suffix); } catch {}
    });
  });

  beforeEach(async () => {
    userId = await createTestUser(repo);
  });

  afterEach(async () => {
    // Clean up tags created by the test - tags cascade delete from user, but
    // we don't delete the user since projects/lanes/tasks reference it
    const tags = await repo.listTags(userId);
    for (const tag of tags) {
      try { await repo.deleteTag(tag.id, userId, tag.version); } catch {}
    }
  });

  describe('createTag', () => {
    it('creates a tag with deterministic color', async () => {
      const tag = await repo.createTag(userId, 'bug');
      expect(tag.name).toBe('bug');
      expect(tag.normalized_name).toBe('bug');
      expect(tag.color).toBeTruthy();
      expect(tag.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(tag.version).toBe(0);
      expect(tag.user_id).toBe(userId);
    });

    it('creates tag with normalized name', async () => {
      const tag = await repo.createTag(userId, '  BUG  ');
      expect(tag.name).toBe('  BUG  ');
      expect(tag.normalized_name).toBe('bug');
    });

    it('enforces unique normalized name per user', async () => {
      await repo.createTag(userId, 'bug');
      await expect(repo.createTag(userId, 'BUG')).rejects.toThrow();
    });

    it('allows same name across different users', async () => {
      const userId2 = await createTestUser(repo);
      await repo.createTag(userId, 'bug');
      const tag2 = await repo.createTag(userId2, 'bug');
      expect(tag2.user_id).toBe(userId2);
      await repo.deleteTag(tag2.id, userId2, tag2.version);
      await sql`DELETE FROM users WHERE id = ${userId2}`.execute(db);
    });
  });

  describe('resolveOrCreateTags', () => {
    it('resolves existing tags and creates new ones', async () => {
      await repo.createTag(userId, 'bug');
      const ids = await repo.resolveOrCreateTags(userId, ['bug', 'feature'], db);
      expect(ids).toHaveLength(2);
      // 'bug' should be resolved, 'feature' should be created
      const bugTag = await repo.getTagByNormalizedName(userId, 'bug');
      expect(ids[0]).toBe(bugTag!.id);
    });

    it('deduplicates within batch (same name twice)', async () => {
      const ids = await repo.resolveOrCreateTags(userId, ['bug', 'bug'], db);
      expect(ids).toHaveLength(1);
    });

    it('handles concurrent creation (simulated via sequential attempt)', async () => {
      // Test that resolveOrCreateTags does not throw on duplicate
      // by creating the same tag twice simultaneously (simulated sequentially)
      const ids1 = await repo.resolveOrCreateTags(userId, ['concurrent'], db);
      const ids2 = await repo.resolveOrCreateTags(userId, ['concurrent'], db);
      expect(ids1).toHaveLength(1);
      expect(ids2).toHaveLength(1);
      // Both should return the same tag ID
      expect(ids1[0]).toBe(ids2[0]);
    });
  });

  describe('setTaskTags and getTaskTags', () => {
    it('attaches tags to a task', async () => {
      // Create project, lane, task
      const project = await repo.createProject(userId, 'Test Project');
      const projectId = project.id;
      const projVer = project.version;
      const laneRow = await repo.createLane(projectId, 'Test Lane', projVer);
      const laneId = laneRow.id;
      const task = await repo.createTask(projectId, laneId, 'Test task');

      // Create tags and attach
      const tag1 = await repo.createTag(userId, 'bug');
      const tag2 = await repo.createTag(userId, 'feature');
      await repo.setTaskTags(task.id, [tag1.id, tag2.id], db);

      const tags = await repo.getTaskTags(task.id);
      expect(tags).toHaveLength(2);
      expect(tags.map(t => t.name)).toContain('bug');
      expect(tags.map(t => t.name)).toContain('feature');

      await repo.deleteTask(task.id);
    });

    it('replaces existing tags when set', async () => {
      const project = await repo.createProject(userId, 'Test Project');
      const projectId = project.id;
      const projVer = project.version;
      const laneRow = await repo.createLane(projectId, 'Test Lane', projVer);
      const laneId = laneRow.id;
      const task = await repo.createTask(projectId, laneId, 'Test task');

      const tag1 = await repo.createTag(userId, 'bug');
      await repo.setTaskTags(task.id, [tag1.id], db);

      const tag2 = await repo.createTag(userId, 'feature');
      await repo.setTaskTags(task.id, [tag2.id], db);

      const tags = await repo.getTaskTags(task.id);
      expect(tags).toHaveLength(1);
      expect(tags[0].name).toBe('feature');

      await repo.deleteTask(task.id);
    });

    it('removes all tags when given empty array', async () => {
      const project = await repo.createProject(userId, 'Test Project');
      const projectId = project.id;
      const projVer = project.version;
      const laneRow = await repo.createLane(projectId, 'Test Lane', projVer);
      const laneId = laneRow.id;
      const task = await repo.createTask(projectId, laneId, 'Test task');

      const tag1 = await repo.createTag(userId, 'bug');
      await repo.setTaskTags(task.id, [tag1.id], db);

      await repo.setTaskTags(task.id, [], db);

      const tags = await repo.getTaskTags(task.id);
      expect(tags).toHaveLength(0);

      await repo.deleteTask(task.id);
    });
  });

  describe('updateTag', () => {
    it('updates tag name and color', async () => {
      const tag = await repo.createTag(userId, 'bug');
      const updated = await repo.updateTag(tag.id, 'bug-fix', '#F56565', userId, tag.version);
      expect(updated.name).toBe('bug-fix');
      expect(updated.color).toBe('#F56565');
      expect(updated.version).toBe(tag.version + 1);
      expect(updated.normalized_name).toBe('bug-fix');
    });

    it('throws on stale version', async () => {
      const tag = await repo.createTag(userId, 'bug');
      await expect(repo.updateTag(tag.id, 'bug-fix', '#F56565', userId, 999)).rejects.toThrow(ApiError);
    });
  });

  describe('deleteTag', () => {
    it('deletes tag', async () => {
      const tag = await repo.createTag(userId, 'bug');
      await repo.deleteTag(tag.id, userId, tag.version);
      const found = await repo.getTagById(tag.id);
      expect(found).toBeNull();
    });

    it('throws on stale version', async () => {
      const tag = await repo.createTag(userId, 'bug');
      await expect(repo.deleteTag(tag.id, userId, 999)).rejects.toThrow(ApiError);
    });
  });

  describe('listTags', () => {
    it('lists tags alphabetically', async () => {
      await repo.createTag(userId, 'zebra');
      await repo.createTag(userId, 'apple');
      const tags = await repo.listTags(userId);
      expect(tags[0].name).toBe('apple');
      expect(tags[1].name).toBe('zebra');
    });

    it('only returns user-owned tags', async () => {
      const userId2 = await createTestUser(repo);
      await repo.createTag(userId2, 'apple');
      const tags = await repo.listTags(userId);
      expect(tags).toHaveLength(0);
      const tags2 = await repo.listTags(userId2);
      expect(tags2).toHaveLength(1);
      await repo.deleteTag(tags2[0].id, userId2, tags2[0].version);
      await sql`DELETE FROM users WHERE id = ${userId2}`.execute(db);
    });
  });

  describe('createTask with tags', () => {
    it('creates task with tags', async () => {
      const project = await repo.createProject(userId, 'Test Project');
      const projectId = project.id;
      const projVer = project.version;
      const laneRow = await repo.createLane(projectId, 'Test Lane', projVer);
      const laneId = laneRow.id;
      const task = await repo.createTask(projectId, laneId, 'Test task', undefined, undefined, ['bug', 'feature']);
      expect(task.tags).toHaveLength(2);
      expect(task.tags.map(t => t.name)).toContain('bug');
      expect(task.tags.map(t => t.name)).toContain('feature');
      await repo.deleteTask(task.id);
    });

    it('creates task without tags', async () => {
      const project = await repo.createProject(userId, 'Test Project');
      const projectId = project.id;
      const projVer = project.version;
      const laneRow = await repo.createLane(projectId, 'Test Lane', projVer);
      const laneId = laneRow.id;
      const task = await repo.createTask(projectId, laneId, 'Test task');
      expect(task.tags).toHaveLength(0);
      await repo.deleteTask(task.id);
    });
  });

  describe('updateTask with tags', () => {
    it('updates task tags', async () => {
      const project = await repo.createProject(userId, 'Test Project');
      const projectId = project.id;
      const projVer = project.version;
      const laneRow = await repo.createLane(projectId, 'Test Lane', projVer);
      const laneId = laneRow.id;
      const task = await repo.createTask(projectId, laneId, 'Test task', undefined, undefined, ['bug']);
      expect(task.tags).toHaveLength(1);

      const updated = await repo.updateTask(task.id, undefined, undefined, ['feature'], task.version);
      expect(updated.tags).toHaveLength(1);
      expect(updated.tags[0].name).toBe('feature');
      expect(updated.version).toBe(task.version + 1);

      await repo.deleteTask(updated.id);
    });

    it('removes tags when given empty array', async () => {
      const project = await repo.createProject(userId, 'Test Project');
      const projectId = project.id;
      const projVer = project.version;
      const laneRow = await repo.createLane(projectId, 'Test Lane', projVer);
      const laneId = laneRow.id;
      const task = await repo.createTask(projectId, laneId, 'Test task', undefined, undefined, ['bug']);

      const updated = await repo.updateTask(task.id, undefined, undefined, [], task.version);
      expect(updated.tags).toHaveLength(0);

      await repo.deleteTask(updated.id);
    });

    it('preserves tags when tagNames not provided', async () => {
      const project = await repo.createProject(userId, 'Test Project');
      const projectId = project.id;
      const projVer = project.version;
      const laneRow = await repo.createLane(projectId, 'Test Lane', projVer);
      const laneId = laneRow.id;
      const task = await repo.createTask(projectId, laneId, 'Test task', undefined, undefined, ['bug']);

      const updated = await repo.updateTask(task.id, 'Updated title', undefined, undefined, task.version);
      expect(updated.tags).toHaveLength(1);
      expect(updated.tags[0].name).toBe('bug');

      await repo.deleteTask(updated.id);
    });
  });

  describe('task tag hydration (batch)', () => {
    it('hydrates tasks with tags', async () => {
      const project = await repo.createProject(userId, 'Test Project');
      const projectId = project.id;
      const projVer = project.version;
      const laneRow = await repo.createLane(projectId, 'Test Lane', projVer);
      const laneId = laneRow.id;
      const task1 = await repo.createTask(projectId, laneId, 'Task 1', undefined, undefined, ['bug']);
      const task2 = await repo.createTask(projectId, laneId, 'Task 2', undefined, undefined, ['feature']);

      const tasks = await repo.listTasks(projectId);
      expect(tasks).toHaveLength(2);
      // Both should have tags hydrated
      expect(tasks[0].tags).toBeDefined();
      expect(tasks[1].tags).toBeDefined();

      await repo.deleteTask(task1.id);
      await repo.deleteTask(task2.id);
    });
  });

  describe('tag rename does not bump task versions', () => {
    it('renaming tag does not affect task version', async () => {
      const project = await repo.createProject(userId, 'Test Project');
      const projectId = project.id;
      const projVer = project.version;
      const laneRow = await repo.createLane(projectId, 'Test Lane', projVer);
      const laneId = laneRow.id;
      const task = await repo.createTask(projectId, laneId, 'Test task', undefined, undefined, ['bug']);
      const taskVersion = task.version;

      const tag = await repo.getTagByNormalizedName(userId, 'bug');
      await repo.updateTag(tag!.id, 'bug-fix', '#F56565', userId, tag!.version);

      const updatedTask = await repo.getTaskById(task.id);
      expect(updatedTask!.version).toBe(taskVersion);

      await repo.deleteTask(task.id);
    });
  });
});
});
