import type { EmbedComponentId } from '@bagseven/sdk/components';

export const PAGE_TYPES: Array<{ id: EmbedComponentId; label: string; description: string; use: string }> = [
  { id: 'cmp_pricing', label: 'Pricing page', description: 'Help customers choose a plan and start checkout.', use: 'Your website’s pricing section' },
  { id: 'cmp_customer', label: 'Customer portal', description: 'Put plans, credits and subscription management in one place.', use: 'The billing area in your app' },
  { id: 'cmp_portal', label: 'Manage subscription', description: 'Show current access, usage and renewal controls.', use: 'Account settings and billing' },
  { id: 'cmp_checkout', label: 'Checkout', description: 'Let a customer review and pay for an existing checkout.', use: 'After your backend creates a checkout session' },
];
export type DesignConfig = { componentId: EmbedComponentId; name: string; heading: string; cta: string;
  ink: string; accent: string; soft: string; radius: string; powered: boolean; planIds: string[] };
export type Design = { id: string; config: DesignConfig; revision: number; published: DesignConfig | null; published_revision: number | null; updated_at: string };
export const PALETTES = [
  { label: 'Bagseven', ink: '#0e0e10', accent: '#0002f8', soft: '#f6f6f8' },
  { label: 'Midnight', ink: '#172033', accent: '#172033', soft: '#f1f3f7' },
  { label: 'Ocean', ink: '#123b50', accent: '#007c91', soft: '#eef8fa' },
  { label: 'Forest', ink: '#153c2e', accent: '#228452', soft: '#f0f7f2' },
  { label: 'Rose', ink: '#4a2438', accent: '#b83e70', soft: '#fff2f7' },
];
export function newDesign(componentId: EmbedComponentId = 'cmp_customer', planIds: string[] = []): DesignConfig {
  const meta = PAGE_TYPES.find(p => p.id === componentId)!;
  return { componentId, name: meta.label, heading: componentId === 'cmp_pricing' ? 'Find your next plan' : componentId === 'cmp_checkout' ? 'Complete your purchase' : 'Your account',
    cta: 'Choose plan', ink: '#0e0e10', accent: '#0002f8', soft: '#f6f6f8', radius: '16px', powered: true, planIds };
}
export function validateDesign(input: unknown): DesignConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Design must be an object.');
  const data = input as Record<string, unknown>;
  if (!PAGE_TYPES.some(p => p.id === data.componentId)) throw Error('Choose a supported page type.');
  const text = (key: string, max: number) => {
    const value = data[key];
    if (typeof value !== 'string' || !value.trim() || value.length > max) throw Error(`${key} must contain 1–${max} characters.`);
    return value.trim();
  };
  const color = (key: string) => { if (typeof data[key] !== 'string' || !/^#[a-f0-9]{6}$/i.test(data[key])) throw Error(`Choose a valid ${key} color.`); return data[key] as string; };
  if (!['0px', '8px', '12px', '16px', '20px', '24px'].includes(String(data.radius))) throw Error('Choose a supported corner radius.');
  if (typeof data.powered !== 'boolean') throw Error('Choose whether to show Bagseven branding.');
  if (!Array.isArray(data.planIds) || data.planIds.length > 100 || data.planIds.some(id => typeof id !== 'string' || !/^plan_[a-zA-Z0-9_-]{1,100}$/.test(id))) throw Error('Choose valid plans.');
  return { componentId: data.componentId as EmbedComponentId, name: text('name', 80), heading: text('heading', 120), cta: text('cta', 60),
    ink: color('ink'), accent: color('accent'), soft: color('soft'), radius: String(data.radius), powered: data.powered, planIds: [...new Set(data.planIds)] };
}
export function designProps(config: DesignConfig) {
  return { component: config.componentId, heading: config.heading, ctaLabel: config.cta, showPoweredBy: config.powered,
    ...(config.componentId === 'cmp_customer' ? { initialView: 'pricing' as const } : {}),
    planIds: config.planIds, theme: { ink: config.ink, accent: config.accent, soft: config.soft, radius: config.radius } };
}
export function reactInstall(config: DesignConfig, origin: string, pk: string) {
  const props = JSON.stringify({ ...designProps(config), apiUrl: `${origin}/api/public`, publishableKey: pk }, null, 2);
  return `import { BagsevenEmbed } from "@bagseven/sdk/react";\n\n// Issue accessToken for the signed-in customer on your backend.\nexport function BillingPage({ customerId, accessToken, checkoutSessionId }) {\n  const options = ${props};\n  return <BagsevenEmbed {...options} holder={customerId}\n    accessToken={accessToken} checkoutSessionId={checkoutSessionId} />;\n}`;
}
export function iframeInstall(id: string, origin: string) {
  return `<div id="bagseven-billing"></div>\n<script type="module">\nconst origin = ${JSON.stringify(origin)};\nconst frame = document.createElement("iframe");\nframe.title = "Billing";\nframe.style.cssText = "width:100%;min-height:720px;border:0";\nframe.referrerPolicy = "no-referrer";\nframe.src = origin + "/embed?design=${encodeURIComponent(id)}&parent=" + encodeURIComponent(window.location.origin);\nwindow.addEventListener("message", async (event) => {\n  if (event.source !== frame.contentWindow || event.origin !== origin || event.data?.type !== "bagseven:ready") return;\n  // Your authenticated backend calls Bagseven identify for this customer.\n  const response = await fetch("/api/billing/customer-token", { credentials: "same-origin" });\n  if (!response.ok) throw new Error("Customer sign-in required");\n  const { token, holder, checkoutSessionId } = await response.json();\n  frame.contentWindow.postMessage({ type: "bagseven:authorize", token, holder, checkoutSessionId }, origin);\n});\ndocument.getElementById("bagseven-billing").append(frame);\n</script>`;
}
