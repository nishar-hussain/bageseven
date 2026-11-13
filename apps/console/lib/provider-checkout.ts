export type ProviderCheckoutStatus = {
  configured: boolean;
  status?: string;
  expires_at?: string | null;
  balances?: { registry: string | null };
};

/** Human checkout needs provider Registry gas; the buyer pays transfer gas. */
export function providerCheckoutBlockReason(status: ProviderCheckoutStatus | null, now = Date.now()): string | null {
  if (!status) return 'Checking provider authorization and funding…';
  if (!status.configured) return 'Authorize your dedicated provider gas account in Tracks before accepting payments.';
  if (status.status !== 'active' || !status.expires_at || !(new Date(status.expires_at).getTime() > now)) return 'Your provider signing authorization is missing, expired, or revoked. Renew it in Tracks.';
  if (status.balances?.registry == null) return 'The Registry gas balance could not be checked. Refresh before opening checkout.';
  if (!(Number(status.balances.registry) > 0)) return 'Fund your provider gas account with AVAX on Registry before accepting payments.';
  return null;
}
