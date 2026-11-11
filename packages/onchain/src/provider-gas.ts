import { createCipheriv, createDecipheriv, createHmac, timingSafeEqual, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { providerGasAccounts, providerSignedTransactions, mandates, billingPlans, subscriptionPlans, entitlementRecords, type Database } from '@bagseven/db';
import { EntitlementRegistryAbi } from './entitlement-registry-artifact.js';
import { avalancheConfig } from './index.js';
import { createPublicClient, createWalletClient, http, nonceManager, decodeAbiParameters, decodeFunctionData, formatEther, parseAbi, parseAbiParameters, parseEther, recoverMessageAddress, toFunctionSelector, keccak256, stringToHex, parseUnits, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { SubscriptionBytecode, SubscriptionAbi } from './subscription-artifact.js';
import { BagMandateBytecode } from './bytecode.js';

/** Console-to-service scope proof; the public SDK/service bearer is not sufficient. */
export function verifyProviderScope(token: unknown, provider: string, env: NodeJS.ProcessEnv): boolean {
  if (typeof token !== 'string' || !env.PROVIDER_GAS_ENCRYPTION_KEY) return false;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return false;
  const expected = createHmac('sha256', env.PROVIDER_GAS_ENCRYPTION_KEY).update(`bagseven-provider-scope-v1:${payload}`).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;
  try { const claim = JSON.parse(Buffer.from(payload, 'base64url').toString()); return claim.provider === provider && Number.isSafeInteger(claim.expires) && claim.expires > Date.now() && claim.expires <= Date.now() + 120_000; } catch { return false; }
}
export function providerGasEnabled(env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV === 'production' && env.PROVIDER_FUNDED_GAS === 'false') throw new Error('PROVIDER_GAS_REQUIRED: platform-funded mode is forbidden in production');
  return env.PROVIDER_FUNDED_GAS !== 'false';
}
export type GasAuthorization = {
  subscriptions?: boolean;
  provider: string; owner: string; address: string; nonce: string; challengeExpires: number; expires: number;
  avalancheId: number; registryId: number; avalancheBudget: string; registryBudget: string;
  avalancheTxLimit: string; registryTxLimit: string;
};
type Recovery = { provider: string; to: string; address: string; chainId: number; amount: string; nonce: number; gas: string; gasPrice: string; expires: number; status: 'pending' | 'submitted'; hash?: string };
export function gasRecoveryMessage(r: Recovery) { return ['Bagseven provider gas recovery v1', `Provider: ${r.provider}`, `From: ${r.address}`, `Owner recipient: ${r.to}`, `Chain: ${r.chainId}`, `Native amount: ${r.amount}`, `Nonce: ${r.nonce}`, `Gas limit: ${r.gas}`, `Gas price (wei): ${r.gasPrice}`, `Maximum native fee: ${formatEther(BigInt(r.gas) * BigInt(r.gasPrice))}`, `Expires: ${new Date(r.expires).toISOString()}`].join('\n'); }
export function gasAuthorizationMessage(a: GasAuthorization) {
  return ['Bagseven provider-funded gas authorization v1', `Provider: ${a.provider}`, `Owner: ${a.owner}`,
    `Dedicated signer: ${a.address}`, `Avalanche chain: ${a.avalancheId}`, `Registry chain: ${a.registryId}`,
    `Avalanche gas budget (native): ${a.avalancheBudget}`, `Registry gas budget (native): ${a.registryBudget}`,
    `Avalanche maximum fee per transaction: ${a.avalancheTxLimit}`, `Registry maximum fee per transaction: ${a.registryTxLimit}`,
    `Expires: ${new Date(a.expires).toISOString()}`, `Challenge expires: ${new Date(a.challengeExpires).toISOString()}`, `Nonce: ${a.nonce}`,
    'Permitted: provider entitlement create/update on Registry; owner mandate deployment and provider-mandate registerWorker/execute on Avalanche.',
    ...(a.subscriptions ? ['Also permitted: deploy fixed-price subscription plans owned by this provider; collect only their due USDT renewals under customer-approved on-chain terms.'] : []),
    'No native transfers, token approvals, arbitrary calls, or platform-wallet fallback. Budgets reserve maximum fees before signing; reservations are not automatically refunded.',
    'The server holds an encrypted delegated signing key. These limits are server-enforced, not restrictions encoded into the EOA on-chain.'].join('\n');
}
function encryptionKey(env: NodeJS.ProcessEnv) {
  const key = env.PROVIDER_GAS_ENCRYPTION_KEY?.trim();
  if (!key || !/^[0-9a-fA-F]{64}$/.test(key)) throw new Error('PROVIDER_GAS_UNCONFIGURED: set a 32-byte hexadecimal PROVIDER_GAS_ENCRYPTION_KEY');
  return Buffer.from(key, 'hex');
}
export function encryptGasKey(key: Hex, provider: string, env: NodeJS.ProcessEnv) {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', encryptionKey(env), iv);
  cipher.setAAD(Buffer.from(provider));
  const encrypted = Buffer.concat([cipher.update(key, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(b => b.toString('base64url')).join('.');
}
function decryptGasKey(value: string, provider: string, env: NodeJS.ProcessEnv): Hex {
  const [iv, tag, body] = value.split('.').map(s => Buffer.from(s, 'base64url'));
  if (!iv || !tag || !body) throw new Error('PROVIDER_GAS_KEY_INVALID');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(env), iv);
  decipher.setAAD(Buffer.from(provider)); decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString() as Hex;
}
export function validateGasAuthorization(a: GasAuthorization) {
  if (!/^0x[\da-f]{40}$/i.test(a.owner)) throw new Error('PROVIDER_GAS_INVALID: invalid owner');
  for (const [limit, budget] of [[a.avalancheTxLimit, a.avalancheBudget], [a.registryTxLimit, a.registryBudget]] as const) {
    if (!/^\d+(\.\d{1,18})?$/.test(limit) || !/^\d+(\.\d{1,18})?$/.test(budget) || parseEther(limit) <= 0n || parseEther(budget) < parseEther(limit)) throw new Error('PROVIDER_GAS_INVALID: each budget must be positive and at least its per-transaction fee limit');
  }
  if (!Number.isSafeInteger(a.expires) || a.expires <= Date.now() || a.expires > Date.now() + (a.subscriptions ? 365 : 30) * 86400_000) throw new Error('PROVIDER_GAS_INVALID: authorization must expire within 30 days, or 365 days when subscription collection is explicitly authorized');
}
export class ProviderGasManager {
  constructor(private db: Database, private env: NodeJS.ProcessEnv) {}
  private subscriptionIntent(data: Hex, to?: string) {
    return keccak256(stringToHex(`${to?.toLowerCase() ?? 'deploy'}:${data.toLowerCase()}`));
  }
  /** Previously signed permissions may be recovered without signing or reserving fees again. */
  async signedSubscription(provider: string, chainId: number, data: Hex, to?: string): Promise<Hex | undefined> {
    const [signed] = await this.db.select().from(providerSignedTransactions).where(and(
      eq(providerSignedTransactions.providerId, provider), eq(providerSignedTransactions.chainId, chainId),
      eq(providerSignedTransactions.intent, this.subscriptionIntent(data, to))));
    return signed?.raw as Hex | undefined;
  }
  /** Only the chain adapter may release an intent after proving that its transaction reverted. */
  async revertedSubscription(provider: string, chainId: number, raw: Hex) {
    await this.db.update(providerSignedTransactions).set({ intent: null }).where(and(
      eq(providerSignedTransactions.providerId, provider), eq(providerSignedTransactions.chainId, chainId), eq(providerSignedTransactions.raw, raw)));
  }
  private async row(provider: string) {
    const row = await this.db.query.providerGasAccounts.findFirst({ where: eq(providerGasAccounts.providerId, provider) });
    if (!row) throw new Error('PROVIDER_GAS_REQUIRED: provider must configure and fund its gas account');
    return row;
  }
  async prepare(provider: string, input: Omit<GasAuthorization, 'provider' | 'address' | 'nonce' | 'challengeExpires' | 'avalancheId' | 'registryId'>) {
    encryptionKey(this.env);
    let row = await this.db.query.providerGasAccounts.findFirst({ where: eq(providerGasAccounts.providerId, provider) });
    const draft: GasAuthorization = { ...input, owner: input.owner.toLowerCase(), provider, address: row?.address ?? privateKeyToAccount(generatePrivateKey()).address,
      subscriptions: true, nonce: randomUUID(), challengeExpires: Date.now() + 300_000,
      avalancheId: avalancheConfig(this.env).chainId, registryId: avalancheConfig(this.env).chainId };
    validateGasAuthorization(draft);
    if (row && row.ownerAddress !== draft.owner) throw new Error('PROVIDER_GAS_OWNER_MISMATCH: revoke and recover the existing account before changing its owner');
    if (!row) {
      const key = generatePrivateKey(); draft.address = privateKeyToAccount(key).address;
      await this.db.insert(providerGasAccounts).values({ providerId: provider, ownerAddress: draft.owner, address: draft.address.toLowerCase(), encryptedKey: encryptGasKey(key, provider, this.env), challenge: draft }).onConflictDoNothing();
      row = await this.row(provider);
      if (row.ownerAddress !== draft.owner) throw new Error('PROVIDER_GAS_OWNER_MISMATCH');
    }
    draft.address = row.address;
    // A proposal never increases the authority of an existing authorization.
    await this.db.update(providerGasAccounts).set({ challenge: draft }).where(eq(providerGasAccounts.providerId, provider));
    return { authorization: draft, message: gasAuthorizationMessage(draft) };
  }
  async authorize(provider: string, signature: Hex) {
    return this.db.transaction(async tx => {
      const [row] = await tx.select().from(providerGasAccounts).where(eq(providerGasAccounts.providerId, provider)).for('update');
      if (!row) throw new Error('PROVIDER_GAS_REQUIRED');
      const a = row.challenge as GasAuthorization;
      if (!a.nonce || a.challengeExpires <= Date.now() || (row.authorization as GasAuthorization | null)?.nonce === a.nonce) throw new Error('PROVIDER_GAS_CHALLENGE_EXPIRED: request a fresh authorization');
      validateGasAuthorization(a);
      const signer = await recoverMessageAddress({ message: gasAuthorizationMessage(a), signature });
      if (signer.toLowerCase() !== row.ownerAddress) throw new Error('PROVIDER_GAS_SIGNATURE_INVALID');
      await tx.update(providerGasAccounts).set({ authorization: a, authorizationSignature: signature, expiresAt: new Date(a.expires), status: 'active', avalancheReserved: '0', registryReserved: '0' }).where(eq(providerGasAccounts.providerId, provider));
      return { address: row.address, expires: a.expires };
    });
  }
  async status(provider: string) {
    const row = await this.db.query.providerGasAccounts.findFirst({ where: eq(providerGasAccounts.providerId, provider) });
    if (!row) return { configured: false as const };
    return { configured: true as const, address: row.address, owner: row.ownerAddress, status: row.status,
      authorization: row.authorization as GasAuthorization | null, expires_at: row.expiresAt,
      avalanche_reserved_wei: row.avalancheReserved, registry_reserved_wei: row.registryReserved };
  }
  async revoke(provider: string) {
    await this.db.update(providerGasAccounts).set({ status: 'revoked' }).where(eq(providerGasAccounts.providerId, provider));
    return { revoked: true };
  }
  private network(network: 'registry' | 'avalanche') {
    const config = avalancheConfig(this.env);
    return { chainId: config.chainId, url: config.rpcUrl };
  }
  async prepareRecovery(provider: string, network: 'registry' | 'avalanche', amount: string) {
    const row = await this.row(provider);
    if (row.status === 'active') throw new Error('PROVIDER_GAS_REVOKE_FIRST: revoke future signing before recovering funds');
    if (!/^\d+(\.\d{1,18})?$/.test(amount) || parseEther(amount) <= 0n) throw new Error('PROVIDER_GAS_INVALID: recovery amount must be positive');
    const { chainId, url } = this.network(network);
    const client = createPublicClient({ transport: http(url) });
    if (await client.getChainId() !== chainId) throw new Error('PROVIDER_GAS_CHAIN_MISMATCH');
    const from = row.address as Hex; const to = row.ownerAddress as Hex;
    const gas = (await client.estimateGas({ account: from, to, value: parseEther(amount) })) * 125n / 100n;
    const price = (await client.getGasPrice()) * 120n / 100n;
    if (await client.getBalance({ address: from }) < parseEther(amount) + gas * price) throw new Error('PROVIDER_GAS_EMPTY: leave enough native currency for recovery gas');
    const r: Recovery = { provider, to, address: from, amount, chainId, gas: String(gas), gasPrice: String(price), nonce: await client.getTransactionCount({ address: from, blockTag: 'pending' }), expires: Date.now() + 300_000, status: 'pending' };
    await this.db.update(providerGasAccounts).set({ recoveryChallenge: r }).where(eq(providerGasAccounts.providerId, provider));
    return { message: gasRecoveryMessage(r), recovery: r };
  }
  async recover(provider: string, signature: Hex) {
    const row = await this.row(provider); const r = row.recoveryChallenge as Recovery | null;
    if (!r || r.status !== 'pending' || r.expires <= Date.now()) throw new Error('PROVIDER_GAS_CHALLENGE_EXPIRED');
    const signer = await recoverMessageAddress({ message: gasRecoveryMessage(r), signature });
    if (signer.toLowerCase() !== row.ownerAddress || r.to !== row.ownerAddress || r.address !== row.address) throw new Error('PROVIDER_GAS_SIGNATURE_INVALID');
    const claimed = await this.db.update(providerGasAccounts).set({ recoveryChallenge: { ...r, status: 'submitted' } }).where(sql`${providerGasAccounts.providerId} = ${provider} and ${providerGasAccounts.recoveryChallenge}->>'status' = 'pending' and ${providerGasAccounts.recoveryChallenge}->>'expires' = ${String(r.expires)}`).returning({ id: providerGasAccounts.providerId });
    if (!claimed.length) throw new Error('PROVIDER_GAS_RECOVERY_ALREADY_SUBMITTED');
    const network = this.network('avalanche');
    if (network.chainId !== r.chainId) throw new Error('PROVIDER_GAS_CHAIN_MISMATCH');
    const account = privateKeyToAccount(decryptGasKey(row.encryptedKey, provider, this.env), { nonceManager });
    // Separate, owner-signed recovery authority; automatic delegates cannot transfer native value.
    const wallet = createWalletClient({ account, transport: http(network.url) });
    const hash = await wallet.sendTransaction({ chain: null, chainId: r.chainId, to: r.to as Hex, value: parseEther(r.amount), nonce: r.nonce, gas: BigInt(r.gas), gasPrice: BigInt(r.gasPrice), type: 'legacy' });
    await this.db.update(providerGasAccounts).set({ recoveryChallenge: { ...r, status: 'submitted', hash } }).where(eq(providerGasAccounts.providerId, provider));
    return { hash, to: r.to, amount: r.amount };
  }
  async assertActive(provider: string) {
    const row = await this.row(provider);
    if (row.status !== 'active' || !row.expiresAt || row.expiresAt.getTime() <= Date.now()) throw new Error('PROVIDER_GAS_INACTIVE: provider gas authorization is missing, expired, or revoked');
    const terms = row.authorization as GasAuthorization | null;
    const chainId = avalancheConfig(this.env).chainId;
    if (terms?.avalancheId !== chainId || terms.registryId !== chainId) throw Error('PROVIDER_GAS_REAUTHORIZE_REQUIRED: sign a fresh authorization for this Avalanche network');
    return row;
  }
  async account(provider: string, network: 'registry' | 'avalanche'): Promise<PrivateKeyAccount> {
    if (!provider) throw new Error('PROVIDER_GAS_REQUIRED: this operation has no provider binding');
    const row = await this.assertActive(provider);
    const raw = privateKeyToAccount(decryptGasKey(row.encryptedKey, provider, this.env), { nonceManager });
    const account: PrivateKeyAccount = { ...raw,
      sign: async () => { throw new Error('PROVIDER_GAS_CALL_FORBIDDEN'); },
      signAuthorization: async () => { throw new Error('PROVIDER_GAS_CALL_FORBIDDEN'); },
      signMessage: async () => { throw new Error('PROVIDER_GAS_CALL_FORBIDDEN: message signing is not delegated'); },
      signTypedData: async () => { throw new Error('PROVIDER_GAS_CALL_FORBIDDEN: typed-data signing is not delegated'); },
      signTransaction: async (transaction, options) => {
        if (transaction.type && !['legacy', 'eip1559'].includes(transaction.type)) throw new Error('PROVIDER_GAS_CALL_FORBIDDEN: only bounded legacy or EIP-1559 transactions are delegated');
        const current = await this.assertActive(provider);
        const a = current.authorization as GasAuthorization;
        const expectedChain = network === 'registry' ? a.registryId : a.avalancheId;
        if (Number(transaction.chainId) !== expectedChain || BigInt(transaction.value ?? 0) !== 0n) throw new Error('PROVIDER_GAS_CALL_FORBIDDEN: wrong chain or native value');
        const data = transaction.data ?? '0x';
        let subscriptionIntent: string | undefined;
        if (network === 'registry') {
          const registry = this.env.AVALANCHE_ENTITLEMENT_REGISTRY?.toLowerCase();
          if (!registry || transaction.to?.toLowerCase() !== registry) throw new Error('PROVIDER_GAS_CALL_FORBIDDEN: only the configured entitlement registry is delegated');
          const decoded = (() => {
            try { return decodeFunctionData({ abi: EntitlementRegistryAbi, data }); }
            catch { throw Error('PROVIDER_GAS_CALL_FORBIDDEN: unsupported registry call'); }
          })();
          if (!['issue', 'consume', 'hold', 'finalizeHold', 'cancelRenewal'].includes(decoded.functionName)) throw Error('PROVIDER_GAS_CALL_FORBIDDEN');
          const id = decoded.args?.[0];
          const [record] = await this.db.select().from(entitlementRecords).where(eq(entitlementRecords.key, `${expectedChain}:${registry}:${id}`));
          if (record?.providerId !== provider) throw Error('PROVIDER_GAS_CALL_FORBIDDEN: registry operation belongs to another provider');
          if (decoded.functionName === 'issue' && decoded.args[1].toLowerCase() !== raw.address.toLowerCase()) throw Error('PROVIDER_GAS_CALL_FORBIDDEN');
          subscriptionIntent = this.subscriptionIntent(data, registry);
        } else if (!transaction.to) {
          if (a.subscriptions && data.startsWith(SubscriptionBytecode)) {
            subscriptionIntent = this.subscriptionIntent(data);
            const args = decodeAbiParameters(parseAbiParameters('address,address,address,uint256,uint256,bytes32'), `0x${data.slice(SubscriptionBytecode.length)}`);
            const plans = await this.db.select().from(billingPlans).where(eq(billingPlans.providerId, provider));
            const plan = plans.find(p => keccak256(stringToHex(p.id)) === args[5]);
            if (!plan || plan.active !== 'true' || plan.interval !== 'month' || plan.merchantWallet.toLowerCase() !== args[1].toLowerCase() ||
                args[0].toLowerCase() !== (this.env.AVALANCHE_USDC ?? '').toLowerCase() || args[2].toLowerCase() !== raw.address.toLowerCase() ||
                args[3] !== parseUnits(plan.amount, 6) || args[4] !== BigInt(plan.ttlSeconds)) throw new Error('PROVIDER_GAS_CALL_FORBIDDEN: subscription terms do not match the provider plan');
          } else {
            if (!data.startsWith(BagMandateBytecode)) throw new Error('PROVIDER_GAS_CALL_FORBIDDEN: deployment is not delegated; renew provider gas authorization for subscriptions');
            const args = decodeAbiParameters(parseAbiParameters('address,address,address,address,uint256,uint256,uint256,uint256,uint256,uint8,bytes32,uint256'), `0x${data.slice(BagMandateBytecode.length)}`);
            if (args[0].toLowerCase() !== current.ownerAddress || args[2].toLowerCase() !== raw.address.toLowerCase()) throw new Error('PROVIDER_GAS_CALL_FORBIDDEN: deployment must retain the authorized owner and provider enforcer');
          }
        } else {
          const mandate = await this.db.query.mandates.findFirst({ where: sql`lower(${mandates.contractAddress}) = ${transaction.to.toLowerCase()}` });
          const allowed = ['execute(uint256,address,bytes32)', 'registerWorker(bytes32,bytes32,address,uint256,uint8)'].map(toFunctionSelector);
          const subscription = a.subscriptions && data.startsWith(toFunctionSelector('charge(bytes32,uint256)'))
            ? (await this.db.select().from(subscriptionPlans).where(eq(subscriptionPlans.providerId, provider))).find(p => (p.data as { contract?: string; status?: string }).contract?.toLowerCase() === transaction.to!.toLowerCase() && (p.data as { status?: string }).status === 'ready') : undefined;
          if (subscription) {
            decodeFunctionData({ abi: SubscriptionAbi, data });
            subscriptionIntent = this.subscriptionIntent(data, transaction.to);
          } else if (mandate?.providerId !== provider || !allowed.some(selector => data.startsWith(selector))) throw new Error('PROVIDER_GAS_CALL_FORBIDDEN: target mandate or method is not delegated');
        }
        const fee = transaction.maxFeePerGas ?? transaction.gasPrice;
        if (!transaction.gas || fee === undefined || transaction.gas <= 0n || fee < 0n) throw new Error('PROVIDER_GAS_FEE_REQUIRED: a bounded gas limit and fee must be prepared before signing');
        const cost = transaction.gas * fee;
        const limit = parseEther(network === 'registry' ? a.registryTxLimit : a.avalancheTxLimit);
        const budget = parseEther(network === 'registry' ? a.registryBudget : a.avalancheBudget);
        if (cost > limit) throw new Error('PROVIDER_GAS_TX_LIMIT: estimated maximum gas exceeds the provider limit');
        const column = network === 'registry' ? providerGasAccounts.registryReserved : providerGasAccounts.avalancheReserved;
        const field = network === 'registry' ? 'registryReserved' : 'avalancheReserved';
        // Atomic reservation also rechecks revocation and the authorization nonce.
        const sign = async (db: Database, signed?: Hex) => {
          const updated = await db.update(providerGasAccounts).set({ [field]: sql`${column} + ${cost.toString()}::numeric` }).where(sql`${providerGasAccounts.providerId} = ${provider} and ${providerGasAccounts.status} = 'active' and ${providerGasAccounts.expiresAt} > now() and ${providerGasAccounts.authorization}->>'nonce' = ${a.nonce} and ${column} + ${cost.toString()}::numeric <= ${budget.toString()}::numeric`).returning({ id: providerGasAccounts.providerId });
          if (!updated.length) throw new Error('PROVIDER_GAS_BUDGET: provider budget exhausted or authorization changed');
          return signed ?? raw.signTransaction(transaction, options);
        };
        if (!Number.isSafeInteger(transaction.nonce) || transaction.nonce! < 0) throw Error('PROVIDER_GAS_NONCE_REQUIRED');
        return this.db.transaction(async tx => {
          // Serialize every Avalanche signer for this account across daemon/policy replicas.
          await tx.select().from(providerGasAccounts).where(eq(providerGasAccounts.providerId, provider)).for('update');
          if (subscriptionIntent) {
            const [existing] = await tx.select().from(providerSignedTransactions).where(and(
              eq(providerSignedTransactions.providerId, provider), eq(providerSignedTransactions.chainId, expectedChain),
              eq(providerSignedTransactions.intent, subscriptionIntent)));
            if (existing) return existing.raw as Hex;
          }
          const id = `${provider}:${expectedChain}:${transaction.nonce}`;
          const [existing] = await tx.select().from(providerSignedTransactions).where(eq(providerSignedTransactions.id, id));
          const signed = await raw.signTransaction(transaction, options);
          if (existing) {
            if (existing.raw === signed) return signed;
            throw Error('PROVIDER_GAS_NONCE_BUSY: this nonce already belongs to another signed transaction; retry with a fresh pending nonce');
          }
          await sign(tx as unknown as Database, signed);
          // Both the fee reservation and exact signed bytes commit before the caller can broadcast.
          await tx.insert(providerSignedTransactions).values({ id, providerId: provider, chainId: expectedChain,
            nonce: transaction.nonce!, intent: subscriptionIntent, raw: signed });
          return signed;
        });
      },
    };
    return account;
  }
}
