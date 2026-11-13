import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { McpConsoleConsent } from '@bagseven/db';
import { consoleDatabase } from './account-profiles';
export const mcpConsoleConsent = () => new McpConsoleConsent(consoleDatabase());
export function mcpIssuer() {
  const path = resolve(process.cwd(), '../../.env');
  const local = process.env.NODE_ENV !== 'production' && existsSync(path) ? parseEnv(readFileSync(path, 'utf8')).BAGSEVEN_MCP_PUBLIC_URL : undefined;
  const url = new URL(local || process.env.BAGSEVEN_MCP_PUBLIC_URL || '');
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error('MCP origin is not configured');
  return url.origin;
}
