import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { defineConfig } from 'drizzle-kit';

try {
  const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../.env');
  for (const [key, value] of Object.entries(parseEnv(readFileSync(envPath, 'utf8'))))
    if (process.env[key] === undefined) process.env[key] = value;
} catch {
  /* .env is optional in CI and production migration environments. */
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://bagseven:bagseven@localhost:5432/bagseven',
  },
  strict: true,
  verbose: true,
});
