import { notFound } from 'next/navigation';
import { BillingDocumentView } from '../../../components/app/BillingDocumentView';
import { sharedBillingDocument } from '../../../lib/provider-billing';
import { consoleDatabase } from '../../../lib/account-profiles';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Your invoice · Bagseven', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export default async function BillingReceiptPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ access?: string }>;
}) {
  const { id } = await params, { access } = await searchParams;
  if (!access) notFound();
  const document = await sharedBillingDocument(consoleDatabase(), id, access, process.env.ENTITLEMENT_SUBJECT_SECRET || '');
  if (!document) notFound();
  return <main style={{ maxWidth: 1040, margin: '0 auto', padding: '32px 20px' }}><BillingDocumentView id={id} initialDocument={document} shared /></main>;
}
