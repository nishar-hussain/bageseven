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
    providerId: text('provider_id'),
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

/** Encrypted, provider-funded signing accounts. Limits reserve worst-case gas. */
export const providerGasAccounts = pgTable('provider_gas_accounts', {
  providerId: text('provider_id').primaryKey(),
  ownerAddress: text('owner_address').notNull(),
  address: text('address').notNull(),
  encryptedKey: text('encrypted_key').notNull(),
  status: text('status').notNull().default('pending'),
  challenge: jsonb('challenge').notNull(),
  authorization: jsonb('authorization'),
  authorizationSignature: text('authorization_signature'),
  recoveryChallenge: jsonb('recovery_challenge'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  whitechainReserved: numeric('whitechain_reserved', { precision: 78, scale: 0 }).notNull().default('0'),
  arkivReserved: numeric('arkiv_reserved', { precision: 78, scale: 0 }).notNull().default('0'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Durable ownership of Whitechain nonces, shared by every provider signing process. */
export const providerSignedTransactions = pgTable('provider_signed_transactions', {
  id: text('id').primaryKey(),
  providerId: text('provider_id').notNull().references(() => providerGasAccounts.providerId),
  chainId: integer('chain_id').notNull(),
  nonce: integer('nonce').notNull(),
  intent: text('intent'),
  raw: text('raw').notNull(),
}, t => [uniqueIndex('uq_provider_signed_intent').on(t.providerId, t.chainId, t.intent)]);

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

/** Thin SaaS plan → living Arkiv entitlement (no payment-link product line). */
export const billingPlans = pgTable(
  'billing_plans',
  {
    id: text('id').primaryKey(),
    providerId: text('provider_id').notNull().default('legacy'),
    feature: text('feature').notNull(),
    name: text('name').notNull(),
    amount: text('amount').notNull(),
    interval: text('interval').notNull().default('once'),
    credits: text('credits').notNull().default('10'),
    ttlSeconds: integer('ttl_seconds').notNull().default(3600),
    merchantWallet: text('merchant_wallet').notNull(),
    active: text('active').notNull().default('true'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_billing_plans_feature').on(t.feature)],
);

export const checkoutSessions = pgTable(
  'checkout_sessions',
  {
    id: text('id').primaryKey(),
    planId: text('plan_id')
      .notNull()
      .references(() => billingPlans.id, { onDelete: 'cascade' }),
    holder: text('holder').notNull(),
    status: text('status').notNull().default('PENDING'),
    amount: text('amount').notNull(),
    chainId: integer('chain_id').notNull().default(1874),
    workerId: text('worker_id'),
    platformFeeBps: integer('platform_fee_bps').notNull().default(0),
    platformFeeAmount: text('platform_fee_amount').notNull().default('0'),
    customerWallet: text('customer_wallet'),
    paymentTx: text('payment_tx'),
    grantId: text('grant_id'),
    successUrl: text('success_url'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_checkout_sessions_plan').on(t.planId),
    index('idx_checkout_sessions_holder').on(t.holder),
    index('idx_checkout_sessions_status').on(t.status),
    uniqueIndex('idx_checkout_payment_unique').on(t.chainId, t.paymentTx),
  ],
);

/** Durable subscription journals; signed transactions are public data, never wallet keys. */
export const subscriptionPlans = pgTable('subscription_plans', {
  id: text('id').primaryKey().references(() => billingPlans.id),
  providerId: text('provider_id').notNull(),
  data: jsonb('data').notNull(),
});
export const billingSubscriptions = pgTable('billing_subscriptions', {
  id: text('id').primaryKey(),
  checkoutId: text('checkout_id').notNull().unique().references(() => checkoutSessions.id),
  holder: text('holder').notNull(),
  providerId: text('provider_id').notNull(),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull(),
  status: text('status').notNull(),
  data: jsonb('data').notNull(),
}, t => [index('idx_subscription_due').on(t.status, t.nextAttemptAt), index('idx_subscription_holder').on(t.holder)]);
export const subscriptionPeriods = pgTable('subscription_periods', {
  id: text('id').primaryKey(),
  subscriptionId: text('subscription_id').notNull().references(() => billingSubscriptions.id),
  data: jsonb('data').notNull(),
});

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
