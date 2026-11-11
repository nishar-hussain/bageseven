import { NextResponse } from 'next/server';

/**
 * Wallets cannot be attached by posting an address. A client must complete
 * /api/auth/wallet/verify so the address is backed by an account-bound signature.
 */
export async function POST() {
  return NextResponse.json(
    { error: 'Link a wallet by signing the ownership message from the connected Avalanche wallet.' },
    { status: 410 },
  );
}
