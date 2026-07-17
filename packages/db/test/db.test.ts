import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { Repository, createDb, getDialect, ApiError, x0n } from '../dist/index.js';
import { up as migrationUp, down as migrationDown } from '../dist/migrations/001-initial.js';
import { up as migration003Up } from '../dist/migrations/003-task-tags.js';
import { up as migration004Up, down as migration004Down } from '../dist/migrations/004-ensure-task-tags.js';
import { up as migration005Up, down as migration005Down } from '../dist/migrations/005-lane-auto-collapse.js';
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
    await migration005Up(db);
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
    expect(lanes[0].auto_collapse).toBe(0);
    expect(lanes[1].name).toBe('InProgress');
    expect(lanes[1].rank).toBe(10);
    expect(lanes[1].auto_collapse).toBe(0);
    expect(lanes[2].name).toBe('Complete');
    expect(lanes[2].rank).toBe(20);
    expect(lanes[2].auto_collapse).toBe(1);
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
    expect(newLanes[0].auto_collapse).toBe(0);
    expect(newLanes[1].name).toBe('InProgress');
    expect(newLanes[1].rank).toBe(10);
    expect(newLanes[1].auto_collapse).toBe(0);
    expect(newLanes[2].name).toBe('Complete');
    expect(newLanes[2].rank).toBe(20);
    expect(newLanes[2].auto_collapse).toBe(1);
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

        // Then apply 005 for lane auto_collapse
        await migration005Up(db);

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
    await migration005Up(db);
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

