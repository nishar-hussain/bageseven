import { redirect } from 'next/navigation';

/**
 * Checkout sessions are created by Embed/Builder (and your backend) — not a payment-link catalog.
 * ArcenPay/Schematic: customers buy inside the embedded component.
 */
export default function CheckoutsRedirect() {
  redirect('/app/builder');
}
