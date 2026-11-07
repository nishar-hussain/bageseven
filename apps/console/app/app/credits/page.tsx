import { Suspense } from 'react';
import { ProviderCheckout } from '../../../components/app/ProviderCheckout';

export default function CreditsPage() {
  return <Suspense fallback={<p className="p-8 text-sm">Loading plans…</p>}><ProviderCheckout creditsOnly /></Suspense>;
}
