import { createHmac } from "node:crypto";

export const FEATURES = [
  { id: "pro_notes", label: "Pro workspace", credits: "1", boolean: true },
  { id: "ocr", label: "Document scans", credits: "50" },
  { id: "research_fetch", label: "Research credits", credits: "100" },
  { id: "api_access", label: "API trial", credits: "2" },
];
export const HOLDER = process.env.DEMO_HOLDER || "demo-subscriber@acme.test";
export const DAEMON = (
  process.env.BAGSEVEN_API_URL || "http://127.0.0.1:4001"
).replace(/\/$/, "");
export const PLAN_NAMES = [
  "Bagseven OCR Starter",
  "Bagseven Research Pro",
  "Bagseven Pro Access",
];

export async function internal(method, path, body) {
  const provider = process.env.DEMO_PROVIDER_ID;
  const secret = process.env.PROVIDER_GAS_ENCRYPTION_KEY;
  const headers = {
    authorization: `Bearer ${process.env.DAEMON_AUTH_TOKEN}`,
    "content-type": "application/json",
  };
  if (provider && secret) {
    const payload = Buffer.from(
      JSON.stringify({ provider, expires: Date.now() + 60000 }),
    ).toString("base64url");
    headers["x-bagseven-provider"] = provider;
    headers["x-bagseven-provider-scope"] =
      `${payload}.${createHmac("sha256", secret).update(`bagseven-provider-scope-v1:${payload}`).digest("base64url")}`;
  }
  const response = await fetch(`${DAEMON}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });
  const json = await response.json();
  if (!response.ok) {
    const error = new Error(json.error?.message || `Daemon ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return json;
}
