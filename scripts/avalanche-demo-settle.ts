/**
 * Print a Avalanche settle result for README / demo.
 *   pnpm avalanche:settle
 */
import { readFileSync } from 'node:fs';
import { settleAvalancheUsdt } from '../services/daemon/src/avalanche-settle.js';

try {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i > 0 && process.env[line.slice(0, i)] === undefined) {
      process.env[line.slice(0, i)] = line.slice(i + 1);
    }
  }
} catch {
  /* optional */
}

async function main(): Promise<void> {
  const result = await settleAvalancheUsdt({
    amount: '1.00',
    feature: 'ocr',
    holder: 'demo-holder',
    reason: 'avalanche-demo-settle script',
  });

  console.log(JSON.stringify(result, null, 2));
  console.log('\nPaste into README:');
  console.log(`AVALANCHE_PAYMENT_TX=${result.payment_tx}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
