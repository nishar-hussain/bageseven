import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { worldIdKitConfig, worldMocksAllowed } from '@bagseven/world';
import { attachSessionCookie } from '../../../../lib/auth';
import { daemonJson } from '../../../../lib/daemon-bff';

/** Public configuration contains IDs and readiness only, never signing keys. */
export async function GET() {
  const cfg = worldIdKitConfig();
  return NextResponse.json(
    {
      app_id: cfg.app_id,
      rp_id: cfg.rp_id,
      action: cfg.action,
      login_action: cfg.login_action,
      login_signal: cfg.login_signal,
      environment: cfg.environment,
      mock_proofs: cfg.mock_proofs,
      idkit: cfg.idkit && cfg.signing_configured,
      signing_configured: cfg.signing_configured,
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    idkit_response?: unknown;
    id_token?: string;
    mock?: boolean;
    challenge_nonce?: string;
  };
  if (body.mock) {
    if (!worldMocksAllowed()) return NextResponse.json({ error: 'Mock World login is disabled' }, { status: 403 });
    const human = `mock:${randomUUID()}`;
    return attachSessionCookie(NextResponse.json({ ok: true, mode: 'mock', world_human_id: human }), {
      world_human_id: human,
      mock: true,
    });
  }

  const idkit = body.idkit_response as { nonce?: unknown } | undefined;
  if (idkit) {
    const cookieNonce = req.cookies.get('bagseven_world_nonce')?.value;
    const clientNonce = typeof body.challenge_nonce === 'string' ? body.challenge_nonce : undefined;
    const expected = cookieNonce || clientNonce;
    if (!expected || idkit.nonce !== expected) {
      return NextResponse.json(
        { error: 'Start World ID sign-in again; this proof does not match your sign-in request' },
        { status: 403 },
      );
    }
  } else if (!body.id_token) {
    return NextResponse.json({ error: 'Complete World ID verification to sign in' }, { status: 400 });
  }

  try {
    const result = await daemonJson<{
      ok?: boolean;
      mode?: string;
      human_id?: string;
      nullifier?: string;
      world_proof_id?: string;
      session_id?: string | null;
      returning?: boolean;
      error?: { message?: string; code?: string; detail?: string };
    }>(idkit ? '/internal/world/verify-idkit' : '/internal/world/verify-session', {
      method: 'POST',
      body: JSON.stringify(idkit ? { idkit_response: idkit } : { id_token: body.id_token }),
    });
    if (!result.ok || !result.body.ok || !result.body.human_id) {
      const detail =
        result.body.error?.detail ||
        result.body.error?.message ||
        'World verification failed';
      return NextResponse.json({ error: detail }, { status: result.ok ? 403 : result.status });
    }
    const human = result.body.nullifier || result.body.human_id;
    const returning = Boolean(result.body.returning);
    // Returning humans already finished (or skipped) onboarding once — skip the wizard.
    // Brand-new World sessions go through skippable email + optional wallet.
    const onboardingDoneAt = returning ? Math.floor(Date.now() / 1000) : null;
    const res = attachSessionCookie(
      NextResponse.json({
        ok: true,
        mode: idkit ? 'idkit' : 'agent_pass',
        world_human_id: human,
        world_proof_id: result.body.world_proof_id,
        session_id: result.body.session_id ?? null,
        returning,
        needs_onboarding: !returning,
      }),
      {
        world_human_id: human,
        mock: false,
        onboarding_done_at: onboardingDoneAt,
      },
    );
    res.cookies.set('bagseven_world_nonce', '', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 0,
    });
    return res;
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'World verification service is unavailable; please try again',
      },
      { status: 503 },
    );
  }
}
