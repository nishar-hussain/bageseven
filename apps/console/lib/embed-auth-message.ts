export function parentOrigin(value: string | null): string | null {
  try { const url = new URL(value ?? ''); return ['https:', 'http:'].includes(url.protocol) && url.origin === value ? url.origin : null; } catch { return null; }
}
export function embedAuthMessage(event: Pick<MessageEvent, 'origin' | 'source' | 'data'>, origin: string | null, parent: Window) {
  if (!origin || event.origin !== origin || event.source !== parent || !event.data || event.data.type !== 'bagseven:authorize') return null;
  const { token, holder, checkoutSessionId } = event.data;
  if (typeof token !== 'string' || token.length < 10 || token.length > 8192 || typeof holder !== 'string' || !holder.trim() || holder.length > 320) return null;
  if (checkoutSessionId !== undefined && (typeof checkoutSessionId !== 'string' || !/^cs_[a-zA-Z0-9_-]{1,100}$/.test(checkoutSessionId))) return null;
  return { token, holder, checkoutSessionId: checkoutSessionId as string | undefined };
}
