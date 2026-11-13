/** Avalanche settlement seam (library helper). Daemon uses the live settlement module for stamps. */

export type AvalancheSettlementInput = {
  paymentTx: string;
  network?: 'fuji' | 'mainnet';
};

export type AvalancheSettlementResult = {
  payment_tx: string;
  settlement_network: 'avalanche';
  explorer_url: string;
  note: string;
};

export function explorerUrl(paymentTx: string, network: 'fuji' | 'mainnet' = 'fuji'): string {
  const base = network === 'mainnet' ? 'https://snowtrace.io' : 'https://testnet.snowtrace.io';
  return `${base}/tx/${paymentTx}`;
}

export function recordAvalanchePayment(input: AvalancheSettlementInput): AvalancheSettlementResult {
  const network = input.network ?? 'fuji';
  const payment_tx = input.paymentTx?.trim();
  if (!/^0x[\da-f]{64}$/i.test(payment_tx || '')) throw Error('PAYMENT_TRANSACTION_REQUIRED');
  return {
    payment_tx,
    settlement_network: 'avalanche',
    explorer_url: explorerUrl(payment_tx, network),
    note: 'Transaction reference only; verify its receipt before issuing access',
  };
}
