import { ApiError } from '@bagseven/server';
import type { WhitechainSettleResult } from './whitechain-settle.js';

export type PaymentLedger = { claimPayment?: (hash: string) => Promise<boolean> };

/** All paid mint paths share the same persistent receipt ledger as checkout. */
export async function claimSettlement(settlement: WhitechainSettleResult, ledger: PaymentLedger): Promise<void> {
  if (settlement.mode === 'demo') return;
  if (!ledger.claimPayment) throw new ApiError(503, 'PAYMENT_LEDGER_UNAVAILABLE', 'Payment replay protection is unavailable');
  if (!await ledger.claimPayment(settlement.payment_tx)) throw new ApiError(409, 'PAYMENT_REUSED', 'This payment was already redeemed; use its existing entitlement');
}
