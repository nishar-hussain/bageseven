import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  BagsevenEmbed,
  BagsevenProvider,
  useBagseven,
  useEntitlement,
  useRemaining,
} from "@bagseven/sdk/react";

type Entitlement = ReturnType<typeof useEntitlement>;
type Bootstrap = {
  holder: string;
  publishableKey: string;
  accessToken: string;
  apiUrl: string;
  planIds: string[];
};
type Receipt = {
  id: string;
  merchant: string;
  date: string;
  total: number | null;
  tax: number | null;
  currency: string;
  category: string;
  notes: string;
  rawText: string;
  fileName: string;
  createdAt: string;
  items: { description: string; amount: number }[];
  remaining: string;
  entitlement?: Entitlement;
};
type Insight = {
  entitlement?: Entitlement;
  count: number;
  groups: Record<string, number>;
  missingTotals: number;
};
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/demo/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error?.message || "Request failed. Please try again.");
  return data;
}
const money = (value: number | null, currency: string) =>
  value === null
    ? "Needs review"
    : `${currency || "Amount"} ${value.toFixed(2)}`;
function Workspace({ boot }: { boot: Bootstrap }) {
  const { refresh, accessToken, pending, error: entitlementError, applyEntitlement } = useBagseven();
  const scans = useEntitlement("ocr");
  const scanRemaining = useRemaining("ocr");
  const insightRemaining = useRemaining("research_fetch");
  const jsonRemaining = useRemaining("api_access");
  const pro = useEntitlement("pro_notes");
  const insightCredits = useEntitlement("research_fetch");
  const jsonCredits = useEntitlement("api_access");
  const [tab, setTab] = useState<"receipts" | "insights" | "billing">(
    "receipts",
  );
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [selected, setSelected] = useState<Receipt | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [requestId, setRequestId] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [insights, setInsights] = useState<Insight | null>(null);
  const [revision, setRevision] = useState(0);
  const [billingView, setBillingView] = useState<"pricing" | "portal">(
    "pricing",
  );
  const upload = useRef<HTMLInputElement>(null);
  const exporting = useRef<Record<string, string>>({});
  useEffect(() => {
    void api<{ receipts: Receipt[] }>("receipts")
      .then((d) => setReceipts(d.receipts))
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    const update = () => {
      void refresh().catch(() => {});
      void api<{ receipts: Receipt[] }>("receipts")
        .then((data) => setReceipts(data.receipts))
        .catch((e) => setError(e.message));
    };
    const poll = setInterval(() => { if (!document.hidden) void refresh().catch(() => {}); }, 10000);
    window.addEventListener("focus", update);
    return () => { clearInterval(poll); window.removeEventListener("focus", update); };
  }, [refresh]);
  useEffect(() => {
    void refresh().catch(() => {});
  }, [tab, refresh]);
  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  function choose(file?: File) {
    setError("");
    setNotice("");
    if (!file) return;
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > 6 * 1024 * 1024
    ) {
      setError("Choose a PNG, JPEG, or WebP image smaller than 6 MB.");
      return;
    }
    setFile(file);
    setSelected(null);
    setRequestId(crypto.randomUUID());
  }
  async function sync() {
    await refresh().catch(() => {});
    setRevision((r) => r + 1);
  }
  async function sample() {
    try {
      const blob = await fetch("/sample-receipt.png").then((r) => r.blob());
      choose(new File([blob], "harbor-coffee.png", { type: "image/png" }));
    } catch {
      setError("Could not load the sample receipt.");
    }
  }
  async function scan() {
    if (!file || busy) return;
    setBusy("scan");
    setError("");
    setNotice("");
    try {
      const image = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const { receipt } = await api<{ receipt: Receipt }>("scan", {
        image,
        fileName: file.name,
        requestId,
      });
      if (receipt.entitlement) applyEntitlement(receipt.entitlement);
      setSelected(receipt);
      setReceipts((rows) => [
        receipt,
        ...rows.filter((r) => r.id !== receipt.id),
      ]);
      setNotice(
        "Receipt scanned and saved. One scan credit used. Review the extracted details below.",
      );
      await sync();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Scan failed. Retry with the same image.",
      );
    } finally {
      setBusy("");
    }
  }
  async function save() {
    if (!selected) return;
    setBusy("save");
    setError("");
    try {
      const { receipt } = await api<{ receipt: Receipt }>(
        "receipts/save",
        selected,
      );
      setSelected(receipt);
      setReceipts((rows) =>
        rows.map((r) => (r.id === receipt.id ? receipt : r)),
      );
      setInsights(null);
      setNotice("Changes saved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function download(format: "csv" | "json") {
    setBusy(format);
    setError("");
    const id = (exporting.current[format] ||= crypto.randomUUID());
    try {
      const data = await api<{
        entitlement?: Entitlement;
        content: string;
        mime: string;
        fileName: string;
      }>("export", { format, requestId: id });
      if (data.entitlement) applyEntitlement(data.entitlement);
      const url = URL.createObjectURL(
        new Blob([data.content], { type: data.mime }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = data.fileName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      delete exporting.current[format];
      setNotice(
        `${format.toUpperCase()} exported.${format === "json" ? " One JSON export credit used." : ""}`,
      );
      await sync();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function analyze() {
    setBusy("insights");
    setError("");
    const id = (exporting.current.insights ||= crypto.randomUUID());
    try {
      const result = await api<Insight>("insights", { requestId: id });
      if (result.entitlement) applyEntitlement(result.entitlement);
      setInsights(result);
      delete exporting.current.insights;
      await sync();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  const filtered = receipts.filter((r) =>
    `${r.merchant} ${r.category} ${r.date}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="wordmark" href="/" aria-label="ReceiptBox home">
          <span className="app-icon">▤</span>ReceiptBox
        </a>
        <p className="workspace-label">YOUR WORKSPACE</p>
        <nav>
          {(["receipts", "insights", "billing"] as const).map((item, i) => (
            <button
              key={item}
              className={tab === item ? "nav active" : "nav"}
              onClick={() => {
                setTab(item);
                setError("");
              }}
            >
              <span>{["▤", "◷", "◇"][i]}</span>
              {item[0].toUpperCase() + item.slice(1)}
              {item === "receipts" && <small>{receipts.length}</small>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="plan-status">
            <span className="dot" />
            {pro.enabled ? "CSV access enabled" : "Receipt workspace"}
            <small>{scanRemaining} scans available</small>
            <button className="text-button" onClick={() => setTab("billing")}>
              Manage plan →
            </button>
          </div>
          <a
            className="powered"
            href="http://localhost:3000/app"
            target="_blank"
            rel="noreferrer"
          >
            <img src="/bagseven.svg" alt="Bagseven logo" />
            Powered by <strong>Bagseven</strong>
          </a>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <span>
            Workspace <span className="slash">/</span>{" "}
            {tab[0].toUpperCase() + tab.slice(1)}
          </span>
          <div className="top-actions">
            <span className="credit-badge">
              {entitlementError ? "Balance unavailable" : pending ? "Updating…" : `${scanRemaining} scan credits`}
            </span>
            <button
              title="Refresh access and billing"
              className="icon-button"
              disabled={!!busy || pending}
              onClick={() => void sync().catch((e) => setError(e.message))}
            >
              ↻
            </button>
            <span className="avatar">RB</span>
          </div>
        </header>
        <nav className="mobile-nav" aria-label="Workspace navigation">
          {(["receipts", "insights", "billing"] as const).map((item) => (
            <button key={item} className={tab === item ? "active" : ""} onClick={() => { setTab(item); setError(""); }}>
              {item[0].toUpperCase() + item.slice(1)}
            </button>
          ))}
        </nav>
        <div className="content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">LESS PAPERWORK. MORE CLARITY.</p>
              <h1>
                {tab === "receipts"
                  ? "Your receipts, organized."
                  : tab === "insights"
                    ? "Know where it goes."
                    : "A plan for your paperwork."}
              </h1>
              <p className="subtitle">
                {tab === "receipts"
                  ? "Turn receipt photos into searchable expenses. Upload, review, and keep moving."
                  : tab === "insights"
                    ? "A clear breakdown of your saved expenses, grouped by category and currency."
                    : "Scan credits, export permissions, and billing — all in one place."}
              </p>
            </div>
            {tab === "receipts" && (
              <button
                className="button secondary"
                disabled={!!busy}
                onClick={() => void sample()}
              >
                Try a sample receipt ↗
              </button>
            )}
          </div>
          {(error || entitlementError) && (
            <div className="message error" role="alert">
              {error || entitlementError}{" "}
              <button className="text-button" onClick={() => setTab("billing")}>
                View billing
              </button>
            </div>
          )}
          {notice && (
            <div className="message success" role="status">
              {notice}
            </div>
          )}
          {tab === "receipts" && (
            <>
              <section className="scan-layout">
                <div className="card upload-card">
                  <div className="section-heading">
                    <h2>Scan a receipt</h2>
                    <span className="tag">1 credit / scan</span>
                  </div>
                  <input
                    ref={upload}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    aria-label="Upload receipt image"
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      choose(e.target.files?.[0])
                    }
                    disabled={!!busy}
                  />
                  <div
                    className={`dropzone ${preview || selected ? "has-image" : ""}`}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (!busy) choose(e.dataTransfer.files[0]);
                    }}
                  >
                    {preview || selected ? (
                      <img
                        className="receipt-preview"
                        src={
                          preview || `/api/demo/receipts/${selected!.id}/image`
                        }
                        alt="Receipt to scan"
                      />
                    ) : (
                      <>
                        <span className="upload-icon">↥</span>
                        <h3>Drop your receipt here</h3>
                        <p>PNG, JPEG, or WebP · up to 6 MB</p>
                        <button
                          className="button secondary"
                          onClick={() => upload.current?.click()}
                        >
                          Choose image
                        </button>
                      </>
                    )}
                  </div>
                  {file && (
                    <div className="file-row">
                      <span>
                        {file.name}
                        <small>{Math.ceil(file.size / 1024)} KB</small>
                      </span>
                      <button
                        className="text-button"
                        disabled={!!busy}
                        onClick={() => upload.current?.click()}
                      >
                        Change image
                      </button>
                    </div>
                  )}
                  <button
                    className="button scan-button"
                    disabled={
                      !file || !!busy || pending || !scans.enabled || !!selected
                    }
                    onClick={() => void scan()}
                  >
                    {busy === "scan"
                      ? "Reading receipt & saving usage…"
                      : selected
                        ? "Receipt saved ✓"
                        : !scans.enabled
                          ? "Add scan credits to continue"
                          : "Scan receipt →"}
                  </button>
                  <p className="hint">
                    A successful scan uses one credit. Unreadable images do not
                    use credits.
                  </p>
                </div>
                <div className="card review-card">
                  <div className="section-heading">
                    <h2>Receipt details</h2>
                    <span className="tag">
                      {selected ? "Review & edit" : "Ready when you are"}
                    </span>
                  </div>
                  {selected ? (
                    <>
                      <div className="receipt-merchant">
                        <span className="merchant-icon">▤</span>
                        <div>
                          <h3>{selected.merchant}</h3>
                          <p>{selected.fileName}</p>
                        </div>
                        <strong>
                          {money(selected.total, selected.currency)}
                        </strong>
                      </div>
                      <div className="form-grid">
                        <label>
                          Merchant
                          <input
                            value={selected.merchant}
                            onChange={(e) =>
                              setSelected({
                                ...selected,
                                merchant: e.target.value,
                              })
                            }
                          />
                        </label>
                        <label>
                          Date
                          <input
                            type="date"
                            value={selected.date}
                            onChange={(e) =>
                              setSelected({ ...selected, date: e.target.value })
                            }
                          />
                        </label>
                        <label>
                          Total
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={selected.total ?? ""}
                            onChange={(e) =>
                              setSelected({
                                ...selected,
                                total:
                                  e.target.value === ""
                                    ? null
                                    : Number(e.target.value),
                              })
                            }
                          />
                        </label>
                        <label>
                          Tax
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={selected.tax ?? ""}
                            onChange={(e) =>
                              setSelected({
                                ...selected,
                                tax:
                                  e.target.value === ""
                                    ? null
                                    : Number(e.target.value),
                              })
                            }
                          />
                        </label>
                        <label>
                          Currency
                          <select
                            value={selected.currency}
                            onChange={(e) =>
                              setSelected({
                                ...selected,
                                currency: e.target.value,
                              })
                            }
                          >
                            <option value="">Select currency</option>
                            {["INR", "USD", "EUR", "GBP", "AED", "SGD"].map(
                              (c) => (
                                <option key={c}>{c}</option>
                              ),
                            )}
                          </select>
                        </label>
                        <label>
                          Category
                          <select
                            value={selected.category}
                            onChange={(e) =>
                              setSelected({
                                ...selected,
                                category: e.target.value,
                              })
                            }
                          >
                            {[
                              "Other",
                              "Food & drink",
                              "Travel",
                              "Office",
                              "Shopping",
                              "Utilities",
                            ].map((c) => (
                              <option key={c}>{c}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <label className="notes-label">
                        Notes
                        <textarea
                          value={selected.notes}
                          onChange={(e) =>
                            setSelected({ ...selected, notes: e.target.value })
                          }
                          placeholder="Add a project or expense note"
                        />
                      </label>
                      <div className="review-actions">
                        <span className="hint">
                          Check the details before exporting.
                        </span>
                        <button
                          className="button"
                          disabled={!!busy}
                          onClick={() => void save()}
                        >
                          {busy === "save" ? "Saving…" : "Save changes"}
                        </button>
                      </div>
                      <details className="raw-text">
                        <summary>Line items & extracted text</summary>
                        <div className="line-items">
                          {selected.items.map((item, index) => (
                            <div key={index}>
                              <span>{item.description}</span>
                              <strong>
                                {money(item.amount, selected.currency)}
                              </strong>
                            </div>
                          ))}
                        </div>
                        <pre>{selected.rawText}</pre>
                      </details>
                    </>
                  ) : (
                    <div className="empty-review">
                      <div className="paper-icon">▤</div>
                      <h3>From paper to details.</h3>
                      <p>
                        Your merchant, date, items, tax, and total will appear
                        here after scanning.
                      </p>
                      <div className="placeholder-lines">
                        <i />
                        <i />
                        <i />
                      </div>
                      <span className="tag">Review before exporting</span>
                    </div>
                  )}
                </div>
              </section>
              <section className="card history">
                <div className="section-heading">
                  <div>
                    <h2>
                      Receipt library{" "}
                      <span className="count">{receipts.length}</span>
                    </h2>
                    <p className="hint">
                      Saved in your workspace, ready whenever you need them.
                    </p>
                  </div>
                  <div className="row">
                    <button
                      className="button secondary"
                      disabled={!receipts.length || !!busy || !pro.enabled}
                      onClick={() => void download("csv")}
                    >
                      Export CSV {pro.enabled ? "↗" : "· locked"}
                    </button>
                    <button
                      className="button secondary"
                      disabled={
                        !receipts.length || !!busy || !jsonCredits.enabled
                      }
                      onClick={() => void download("json")}
                    >
                      Export JSON · {jsonRemaining} left
                    </button>
                  </div>
                </div>
                <input
                  className="search"
                  aria-label="Search receipts"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search merchant, date, or category…"
                />
                {receipts.length ? (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>MERCHANT</th>
                          <th>DATE</th>
                          <th>CATEGORY</th>
                          <th>TOTAL</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((r) => (
                          <tr key={r.id}>
                            <td>
                              <strong>{r.merchant}</strong>
                              <small>{r.fileName}</small>
                            </td>
                            <td>{r.date || "Needs review"}</td>
                            <td>
                              <span className="tag">{r.category}</span>
                            </td>
                            <td>{money(r.total, r.currency)}</td>
                            <td>
                              <button
                                className="text-button"
                                disabled={!!busy}
                                onClick={() => {
                                  setSelected(r);
                                  setFile(null);
                                  window.scrollTo({
                                    top: 80,
                                    behavior: "smooth",
                                  });
                                }}
                              >
                                Open →
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!filtered.length && (
                      <p className="empty-list">No matching receipts.</p>
                    )}
                  </div>
                ) : (
                  <div className="empty-list">
                    Your next receipt is the start of a more organized day.
                  </div>
                )}
              </section>
            </>
          )}
          {tab === "insights" && (
            <section className="card insights">
              <div className="section-heading">
                <div>
                  <h2>Spending overview</h2>
                  <p className="hint">
                    Calculated from saved receipt totals. Different currencies
                    stay separate.
                  </p>
                </div>
                <button
                  className="button"
                  disabled={
                    !!busy || !receipts.length || !insightCredits.enabled
                  }
                  onClick={() => void analyze()}
                >
                  {busy === "insights"
                    ? "Calculating…"
                    : "Generate insights · 1 credit"}
                </button>
              </div>
              <span className="tag">
                {insightRemaining} insight credits remaining
              </span>
              {insights ? (
                <>
                  <h3>{insights.count} {insights.count === 1 ? "receipt" : "receipts"} in your workspace</h3>
                  {Object.entries(insights.groups).map(([key, value]) => (
                    <div className="insight-row" key={key}>
                      <span>{key}</span>
                      <strong>{value.toFixed(2)}</strong>
                    </div>
                  ))}
                  {!!insights.missingTotals && (
                    <p>
                      {insights.missingTotals} receipts need a total. Review
                      them for accurate reporting.
                    </p>
                  )}
                </>
              ) : (
                <div className="empty-list">
                  Scan and categorize receipts, then generate your spending
                  breakdown.
                </div>
              )}
            </section>
          )}
          {tab === "billing" && (
            <>
              <div className="allowances">
                {[
                  {
                    title: "Receipt scans",
                    value: scanRemaining,
                    note: "One credit per successful scan",
                  },
                  {
                    title: "CSV exports",
                    value: pro.enabled ? "Included" : "Separate access required",
                    note: "Requires an active CSV export entitlement",
                  },
                  {
                    title: "Expense insights",
                    value: insightRemaining,
                    note: "One credit per generated overview",
                  },
                  {
                    title: "JSON exports",
                    value: jsonRemaining,
                    note: "One credit per export",
                  },
                ].map((a) => (
                  <div className="card allowance" key={a.title}>
                    <p>{a.title}</p>
                    <strong>{a.value}</strong>
                    <small>{a.note}</small>
                  </div>
                ))}
              </div>
              <section className="card billing">
                <div className="section-heading">
                  <h2>Manage your access</h2>
                </div>
                <BagsevenEmbed
                  key={`${billingView}-${revision}`}
                  accessToken={accessToken || boot.accessToken}
                  publishableKey={boot.publishableKey}
                  holder={boot.holder}
                  apiUrl={boot.apiUrl}
                  initialView={billingView}
                  planIds={boot.planIds}
                  theme={{ accent: "#0002f8" }}
                />
              </section>
            </>
          )}
          <footer>
            <span>ReceiptBox · Receipt management, without the paperwork.</span>
            <span>
              Payments & access by{" "}
              <a href="http://localhost:3001" target="_blank" rel="noreferrer">
                Bagseven ↗
              </a>
            </span>
          </footer>
        </div>
      </main>
    </div>
  );
}
export function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    void fetch("/api/demo/bootstrap", { signal: controller.signal })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error?.message || "Unable to connect");
        setBoot(d);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [attempt]);
  useEffect(() => {
    const timer = setInterval(() => setAttempt(n => n + 1), 45 * 60_000);
    return () => clearInterval(timer);
  }, []);
  if (!boot)
    return (
      <div className="loading">
        <img src="/bagseven.svg" alt="Bagseven" />
        <h1>ReceiptBox</h1>
        <p role="status">{error || "Opening your workspace…"}</p>
        {error && (
          <button className="button" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        )}
      </div>
    );
  return (
    <BagsevenProvider
      publishableKey={boot.publishableKey}
      apiUrl={boot.apiUrl}
      accessToken={boot.accessToken}
      holder={boot.holder}
    >
      <Workspace boot={boot} />
    </BagsevenProvider>
  );
}
