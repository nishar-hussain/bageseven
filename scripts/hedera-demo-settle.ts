/**
 * Print a Hedera settle result for README / demo (facilitator or demo mode).
 *   pnpm hedera:settle
 */
import { readFileSync } from 'node:fs';
import { settleHederaX402 } from '../services/daemon/src/hedera-x402.js';

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
  const result = await settleHederaX402({
    amount: '1.00',
    feature: 'ocr',
    holder: 'demo-holder',
    reason: 'hedera-demo-settle script',
  });

  console.log(JSON.stringify(result, null, 2));
  console.log('\nPaste into README:');
  console.log(`HEDERA_PAYMENT_TX_ID=${result.payment_tx}`);
  console.log(result.hashscan_url);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
