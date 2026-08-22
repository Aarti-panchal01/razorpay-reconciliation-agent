"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Gauge,
  History,
  Loader2,
  Play,
  RotateCcw,
  ScanSearch,
  ShieldAlert,
  Sparkles,
  TriangleAlert,
  Zap,
} from "lucide-react";
import { StatTile } from "@/components/StatTile";
import { ComparisonChart, type ComparisonDatum } from "@/components/ComparisonChart";
import { ExceptionTable, type ExceptionRow } from "@/components/ExceptionTable";
import { SampleDataTables } from "@/components/SampleDataTables";
import { WorkedExample } from "@/components/WorkedExample";
import type { BadgeKey } from "@/components/CategoryBadge";

interface CategoryCounts {
  unmatched_bank_credit: number;
  unmatched_ledger: number;
  amount_mismatch: number;
  duplicate_utr: number;
  ambiguous_narration: number;
  orphan_settlement: number;
  unrecognized_tds_regime: number;
}

interface MatchResultRow extends ExceptionRow {
  status: "matched" | "matched_by_resolver" | "exception";
}

interface ReportSummary {
  totalRecords: number;
  matchedCount: number;
  matchedByResolverCount: number;
  exceptionCount: number;
  matchRatePct: number;
  throughputMsPerRecord: number;
  exceptionsByCategory: CategoryCounts;
  results?: MatchResultRow[];
}

interface SampleData {
  settlements: {
    paymentId: string;
    orderId: string;
    method: string;
    grossAmount: number;
    netAmount: number;
    settlementUtr: string;
    settlementDate: string;
  }[];
  bankEntries: { utr: string; creditAmount: number; creditDate: string; narration: string }[];
  ledgerEntries: { orderId: string; orderAmount: number; customerRef: string }[];
}

interface RunBatchResponse {
  seed: number;
  orderCount: number;
  sample: SampleData;
  naive: ReportSummary;
  current: ReportSummary;
}

interface RunHistoryEntry {
  id: string;
  createdAt: string;
  seed: number;
  orderCount: number;
  usedResolver: boolean;
  matchRatePct: number;
  exceptionCount: number;
}

// Matched rows are mechanically identical in kind (exact UTR, amount
// agrees) — rendering all of them for a large batch (seen: 249 rows,
// 14,500+ px of dead page height) is pure scroll cost with no new
// information past the first few dozen. Exceptions are never capped: the
// "nothing cherry-picked" claim specifically depends on that list being
// complete, and exception counts are naturally small enough not to need it.
const MATCHED_DISPLAY_CAP = 50;

const CATEGORY_KEYS = Object.keys({
  unmatched_bank_credit: 0,
  unmatched_ledger: 0,
  amount_mismatch: 0,
  duplicate_utr: 0,
  ambiguous_narration: 0,
  orphan_settlement: 0,
  unrecognized_tds_regime: 0,
} as CategoryCounts) as (keyof CategoryCounts)[];

