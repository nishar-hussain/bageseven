import { randomUUID } from 'node:crypto';
import {
  AccountId,
  Client,
  Hbar,
  PrivateKey,
  TransferTransaction,
} from '@hashgraph/sdk';

export type HederaSettleInput = {
  amount: string;
  feature: string;
  holder: string;
  grant_id?: string;
  /** Existing HashScan / facilitator tx if client already paid. */
  payment_tx?: string;
  reason?: string;
};

export type HederaSettleResult = {
  payment_tx: string;
  settlement_network: 'hedera';
  network: 'testnet' | 'mainnet';
  hashscan_url: string;
  facilitator: string;
  hcs?: {
    topic_id: string;
    message: string;
    note: string;
  };
  mode: 'facilitator' | 'provided' | 'demo' | 'operator';
};

function networkFromEnv(env: NodeJS.ProcessEnv): 'testnet' | 'mainnet' {
  return env.HEDERA_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';
}

function hashscanUrl(network: 'testnet' | 'mainnet', txId: string): string {
  const path = txId.includes('@') || txId.includes('-')
    ? `transaction/${encodeURIComponent(txId)}`
    : `transaction/${encodeURIComponent(txId)}`;
  return `https://hashscan.io/${network}/${path}`;
}

function toHashScanTxId(txId: { toString(): string }): string {
  // SDK prints `0.0.x@seconds.nanos` — HashScan accepts that form.
  return txId.toString();
}

/**
 * Live stamp: 1 tinybar self-transfer (or to HEDERA_PAY_TO) signed by portal keys.
 * Used when Blocky402-style /settle needs a full payment payload we don't build yet.
 */
async function operatorStampSettle(
  input: HederaSettleInput,
  env: NodeJS.ProcessEnv,
  network: 'testnet' | 'mainnet',
): Promise<HederaSettleResult | null> {
  const accountId = env.HEDERA_ACCOUNT_ID?.trim();
  const privateKey = env.HEDERA_PRIVATE_KEY?.trim();
  if (!accountId || !privateKey) return null;

  const client = network === 'mainnet' ? Client.forMainnet() : Client.forTestnet();
  try {
    const operatorId = AccountId.fromString(accountId);
    const key = privateKey.startsWith('0x')
      ? PrivateKey.fromStringECDSA(privateKey)
      : PrivateKey.fromStringECDSA(privateKey.startsWith('302e') ? privateKey : `0x${privateKey}`);
    client.setOperator(operatorId, key);

    // Hedera rejects same-account transfers; default counterparty is 0.0.98 (network fee sink).
    const payToRaw = env.HEDERA_PAY_TO?.trim() || '';
    const payTo = AccountId.fromString(
      payToRaw && payToRaw !== accountId ? payToRaw : '0.0.98',
    );
    const memo = `bagseven:${input.feature}:${input.holder}`.slice(0, 100);

    const tx = await new TransferTransaction()
      .addHbarTransfer(operatorId, Hbar.fromTinybars(-1))
      .addHbarTransfer(payTo, Hbar.fromTinybars(1))
      .setTransactionMemo(memo)
      .execute(client);
    const receipt = await tx.getReceipt(client);
    if (receipt.status.toString() !== 'SUCCESS') {
      throw new Error(`HEDERA_OPERATOR_STAMP_FAILED: ${receipt.status.toString()}`);
    }
    const payment_tx = toHashScanTxId(tx.transactionId!);
    return {
      payment_tx,
      settlement_network: 'hedera',
      network,
      hashscan_url: hashscanUrl(network, payment_tx),
      facilitator: 'hedera-operator-stamp',
      mode: 'operator',
    };
  } finally {
    client.close();
  }
}

/**
 * Settle (or record) a Hedera x402 payment for buy_credits / paid provider path.
 *
 * Priority:
 * 1. Caller-provided payment_tx (already on HashScan)
 * 2. POST to HEDERA_X402_FACILITATOR_URL (when it accepts a settle body)
 * 3. Operator stamp via HEDERA_ACCOUNT_ID + HEDERA_PRIVATE_KEY (live testnet tx)
 * 4. Demo settle id when HEDERA_DEMO_SETTLE!=false
 */
