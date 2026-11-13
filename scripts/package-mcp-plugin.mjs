#!/usr/bin/env node
/** Package the current OAuth MCP endpoint without copying credentials. */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const env = parseEnv(readFileSync(resolve(root, '.env'), 'utf8'));
const statePath = resolve(root, '.data/plugin/avalanche-plugin-state.json');
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {};
const origin = new URL(env.BAGSEVEN_MCP_PUBLIC_URL);
if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw Error('A verified public HTTPS MCP origin is required');
const endpoint = `${origin.origin}/mcp`;
const response = await fetch(`${origin.origin}/.well-known/oauth-protected-resource/mcp`, { headers: { 'ngrok-skip-browser-warning': 'true' } });
const resource = await response.json();
if (!response.ok || resource.resource !== endpoint || !resource.authorization_servers?.includes(origin.origin)) throw Error('MCP OAuth discovery does not match the endpoint');
mkdirSync(resolve(root, '.data/plugin'), { recursive: true });
const dir = mkdtempSync(resolve(root, '.data/plugin/bagseven-stage-'));
mkdirSync(resolve(dir, 'assets'), { recursive: true });
cpSync(resolve(root, 'apps/console/public/icon.svg'), resolve(dir, 'assets/bagseven.svg'));
cpSync(resolve(root, 'skills/bagseven'), resolve(dir, 'skills/bagseven'), { recursive: true });
const manifest = { $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: 'bagseven-avalanche', version: process.env.BAGSEVEN_PLUGIN_VERSION || state.version || '1.0.0',
  description: 'Bagseven on Avalanche: living access, prepaid credits, subscriptions and authorized agent payments.', author: { name: 'Bagseven' },
  extensions: { 'com.openai': { interface: { displayName: 'Bagseven', shortDescription: 'Paid access on Avalanche',
    longDescription: 'Manage living Avalanche entitlements, prepaid usage, subscription checkouts and separately authorized agent spending. Email and wallet consent protect access. Financial transactions require explicit wallet approval.',
    developerName: 'Bagseven', category: 'Developer Tools', capabilities: [], brandColor: '#0002f8', logo: './assets/bagseven.svg', composerIcon: './assets/bagseven.svg',
    defaultPrompt: ['Check my living entitlements and remaining credits.', 'Explain my agent spending limits without making a payment.'] } } } };
const mcp = { $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json', mcpServers: { bagseven: { type: 'streamable-http', url: endpoint,
  extensions: { 'com.openai': { auth: { type: 'oauth', client: { mode: 'dcr' }, baseScopes: ['bagseven'], defaultScopes: ['bagseven'], oidcEnabled: false } } } } } };
writeFileSync(resolve(dir, 'plugin.json'), JSON.stringify(manifest, null, 2));
const components = ['plugin.json', 'assets', 'skills'];
if (state.app_id) {
  if (!/^asdk_app_[a-zA-Z0-9_-]+$/.test(state.app_id)) throw Error('Expected a verified ChatGPT app ID');
  manifest.extensions['com.openai'].apps = './.app.json';
  writeFileSync(resolve(dir, 'plugin.json'), JSON.stringify(manifest, null, 2));
  writeFileSync(resolve(dir, '.app.json'), JSON.stringify({ apps: { bagseven: { id: state.app_id } } }, null, 2));
  components.push('.app.json');
} else {
  writeFileSync(resolve(dir, 'mcp.json'), JSON.stringify(mcp, null, 2));
  components.push('mcp.json');
}
const archive = resolve(root, '.data/plugin/bagseven-avalanche.zip');
const temporaryArchive = `${dir}.zip`;
const result = spawnSync('zip', ['-qr', temporaryArchive, ...components], { cwd: dir });
if (result.status !== 0) throw Error('Could not create plugin archive');
renameSync(temporaryArchive, archive);
rmSync(dir, { recursive: true });
console.log(JSON.stringify({ archive, endpoint, name: manifest.name, version: manifest.version }));
