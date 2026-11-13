import { NextResponse } from 'next/server';
import { getSession, sessionHolder, sessionIsValid } from '../../../lib/auth';
import { consoleDatabase } from '../../../lib/account-profiles';
import { billingDocument, documentList } from '../../../lib/provider-billing';
export async function GET(request: Request) {
  const session = await getSession();
  if (!session || !sessionIsValid(session)) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const id = params.get('id');
  const view = params.get('view') ?? 'issued', status = params.get('status') ?? 'ALL';
  const customer = params.get('customer') ?? '', page = Number(params.get('page') ?? 0);
  if ((id && !/^inv_[a-f0-9]{32}$/.test(id)) || !['issued', 'purchases'].includes(view) ||
      !['ALL', 'OPEN', 'PAID', 'VOID', 'EXPIRED'].includes(status) || customer.length > 320 || !Number.isInteger(page) || page < 0 || page > 500)
    return NextResponse.json({ error: 'Invalid invoice filters.' }, { status: 400 });
  try {
    if (id) {
      const document = await billingDocument(consoleDatabase(), sessionHolder(session), id);
      return document ? NextResponse.json({ document }, { headers: { 'Cache-Control': 'no-store' } }) : NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });
    }
    return NextResponse.json(await documentList(consoleDatabase(), sessionHolder(session), view as 'issued' | 'purchases', status, customer, page), { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Invoices are temporarily unavailable. Please retry.' }, { status: 503 });
  }
}
