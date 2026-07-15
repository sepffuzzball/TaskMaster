import { randomUUID } from 'crypto';

// Pre-set environment for all tests - but each test can override with its own SQLITE_PATH
process.env.APP_ORIGIN = 'http://localhost:3000';
process.env.OIDC_ISSUER = 'http://localhost:9999';
process.env.OIDC_CLIENT_ID = 'test';
process.env.OIDC_CLIENT_SECRET = 'test';
process.env.OIDC_REDIRECT_URI = 'http://localhost:3000/api/v1/auth/callback';
process.env.DB_DIALECT = 'sqlite';
process.env.SQLITE_PATH = '/tmp/test-taskmaster-' + randomUUID() + '.db';
process.env.NODE_ENV = 'test';
