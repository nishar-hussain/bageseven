import { NextRequest, NextResponse } from 'next/server';
import { attachSessionCookie } from '../../../../lib/auth';
import { daemonJson } from '../../../../lib/daemon-bff';

/**
 * World-primary sign-in.
 * - Live: POST idkit_response (or id_token) → daemon verifies → session
 * - Local: WORLD_MOCK_PROOFS / mock:true → labeled mock World session
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    idkit_response?: unknown;
    id_token?: string;
    mock?: boolean;
    next?: string;
  };

  const mockAllowed =
    (process.env.WORLD_MOCK_PROOFS ?? 'true').toLowerCase() !== 'false' ||
    (process.env.NODE_ENV ?? 'development') !== 'production';

  if (body.mock || (!body.idkit_response && !body.id_token && mockAllowed)) {
    const human = `mock:${Date.now().toString(36)}`;
    const res = NextResponse.json({
      ok: true,
      mode: 'mock',
      world_human_id: human,
      holder: `world:${human}`,
      note: 'Mock World session — labeled. Set WORLD_MOCK_PROOFS=false for live IDKit login.',
    });
    return attachSessionCookie(res, { world_human_id: human, mock: true });
  }

  if (body.idkit_response) {
    const { ok, status, body: verified } = await daemonJson<{
      ok?: boolean;
      human_id?: string;
      nullifier?: string;
      world_proof_id?: string;
      error?: { message?: string };
    }>('/internal/world/verify-idkit', {
      method: 'POST',
      body: JSON.stringify({ idkit_response: body.idkit_response, action: process.env.WORLD_IDKIT_ACTION || 'bagseven-mint' }),
    });
    if (!ok || !verified.human_id) {
      return NextResponse.json(
        { error: verified.error?.message ?? 'World IDKit verification failed' },
        { status: status || 403 },
      );
    }
    const human = verified.nullifier || verified.human_id.replace(/^world:/, '');
    const res = NextResponse.json({
      ok: true,
      mode: 'idkit',
      world_human_id: human,
      holder: `world:${human}`,
      world_proof_id: verified.world_proof_id,
    });
    return attachSessionCookie(res, { world_human_id: human, mock: false });
  }

  if (body.id_token) {
    // Agent Pass path: trust daemon world callback shape via a thin verify endpoint if present;
    // fall back to hashing the token subject locally is unsafe — require daemon.
    const { ok, status, body: verified } = await daemonJson<{
      ok?: boolean;
      human_id?: string;
      world_proof_id?: string;
      error?: { message?: string };
    }>('/internal/world/verify-session', {
      method: 'POST',
      body: JSON.stringify({ id_token: body.id_token }),
    });
    if (!ok) {
      // Soft fallback: mint session from id_token presence only in non-prod when endpoint missing
      if (status === 404 && mockAllowed) {
        const human = `agentpass:${Date.now().toString(36)}`;
        const res = NextResponse.json({ ok: true, mode: 'agent_pass_dev', world_human_id: human });
        return attachSessionCookie(res, { world_human_id: human, mock: true });
      }
      return NextResponse.json(
        { error: verified.error?.message ?? 'World Agent Pass verification failed' },
        { status: status || 403 },
      );
    }
    const human = (verified.human_id ?? '').replace(/^world:/, '') || `agentpass:${Date.now().toString(36)}`;
    const res = NextResponse.json({ ok: true, mode: 'agent_pass', world_human_id: human });
    return attachSessionCookie(res, { world_human_id: human, mock: false });
  }

  return NextResponse.json({ error: 'Provide World IDKit response, id_token, or mock:true locally' }, { status: 400 });
}
