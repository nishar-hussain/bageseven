import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { worldIdKitConfig, worldMocksAllowed } from '@bagseven/world';
import { attachSessionCookie } from '../../../../lib/auth';
import { daemonJson } from '../../../../lib/daemon-bff';

/** Public configuration contains IDs and readiness only, never signing keys. */
export async function GET() {
  return NextResponse.json(worldIdKitConfig(), { headers: { 'cache-control': 'no-store' } });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { idkit_response?: unknown; id_token?: string; mock?: boolean };
  if (body.mock) {
    if (!worldMocksAllowed()) return NextResponse.json({ error: 'Mock World login is disabled' }, { status: 403 });
    const human = `mock:${randomUUID()}`;
    return attachSessionCookie(NextResponse.json({ ok: true, mode: 'mock', world_human_id: human }), { world_human_id: human, mock: true });
  }

  const idkit = body.idkit_response as { nonce?: unknown } | undefined;
  if (idkit) {
    const nonce = req.cookies.get('bagseven_world_nonce')?.value;
    if (!nonce || idkit.nonce !== nonce) return NextResponse.json({ error: 'Start World ID sign-in again; this proof does not match your sign-in request' }, { status: 403 });
  } else if (!body.id_token) {
    return NextResponse.json({ error: 'Complete World ID verification to sign in' }, { status: 400 });
  }

  try {
    const result = await daemonJson<{ ok?: boolean; mode?: string; human_id?: string; nullifier?: string; world_proof_id?: string; error?: { message?: string } }>(
      idkit ? '/internal/world/verify-idkit' : '/internal/world/verify-session',
      { method: 'POST', body: JSON.stringify(idkit ? { idkit_response: idkit } : { id_token: body.id_token }) },
    );
    if (!result.ok || !result.body.ok || !result.body.human_id) {
      return NextResponse.json({ error: result.body.error?.message ?? 'World verification failed' }, { status: result.ok ? 403 : result.status });
    }
    const human = result.body.nullifier || result.body.human_id;
    const res = attachSessionCookie(NextResponse.json({ ok: true, mode: idkit ? 'idkit' : 'agent_pass', world_human_id: human, world_proof_id: result.body.world_proof_id }), { world_human_id: human, mock: false });
    res.cookies.set('bagseven_world_nonce', '', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/api/auth/world', maxAge: 0 });
    return res;
  } catch {
    return NextResponse.json({ error: 'World verification service is unavailable; please try again' }, { status: 503 });
  }
}
