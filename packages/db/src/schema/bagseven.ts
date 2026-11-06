import { pgTable, uuid, text, timestamp, numeric, jsonb, integer, index, bigint, uniqueIndex, pgEnum } from 'drizzle-orm/pg-core';

export const mandateStatus = pgEnum('mandate_status', ['active', 'revoked', 'superseded']);
export const agentStatus = pgEnum('agent_status', ['active', 'suspended', 'retired']);
export const reservationStatus = pgEnum('reservation_status', ['reserved', 'committed', 'settled', 'released']);
export const txType = pgEnum('tx_type', ['reserve', 'commit', 'withdraw', 'fund']);
export const providerStatus = pgEnum('provider_status', ['active', 'revoked']);

/**
 * A mandate is the signed, immutable spending contract for an agent tree.
 * The OWNER (connected wallet) signs the canonical bounds once; the caps mirror
 * the on-chain BagMandate contract (the ground truth). The counters below are a
 * convenience mirror updated after each on-chain settlement.
 */
export const mandates = pgTable(
  'mandates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerAddress: text('owner_address').notNull(),
    operatorAddress: text('operator_address').notNull(),
    contractAddress: text('contract_address'),
    budgetPerWindow: numeric('budget_per_window', { precision: 38, scale: 18 }).notNull(),
    windowSeconds: bigint('window_seconds', { mode: 'number' }).notNull(),
    lifetimeCap: numeric('lifetime_cap', { precision: 38, scale: 18 }).notNull(),
    perPurchaseCap: numeric('per_purchase_cap', { precision: 38, scale: 18 }).notNull(),
    perSellerPct: integer('per_seller_pct').notNull(),
    maxDepth: integer('max_depth').notNull(),
    signature: text('signature').notNull(),
    status: mandateStatus('status').notNull().default('active'),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    windowOpenedAt: timestamp('window_opened_at', { withTimezone: true }).notNull().defaultNow(),
    windowSpent: numeric('window_spent', { precision: 38, scale: 18 }).notNull().default('0'),
    lifetimeSpent: numeric('lifetime_spent', { precision: 38, scale: 18 }).notNull().default('0'),
    sellerSpent: jsonb('seller_spent').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_mandates_owner').on(t.ownerAddress),
    index('idx_mandates_status').on(t.status),
  ],
);

export const providers = pgTable(
  'providers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    hostname: text('hostname').notNull(),
    address: text('address').notNull(),
    status: providerStatus('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_providers_hostname').on(t.hostname)],
);

/** Agents under a mandate tree. The operatorAddress is the agent's hot key. */
export const agents = pgTable(
  'agents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mandateId: uuid('mandate_id')
      .notNull()
      .references(() => mandates.id, { onDelete: 'cascade' }),
    parentAgentId: uuid('parent_agent_id'),
    operatorAddress: text('operator_address').notNull(),
    sharePercent: numeric('share_percent', { precision: 10, scale: 2 }).notNull(),
    allocation: numeric('allocation', { precision: 38, scale: 18 }).notNull().default('0'),
    depth: integer('depth').notNull().default(0),
    name: text('name'),
    mcpEndpoint: text('mcp_endpoint'),
    status: agentStatus('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_agents_mandate').on(t.mandateId), index('idx_agents_operator').on(t.operatorAddress)],
);

/** One vault (the contract's USDC balance) per mandate tree. */
export const vaults = pgTable(
  'vaults',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mandateId: uuid('mandate_id')
      .notNull()
      .references(() => mandates.id, { onDelete: 'cascade' }),
    contractAddress: text('contract_address'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_vault_mandate').on(t.mandateId)],
);

/** Two-phase spend lifecycle: reserve → commit/settle. */
export const reservations = pgTable(
  'reservations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mandateId: uuid('mandate_id')
      .notNull()
      .references(() => mandates.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    amount: numeric('amount', { precision: 38, scale: 18 }).notNull(),
    status: reservationStatus('status').notNull().default('reserved'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (t) => [index('idx_reservations_mandate').on(t.mandateId)],
);

/** A spend attempt that violated a bound — named after the contract error. */
export const refusals = pgTable(
  'refusals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mandateId: uuid('mandate_id')
      .notNull()
      .references(() => mandates.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    amount: numeric('amount', { precision: 38, scale: 18 }).notNull(),
    seller: text('seller'),
    bound: text('bound').notNull(),
    reason: text('reason'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    releasedAt: timestamp('released_at', { withTimezone: true }),
  },
  (t) => [index('idx_refusals_mandate_created').on(t.mandateId, t.requestedAt)],
);

/** Every on-chain action for audit. */
export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mandateId: uuid('mandate_id')
      .notNull()
      .references(() => mandates.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    txHash: text('tx_hash'),
    amount: numeric('amount', { precision: 38, scale: 18 }).notNull(),
    type: txType('type').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_transactions_mandate').on(t.mandateId)],
);
