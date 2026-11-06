import { NextRequest, NextResponse } from 'next/server';
import { IDKitErrorCodes } from '@worldcoin/idkit-core';

/** Record only the error code and stage; never a proof, name, or identifier. */
export async function POST(req: NextRequest) {
  if (!req.cookies.get('bagseven_world_nonce')?.value || req.headers.get('origin') !== req.nextUrl.origin) {
    return NextResponse.json({ error: 'Invalid sign-in diagnostic request' }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  if (!body || !Object.values(IDKitErrorCodes).includes(body.code)) {
    return NextResponse.json({ error: 'Invalid World error code' }, { status: 400 });
  }
  console.warn('[world-login-error]', JSON.stringify({ code: body.code, stage: body.stage === 'backend' ? 'backend' : 'world_app' }));
  return new NextResponse(null, { status: 204 });
}
