import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NextResponse } from 'next/server';
import { getSession } from '../../../../lib/auth';

function rootEnvPath(): string {
  return resolve(process.cwd(), '../../.env');
}

function readEnvWorker(): string {
  const fromProcess = process.env.BAGSEVEN_MCP_WORKER?.trim();
  if (fromProcess) return fromProcess;
  const path = rootEnvPath();
  if (!existsSync(path)) return '';
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.startsWith('BAGSEVEN_MCP_WORKER=')) return line.slice('BAGSEVEN_MCP_WORKER='.length).trim();
  }
  return '';
}

function upsertEnvWorker(worker: string): void {
  const path = rootEnvPath();
  if (!existsSync(path)) return;
  const lines = readFileSync(path, 'utf8').split('\n');
  let found = false;
  const next = lines.map((line) => {
    if (line.startsWith('BAGSEVEN_MCP_WORKER=')) {
      found = true;
      return `BAGSEVEN_MCP_WORKER=${worker}`;
    }
    return line;
  });
  if (!found) next.push(`BAGSEVEN_MCP_WORKER=${worker}`);
  writeFileSync(path, next.join('\n'));
  process.env.BAGSEVEN_MCP_WORKER = worker;
}

function configs(worker: string) {
  const daemon = process.env.DAEMON_URL ?? 'http://127.0.0.1:4001';
  const root = resolve(process.cwd(), '../..');
  const cmd = `BAGSEVEN_MCP_WORKER=${worker} BAGSEVEN_MCP_PORT=4009 DAEMON_URL=${daemon} pnpm bagseven-mcp`;
  const cursorMcp = {
    mcpServers: {
      bagseven: {
        command: 'pnpm',
        args: ['bagseven-mcp'],
        cwd: root,
        env: {
          BAGSEVEN_MCP_WORKER: worker,
          DAEMON_URL: daemon,
          DAEMON_AUTH_TOKEN: process.env.DAEMON_AUTH_TOKEN ? '(from .env — do not paste into chat)' : '',
        },
      },
    },
  };
  return { cmd, cursorMcp, daemon };
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const worker = readEnvWorker();
  return NextResponse.json({
    worker: worker || null,
    ready: Boolean(worker),
    tools: [
      'bagseven_status',
      'bagseven_search',
      'bagseven_fetch',
      'bagseven_spawn',
      'grant_status',
      'check_entitlement',
      'consume_entitlement',
      'mint_with_world',
      'buy_credits',
      'create_checkout_session',
      'paid_run',
      'cancel_renewal',
      'explain_denial',
    ],
    auth: {
      human: 'World-primary dashboard login. Email OTP is verify-later. World still gates mint uniqueness.',
      agent:
        'External agents never hold World credentials. They connect via MCP bound to BAGSEVEN_MCP_WORKER; daemon auth is DAEMON_AUTH_TOKEN. Dual-gate still requires a living Arkiv grant minted by a human.',
    },
    ...(worker ? configs(worker) : {}),
  });
}

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  let worker = readEnvWorker();
  if (!worker) {
    worker = randomUUID();
    upsertEnvWorker(worker);
  }
  return NextResponse.json({
    worker,
    ready: true,
    created: true,
    ...configs(worker),
    auth: {
      human: 'Magic-link dashboard. World Agent Pass gates mint.',
      agent: 'MCP + worker UUID + DAEMON_AUTH_TOKEN. No World ID on the agent path.',
    },
  });
}
