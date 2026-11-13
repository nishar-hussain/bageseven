import { NextResponse } from 'next/server';
import { designStore } from '../../../../lib/builder-server';
import { validateDesign } from '../../../../lib/builder-model';
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[a-f0-9-]{36}$/i.test(id)) return NextResponse.json({ error: 'Page not found.' }, { status: 404 });
  try {
    const config = await designStore().published(id);
    if (!config) return NextResponse.json({ error: 'This page is not published.' }, { status: 404 });
    return NextResponse.json({ config: validateDesign(config) }, { headers: { 'cache-control': 'no-store', 'access-control-allow-origin': '*' } });
  } catch { return NextResponse.json({ error: 'Page unavailable. Try again shortly.' }, { status: 503 }); }
}
