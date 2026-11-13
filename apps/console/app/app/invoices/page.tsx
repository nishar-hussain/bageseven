import { Suspense } from 'react';
import { BillingWorkspace } from '../../../components/app/BillingWorkspace';
export default function InvoicesPage() {
  return <Suspense fallback={<p>Loading invoices…</p>}><BillingWorkspace kind="invoices" /></Suspense>;
}
