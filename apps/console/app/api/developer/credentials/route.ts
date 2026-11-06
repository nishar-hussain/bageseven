import { NextResponse } from 'next/server';
import { getSession, sessionIsValid } from '../../../../lib/auth';
import { EMBED_COMPONENTS } from '../../../../lib/bagseven-sdk-components';

/** Session-gated: merchant credentials to drop Bagseven into their platform. */
export async function GET() {
  const session = await getSession();
  if (!sessionIsValid(session) || !session) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Sign in required' } }, { status: 401 });
  }

  const publishable =
    process.env.NEXT_PUBLIC_BAGSEVEN_PUBLISHABLE_KEY?.trim() ||
    process.env.BAGSEVEN_PUBLISHABLE_KEY?.trim() ||
    '';
  const secret = process.env.BAGSEVEN_SECRET_KEY?.trim() || process.env.DAEMON_AUTH_TOKEN?.trim() || '';
  const origin = process.env.BAGSEVEN_PUBLIC_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim() || '';

  return NextResponse.json({
    publishable_key: publishable || null,
    secret_key: secret || null,
    secret_key_hint: secret ? `${secret.slice(0, 8)}…${secret.slice(-4)}` : null,
    embed_base_path: '/embed',
    public_api_path: '/api/public',
    components: EMBED_COMPONENTS.map((c) => ({ id: c.id, label: c.label, blurb: c.blurb })),
    notes: [
      'Publishable key (pk_) is safe in browser / BagsevenProvider.',
      'Secret key (sk_) stays on your server — use BagsevenClient to identify customers and create plans.',
      'Pass component=cmp_pricing|cmp_checkout|cmp_portal|cmp_customer on /embed or BagsevenEmbed.',
    ],
    public_origin: origin || null,
  });
}
