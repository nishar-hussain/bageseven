/**
 * Hedera settlement seam for Mumbai (library helper).
 * Daemon prefers `services/daemon/src/hedera-x402.ts` for live facilitator settle.
 */
export type HederaSettlementInput = {
  paymentTx?: string;
  network?: 'testnet' | 'mainnet';
};

export type HederaSettlementResult = {
  payment_tx: string;
  settlement_network: 'hedera';
  hashscan_url: string;
  note: string;
};

export function recordHederaPayment(input: HederaSettlementInput = {}): HederaSettlementResult {
  const network = input.network ?? 'testnet';
  const payment_tx = input.paymentTx?.trim() || `0.0.9000@${Math.floor(Date.now() / 1000)}.demo`;
  return {
    payment_tx,
    settlement_network: 'hedera',
    hashscan_url: `https://hashscan.io/${network}/transaction/${encodeURIComponent(payment_tx)}`,
    note: input.paymentTx
      ? 'Using provided Hedera / HashScan payment id'
      : 'Demo payment id — replace with live x402 facilitator settlement before judging',
  };
}
