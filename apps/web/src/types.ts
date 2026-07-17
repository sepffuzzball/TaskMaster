export type User = {
  id: string;
  issuer: string;
  subject: string;
  createdAt: string;
  updatedAt: string;
};

export type Project = {
  id: string;
  ownerId: string;
  name: string;
  description?: string;
  archivedAt?: string;
  rank: number;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type Lane = {
  id: string;
  projectId: string;
  name: string;
  rank: number;
  autoCollapse: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type Tag = {
  id: string;
  name: string;
  color: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type Task = {
  id: string;
  projectId: string;
  laneId: string;
  title: string;
  description?: string;
  rank: number;
  version: number;
  tags: Tag[];
  createdAt: string;
  updatedAt: string;
};

export type ApiToken = {
  id: string;
  ownerId: string;
  name: string;
  prefix: string;
  scopes: ('read' | 'write')[];
  expiresAt?: string;
  revokedAt?: string;
  lastUsedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type ApiError = {
  code: string;
  message: string;
  details?: any;
};

export type ApiErrors = {
  errors: ApiError[];
};

export type ThemeName = 'tokyo-night' | 'latte' | 'frappe' | 'macchiato' | 'mocha';
