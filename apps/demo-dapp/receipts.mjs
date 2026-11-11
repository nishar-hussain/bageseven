import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  readdir,
  mkdtemp,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const exec = promisify(execFile);
export function fail(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
export function parseReceipt(text) {
  const lines = text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const amount = (line) => {
    const matches = [
      ...line.matchAll(/(?:[$€£₹]\s*)?(\d[\d,]*[.,]\d{2})(?!\d)/g),
    ];
    return matches.length
      ? Number(
          matches
            .at(-1)[1]
            .replace(/,(?=\d{3})/g, "")
            .replace(",", "."),
        )
      : null;
  };
  const totalLine = [...lines]
    .reverse()
    .find(
      (l) =>
        /\b(grand total|amount due|balance due|total)\b/i.test(l) &&
        !/sub\s*total|tax|saving/i.test(l) &&
        amount(l) !== null,
    );
  const taxLine = lines.find(
    (l) => /\b(tax|gst|vat)\b/i.test(l) && amount(l) !== null,
  );
  const date =
    text.match(/\b(20\d{2})[-/.](\d{2})[-/.](\d{2})\b/) ||
    text.match(/\b(\d{2})[-/.](\d{2})[-/.](20\d{2})\b/);
  return {
    merchant: lines.find((l) => /[a-z]{3}/i.test(l)) || "Untitled receipt",
    date: date
      ? date[1].length === 4
        ? `${date[1]}-${date[2]}-${date[3]}`
        : `${date[3]}-${date[2]}-${date[1]}`
      : "",
    total: totalLine ? amount(totalLine) : null,
    tax: taxLine ? amount(taxLine) : null,
    currency: /₹|\bINR\b/i.test(text)
      ? "INR"
      : /€|\bEUR\b/.test(text)
        ? "EUR"
        : /£|\bGBP\b/.test(text)
          ? "GBP"
          : /\$|\bUSD\b/.test(text)
            ? "USD"
            : "",
    category: "Other",
    notes: "",
    items: lines
      .filter(
        (l) =>
          amount(l) !== null &&
          !/\b(sub\s*total|total|tax|gst|vat|cash|change|balance|card|paid)\b/i.test(
            l,
          ),
      )
      .map((l) => ({
        description: l.replace(/\s+[$€£₹]?\s*\d[\d,.]*\s*$/, ""),
        amount: amount(l),
      })),
    rawText: text.trim(),
  };
}
export function decodeImage(dataUrl) {
  if (typeof dataUrl !== "string" || dataUrl.length > 9_000_000)
    throw fail(413, "Choose an image smaller than 6 MB.");
  const match =
    /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(dataUrl);
  if (!match) throw fail(400, "Upload a PNG, JPEG, or WebP receipt.");
  const image = Buffer.from(match[2], "base64");
  const png = image
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = image[0] === 255 && image[1] === 216 && image[2] === 255;
  const webp =
    image.toString("ascii", 0, 4) === "RIFF" &&
    image.toString("ascii", 8, 12) === "WEBP";
  if (!(png || jpeg || webp) || image.length > 6 * 1024 * 1024)
    throw fail(400, "The file is not a supported receipt image.");
  return image;
}
export async function recognize(image) {
  const dir = await mkdtemp(join(tmpdir(), "bagseven-receipt-"));
  try {
    const path = join(dir, "receipt");
    await writeFile(path, image);
    const { stdout } = await exec(
      process.env.TESSERACT_BIN || "tesseract",
      [path, "stdout", "-l", "eng", "--psm", "6"],
      { timeout: 45000, maxBuffer: 1024 * 1024 },
    );
    if (stdout.trim().length < 8)
      throw fail(
        422,
        "No readable text found. Try a sharper, well-lit receipt photo. No scan credit was used.",
      );
    return stdout;
  } catch (e) {
    if (e.status) throw e;
    throw fail(
      422,
      "Could not read this image. Try a clear PNG or JPEG receipt. No scan credit was used.",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
export function createReceiptService({
  directory,
  check,
  consume,
  ocr = recognize,
}) {
  let queue = Promise.resolve();
  const serial = (fn) => {
    const task = queue.then(fn);
    queue = task.catch(() => {});
    return task;
  };
  const path = (id) => {
    if (!/^[a-f0-9]{64}$/.test(id)) throw fail(400, "Invalid receipt");
    return join(directory, `${id}.json`);
  };
  async function load(id) {
    try {
      return JSON.parse(await readFile(path(id), "utf8"));
    } catch (e) {
      if (e.code === "ENOENT") return null;
      throw e;
    }
  }
  async function save(record) {
    await mkdir(directory, { recursive: true });
    await writeFile(`${path(record.id)}.tmp`, JSON.stringify(record), {
      mode: 0o600,
    });
    await rename(`${path(record.id)}.tmp`, path(record.id));
  }
  async function requireAccess(feature) {
    const ent = await check(feature);
    if (!ent.enabled)
      throw fail(
        403,
        feature === "ocr"
          ? "You have no scan credits available. Add a scan pack in Billing to continue."
          : "This feature needs an active entitlement. Open Billing to add access.",
      );
    return ent;
  }
  async function list() {
    await mkdir(directory, { recursive: true });
    return (
      await Promise.all(
        (await readdir(directory))
          .filter((f) => /^[a-f0-9]{64}\.json$/.test(f))
          .map((f) => load(f.slice(0, -5))),
      )
    )
      .filter((r) => r?.charged)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  return {
    list,
    image: async (id) => {
      const record = await load(id);
      if (!record?.charged) throw fail(404, "Receipt not found");
      return readFile(join(directory, `${id}.image`));
    },
    scan: (body) =>
      serial(async () => {
        if (!/^[a-zA-Z0-9-]{16,80}$/.test(body.requestId || ""))
          throw fail(400, "A scan request ID is required");
        const image = decodeImage(body.image);
        const id = createHash("sha256").update(body.requestId).digest("hex");
        const hash = createHash("sha256").update(image).digest("hex");
        let record = await load(id);
        if (record && record.imageHash !== hash)
          throw fail(409, "This scan request belongs to a different image.");
        if (record?.charged) return record;
        const entitlement = record?.grantId
          ? { grant_id: record.grantId }
          : await requireAccess("ocr");
        if (!record) {
          await mkdir(directory, { recursive: true });
          await writeFile(join(directory, `${id}.image`), image, {
            mode: 0o600,
          });
          record = {
            id,
            imageHash: hash,
            grantId: entitlement.grant_id,
            fileName: String(body.fileName || "Receipt").slice(0, 180),
            createdAt: new Date().toISOString(),
            ...parseReceipt(await ocr(image)),
            charged: false,
          };
          await save(record);
        }
        const result = await consume(
          "ocr",
          `receipt-${id}`,
          entitlement.grant_id,
        );
        record.charged = true;
        record.remaining = result.entitlement.remaining;
        record.entitlement = result.entitlement;
        await save(record);
        return record;
      }),
    update: (body) =>
      serial(async () => {
        const record = await load(body.id);
        if (!record?.charged) throw fail(404, "Receipt not found");
        for (const key of ["merchant", "date", "currency", "category", "notes"])
          if (typeof body[key] === "string")
            record[key] = body[key].slice(0, key === "notes" ? 2000 : 150);
        for (const key of ["total", "tax"])
          if (
            body[key] === null ||
            (typeof body[key] === "number" &&
              Number.isFinite(body[key]) &&
              body[key] >= 0)
          )
            record[key] = body[key];
        await save(record);
        return record;
      }),
    export: async (format, requestId) => {
      if (!["csv", "json"].includes(format))
        throw fail(400, "Unknown export format");
      const rows = await list();
      if (!rows.length) throw fail(400, "Scan a receipt before exporting.");
      const feature = format === "csv" ? "pro_notes" : "api_access";
      const entitlement = await requireAccess(feature);
      let confirmed;
      if (format === "json") {
        if (!/^[a-zA-Z0-9-]{16,80}$/.test(requestId || ""))
          throw fail(400, "Export request ID required");
        confirmed = (await consume(feature, `export-${requestId}`, entitlement.grant_id)).entitlement;
      }
      return { rows, entitlement: confirmed };
    },
    insights: (requestId) =>
      serial(async () => {
        const rows = await list();
        if (!rows.length)
          throw fail(400, "Scan a receipt to see spending insights.");
        if (!/^[a-zA-Z0-9-]{16,80}$/.test(requestId || ""))
          throw fail(400, "Insights request ID required");
        const entitlement = await requireAccess("research_fetch");
        const consumed = await consume(
          "research_fetch",
          `insights-${requestId}`,
          entitlement.grant_id,
        );
        const groups = {};
        for (const r of rows) {
          const key = `${r.currency || "Unspecified"} · ${r.category}`;
          groups[key] = (groups[key] || 0) + (r.total || 0);
        }
        return {
          entitlement: consumed.entitlement,
          count: rows.length,
          groups,
          missingTotals: rows.filter((r) => r.total === null).length,
        };
      }),
  };
}
