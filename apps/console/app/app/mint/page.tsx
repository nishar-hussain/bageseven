import { Suspense } from 'react';
import { ProviderCheckout } from '../../../components/app/ProviderCheckout';

export default function MintPage() {
  return <Suspense fallback={<p className="p-8 text-sm">Loading checkout…</p>}><ProviderCheckout /></Suspense>;
}
