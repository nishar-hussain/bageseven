import { createCipheriv, createDecipheriv, createHmac, timingSafeEqual, randomBytes, randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { providerGasAccounts, mandates, type Database } from '@bagseven/db';
import { createPublicClient, createWalletClient, http, nonceManager, decodeAbiParameters, decodeFunctionData, formatEther, parseAbi, parseAbiParameters, parseEther, recoverMessageAddress, toFunctionSelector, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { BagMandateBytecode } from './bytecode.js';

export const ARKIV_ENGINE = '0x4400000000000000000000000000000000000044';
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
  provider: string; owner: string; address: string; nonce: string; challengeExpires: number; expires: number;
  whitechainId: number; arkivId: number; whitechainBudget: string; arkivBudget: string;
  whitechainTxLimit: string; arkivTxLimit: string;
};
type Recovery = { provider: string; to: string; address: string; chainId: number; amount: string; nonce: number; gas: string; gasPrice: string; expires: number; status: 'pending' | 'submitted'; hash?: string };
export function gasRecoveryMessage(r: Recovery) { return ['Bagseven provider gas recovery v1', `Provider: ${r.provider}`, `From: ${r.address}`, `Owner recipient: ${r.to}`, `Chain: ${r.chainId}`, `Native amount: ${r.amount}`, `Nonce: ${r.nonce}`, `Gas limit: ${r.gas}`, `Gas price (wei): ${r.gasPrice}`, `Maximum native fee: ${formatEther(BigInt(r.gas) * BigInt(r.gasPrice))}`, `Expires: ${new Date(r.expires).toISOString()}`].join('\n'); }
export function gasAuthorizationMessage(a: GasAuthorization) {
  return ['Bagseven provider-funded gas authorization v1', `Provider: ${a.provider}`, `Owner: ${a.owner}`,
    `Dedicated signer: ${a.address}`, `Whitechain chain: ${a.whitechainId}`, `Arkiv chain: ${a.arkivId}`,
    `Whitechain gas budget (native): ${a.whitechainBudget}`, `Arkiv gas budget (native): ${a.arkivBudget}`,
    `Whitechain maximum fee per transaction: ${a.whitechainTxLimit}`, `Arkiv maximum fee per transaction: ${a.arkivTxLimit}`,
    `Expires: ${new Date(a.expires).toISOString()}`, `Challenge expires: ${new Date(a.challengeExpires).toISOString()}`, `Nonce: ${a.nonce}`,
    'Permitted: provider entitlement create/update on Arkiv; owner mandate deployment and provider-mandate registerWorker/execute on Whitechain.',
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
  for (const [limit, budget] of [[a.whitechainTxLimit, a.whitechainBudget], [a.arkivTxLimit, a.arkivBudget]] as const) {
    if (!/^\d+(\.\d{1,18})?$/.test(limit) || !/^\d+(\.\d{1,18})?$/.test(budget) || parseEther(limit) <= 0n || parseEther(budget) < parseEther(limit)) throw new Error('PROVIDER_GAS_INVALID: each budget must be positive and at least its per-transaction fee limit');
  }
  if (!Number.isSafeInteger(a.expires) || a.expires <= Date.now() || a.expires > Date.now() + 30 * 86400_000) throw new Error('PROVIDER_GAS_INVALID: authorization must expire within 30 days');
}
export class ProviderGasManager {
  constructor(private db: Database, private env: NodeJS.ProcessEnv) {}
  private async row(provider: string) {
    const row = await this.db.query.providerGasAccounts.findFirst({ where: eq(providerGasAccounts.providerId, provider) });
    if (!row) throw new Error('PROVIDER_GAS_REQUIRED: provider must configure and fund its gas account');
    return row;
  }
  async prepare(provider: string, input: Omit<GasAuthorization, 'provider' | 'address' | 'nonce' | 'challengeExpires' | 'whitechainId' | 'arkivId'>) {
    encryptionKey(this.env);
    let row = await this.db.query.providerGasAccounts.findFirst({ where: eq(providerGasAccounts.providerId, provider) });
    const draft: GasAuthorization = { ...input, owner: input.owner.toLowerCase(), provider, address: row?.address ?? privateKeyToAccount(generatePrivateKey()).address,
      nonce: randomUUID(), challengeExpires: Date.now() + 300_000,
      whitechainId: Number(this.env.CHAIN_ID ?? 1874), arkivId: Number(this.env.ARKIV_CHAIN_ID ?? 7794095) };
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
      await tx.update(providerGasAccounts).set({ authorization: a, authorizationSignature: signature, expiresAt: new Date(a.expires), status: 'active', whitechainReserved: '0', arkivReserved: '0' }).where(eq(providerGasAccounts.providerId, provider));
      return { address: row.address, expires: a.expires };
    });
  }
  async status(provider: string) {
    const row = await this.db.query.providerGasAccounts.findFirst({ where: eq(providerGasAccounts.providerId, provider) });
    if (!row) return { configured: false as const };
    return { configured: true as const, address: row.address, owner: row.ownerAddress, status: row.status,
      authorization: row.authorization as GasAuthorization | null, expires_at: row.expiresAt,
      whitechain_reserved_wei: row.whitechainReserved, arkiv_reserved_wei: row.arkivReserved };
  }
  async revoke(provider: string) {
    await this.db.update(providerGasAccounts).set({ status: 'revoked' }).where(eq(providerGasAccounts.providerId, provider));
    return { revoked: true };
  }
  private network(network: 'arkiv' | 'whitechain') {
    const chainId = Number(network === 'arkiv' ? this.env.ARKIV_CHAIN_ID ?? 7794095 : this.env.CHAIN_ID ?? 1874);
    const url = network === 'arkiv' ? this.env.ARKIV_RPC_URL ?? 'https://rpc.rabdi.db-chain.testnet.arkiv.network' : this.env.RPC_URL ?? 'https://rpc.testnet.whitechain.io';
    return { chainId, url: network === 'arkiv' && this.env.ARKIV_ACCESS_KEY && new URL(url).pathname === '/' ? `${url.replace(/\/$/, '')}/${encodeURIComponent(this.env.ARKIV_ACCESS_KEY)}` : url };
  }
  async prepareRecovery(provider: string, network: 'arkiv' | 'whitechain', amount: string) {
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
    const network = this.network(r.chainId === Number(this.env.ARKIV_CHAIN_ID ?? 7794095) ? 'arkiv' : 'whitechain');
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
    return row;
  }
  async account(provider: string, network: 'arkiv' | 'whitechain'): Promise<PrivateKeyAccount> {
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
        const expectedChain = network === 'arkiv' ? a.arkivId : a.whitechainId;
        if (Number(transaction.chainId) !== expectedChain || BigInt(transaction.value ?? 0) !== 0n) throw new Error('PROVIDER_GAS_CALL_FORBIDDEN: wrong chain or native value');
        const data = transaction.data ?? '0x';
        if (network === 'arkiv') {
          if (transaction.to?.toLowerCase() !== ARKIV_ENGINE.toLowerCase()) throw new Error('PROVIDER_GAS_CALL_FORBIDDEN: only Arkiv engine writes are delegated');
          const decoded = decodeFunctionData({ abi: parseAbi(['function execute((uint8 operation,bytes operationData)[] ops)']), data });
          if (decoded.functionName !== 'execute' || decoded.args[0].length !== 1 || ![1, 2].includes(decoded.args[0][0]!.operation)) throw new Error('PROVIDER_GAS_CALL_FORBIDDEN: only single create/patch operations are delegated');
        } else if (!transaction.to) {
          if (!data.startsWith(BagMandateBytecode)) throw new Error('PROVIDER_GAS_CALL_FORBIDDEN: only BagMandate deployment is delegated');
          const args = decodeAbiParameters(parseAbiParameters('address,address,address,address,uint256,uint256,uint256,uint256,uint256,uint8,bytes32,uint256'), `0x${data.slice(BagMandateBytecode.length)}`);
          if (args[0].toLowerCase() !== current.ownerAddress || args[2].toLowerCase() !== raw.address.toLowerCase()) throw new Error('PROVIDER_GAS_CALL_FORBIDDEN: deployment must retain the authorized owner and provider enforcer');
        } else {
          const mandate = await this.db.query.mandates.findFirst({ where: sql`lower(${mandates.contractAddress}) = ${transaction.to.toLowerCase()}` });
          const allowed = ['execute(uint256,address,bytes32)', 'registerWorker(bytes32,bytes32,address,uint256,uint8)'].map(toFunctionSelector);
          if (mandate?.providerId !== provider || !allowed.some(selector => data.startsWith(selector))) throw new Error('PROVIDER_GAS_CALL_FORBIDDEN: target mandate or method is not delegated');
        }
        const fee = transaction.maxFeePerGas ?? transaction.gasPrice;
        if (!transaction.gas || fee === undefined || transaction.gas <= 0n || fee < 0n) throw new Error('PROVIDER_GAS_FEE_REQUIRED: a bounded gas limit and fee must be prepared before signing');
        const cost = transaction.gas * fee;
        const limit = parseEther(network === 'arkiv' ? a.arkivTxLimit : a.whitechainTxLimit);
        const budget = parseEther(network === 'arkiv' ? a.arkivBudget : a.whitechainBudget);
        if (cost > limit) throw new Error('PROVIDER_GAS_TX_LIMIT: estimated maximum gas exceeds the provider limit');
        const column = network === 'arkiv' ? providerGasAccounts.arkivReserved : providerGasAccounts.whitechainReserved;
        const field = network === 'arkiv' ? 'arkivReserved' : 'whitechainReserved';
        // Atomic reservation also rechecks revocation and the authorization nonce.
        const updated = await this.db.update(providerGasAccounts).set({ [field]: sql`${column} + ${cost.toString()}::numeric` }).where(sql`${providerGasAccounts.providerId} = ${provider} and ${providerGasAccounts.status} = 'active' and ${providerGasAccounts.expiresAt} > now() and ${providerGasAccounts.authorization}->>'nonce' = ${a.nonce} and ${column} + ${cost.toString()}::numeric <= ${budget.toString()}::numeric`).returning({ id: providerGasAccounts.providerId });
        if (!updated.length) throw new Error('PROVIDER_GAS_BUDGET: provider budget exhausted or authorization changed');
        // Reservations remain charged after signing, even if broadcast becomes uncertain.
        return raw.signTransaction(transaction, options);
      },
    };
    return account;
  }
}
