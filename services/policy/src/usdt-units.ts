import { ApiError } from '@bagseven/server';
import { formatUnits } from 'viem';

/** PostgreSQL NUMERIC(38,18) adds trailing zeros; only nonzero sub-micro precision is invalid. */
export function toUnits(amount: string): bigint {
  if (!/^\d+(\.\d+)?$/.test(amount)) throw new ApiError(400, 'AMOUNT_PRECISION', 'USDT amount must be a nonnegative decimal');
  const [whole = '0', fraction = ''] = amount.split('.');
  if (/[1-9]/.test(fraction.slice(6))) throw new ApiError(400, 'AMOUNT_PRECISION', 'USDT amounts must have at most six significant decimal places');
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0').slice(0, 6));
}
export function fromUnits(units: bigint): string { return formatUnits(units, 6); }
