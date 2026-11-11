/** Explicit local demo setup. Reloading the app never refills exhausted credits. */
import { FEATURES, HOLDER, internal } from "../demo-config.mjs";

if (process.env.ENTITLEMENT_STORE !== "memory" || process.env.NODE_ENV === "production" || !process.env.DEMO_PROVIDER_ID) {
  throw new Error(
    "Demo seed requires explicit local memory mode and an explicitly configured DEMO_PROVIDER_ID",
  );
}
const features = (await internal("GET", "/internal/features")).features;
const grants = (
  await internal(
    "GET",
    `/internal/grants/live?holder=${encodeURIComponent(HOLDER)}`,
  )
).grants;
for (const feature of FEATURES) {
  if (!features.some((f) => f.id === feature.id)) {
    await internal("POST", "/internal/features", {
      id: feature.id,
      label: feature.label,
      value_type: feature.boolean ? "boolean" : "numeric",
    });
  }
  if (
    grants.some(
      (g) =>
        g.feature === feature.id && g.merchant === process.env.DEMO_PROVIDER_ID,
    )
  ) {
    console.log(`KEEP ${feature.label}: existing provider grant`);
    continue;
  }
  await internal("POST", "/internal/grants/mint", {
    feature: feature.id,
    holder: HOLDER,
    remaining: feature.credits,
    ttl_seconds: 86400,
    settlement_network: "local",
    renewal_enabled: Boolean(feature.boolean),
  });
  console.log(
    `READY ${feature.label}: ${feature.credits} (seeded demo access; no customer payment)`,
  );
}
