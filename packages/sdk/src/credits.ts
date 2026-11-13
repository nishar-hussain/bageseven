/** Sum decimal credit units without floating-point rounding. */
export function sumCredits(values: string[]): string {
  const parts = values.map(value => {
    if (!/^\d+(?:\.\d+)?$/.test(value)) throw new Error('Invalid credit balance');
    const [whole, fraction = ''] = value.split('.');
    return { whole, fraction };
  });
  const scale = Math.max(0, ...parts.map(part => part.fraction.length));
  const total = parts.reduce((sum, part) => sum + BigInt(part.whole + part.fraction.padEnd(scale, '0')), 0n);
  if (!scale) return total.toString();
  const digits = total.toString().padStart(scale + 1, '0');
  return `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/\.?0+$/, '');
}