export default function Dashboard() {
  const [seed, setSeed] = useState(42);
  const [orderCount, setOrderCount] = useState(300);
  const [useResolver, setUseResolver] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<RunBatchResponse | null>(null);
  const [history, setHistory] = useState<RunHistoryEntry[]>([]);
  const [resultsTab, setResultsTab] = useState<"exceptions" | "matched">("exceptions");

  async function loadHistory() {
    try {
      const res = await fetch("/api/runs");
      if (!res.ok) return;
      const json = (await res.json()) as { runs: RunHistoryEntry[] };
      setHistory(json.runs);
    } catch {
      // History is a nice-to-have — a failed fetch here shouldn't surface
      // as a page-level error when the actual reconciliation flow is fine.
    }
  }

  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const res = await fetch("/api/runs");
        if (!res.ok || ignore) return;
        const json = (await res.json()) as { runs: RunHistoryEntry[] };
        if (!ignore) setHistory(json.runs);
      } catch {
        // Same reasoning as loadHistory() above — non-fatal.
      }
    })();
    return () => {
      ignore = true;
    };
  }, []);

  async function runBatch() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/run-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seed, orderCount, useResolver }),
      });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const json = (await res.json()) as RunBatchResponse;
      setData(json);
      loadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error — the batch did not complete.");
    } finally {
      setLoading(false);
    }
  }

  const allResults = data?.current.results ?? [];
  const exceptions = allResults.filter((r) => r.status === "exception");
  const matched = allResults.filter((r) => r.status !== "exception");
  const exampleMatched = matched[0];
  const exampleException = exceptions[0];

  const tdsDelta = data
    ? data.naive.exceptionsByCategory.unrecognized_tds_regime -
      data.current.exceptionsByCategory.unrecognized_tds_regime
    : 0;

  const comparisonData: ComparisonDatum[] = data
    ? CATEGORY_KEYS.map((category) => ({
        category: category as BadgeKey,
        naive: data.naive.exceptionsByCategory[category],
        current: data.current.exceptionsByCategory[category],
      }))
    : [];

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-6xl px-6 py-8 space-y-8">
        <header className="glass-panel flex items-center justify-between rounded-2xl px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--series-current)] text-white shadow-sm">
              <Zap size={18} strokeWidth={2.5} />
            </div>
            <div>
              <h1 className="text-base font-semibold leading-tight">ReconIQ</h1>
              <p className="text-xs text-[var(--text-muted)]">Multi-rail settlement matching, honest exceptions</p>
            </div>
          </div>
          <span className="rounded-full border border-[var(--border)] bg-[var(--background)]/40 px-3 py-1 text-xs font-medium text-[var(--text-secondary)]">
            Track 04 · AI Finance Controller
          </span>
        </header>

        {/* What this actually is — plain language, always visible, read before
            anything else. This exists because "43.1% match rate" means
            nothing without it, and no amount of visual polish substitutes
            for actually saying what the tool does. */}
        <section className="glass-panel rounded-2xl p-5">
          <h2 className="mb-2 text-sm font-semibold">What this does</h2>
          <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
            A merchant&apos;s money passes through <strong className="text-[var(--foreground)]">three records that
            don&apos;t naturally agree</strong>: what Razorpay says it settled, what actually landed in the bank
            (identified by a UTR number, not an order ID), and what the merchant&apos;s own order ledger expects.
            Reconciling them means matching those three sources back together and being honest about the ones
            that don&apos;t line up. Click <strong className="text-[var(--foreground)]">Run batch</strong> below
            to generate a fresh synthetic set of all three (no real transactions — this is test data built to
            include the same messiness real settlement files have) and watch the matching happen record by record.
          </p>
        </section>

        <section className="glass-panel rounded-2xl p-5">
          <div className="flex flex-wrap items-end gap-5">
            <Field label="Seed" hint="Same seed = same generated batch, for reproducibility">
              <input
                type="number"
                value={seed}
                onChange={(e) => setSeed(Number(e.target.value))}
                className="w-24 rounded-md border border-[var(--border)] bg-transparent px-2.5 py-1.5 text-sm font-tabular outline-none focus:border-[var(--series-current)] focus:ring-2 focus:ring-[var(--series-current)]/20"
              />
            </Field>
            <Field label="Order count" hint="How many settlements to generate">
              <input
                type="number"
                value={orderCount}
                onChange={(e) => setOrderCount(Number(e.target.value))}
                className="w-24 rounded-md border border-[var(--border)] bg-transparent px-2.5 py-1.5 text-sm font-tabular outline-none focus:border-[var(--series-current)] focus:ring-2 focus:ring-[var(--series-current)]/20"
              />
            </Field>
            <label className="flex items-center gap-2 pb-1.5 text-sm text-[var(--text-secondary)]">
              <input
                type="checkbox"
                checked={useResolver}
                onChange={(e) => setUseResolver(e.target.checked)}
                className="h-4 w-4 rounded border-[var(--border)] accent-[var(--series-current)]"
              />
              Run LLM resolver on ambiguous cases
            </label>
            <button
              onClick={runBatch}
              disabled={loading}
              className="ml-auto inline-flex items-center gap-2 rounded-md bg-[var(--foreground)] px-4 py-2 text-sm font-medium text-[var(--background)] transition-opacity disabled:opacity-50"
            >
              {loading ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
              {loading ? "Generating batch and reconciling…" : "Run batch"}
            </button>
          </div>
        </section>

        {error && (
          <div className="glass-panel flex items-start gap-2 rounded-2xl border-[var(--status-critical)]/30 p-4 text-sm text-[var(--status-critical)]">
            <TriangleAlert size={16} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {!data && !loading && !error && (
          <div className="glass-panel flex flex-col items-center gap-3 rounded-2xl border-dashed py-20 text-center">
            <ScanSearch size={28} className="text-[var(--text-muted)]" />
            <p className="text-sm text-[var(--text-secondary)]">
              No batch run yet — click &ldquo;Run batch&rdquo; above to generate one and see it reconciled.
            </p>
          </div>
        )}

        {loading && !data && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="glass-panel h-24 animate-pulse rounded-2xl" />
            ))}
          </div>
        )}

        {data && (
          <>
            {/* The three raw inputs, shown as-is, BEFORE any results. */}
            <section>
              <h2 className="mb-3 text-sm font-semibold">
                What we generated
                <span className="ml-2 font-normal text-[var(--text-muted)]">
                  first 5 of {data.orderCount} settlements — same shape for the rest
                </span>
              </h2>
              <SampleDataTables
                settlements={data.sample.settlements}
                bankEntries={data.sample.bankEntries}
                ledgerEntries={data.sample.ledgerEntries}
              />
            </section>

            {/* Concrete before/after examples, read before the aggregate stats. */}
            {(exampleMatched || exampleException) && (
              <section>
                <h2 className="mb-3 text-sm font-semibold">How the matching actually works</h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  {exampleMatched && <WorkedExample row={exampleMatched} />}
                  {exampleException && <WorkedExample row={exampleException} />}
                </div>
              </section>
            )}

            {tdsDelta > 0 && (
              <div className="glass-panel flex items-center gap-3 rounded-2xl border-[var(--status-critical)]/30 px-5 py-4">
                <ShieldAlert size={20} className="shrink-0 text-[var(--status-critical)]" />
                <p className="text-sm">
                  <span className="font-tabular font-semibold text-[var(--status-critical)]">{tdsDelta}</span>{" "}
                  transaction{tdsDelta === 1 ? "" : "s"} under the new Section 393(1) / code-1035 TDS regime
                  {tdsDelta === 1 ? " was" : " were"} wrongly flagged by the naive baseline reconciler — and correctly
                  recognized by this engine. That is the live Apr-2026–Mar-2027 transition window, in one batch.
                </p>
              </div>
            )}

            <section>
              <h2 className="mb-1 text-sm font-semibold">
                Results for this batch
                <span className="ml-2 font-normal text-[var(--text-muted)]">
                  what fraction of {data.orderCount} settlements reconciled automatically, and how fast
                </span>
              </h2>
              <p className="mb-3 font-mono text-xs text-[var(--text-secondary)]">
                match rate = (matched + matched by resolver) ÷ total settlements × 100. Computed server-side in{" "}
                <code className="rounded bg-[color-mix(in_oklab,var(--foreground)_8%,transparent)] px-1 py-0.5">
                  engine/match.ts
                </code>{" "}
                from the &ldquo;Run batch&rdquo; click above, which calls{" "}
                <code className="rounded bg-[color-mix(in_oklab,var(--foreground)_8%,transparent)] px-1 py-0.5">
                  POST /api/run-batch
                </code>{" "}
                — nothing here is hardcoded or estimated, it&apos;s the literal count of this batch&apos;s results.
              </p>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
                <StatTile
                  label="Match rate"
                  value={`${data.current.matchRatePct.toFixed(1)}%`}
                  icon={Gauge}
                  hint="matched ÷ total"
                />
                <StatTile label="Matched" value={String(data.current.matchedCount)} icon={CheckCircle2} hint="by exact UTR" />
                <StatTile
                  label="Matched by resolver"
                  value={String(data.current.matchedByResolverCount)}
                  icon={Sparkles}
                  hint="LLM confirmed"
                />
                <StatTile
                  label="Exceptions"
                  value={String(data.current.exceptionCount)}
                  icon={TriangleAlert}
                  emphasis={data.current.exceptionCount > 0 ? "critical" : "default"}
                  hint="need a human"
                />
                <StatTile
                  label="Throughput"
                  value={`${data.current.throughputMsPerRecord.toFixed(3)} ms`}
                  icon={Zap}
                  hint="per record"
                />
              </div>
            </section>

            <section className="glass-panel rounded-2xl p-5">
              <div className="mb-1 flex items-baseline justify-between">
                <h2 className="text-sm font-semibold">Naive baseline vs. current engine</h2>
                <span className="text-xs text-[var(--text-muted)]">
                  seed {data.seed} · {data.orderCount} orders
                </span>
              </div>
              <p className="mb-3 text-xs text-[var(--text-secondary)]">
                Same exact batch, run through two versions of the matcher. &ldquo;Naive&rdquo; is what a
                reconciler built before the TDS transition does: it only recognizes the legacy Section 194O
                code, so it wrongly treats every new 393(1)/1035-tagged settlement as an anomaly — the tall
                orange bar under &ldquo;unrecognized TDS regime&rdquo; below. &ldquo;Current&rdquo; is this
                engine, which recognizes both.
              </p>
              <ComparisonChart data={comparisonData} />
            </section>

            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">
                  Every record, in full
                  <span className="ml-2 font-normal text-[var(--text-muted)]">
                    nothing cherry-picked — {matched.length} matched, {exceptions.length} exceptions
                  </span>
                </h2>
                <div className="flex gap-1 rounded-lg border border-[var(--border)] p-1">
                  <button
                    onClick={() => setResultsTab("exceptions")}
                    className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                      resultsTab === "exceptions"
                        ? "bg-[var(--foreground)] text-[var(--background)]"
                        : "text-[var(--text-secondary)]"
                    }`}
                  >
                    Exceptions ({exceptions.length})
                  </button>
                  <button
                    onClick={() => setResultsTab("matched")}
                    className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                      resultsTab === "matched"
                        ? "bg-[var(--foreground)] text-[var(--background)]"
                        : "text-[var(--text-secondary)]"
                    }`}
                  >
                    Matched ({matched.length})
                  </button>
                </div>
              </div>
              {resultsTab === "matched" && matched.length > MATCHED_DISPLAY_CAP && (
                <p className="mb-2 text-xs text-[var(--text-muted)]">
                  Showing the first {MATCHED_DISPLAY_CAP} of {matched.length} — every one matched the same way
                  (exact UTR, amount agrees), so the rest look identical in kind, not cherry-picked to hide
                  anything. The exception list above is never capped.
                </p>
              )}
              <ExceptionTable
                rows={
                  resultsTab === "exceptions" ? exceptions : matched.slice(0, MATCHED_DISPLAY_CAP)
                }
                emptyMessage={
                  resultsTab === "exceptions"
                    ? "No exceptions in this batch."
                    : "No matches in this batch."
                }
              />
            </section>
          </>
        )}

        {history.length > 0 && (
          <section>
            <div className="mb-3 flex items-center gap-2">
              <History size={15} className="text-[var(--text-muted)]" />
              <h2 className="text-sm font-semibold">Recent runs</h2>
              <span className="text-xs text-[var(--text-muted)]">persisted in Supabase</span>
            </div>
            <div className="glass-panel overflow-x-auto rounded-2xl">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--text-muted)]">
                    <th className="px-4 py-2.5 font-medium">When</th>
                    <th className="px-4 py-2.5 font-medium">Seed</th>
                    <th className="px-4 py-2.5 font-medium">Orders</th>
                    <th className="px-4 py-2.5 font-medium">Resolver</th>
                    <th className="px-4 py-2.5 text-right font-medium">Match rate</th>
                    <th className="px-4 py-2.5 text-right font-medium">Exceptions</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {history.map((run) => (
                    <tr key={run.id} className="border-b border-[var(--border)] last:border-0">
                      <td className="px-4 py-2.5 text-xs text-[var(--text-secondary)] whitespace-nowrap">
                        {new Date(run.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5 font-tabular">{run.seed}</td>
                      <td className="px-4 py-2.5 font-tabular">{run.orderCount}</td>
                      <td className="px-4 py-2.5 text-xs text-[var(--text-secondary)]">
                        {run.usedResolver ? "on" : "off"}
                      </td>
                      <td className="px-4 py-2.5 text-right font-tabular">{run.matchRatePct.toFixed(1)}%</td>
                      <td className="px-4 py-2.5 text-right font-tabular">{run.exceptionCount}</td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          onClick={() => {
                            setSeed(run.seed);
                            setOrderCount(run.orderCount);
                            setUseResolver(run.usedResolver);
                          }}
                          className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]"
                          title="Load these parameters"
                        >
                          <RotateCcw size={12} /> load
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function Field({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-[var(--text-muted)]" title={hint}>
      {label}
      {children}
      <span className="max-w-[10rem] text-[10px] font-normal normal-case leading-tight text-[var(--text-muted)]">
        {hint}
      </span>
    </label>
  );
}
