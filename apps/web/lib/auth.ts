import 'server-only';
import { betterAuth } from 'better-auth';
import { nextCookies } from 'better-auth/next-js';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-serverless';
import * as schema from './auth-schema';
import { remotePool } from './db';

async function createAuth() {
  if (process.env.NODE_ENV === 'production' && !process.env.BETTER_AUTH_SECRET) throw new Error('BETTER_AUTH_SECRET required');
  if (process.env.NODE_ENV === 'production' && !process.env.BETTER_AUTH_URL) throw new Error('BETTER_AUTH_URL required');
  if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
  const adapter = drizzleAdapter(drizzleNeon(remotePool(), { schema }), { provider: 'pg', schema });
  return betterAuth({
    database: adapter,
    secret: process.env.BETTER_AUTH_SECRET || 'local-development-only-melody-secret-change-before-deployment',
    baseURL: process.env.BETTER_AUTH_URL || (process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : undefined),
    socialProviders: process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? { google: { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET, prompt: 'select_account' } }
      : {},
    trustedOrigins: process.env.NODE_ENV === 'development'
      ? ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://192.168.100.30:3000']
      : [process.env.BETTER_AUTH_URL!],
    plugins: [nextCookies()],
  });
}
let authInstance: Awaited<ReturnType<typeof createAuth>> | undefined;
export async function getAuth() {
  if (!authInstance) authInstance = await createAuth();
  return authInstance;
}
