import { NextResponse } from 'next/server';
import { designStore } from '../../../../lib/builder-server';
import { validateDesign } from '../../../../lib/builder-model';
import { consoleDatabase } from '../../../../lib/account-profiles';
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[a-f0-9-]{36}$/i.test(id)) return NextResponse.json({ error: 'Page not found.' }, { status: 404 });
  try {
    const config = await designStore().published(id);
    if (!config) return NextResponse.json({ error: 'This page is not published.' }, { status: 404 });
    const key = await consoleDatabase().$client.query(`select k.public_key from embed_designs d join provider_api_keys k on k.provider_id=d.owner
      where d.id=$1::uuid and k.kind='pk' and k.revoked_at is null and k.expires_at>now() order by k.created_at desc,k.id limit 1`, [id]);
    return NextResponse.json(
      { config: validateDesign(config), publishableKey: key.rows[0]?.public_key ?? null },
      { headers: { 'cache-control': 'no-store', 'access-control-allow-origin': '*' } },
    );
  } catch {
    return NextResponse.json({ error: 'Page unavailable. Try again shortly.' }, { status: 503 });
  }
}
