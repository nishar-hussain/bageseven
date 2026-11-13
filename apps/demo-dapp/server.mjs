/**
 * Merchant backend for the demo dapp.
 * Uses @bagseven/sdk/node (secret key) — never ship this key to the browser.
 */
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createReceiptService, fail } from "./receipts.mjs";
import { BagsevenClient } from "@bagseven/sdk/node";
import { FEATURES, HOLDER, receiptPlanIds, internal } from "./demo-config.mjs";

const PORT = Number(process.env.DEMO_DAPP_API_PORT || 5178);
const DAEMON = (
  process.env.BAGSEVEN_API_URL || "http://127.0.0.1:4001"
).replace(/\/$/, "");
const SK = (
  process.env.BAGSEVEN_SECRET_KEY ||
  process.env.DAEMON_AUTH_TOKEN ||
  ""
).trim();
const PK = (
  process.env.BAGSEVEN_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_BAGSEVEN_PUBLISHABLE_KEY ||
  ""
).trim();
const FEATURE_PRO = "pro_notes";

if (!SK) {
  console.error("[demo-api] BAGSEVEN_SECRET_KEY or DAEMON_AUTH_TOKEN required");
  process.exit(1);
}

const client = new BagsevenClient({ apiKey: SK, baseUrl: DAEMON });

async function bootstrap() {
  const entitlements = Object.fromEntries(
    await Promise.all(
      FEATURES.map(async (f) => [
        f.id,
        await client.checkEntitlement(f.id, { holder: HOLDER }),
      ]),
    ),
  );
  const identified = await client.identify({ holder: HOLDER, expiresIn: 3600 });
  const { plans } = await internal("GET", "/v1/plans?active=true");
  return {
    holder: HOLDER,
    publishableKey: PK || "pk_local",
    accessToken: identified.token,
    entitlements,
    apiUrl: "/v1",
    planIds: receiptPlanIds(plans, process.env.DEMO_PROVIDER_ID),
  };
}

const receipts = createReceiptService({
  directory: fileURLToPath(
    new URL(
      `../../.data/receipts/${createHash("sha256").update(HOLDER).digest("hex")}/`,
      import.meta.url,
    ),
  ),
  check: (feature) => client.checkEntitlement(feature, { holder: HOLDER }),
  consume: async (feature, idempotencyKey, grant_id) => {
    const { token } = await client.identify({ holder: HOLDER, expiresIn: 300 });
    const holderClient = new BagsevenClient({ apiKey: token, baseUrl: DAEMON });
    return holderClient.consumeEntitlement({
      feature,
      holder: HOLDER,
      amount: "1",
      idempotencyKey,
      grant_id,
    });
  },
});
function send(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}
async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 9_000_000) throw fail(413, "Choose an image smaller than 6 MB.");
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error("Invalid request");
    return body;
  } catch {
    throw fail(400, "Invalid request");
  }
}
const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
  try {
    if (req.method === "GET" && url.pathname === "/api/demo/bootstrap")
      return send(res, 200, await bootstrap());
    const imageMatch = /^\/api\/demo\/receipts\/([a-f0-9]{64})\/image$/.exec(
      url.pathname,
    );
    if (req.method === "GET" && imageMatch) {
      const bytes = await receipts.image(imageMatch[1]);
      const mime =
        bytes[0] === 137
          ? "image/png"
          : bytes[0] === 255
            ? "image/jpeg"
            : "image/webp";
      res.writeHead(200, {
        "content-type": mime,
        "cache-control": "private, max-age=3600",
        "x-content-type-options": "nosniff",
      });
      res.end(bytes);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/demo/receipts")
      return send(res, 200, { receipts: await receipts.list() });
    if (req.method === "POST" && url.pathname === "/api/demo/scan")
      return send(res, 200, {
        receipt: await receipts.scan(await readBody(req)),
      });
    if (req.method === "POST" && url.pathname === "/api/demo/receipts/save")
      return send(res, 200, {
        receipt: await receipts.update(await readBody(req)),
      });
    if (req.method === "POST" && url.pathname === "/api/demo/insights")
      return send(
        res,
        200,
        await receipts.insights((await readBody(req)).requestId),
      );
    if (req.method === "POST" && url.pathname === "/api/demo/export") {
      const body = await readBody(req);
      const { rows, entitlement } = await receipts.export(body.format, body.requestId);
      const fields = [
        "merchant",
        "date",
        "currency",
        "total",
        "tax",
        "category",
        "notes",
      ];
      const cell = (value) => {
        let text = String(value ?? "");
        if (/^[=+@-]/.test(text)) text = "'" + text;
        return '"' + text.replaceAll('"', '""') + '"';
      };
      const content =
        body.format === "json"
          ? JSON.stringify(
              rows.map(
                ({
                  merchant,
                  date,
                  currency,
                  total,
                  tax,
                  category,
                  notes,
                  items,
                  rawText,
                  fileName,
                  createdAt,
                }) => ({
                  merchant,
                  date,
                  currency,
                  total,
                  tax,
                  category,
                  notes,
                  items,
                  rawText,
                  fileName,
                  createdAt,
                }),
              ),
              null,
              2,
            )
          : [
              fields.join(","),
              ...rows.map((r) => fields.map((k) => cell(r[k])).join(",")),
            ].join("\r\n");
      return send(res, 200, {
        content,
        fileName: `receipts.${body.format}`,
        entitlement,
        mime: body.format === "json" ? "application/json" : "text/csv",
      });
    }
    if (req.method === "GET" && url.pathname === "/api/demo/check") {
      const feature = url.searchParams.get("feature") || FEATURE_PRO;
      return send(res, 200, {
        feature,
        entitlement: await client.checkEntitlement(feature, { holder: HOLDER }),
      });
    }
    send(res, 404, { error: { message: "Not found" } });
  } catch (error) {
    send(res, error.status || 500, {
      error: { message: error.message || "Request failed" },
    });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(
    `[demo-api] http://127.0.0.1:${PORT}  holder=${HOLDER}  daemon=${DAEMON}`,
  );
});
