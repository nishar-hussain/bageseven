import { BagMandateAbi, workerKey } from '@bagseven/onchain';
import { decodeFunctionData, parseAbi, parseEventLogs, type Hex, type PublicClient } from 'viem';
/** Bind a reservation to the actual confirmed token transfer and worker call. */
export async function verifySettlement(client: PublicClient, input: {
  chain: number; confirmations: number; hash: Hex; vault: Hex; token: Hex; recipient: Hex; worker: string; amount: bigint;
}) {
  if (await client.getChainId() !== input.chain) throw Error('SETTLEMENT_CHAIN_MISMATCH');
  const receipt = await client.getTransactionReceipt({ hash: input.hash });
  const head = await client.getBlockNumber({ cacheTime: 0 });
  if (receipt.status !== 'success' || head < receipt.blockNumber + BigInt(input.confirmations - 1) ||
    receipt.to?.toLowerCase() !== input.vault.toLowerCase()) throw Error('SETTLEMENT_NOT_CONFIRMED');
  const tx = await client.getTransaction({ hash: input.hash });
  const call = decodeFunctionData({ abi: BagMandateAbi, data: tx.input });
  if (call.functionName !== 'execute' || call.args[0] !== input.amount ||
    call.args[1].toLowerCase() !== input.recipient.toLowerCase() || call.args[2] !== workerKey(input.worker)) throw Error('SETTLEMENT_CALL_MISMATCH');
  const logs = parseEventLogs({ abi: parseAbi(['event Transfer(address indexed from,address indexed to,uint256 value)']), logs: receipt.logs });
  if (!logs.some(log => log.address.toLowerCase() === input.token.toLowerCase() && log.args.from.toLowerCase() === input.vault.toLowerCase() &&
    log.args.to.toLowerCase() === input.recipient.toLowerCase() && log.args.value === input.amount)) throw Error('SETTLEMENT_TRANSFER_MISMATCH');
}
