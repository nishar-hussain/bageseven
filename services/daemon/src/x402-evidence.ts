import { BagMandateAbi, workerKey } from '@bagseven/onchain';
import { decodeFunctionData, parseAbi, parseEventLogs, parseTransaction, keccak256, type Hex, type PublicClient } from 'viem';
import type { X402Job } from './x402-job-store.js';
const events = parseAbi([
  'event Transfer(address indexed from,address indexed to,uint256 value)',
  'event AuthorizationUsed(address indexed authorizer,bytes32 indexed nonce)',
]);
const tokenAbi = parseAbi(['function authorizationState(address,bytes32) view returns(bool)']);

/** All payment conclusions come from the configured chain, not an HTTP success flag. */
export class X402Evidence {
  constructor(private client: PublicClient, private confirmations: number) {}
  validateFundingBytes(job: X402Job, raw: Hex) {
    const tx = parseTransaction(raw), terms = job.data.authority;
    if (tx.chainId !== terms.chain_id || tx.to?.toLowerCase() !== terms.mandate_contract || BigInt(tx.value ?? 0) !== 0n) throw Error('X402_FUNDING_TRANSACTION_MISMATCH');
    const decoded = decodeFunctionData({ abi: BagMandateAbi, data: tx.data ?? '0x' });
    if (decoded.functionName !== 'execute' || decoded.args[0] !== BigInt(job.data.amount) ||
      decoded.args[1].toLowerCase() !== terms.payer || decoded.args[2] !== workerKey(terms.worker_id)) throw Error('X402_FUNDING_TRANSACTION_MISMATCH');
    return keccak256(raw);
  }
  private async receipt(hash: Hex) {
    let receipt;
    try { receipt = await this.client.getTransactionReceipt({ hash }); }
    catch (error) { if ((error as { name?: string }).name === 'TransactionReceiptNotFoundError') return null; throw error; }
    const head = await this.client.getBlockNumber({ cacheTime: 0 });
    if (head < receipt.blockNumber + BigInt(this.confirmations - 1)) return null;
    return receipt;
  }
  async funding(job: X402Job) {
    if (!job.data.fundingHash || !job.data.fundingRaw) return null;
    if (this.validateFundingBytes(job, job.data.fundingRaw as Hex) !== job.data.fundingHash) throw Error('X402_FUNDING_HASH_MISMATCH');
    const receipt = await this.receipt(job.data.fundingHash as Hex);
    if (!receipt) return null;
    if (receipt.status !== 'success') throw Error('X402_FUNDING_REVERTED');
    if (receipt.to?.toLowerCase() !== job.data.authority.mandate_contract) throw Error('X402_FUNDING_TRANSACTION_MISMATCH');
    const tx = await this.client.getTransaction({ hash: job.data.fundingHash as Hex });
    const decoded = decodeFunctionData({ abi: BagMandateAbi, data: tx.input });
    if (decoded.functionName !== 'execute' || decoded.args[0] !== BigInt(job.data.amount) ||
      decoded.args[1].toLowerCase() !== job.data.authority.payer || decoded.args[2] !== workerKey(job.data.authority.worker_id)) throw Error('X402_FUNDING_TRANSACTION_MISMATCH');
    const transfers = parseEventLogs({ abi: events, logs: receipt.logs, eventName: 'Transfer' });
    if (!transfers.some(log => log.address.toLowerCase() === job.data.authority.token &&
      log.args.from.toLowerCase() === job.data.authority.mandate_contract && log.args.to.toLowerCase() === job.data.authority.payer &&
      log.args.value === BigInt(job.data.amount))) throw Error('X402_FUNDING_TRANSFER_MISMATCH');
    return receipt;
  }
  async settlement(job: X402Job, hash: Hex, refund: boolean) {
    const authorization = refund ? job.data.refundAuthorization : job.data.authorization;
    if (!authorization) return null;
    const receipt = await this.receipt(hash);
    if (!receipt || receipt.status !== 'success') return null;
    const used = parseEventLogs({ abi: events, logs: receipt.logs, eventName: 'AuthorizationUsed' });
    const transfers = parseEventLogs({ abi: events, logs: receipt.logs, eventName: 'Transfer' });
    const terms = job.data.authority;
    const target = refund ? terms.mandate_contract : terms.merchant;
    if (!used.some(log => log.address.toLowerCase() === terms.token && log.args.authorizer.toLowerCase() === terms.payer &&
      log.args.nonce.toLowerCase() === authorization.nonce.toLowerCase())) return null;
    if (!transfers.some(log => log.address.toLowerCase() === terms.token && log.args.from.toLowerCase() === terms.payer &&
      log.args.to.toLowerCase() === target && log.args.value === BigInt(job.data.amount))) throw Error('X402_SETTLEMENT_TRANSFER_MISMATCH');
    return receipt;
  }
  async locateAuthorization(job: X402Job, refund: boolean): Promise<{ used: boolean; hash?: Hex; scannedTo?: bigint }> {
    const authorization = refund ? job.data.refundAuthorization : job.data.authorization;
    if (!authorization) return { used: false };
    const terms = job.data.authority;
    const used = await this.client.readContract({ address: terms.token as Hex, abi: tokenAbi,
      functionName: 'authorizationState', args: [terms.payer as Hex, authorization.nonce as Hex] });
    if (!used) return { used: false };
    const head = await this.client.getBlockNumber({ cacheTime: 0 });
    const confirmed = head >= BigInt(this.confirmations - 1) ? head - BigInt(this.confirmations - 1) : 0n;
    const cursor = refund ? job.data.refundScanBlock : job.data.paymentScanBlock;
    const fromBlock = BigInt(cursor ?? job.data.fundingBlock ?? '0');
    if (fromBlock > confirmed) return { used: true };
    const toBlock = fromBlock + 1999n < confirmed ? fromBlock + 1999n : confirmed;
    const logs = await this.client.getLogs({ address: terms.token as Hex, event: events[1],
      args: { authorizer: terms.payer as Hex, nonce: authorization.nonce as Hex }, fromBlock, toBlock });
    return { used: true, hash: logs[0]?.transactionHash ?? undefined, scannedTo: logs.length ? undefined : toBlock + 1n };
  }
  async confirmedTime() {
    const head = await this.client.getBlockNumber({ cacheTime: 0 });
    const number = head >= BigInt(this.confirmations - 1) ? head - BigInt(this.confirmations - 1) : 0n;
    return Number((await this.client.getBlock({ blockNumber: number })).timestamp);
  }
}