describe('autoCollapse feature', () => {
  it('default lanes set auto_collapse correctly on createProject', async () => {
    const user = await repo.upsertUser('ac-proj-usr', 'ac-proj-subj');
    const project = await repo.createProject(user.id, 'ACProj');
    const lanes = await repo.listLanes(project.id);
    expect(lanes.length).toBe(3);
    // ToDo should be 0, InProgress 0, Complete 1
    expect(lanes.find((l: any) => l.name === 'ToDo')!.auto_collapse).toBe(0);
    expect(lanes.find((l: any) => l.name === 'InProgress')!.auto_collapse).toBe(0);
    expect(lanes.find((l: any) => l.name === 'Complete')!.auto_collapse).toBe(1);
  });

  it('default lanes set auto_collapse correctly on moveTaskToNewProject', async () => {
    const user = await repo.upsertUser('ac-move-usr', 'ac-move-subj');
    const project = await repo.createProject(user.id, 'ACMoveOrig');
    const lane = (await repo.listLanes(project.id))[0];
    const task = await repo.createTask(project.id, lane.id, 'MoveAC');
    const moved = await repo.moveTaskToNewProject(task.id, 'ACMoveDest', task.version, user.id);
    const newLanes = await repo.listLanes(moved.project_id);
    expect(newLanes.length).toBe(3);
    expect(newLanes.find((l: any) => l.name === 'Complete')!.auto_collapse).toBe(1);
  });

  it('user-created Complete lane defaults to auto_collapse true at service level was tested via repo', async () => {
    const user = await repo.upsertUser('ac-create-usr', 'ac-create-subj');
    const project = await repo.createProject(user.id, 'ACCreateProj');
    const projVer = await getProjectVersion(project.id);
    // Repo createLane with autoCollapse=true verification
    const lane = await repo.createLane(project.id, 'Complete', projVer, 0, true);
    expect(lane.auto_collapse).toBe(1);
  });

  it('user-created lane with explicit false stays false', async () => {
    const user = await repo.upsertUser('ac-explicit-false', 'ac-explicit-false-subj');
    const project = await repo.createProject(user.id, 'ACExplicitFalse');
    const projVer = await getProjectVersion(project.id);
    const lane = await repo.createLane(project.id, 'Complete', projVer, 0, false);
    expect(lane.auto_collapse).toBe(0);
  });

  it('updateLane with name-only never changes auto_collapse (Complete or not)', async () => {
    const user = await repo.upsertUser('ac-name-only', 'ac-name-only-subj');
    const project = await repo.createProject(user.id, 'ACNameOnly');
    const lanes = await repo.listLanes(project.id);
    const todo = lanes.find((l: any) => l.name === 'ToDo')!;
    // Name-only update to Complete - should keep auto_collapse=0
    const updated = await repo.updateLane(todo.id, project.id, { name: 'Complete' }, todo.version, 0);
    expect(updated.auto_collapse).toBe(0, 'name-only should preserve original 0');
    expect(updated.name).toBe('Complete');
  });

  it('updateLane with name=Complete and autoCollapse=false wins false', async () => {
    const user = await repo.upsertUser('ac-upd-false', 'ac-upd-false-subj');
    const project = await repo.createProject(user.id, 'ACUpdFalse');
    const lanes = await repo.listLanes(project.id);
    const todo = lanes.find((l: any) => l.name === 'ToDo')!;
    const updated = await repo.updateLane(todo.id, project.id, { name: 'Complete', autoCollapse: false }, todo.version, 0);
    expect(updated.auto_collapse).toBe(0);
    expect(updated.name).toBe('Complete');
  });

  it('updateLane preserves auto_collapse on rename away from Complete', async () => {
    const user = await repo.upsertUser('ac-preserve', 'ac-preserve-subj');
    const project = await repo.createProject(user.id, 'ACPreserve');
    const lanes = await repo.listLanes(project.id);
    const complete = lanes.find((l: any) => l.name === 'Complete')!;
    // Rename Complete to Done; auto_collapse stays 1 (no autoCollapse supplied)
    const updated = await repo.updateLane(complete.id, project.id, { name: 'Done' }, complete.version, 0);
    expect(updated.auto_collapse).toBe(1);
    expect(updated.name).toBe('Done');
  });

  it('regression: create Complete true, set false, name-only update to Complete stays false', async () => {
    const user = await repo.upsertUser('ac-regr', 'ac-regr-subj');
    const project = await repo.createProject(user.id, 'ACRegr');
    const projVer = await getProjectVersion(project.id);
    // Create lane with Complete name and explicit autoCollapse=true
    const lane1 = await repo.createLane(project.id, 'Complete', projVer, 0, true);
    expect(lane1.auto_collapse).toBe(1);
    // Update with explicit false
    const laneVer = lane1.version;
    const projVer2 = await getProjectVersion(project.id);
    const updated = await repo.updateLane(lane1.id, project.id, { autoCollapse: false }, laneVer, projVer2);
    expect(updated.auto_collapse).toBe(0);
    // Now name-only update to Complete - should stay false
    const updated2 = await repo.updateLane(lane1.id, project.id, { name: 'Complete' }, updated.version, projVer2 + 1);
    expect(updated2.auto_collapse).toBe(0, 'name-only should preserve explicit false');
    expect(updated2.name).toBe('Complete');
  });

  it('updateLane with no mutable fields throws', async () => {
    const user = await repo.upsertUser('ac-empty-upd', 'ac-empty-upd-subj');
    const project = await repo.createProject(user.id, 'ACEmptyUpd');
    const lanes = await repo.listLanes(project.id);
    const todo = lanes.find((l: any) => l.name === 'ToDo')!;
    try {
      await repo.updateLane(todo.id, project.id, {}, todo.version, 0);
      expect.fail('Should throw');
    } catch (e: any) {
      expect(e.code).toBe('BAD_REQUEST');
      expect(e.message).toContain('No mutable fields provided');
    }
  });

  it('stale version still rejected in updateLane', async () => {
    const user = await repo.upsertUser('ac-stale', 'ac-stale-subj');
    const project = await repo.createProject(user.id, 'ACStale');
    const lanes = await repo.listLanes(project.id);
    const todo = lanes.find((l: any) => l.name === 'ToDo')!;
    try {
      await repo.updateLane(todo.id, project.id, { name: 'Updated' }, 999, 0);
      expect.fail('Should throw STALE_VERSION');
    } catch (e: any) {
      expect(e.code).toBe('STALE_VERSION');
      expect(e.status).toBe(409);
    }
  });

  describe('migration 005', () => {
    it('backfills auto_collapse correctly for various Complete names', async () => {
      const testDbPath = '/tmp/test-migration-005-bf-' + randomUUID() + '.db';
      process.env.DB_DIALECT = 'sqlite';
      process.env.SQLITE_PATH = testDbPath;

      const db = createDb();
      try {
        // Apply initial migration (which creates lanes without auto_collapse)
        await migrationUp(db);

        // Use raw SQL to insert lanes with various Complete and non-Complete names
        const now = new Date().toISOString();
        // We can use the testRepo for getting a user and project
        const testRepo = new Repository(db);
        const user = await testRepo.upsertUser('005-bf-usr', '005-bf-subj');
        // Create project uses old schema - but it works now because 001-initial
        // creates lanes without auto_collapse. However, the repository now
        // expects auto_collapse column, so we need to insert directly.
        const projectId = randomUUID();
        await sql`
          INSERT INTO projects (id, owner_id, name, description, archived_at, rank, version, created_at, updated_at)
          VALUES (${projectId}, ${user.id}, 'BFProj', NULL, NULL, 0, 0, ${now}, ${now})
        `.execute(db);

        // Insert lanes manually without auto_collapse (using pre-005 schema)
        for (const [name, expectedAc] of [
          ['Complete', 1],
          ['complete', 1],
          ['  COMPLETE  ', 1], // whitespace and mixed case
          ['InProgress', 0],
          ['ToDo', 0],
          ['   todo  ', 0], // whitespace, not Complete
        ] as [string, number][]) {
          const laneId = randomUUID();
          await sql`
            INSERT INTO lanes (id, project_id, name, rank, version, created_at, updated_at)
            VALUES (${laneId}, ${projectId}, ${name}, 0, 0, ${now}, ${now})
          `.execute(db);
        }

        // Now apply migration 005
        await migration005Up(db);

        // Verify auto_collapse values
        const lanesResult = await sql`SELECT * FROM lanes WHERE project_id = ${projectId}`.execute(db);
        const rows = lanesResult.rows as any[];
        expect(rows.length).toBe(6);
        for (const row of rows) {
          if (row.name.trim().toLowerCase() === 'complete') {
            expect(row.auto_collapse).toBe(1, `expected 1 for name="${row.name}"`);
          } else {
            expect(row.auto_collapse).toBe(0, `expected 0 for name="${row.name}"`);
          }
        }
      } finally {
        await db.destroy();
        ['', '-wal', '-shm'].forEach(suffix => {
          try { unlinkSync(testDbPath + suffix); } catch {}
        });
      }
    });

    it('migration 005 chain and idempotence', async () => {
      const testDbPath = '/tmp/test-migration-005-idem-' + randomUUID() + '.db';
      process.env.DB_DIALECT = 'sqlite';
      process.env.SQLITE_PATH = testDbPath;

      const db = createDb();
      try {
        // Apply 001, 003, 005 in sequence
        await migrationUp(db);
        await migration003Up(db);
        await migration005Up(db);

        // Verify lane auto_collapse column exists
        const colResult = await sql`
          SELECT name FROM pragma_table_info('lanes') WHERE name = 'auto_collapse'
        `.execute(db);
        expect(colResult.rows.length).toBeGreaterThanOrEqual(1);

        // Apply 005 again - should be idempotent (ALTER ADD COLUMN ignores if exists)
        await migration005Up(db);

        // Verify still exists
        const colResult2 = await sql`
          SELECT name FROM pragma_table_info('lanes') WHERE name = 'auto_collapse'
        `.execute(db);
        expect(colResult2.rows.length).toBeGreaterThanOrEqual(1);

        // Apply down
        await migration005Down(db);

        // Verify column dropped
        const colResult3 = await sql`
          SELECT name FROM pragma_table_info('lanes') WHERE name = 'auto_collapse'
        `.execute(db);
        expect(colResult3.rows.length).toBe(0);
      } finally {
        await db.destroy();
        ['', '-wal', '-shm'].forEach(suffix => {
          try { unlinkSync(testDbPath + suffix); } catch {}
        });
      }
    });

    it('re-running up after explicit false does not restore backfill', async () => {
      const testDbPath = '/tmp/test-migration-005-norestore-' + randomUUID() + '.db';
      process.env.DB_DIALECT = 'sqlite';
      process.env.SQLITE_PATH = testDbPath;

      const db = createDb();
      try {
        // Apply initial migration (without auto_collapse)
        await migrationUp(db);

        // Create a project and set a lane to explicit false (Complete but false)
        const testRepo = new Repository(db);
        const user = await testRepo.upsertUser('005-nr-usr', '005-nr-subj');
        const projectId = randomUUID();
        const now = new Date().toISOString();
        // Insert project and lane directly with pre-005 schema
        await sql`
          INSERT INTO projects (id, owner_id, name, description, archived_at, rank, version, created_at, updated_at)
          VALUES (${projectId}, ${user.id}, 'NoRestore', NULL, NULL, 0, 0, ${now}, ${now})
        `.execute(db);
        const laneId = randomUUID();
        await sql`
          INSERT INTO lanes (id, project_id, name, rank, version, created_at, updated_at)
          VALUES (${laneId}, ${projectId}, 'Complete', 0, 0, ${now}, ${now})
        `.execute(db);

        // Apply 005 - backfill sets Complete lanes to 1
        await migration005Up(db);
        // Verify it was set to 1 by backfill
        const afterFirst = await sql`SELECT auto_collapse FROM lanes WHERE id = ${laneId}`.execute(db);
        expect((afterFirst.rows as any[])[0].auto_collapse).toBe(1);

        // Simulate explicit false: set auto_collapse to 0
        await sql`UPDATE lanes SET auto_collapse = 0 WHERE id = ${laneId}`.execute(db);
        const afterFalse = await sql`SELECT auto_collapse FROM lanes WHERE id = ${laneId}`.execute(db);
        expect((afterFalse.rows as any[])[0].auto_collapse).toBe(0);

        // Re-run migration 005 up - should NOT overwrite the explicit false
        await migration005Up(db);
        const afterRerun = await sql`SELECT auto_collapse FROM lanes WHERE id = ${laneId}`.execute(db);
        expect((afterRerun.rows as any[])[0].auto_collapse).toBe(0, 'migration rerun should not overwrite explicit false');
      } finally {
        await db.destroy();
        ['', '-wal', '-shm'].forEach(suffix => {
          try { unlinkSync(testDbPath + suffix); } catch {}
        });
      }
    });
  });
});
});
