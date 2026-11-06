/**
 * Print a Whitechain settle result for README / demo.
 *   pnpm whitechain:settle
 */
import { readFileSync } from 'node:fs';
import { settleWhitechainUsdt } from '../services/daemon/src/whitechain-settle.js';

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
  const result = await settleWhitechainUsdt({
    amount: '1.00',
    feature: 'ocr',
    holder: 'demo-holder',
    reason: 'whitechain-demo-settle script',
  });

  console.log(JSON.stringify(result, null, 2));
  console.log('\nPaste into README:');
  console.log(`WHITECHAIN_PAYMENT_TX=${result.payment_tx}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
