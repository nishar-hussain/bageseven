import { Suspense } from 'react';
import { BillingWorkspace } from '../../../components/app/BillingWorkspace';
export default function CustomersPage() {
  return <Suspense fallback={<p>Loading customers…</p>}><BillingWorkspace kind="customers" /></Suspense>;
}
