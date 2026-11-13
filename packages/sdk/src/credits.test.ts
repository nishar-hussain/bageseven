import { describe, expect, it } from 'vitest';
import { sumCredits } from './credits.js';
describe('multi-grant credit totals', () => {
  it('adds fractional credits exactly and preserves whole-unit zeros', () => {
    expect(sumCredits(['0.1', '0.2'])).toBe('0.3');
    expect(sumCredits(['1.98', '8.02'])).toBe('10');
    expect(sumCredits(['9007199254740993', '1'])).toBe('9007199254740994');
    expect(sumCredits(['0.00'])).toBe('0');
    expect(sumCredits([])).toBe('0');
  });
});
