import { expect, it } from 'vitest';
import { summarizeAccess } from '../lib/access-summary';

it('keeps feature units separate and does not add boolean access to credits', () => {
  const rows = summarizeAccess(
    [
      { feature: 'ocr', remaining: '8' },
      { feature: 'api', remaining: '19' },
      { feature: 'ocr', remaining: '2' },
      { feature: 'vip', remaining: '1' },
    ],
    [
      { id: 'ocr', label: 'OCR', value_type: 'numeric' },
      { id: 'api', label: 'API', value_type: 'numeric' },
      { id: 'vip', label: 'VIP', value_type: 'boolean' },
    ],
  );
  expect(rows.map(([id, r]) => [id, r.units, r.type, r.count])).toEqual([
    ['ocr', '10', 'numeric', 2],
    ['api', '19', 'numeric', 1],
    ['vip', '0', 'boolean', 1],
  ]);
});
it('preserves fractional credits and values beyond floating-point integer precision', () => {
  const rows = summarizeAccess(
    [
      { feature: 'ocr', remaining: '9007199254740993.1' },
      { feature: 'ocr', remaining: '0.2' },
    ],
    [{ id: 'ocr', label: 'OCR', value_type: 'numeric' }],
  );
  expect(rows[0]?.[1].units).toBe('9007199254740993.3');
});
it('does not invent a credit unit for an unknown feature', () => {
  expect(summarizeAccess([{ feature: 'new', remaining: '10' }], [])[0]?.[1]).toMatchObject({
    type: 'unknown',
    units: '0',
  });
});
