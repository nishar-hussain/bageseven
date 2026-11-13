export function accountWalletState(input: { loaded: boolean; failed?: boolean; linked?: string | null; connected?: string | null }) {
  if (!input.loaded) return 'loading' as const;
  if (input.failed) return 'unavailable' as const;
  if (!input.connected) return input.linked ? 'reconnect' as const : 'connect' as const;
  if (!input.linked) return 'unlinked' as const;
  return input.linked.toLowerCase() === input.connected.toLowerCase() ? 'verified' as const : 'different' as const;
}
