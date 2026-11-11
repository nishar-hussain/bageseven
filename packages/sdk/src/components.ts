/**
 * Drop-in embed components (Schematic-style).
 * Merchants pick an id in Builder → render via <BagsevenEmbed component="…" /> or /embed?component=
 */
export const EMBED_COMPONENTS = [
  {
    id: 'cmp_pricing',
    label: 'Pricing table',
    blurb: 'Plan catalog with period pricing. Subscribe opens checkout.',
    view: 'pricing' as const,
  },
  {
    id: 'cmp_checkout',
    label: 'Checkout',
    blurb: 'Pay for a plan on Avalanche — activates the plan’s entitlement on success.',
    view: 'checkout' as const,
  },
  {
    id: 'cmp_portal',
    label: 'Plan manager',
    blurb: 'Current plan, credit usage, period end, and cancel-renewal.',
    view: 'portal' as const,
  },
  {
    id: 'cmp_customer',
    label: 'Customer portal',
    blurb: 'Plan manager + pricing shortcut. Cancel renewal keeps access until period end.',
    view: 'customer' as const,
  },
] as const;

export type EmbedComponentId = (typeof EMBED_COMPONENTS)[number]['id'];
export type EmbedComponentView = (typeof EMBED_COMPONENTS)[number]['view'];

export function resolveEmbedComponent(id?: string | null): (typeof EMBED_COMPONENTS)[number] | null {
  if (!id) return null;
  const key = id.trim().toLowerCase();
  return EMBED_COMPONENTS.find((c) => c.id === key) ?? null;
}

export function isEmbedComponentId(id: string): id is EmbedComponentId {
  return EMBED_COMPONENTS.some((c) => c.id === id);
}
