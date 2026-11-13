import Link from 'next/link';
import { getSession, sessionHolder, sessionIsValid } from '../../../../lib/auth';
import { mcpConsoleConsent, mcpIssuer } from '../../../../lib/mcp-console-consent';
import { PageHeader, SoftCard } from '../../../../components/app/ui';
import { mcpConsentCsrf } from '../../../../lib/mcp-consent-csrf';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Authorize Bagseven for ChatGPT', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export default async function Authorize({ searchParams }: { searchParams: Promise<{ request?: string }> }) {
  const { request: id } = await searchParams;
  const session = await getSession();
  const request = id && /^[A-Za-z0-9_-]{43}$/.test(id) ? await mcpConsoleConsent().requests.get(id) : undefined;
  if (!request || request.issuer !== mcpIssuer()) return <SoftCard className="mx-auto max-w-xl space-y-4 p-6"><h1>Connection request expired</h1><p>Return to ChatGPT and connect Bagseven again.</p><Link href="/app/mcp">Back to connections</Link></SoftCard>;
  if (!sessionIsValid(session) || !session?.email_verified_at || !session.wallet_address) return <SoftCard className="mx-auto max-w-xl space-y-4 p-6"><h1>Verify your account</h1><p>Complete email and wallet verification before connecting ChatGPT.</p><Link href={'/app/onboarding?next=' + encodeURIComponent('/app/mcp/authorize?request=' + id)}>Continue verification</Link></SoftCard>;
  return <div className="mx-auto max-w-xl space-y-6"><PageHeader title="Authorize Bagseven for ChatGPT" description="Your email and linked wallet are already verified." /><SoftCard className="space-y-5 p-6">
    <p>Continue as <strong>{sessionHolder(session)}</strong>.</p><p className="break-all text-sm text-[var(--muted)]">Linked wallet: {session.wallet_address}</p>
    <p className="text-sm leading-relaxed">ChatGPT can use Bagseven tools for this account: inspect access, consume authorized prepaid credits, and prepare checkouts. New spending requires its own permission; wallet transactions still require your approval.</p>
    <form action="/api/mcp/consent" method="post"><input type="hidden" name="request" value={id} /><input type="hidden" name="csrf" value={mcpConsentCsrf(id!, session)} /><button type="submit" className="w-full rounded-full bg-[var(--blue)] px-5 py-3 text-sm font-semibold text-white">Authorize and return to ChatGPT</button></form>
    <Link href="/app/mcp" className="block text-center text-sm text-[var(--muted)]">Cancel</Link>
  </SoftCard></div>;
}
