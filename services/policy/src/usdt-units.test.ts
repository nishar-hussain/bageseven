import { describe, expect, it } from 'vitest';
import { fromUnits, toUnits } from './usdt-units.js';
describe('USDT database and chain precision', () => {
  it('accepts NUMERIC(38,18) padding without rounding child allocations', () => {
    expect(toUnits('0.100000000000000000')).toBe(100000n);
    expect(fromUnits(toUnits('0.100000000000000000') / 100n)).toBe('0.001');
    expect(fromUnits(100n)).toBe('0.0001');
  });
  it('preserves amounts beyond JavaScript integer precision', () => {
    expect(fromUnits(toUnits('9007199254740993.000001'))).toBe('9007199254740993.000001');
  });
  it('rejects nonzero precision below a micro-USDT', () => {
    expect(() => toUnits('0.0000001')).toThrow('six significant');
    expect(() => toUnits('-1')).toThrow();
  });
});
