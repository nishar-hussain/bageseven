import { Decimal } from 'decimal.js';

Decimal.set({ precision: 38 });

/**
 * Bagseven never uses floating point for money.
 * All monetary values are canonical decimal strings with at most 18 fractional digits,
 * matching the NUMERIC(38,18) columns in PostgreSQL.
 */
export const SCALE = 18;

const DECIMAL_RE = /^\d+(\.\d{1,18})?$/;

export function validateMoney(value: string): string {
  if (typeof value !== 'string' || !DECIMAL_RE.test(value)) {
    throw new TypeError(`invalid money value: ${JSON.stringify(value)}`);
  }
  const d = new Decimal(value);
  if (d.isNaN() || d.isNegative() || !d.isFinite()) {
    throw new TypeError(`invalid money value: ${value}`);
  }
  return value;
}

export function add(a: string, b: string): string {
  return new Decimal(a).add(b).toString();
}

export function sub(a: string, b: string): string {
  return new Decimal(a).sub(b).toString();
}

export function mul(a: string, b: string): string {
  return new Decimal(a).mul(b).toString();
}

export function div(a: string, b: string): string {
  if (new Decimal(b).isZero()) throw new Error('division by zero');
  return new Decimal(a).div(b).toString();
}

export function gte(a: string, b: string): boolean {
  return new Decimal(a).gte(b);
}

export function gt(a: string, b: string): boolean {
  return new Decimal(a).gt(b);
}

export function lte(a: string, b: string): boolean {
  return new Decimal(a).lte(b);
}

export function lt(a: string, b: string): boolean {
  return new Decimal(a).lt(b);
}

export function eq(a: string, b: string): boolean {
  return new Decimal(a).eq(b);
}

export function isZero(a: string): boolean {
  return new Decimal(a).isZero();
}

export function max(a: string, b: string): string {
  return Decimal.max(a, b).toString();
}

export function min(a: string, b: string): string {
  return Decimal.min(a, b).toString();
}

export function clamp(a: string, lo: string, hi: string): string {
  return Decimal.min(hi, Decimal.max(lo, a)).toString();
}

export const ZERO = '0';

/**
 * Exact conversion between decimal-money strings and integer micro-units (1e-6),
 * used for Redis counters / on-chain USDC (6 decimals). Never uses floating point.
 */
export function toMicroUnits(amount: string): string {
  const [int = '0', frac = ''] = amount.split('.');
  const fracPadded = `${frac}000000`.slice(0, 6);
  const units = BigInt(int) * 1_000_000n + BigInt(fracPadded);
  return units.toString();
}

export function fromMicroUnits(units: string): string {
  const u = BigInt(units);
  const int = u / 1_000_000n;
  const frac = (u % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return frac ? `${int}.${frac}` : `${int}`;
}
