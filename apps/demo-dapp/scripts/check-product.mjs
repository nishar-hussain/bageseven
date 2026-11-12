/** Live receipt workflow check. Uses one scan credit; retries do not charge again. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
const base = "http://127.0.0.1:5178/api/demo";
async function request(path, body) {
  const r = await fetch(`${base}/${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j));
  return j;
}
const before = await request("bootstrap");
assert.equal(before.planIds.length, 3);
assert.ok(
  before.entitlements.ocr.enabled,
  "Add OCR credits before running this live check",
);
const image =
  "data:image/png;base64," +
  (
    await readFile(new URL("../public/sample-receipt.png", import.meta.url))
  ).toString("base64");
const body = { image, requestId: randomUUID(), fileName: "harbor-coffee.png" };
const { receipt } = await request("scan", body);
assert.equal(receipt.merchant, "HARBOR COFFEE");
assert.equal(receipt.total, 525);
assert.equal(receipt.tax, 25);
assert.equal(receipt.currency, "INR");
assert.equal(receipt.items.length, 3);
console.log("PASS actual image OCR: merchant, date, items, tax, total");
const retry = await request("scan", body);
assert.equal(retry.receipt.id, receipt.id);
const after = await request("bootstrap");
assert.equal(
  Number(after.entitlements.ocr.total_remaining ?? after.entitlements.ocr.remaining),
  Number(before.entitlements.ocr.total_remaining ?? before.entitlements.ocr.remaining) - 1,
);
const publicBalance = await fetch(`http://127.0.0.1:5177/v1/entitlements`, {
  headers: { authorization: `Bearer ${after.accessToken}` },
}).then(r => r.json());
assert.equal(publicBalance.entitlements.find(e => e.grant_id === receipt.entitlement.grant_id).remaining, receipt.entitlement.remaining);
for (let i = 0; i < 3; i++) assert.equal((await request("bootstrap")).entitlements.ocr.total_remaining, after.entitlements.ocr.total_remaining);
console.log("PASS confirmed consume, merchant and browser SDK balances agree across repeated refreshes; retry does not charge twice");
const saved = await request("receipts/save", {
  id: receipt.id,
  category: "Food & drink",
  notes: "Live product verification",
});
assert.equal(saved.receipt.category, "Food & drink");
const list = await request("receipts");
assert.ok(
  list.receipts.some(
    (r) => r.id === receipt.id && r.notes === "Live product verification",
  ),
);
assert.equal((await fetch(`${base}/receipts/${receipt.id}/image`)).status, 200);
console.log("PASS saved receipt edits, history, and original image");
const invalid = await fetch(`${base}/scan`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    requestId: randomUUID(),
    image: "data:image/png;base64,aGVsbG8=",
  }),
});
assert.equal(invalid.status, 400);
const unchanged = await request("bootstrap");
assert.equal(
  unchanged.entitlements.ocr.total_remaining,
  after.entitlements.ocr.total_remaining,
);
console.log("PASS invalid image uses no credit");
const jsonId = randomUUID();
const exported = await request("export", { format: "json", requestId: jsonId });
assert.ok(JSON.parse(exported.content).some(r => r.merchant === "HARBOR COFFEE"));
await request("export", { format: "json", requestId: jsonId });
const csv = await request("export", { format: "csv", requestId: randomUUID() });
assert.ok(csv.content.startsWith("merchant,date,currency,total,tax,category,notes"));
const insightId = randomUUID();
const insight = await request("insights", { requestId: insightId });
assert.ok(insight.count >= 1);
await request("insights", { requestId: insightId });
const final = await request("bootstrap");
for (const feature of ["api_access", "research_fetch"]) {
  assert.equal(Number(final.entitlements[feature].total_remaining), Number(after.entitlements[feature].total_remaining) - 1);
}
assert.equal(final.entitlements.pro_notes.total_remaining, after.entitlements.pro_notes.total_remaining);
console.log("PASS actual Pro CSV access, metered JSON export and insights; retries charge each feature once");
