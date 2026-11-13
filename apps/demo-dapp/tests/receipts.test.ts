import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createReceiptService, parseReceipt } from "../receipts.mjs";
const image = `data:image/png;base64,${Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]).toString("base64")}`;
const text =
  "HARBOR COFFEE\nDate: 2026-11-07\nFlat White 180.00\nToast 240.00\nCookie 80.00\nSUBTOTAL 500.00\nGST 25.00\nTOTAL INR 525.00";
async function harness(
  run: (
    service: ReturnType<typeof createReceiptService>,
    calls: string[],
  ) => Promise<void>,
  enabled = true,
) {
  const directory = await mkdtemp(join(tmpdir(), "receipt-test-"));
  const calls: string[] = [];
  const service = createReceiptService({
    directory,
    check: async (feature: string) => {
      calls.push(`check:${feature}`);
      return { enabled, grant_id: "grant" };
    },
    consume: async (feature: string) => {
      calls.push(`consume:${feature}`);
      return { entitlement: { remaining: "45" } };
    },
    ocr: async () => {
      calls.push("ocr");
      return text;
    },
  });
  try {
    await run(service, calls);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
describe("receipt workflow", () => {
  it("extracts the actual total, tax, date and line items", () => {
    const r = parseReceipt(text);
    expect(r).toMatchObject({
      merchant: "HARBOR COFFEE",
      date: "2026-11-07",
      total: 525,
      tax: 25,
      currency: "INR",
    });
    expect(r.items).toHaveLength(3);
  });
  it("blocks scans before OCR or consumption when access is denied", () =>
    harness(async (s, calls) => {
      await expect(
        s.scan({ requestId: "denied-scan-123456", image }),
      ).rejects.toMatchObject({ status: 403 });
      expect(calls).toEqual(["check:ocr"]);
    }, false));
  it("charges exactly once for concurrent retries and survives reloading the saved receipt", () =>
    harness(async (s, calls) => {
      const body = { requestId: "same-scan-12345678", image };
      const [a, b] = await Promise.all([s.scan(body), s.scan(body)]);
      expect(a.id).toBe(b.id);
      expect(a.entitlement.remaining).toBe("45");
      expect(calls.filter((c) => c === "consume:ocr")).toHaveLength(1);
      expect(calls.filter((c) => c === "ocr")).toHaveLength(1);
      expect(await s.list()).toHaveLength(1);
      expect((await s.image(a.id)).subarray(0, 8)).toEqual(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      );
      const changed = await s.update({
        id: a.id,
        merchant: "Corrected merchant",
        total: 530,
        category: "Food & drink",
      });
      expect(changed.total).toBe(530);
      expect((await s.list())[0].merchant).toBe("Corrected merchant");
    }));
  it("does not run OCR or charge invalid uploads", () =>
    harness(async (s, calls) => {
      await expect(
        s.scan({
          requestId: "invalid-scan-12345",
          image: "data:image/png;base64,aGVsbG8=",
        }),
      ).rejects.toMatchObject({ status: 400 });
      expect(calls).toEqual([]);
    }));
  it("enforces Pro CSV access and meters JSON and insights against their own entitlements", () =>
    harness(async (s, calls) => {
      await s.scan({ requestId: "exports-scan-123456", image });
      await s.export("csv", "export-request-123456");
      expect((await s.export("json", "export-request-123456")).entitlement.remaining).toBe("45");
      const insight = await s.insights("insight-request-123456");
      expect(insight.entitlement.remaining).toBe("45");
      expect(insight.groups).toEqual({ "INR · Other": 525 });
      expect(calls).toContain("check:pro_notes");
      expect(calls).not.toContain("consume:pro_notes");
      expect(calls).toContain("consume:api_access");
      expect(calls).toContain("consume:research_fetch");
    }));
  it("keeps a recognized receipt for a safe retry when credit consumption fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "receipt-retry-"));
    let attempts = 0,
      reads = 0;
    const s = createReceiptService({
      directory,
      check: async () => ({ enabled: true, grant_id: "g" }),
      ocr: async () => {
        reads++;
        return text;
      },
      consume: async () => {
        if (!attempts++) throw Error("Temporary chain failure");
        return { entitlement: { remaining: "44" } };
      },
    });
    try {
      const body = { requestId: "retry-scan-12345678", image };
      await expect(s.scan(body)).rejects.toThrow("Temporary chain failure");
      expect(await s.list()).toHaveLength(0);
      await s.scan(body);
      expect(reads).toBe(1);
      expect(await s.list()).toHaveLength(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

it("does not consume a credit when OCR fails", async () => {
  const directory = await mkdtemp(join(tmpdir(), "receipt-unreadable-"));
  let charged = false;
  const service = createReceiptService({
    directory,
    check: async () => ({ enabled: true, grant_id: "g" }),
    consume: async () => {
      charged = true;
    },
    ocr: async () => {
      throw new Error("Unreadable image");
    },
  });
  try {
    await expect(
      service.scan({ requestId: "unreadable-image-12345", image }),
    ).rejects.toThrow("Unreadable image");
    expect(charged).toBe(false);
    expect(await service.list()).toHaveLength(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
