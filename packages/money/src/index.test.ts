import { describe, expect, it } from 'vitest';
import { add, eq, gte, mul, sub, validateMoney } from './index.js';

describe('money', () => {
  it('validates canonical decimal strings', () => {
    expect(validateMoney('0')).toBe('0');
    expect(validateMoney('20.00')).toBe('20.00');
    expect(() => validateMoney('1e3')).toThrow();
    expect(() => validateMoney('-5')).toThrow();
    expect(() => validateMoney('0.0000000000000000001')).toThrow();
  });

  it('does decimal arithmetic without float drift', () => {
    expect(add('0.1', '0.2')).toBe('0.3');
    expect(sub('1.00', '0.99')).toBe('0.01');
    expect(mul('0.1', '0.1')).toBe('0.01');
    expect(gte('20.00', '20.00')).toBe(true);
    expect(gte('20.00', '20.01')).toBe(false);
    expect(eq('20.00', '20')).toBe(true);
  });
});