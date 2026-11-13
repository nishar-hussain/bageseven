import { keccak256, parseEther, parseTransaction, recoverTransactionAddress } from 'viem';

export async function validateFujiGasFunding(plan, raw) {
  if (
    plan.kind !== 'bagseven_fuji_gas_v1' ||
    plan.chainId !== 43113 ||
    !/^0x[\da-f]{40}$/i.test(plan.owner ?? '') ||
    !/^0x[\da-f]{40}$/i.test(plan.to ?? '') ||
    /^0x0{40}$/i.test(plan.to) ||
    !Number.isSafeInteger(plan.nonce) ||
    plan.nonce < 0 ||
    ![plan.value, plan.gas, plan.maxFeePerGas, plan.maxPriorityFeePerGas].every(
      (v) => typeof v === 'string' && /^\d+$/.test(v),
    ) ||
    BigInt(plan.value) <= 0n ||
    BigInt(plan.value) > parseEther('0.1') ||
    BigInt(plan.gas) <= 0n ||
    BigInt(plan.maxFeePerGas) <= 0n ||
    BigInt(plan.maxPriorityFeePerGas) > BigInt(plan.maxFeePerGas)
  )
    throw Error('Invalid Fuji gas funding plan');
  const tx = parseTransaction(raw);
  if (
    tx.type !== 'eip1559' ||
    tx.chainId !== 43113 ||
    tx.nonce !== plan.nonce ||
    tx.to?.toLowerCase() !== plan.to.toLowerCase() ||
    tx.value !== BigInt(plan.value) ||
    tx.gas !== BigInt(plan.gas) ||
    tx.maxFeePerGas !== BigInt(plan.maxFeePerGas) ||
    tx.maxPriorityFeePerGas !== BigInt(plan.maxPriorityFeePerGas) ||
    (tx.data && tx.data !== '0x') ||
    tx.accessList?.length
  )
    throw Error('Signed funding differs from the reviewed transaction');
  if (
    (await recoverTransactionAddress({ serializedTransaction: raw })).toLowerCase() !==
    plan.owner.toLowerCase()
  )
    throw Error('Funding signer mismatch');
  return keccak256(raw);
}