export async function settleHederaX402(
  input: HederaSettleInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<HederaSettleResult> {
  const network = networkFromEnv(env);
  const topicId = env.HEDERA_HCS_TOPIC_ID?.trim();

  const attachHcs = (payment_tx: string, mode: HederaSettleResult['mode']): HederaSettleResult['hcs'] => {
    if (!topicId) return undefined;
    const message = JSON.stringify({
      type: 'bagseven.payment_join',
      payment_tx,
      grant_id: input.grant_id ?? null,
      feature: input.feature,
      holder: input.holder,
      amount: input.amount,
      at: new Date().toISOString(),
    });
    return {
      topic_id: topicId,
      message,
      note:
        mode === 'facilitator' || mode === 'operator'
          ? 'Join payload prepared for HCS submit via operator'
          : 'HCS topic configured — submit join message with operator credentials in demo script',
    };
  };

  if (input.payment_tx?.trim()) {
    const payment_tx = input.payment_tx.trim();
    return {
      payment_tx,
      settlement_network: 'hedera',
      network,
      hashscan_url: hashscanUrl(network, payment_tx),
      facilitator: 'client-provided',
      hcs: attachHcs(payment_tx, 'provided'),
      mode: 'provided',
    };
  }

  const facilitatorUrl = env.HEDERA_X402_FACILITATOR_URL?.replace(/\/$/, '');
  if (facilitatorUrl) {
    const res = await fetch(`${facilitatorUrl}/settle`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(env.HEDERA_X402_FACILITATOR_KEY
          ? { authorization: `Bearer ${env.HEDERA_X402_FACILITATOR_KEY}` }
          : {}),
      },
      body: JSON.stringify({
        network: `hedera:${network}`,
        scheme: 'exact',
        amount: input.amount,
        payTo: env.HEDERA_PAY_TO ?? env.HEDERA_ACCOUNT_ID,
        asset: env.HEDERA_USDC_TOKEN_ID ?? 'USDC',
        extra: {
          feature: input.feature,
          holder: input.holder,
          reason: input.reason,
          accountId: env.HEDERA_ACCOUNT_ID,
        },
      }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      transaction?: string;
      tx_id?: string;
      payment_tx?: string;
      error?: string;
      message?: string;
    };
    if (res.ok) {
      const payment_tx = body.payment_tx ?? body.transaction ?? body.tx_id;
      if (!payment_tx) throw new Error('HEDERA_X402_SETTLE_FAILED: facilitator returned no tx id');
      return {
        payment_tx,
        settlement_network: 'hedera',
        network,
        hashscan_url: hashscanUrl(network, payment_tx),
        facilitator: facilitatorUrl,
        hcs: attachHcs(payment_tx, 'facilitator'),
        mode: 'facilitator',
      };
    }
    // Blocky402 needs a signed paymentPayload — fall through to operator stamp / demo.
  }

  const stamped = await operatorStampSettle(input, env, network);
  if (stamped) {
    return { ...stamped, hcs: attachHcs(stamped.payment_tx, 'operator') };
  }

  const prod = (env.NODE_ENV ?? 'development') === 'production';
  const demoDefault = prod ? 'false' : 'true';
  if ((env.HEDERA_DEMO_SETTLE ?? demoDefault).toLowerCase() === 'false') {
    throw new Error(
      'HEDERA_X402_UNCONFIGURED: set HEDERA_ACCOUNT_ID+HEDERA_PRIVATE_KEY (operator stamp), HEDERA_X402_FACILITATOR_URL with a payment payload, or pass payment_tx (or HEDERA_DEMO_SETTLE=true for non-prod)',
    );
  }

  const payment_tx = `0.0.${env.HEDERA_ACCOUNT_ID?.split('.').pop() ?? '9000'}@${Math.floor(Date.now() / 1000)}.${randomUUID().slice(0, 8)}`;
  return {
    payment_tx,
    settlement_network: 'hedera',
    network,
    hashscan_url: hashscanUrl(network, payment_tx),
    facilitator: 'bagseven-demo-settle',
    hcs: attachHcs(payment_tx, 'demo'),
    mode: 'demo',
  };
}

/** Persist join of payment ↔ grant ↔ consume for audit demos. */
export function buildHcsJoin(input: {
  payment_tx: string;
  grant_id: string;
  consume_id?: string;
}): string {
  return JSON.stringify({
    type: 'bagseven.audit_join',
    payment_tx: input.payment_tx,
    grant_id: input.grant_id,
    consume_id: input.consume_id ?? null,
    at: new Date().toISOString(),
  });
}
