import { BagsevenClient, type ConsumeResult, type Entitlement } from './node.js';

/**
 * Agent-facing wrapper. Same check/consume verbs as the Node SDK.
 * MCP (`scripts/bagseven-mcp.ts`) is the Cursor/Claude surface; this is for
 * programmatic agents that already hold a secret key.
 */
export class BagsevenAgent {
  readonly client: BagsevenClient;

  constructor(opts: { apiKey: string; baseUrl?: string }) {
    this.client = new BagsevenClient(opts);
  }

  checkEntitlement(feature: string, holder: string): Promise<Entitlement> {
    return this.client.checkEntitlement(feature, { holder });
  }

  consumeEntitlement(input: {
    feature: string;
    holder: string;
    amount?: string;
    idempotencyKey?: string;
  }): Promise<ConsumeResult> {
    return this.client.consumeEntitlement(input);
  }
}

export { BagsevenClient, BagsevenApiError } from './node.js';
