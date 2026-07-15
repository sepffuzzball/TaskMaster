import { z } from 'zod';

const envSchema = z.object({
  APP_ORIGIN: z.string().url(),
  OIDC_ISSUER: z.string().url(),
  OIDC_CLIENT_ID: z.string(),
  OIDC_CLIENT_SECRET: z.string(),
  OIDC_REDIRECT_URI: z.string().url(),
  DB_DIALECT: z.enum(['sqlite', 'postgres']),
  SQLITE_PATH: z.string().optional(),
  DATABASE_URL: z.string().url().optional(),
  OPENAI_BASE_URL: z.string().url().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().optional(),
  SESSION_SECRET: z.string().min(32).optional(),
  DEV_AUTH_BYPASS: z.string().optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    throw new Error(`Invalid env vars: ${result.error.format()}`);
  }
  if (result.data.NODE_ENV === 'production' && result.data.DEV_AUTH_BYPASS) {
    throw new Error('DEV_AUTH_BYPASS must not be set in production');
  }
  return result.data;
}
