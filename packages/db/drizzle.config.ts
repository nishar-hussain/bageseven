import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'drizzle-kit';

try {
  const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../.env');
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator > 0 && process.env[line.slice(0, separator)] === undefined) process.env[line.slice(0, separator)] = line.slice(separator + 1);
  }
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
