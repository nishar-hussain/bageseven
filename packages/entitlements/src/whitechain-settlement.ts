/** Whitechain settlement seam (library helper). Daemon uses `whitechain-settle.ts` for live stamps. */

export type WhitechainSettlementInput = {
  paymentTx?: string;
  network?: 'testnet' | 'mainnet';
};

export type WhitechainSettlementResult = {
  payment_tx: string;
  settlement_network: 'whitechain';
  explorer_url: string;
  note: string;
};

export function explorerUrl(paymentTx: string, network: 'testnet' | 'mainnet' = 'testnet'): string {
  const base = network === 'mainnet' ? 'https://explorer.whitechain.io' : 'https://explorer.testnet.whitechain.io';
  return `${base}/tx/${paymentTx}`;
}

export function recordWhitechainPayment(input: WhitechainSettlementInput = {}): WhitechainSettlementResult {
  const network = input.network ?? 'testnet';
  const payment_tx = input.paymentTx?.trim() || `0x${'ab'.repeat(32)}`;
  return {
    payment_tx,
    settlement_network: 'whitechain',
    explorer_url: explorerUrl(payment_tx, network),
    note: input.paymentTx
      ? 'Using provided Whitechain explorer payment id'
      : 'Demo payment id — replace with a live Whitechain USDT stamp before judging',
  };
}
