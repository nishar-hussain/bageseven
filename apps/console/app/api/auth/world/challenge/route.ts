import { NextRequest, NextResponse } from 'next/server';
import { readWorldContinuity, WORLD_CONTINUITY_COOKIE } from '../../../../../lib/world-continuity';
import { daemonJson } from '../../../../../lib/daemon-bff';

/** Login must be able to request a signed challenge before a session exists. */
export async function POST(req: NextRequest) {
  const existingSession = readWorldContinuity(req.cookies.get(WORLD_CONTINUITY_COOKIE)?.value);
  try {
    const result = await daemonJson<{
      nonce?: string;
      expires_at?: number;
      sig?: string;
      created_at?: number;
      rp_id?: string;
      app_id?: string;
      action?: string;
      existing_session_id?: string;
      environment?: string;
      error?: { message?: string; code?: string };
    }>('/internal/world/rp-signature', {
      method: 'POST',
      body: JSON.stringify({ purpose: 'session', ...(existingSession ? { existing_session_id: existingSession } : {}) }),
    });
    if (!result.ok) {
      return NextResponse.json(
        {
          error: {
            message: result.body.error?.message || 'Could not start World verification',
            code: result.body.error?.code,
          },
        },
        { status: result.status || 502 },
      );
    }
    const res = NextResponse.json({ ...result.body, existing_session_id: existingSession }, { status: 200, headers: { 'cache-control': 'no-store' } });
    if (result.body.nonce) {
      // Path `/` so the cookie is sent on POST /api/auth/world after IDKit completes.
      res.cookies.set('bagseven_world_nonce', result.body.nonce, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: 300,
      });
    }
    return res;
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          message: error instanceof Error ? error.message : 'World verification service is unavailable',
        },
      },
      { status: 503 },
    );
  }
}
