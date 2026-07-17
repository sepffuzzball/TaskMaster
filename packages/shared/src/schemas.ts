import { z } from 'zod';

// --- Base Types ---

export const uuid = z.string().uuid();
export type Uuid = z.infer<typeof uuid>;

export const iso8601 = z.string().datetime({ offset: true });
export type Iso8601 = z.infer<typeof iso8601>;

export const version = z.number().int().nonnegative();
export type Version = z.infer<typeof version>;

// --- API Error Scheme ---

export const ApiErrorCode = z.enum([
  'STALE_VERSION',
  'NOT_FOUND',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'BAD_REQUEST',
  'CONFLICT',
  'INTERNAL_ERROR',
  'OIDC_TOKEN_EXCHANGE_FAILED',
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

export const ApiError = z.object({
  code: ApiErrorCode,
  message: z.string(),
  details: z.any().optional(),
});
export type ApiError = z.infer<typeof ApiError>;

export const ApiErrors = z.object({
  errors: z.array(ApiError),
});
export type ApiErrors = z.infer<typeof ApiErrors>;

// --- Resource Models ---

export const User = z.object({
  issuer: z.string(),
  subject: uuid,
  createdAt: iso8601,
  updatedAt: iso8601,
});
export type User = z.infer<typeof User>;

export const Session = z.object({
  id: uuid,
  userId: uuid,
  expiresAt: iso8601,
  createdAt: iso8601,
});
export type Session = z.infer<typeof Session>;

export const Project = z.object({
  id: uuid,
  ownerId: uuid,
  name: z.string().max(100),
  description: z.string().max(500).optional(),
  archivedAt: iso8601.optional(),
  rank: z.number().int().nonnegative(),
  version: version,
  createdAt: iso8601,
  updatedAt: iso8601,
});
export type Project = z.infer<typeof Project>;

export const Lane = z.object({
  id: uuid,
  projectId: uuid,
  name: z.string().max(80),
  rank: z.number().int().nonnegative(),
  version: version,
  createdAt: iso8601,
  updatedAt: iso8601,
});
export type Lane = z.infer<typeof Lane>;

export const Tag = z.object({
  id: uuid,
  name: z.string().max(32).regex(/^[0-9A-Za-z\-_]+$/, { message: 'Tag name must contain ASCII letters, digits, hyphen or underscore only' }),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, { message: 'Color must be a valid hex color (#RRGGBB)' }),
  version: version,
  createdAt: iso8601,
  updatedAt: iso8601,
});
export type Tag = z.infer<typeof Tag>;

export const Task = z.object({
  id: uuid,
  projectId: uuid,
  laneId: uuid,
  title: z.string().max(200),
  description: z.string().max(1000).optional(),
  rank: z.number().int().nonnegative(),
  version: version,
  tags: z.array(Tag).default([]),
  createdAt: iso8601,
  updatedAt: iso8601,
});
export type Task = z.infer<typeof Task>;

export const ApiToken = z.object({
  id: uuid,
  ownerId: uuid,
  name: z.string().max(80),
  prefix: z.string().max(8),
  scopes: z.array(z.enum(['read', 'write'])),
  expiresAt: iso8601.optional(),
  revokedAt: iso8601.optional(),
  lastUsedAt: iso8601.optional(),
  createdAt: iso8601,
  updatedAt: iso8601,
});
export type ApiToken = z.infer<typeof ApiToken>;

// --- Command Inputs ---

export const CreateProjectInput = z.object({
  name: z.string().max(100),
  description: z.string().max(500).optional(),
});
export type CreateProjectInput = z.infer<typeof CreateProjectInput>;

export const UpdateProjectInput = z.object({
  name: z.string().max(100).optional(),
  description: z.string().max(500).optional(),
  expectedVersion: version,
});
export type UpdateProjectInput = z.infer<typeof UpdateProjectInput>;

export const CreateLaneInput = z.object({
  name: z.string().max(80),
  rank: z.number().int().nonnegative().optional(),
  expectedProjectVersion: version,
});
export type CreateLaneInput = z.infer<typeof CreateLaneInput>;

export const UpdateLaneInput = z.object({
  name: z.string().max(80).optional(),
  rank: z.number().int().nonnegative().optional(),
  expectedVersion: version,
  expectedProjectVersion: version,
});
export type UpdateLaneInput = z.infer<typeof UpdateLaneInput>;

export const CreateTaskInput = z.object({
  title: z.string().max(200),
  description: z.string().max(1000).optional(),
  tagNames: z.array(z.string().max(32).regex(/^[0-9A-Za-z\-_]+$/)).max(10).optional(),
});
export type CreateTaskInput = z.infer<typeof CreateTaskInput>;

export const UpdateTaskInput = z.object({
  title: z.string().max(200).optional(),
  description: z.string().max(1000).optional(),
  tagNames: z.array(z.string().max(32).regex(/^[0-9A-Za-z\-_]+$/)).max(10).optional(),
  expectedVersion: version,
});
export type UpdateTaskInput = z.infer<typeof UpdateTaskInput>;

export const MoveTaskInput = z.object({
  destinationProjectId: uuid,
  destinationLaneId: uuid.optional(),
  beforeTaskId: uuid.optional(),
  afterTaskId: uuid.optional(),
  expectedVersion: version,
});
export type MoveTaskInput = z.infer<typeof MoveTaskInput>;

export const MoveTaskToNewProjectInput = z.object({
  projectName: z.string().max(100),
  expectedVersion: version,
});
export type MoveTaskToNewProjectInput = z.infer<typeof MoveTaskToNewProjectInput>;

export const ReorderLanesInput = z.object({
  laneIds: z.array(uuid),
  expectedProjectVersion: version,
});
export type ReorderLanesInput = z.infer<typeof ReorderLanesInput>;

export const DeleteLaneInput = z.object({
  targetLaneId: uuid,
  expectedProjectVersion: version,
});
export type DeleteLaneInput = z.infer<typeof DeleteLaneInput>;

export const UpdateTagInput = z.object({
  name: z.string().max(32).regex(/^[0-9A-Za-z\-_]+$/).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, { message: 'Color must be a valid hex color (#RRGGBB)' }).optional(),
  expectedVersion: version,
});
export type UpdateTagInput = z.infer<typeof UpdateTagInput>;

// --- Auth Inputs ---

export const LoginInput = z.object({});
export type LoginInput = z.infer<typeof LoginInput>;

export const CallbackInput = z.object({
  code: z.string(),
  state: z.string(),
});
export type CallbackInput = z.infer<typeof CallbackInput>;

export const CreateApiTokenInput = z.object({
  name: z.string().max(80),
  scopes: z.array(z.enum(['read', 'write'])),
  expiresInDays: z.number().int().positive().optional(),
});
export type CreateApiTokenInput = z.infer<typeof CreateApiTokenInput>;

// --- AI Breakdown Input/Output ---

export const AiBreakdownInput = z.object({
  title: z.string().max(200),
  context: z.string().max(2000).optional(),
});
export type AiBreakdownInput = z.infer<typeof AiBreakdownInput>;

export const AiBreakdownCard = z.object({
  title: z.string().max(200),
  description: z.string().max(1000).optional(),
});
export type AiBreakdownCard = z.infer<typeof AiBreakdownCard>;

export const AiBreakdownOutput = z.object({
  cards: z.array(AiBreakdownCard).max(12),
});
export type AiBreakdownOutput = z.infer<typeof AiBreakdownOutput>;
