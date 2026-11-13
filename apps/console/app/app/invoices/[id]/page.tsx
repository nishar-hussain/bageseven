import { BillingDocumentView } from '../../../../components/app/BillingDocumentView';
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  return <BillingDocumentView id={(await params).id} />;
}
