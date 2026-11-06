import { NextResponse } from 'next/server';
import { daemonJson } from '../../../../../lib/daemon-bff';

/** Login must be able to request a signed challenge before a session exists. */
export async function POST() {
  try {
    const result = await daemonJson<{ nonce?: string; expires_at?: number }>('/internal/world/rp-signature', {
      method: 'POST', body: JSON.stringify({ purpose: 'login' }),
    });
    const res = NextResponse.json(result.body, { status: result.status, headers: { 'cache-control': 'no-store' } });
    if (result.ok && result.body.nonce) res.cookies.set('bagseven_world_nonce', result.body.nonce, {
      httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/api/auth/world', maxAge: 300,
    });
    return res;
  } catch {
    return NextResponse.json({ error: { message: 'World verification service is unavailable' } }, { status: 503 });
  }
}
