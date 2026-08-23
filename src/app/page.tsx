"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Gauge,
  History,
  Loader2,
  Play,
  RotateCcw,
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
  // Off by default: the very first batch runs automatically on page load
  // (see the mount effect below), and it needs to be fast — sequential
  // real LLM calls would stall the first thing a visitor sees. Anyone who
  // wants to see the resolver in action checks this and reruns manually.
  const [useResolver, setUseResolver] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<RunBatchResponse | null>(null);
  const [history, setHistory] = useState<RunHistoryEntry[]>([]);
  const [resultsTab, setResultsTab] = useState<"exceptions" | "matched">("exceptions");

  // Pure fetches, no setState — both the manual "Run new batch" handler and
  // the auto-run-on-mount effect below wrap these with their own state
  // orchestration. Keeping the fetch itself state-free is what let the
  // mount effect satisfy react-hooks/set-state-in-effect: that rule flags
  // calling a component function that's known to setState directly from an
  // effect body (runBatch used to call setLoading(true) synchronously the
  // moment it's invoked), and it can't see into a Promise-returning fetch
  // helper the same way.
  async function fetchBatch(): Promise<RunBatchResponse> {
    const res = await fetch("/api/run-batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seed, orderCount, useResolver }),
    });
    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    return res.json();
  }

  async function fetchHistory(): Promise<RunHistoryEntry[]> {
    const res = await fetch("/api/runs");
    if (!res.ok) return [];
    const json = (await res.json()) as { runs: RunHistoryEntry[] };
    return json.runs;
  }

  async function runBatch() {
    setLoading(true);
    setError(null);
    try {
      const json = await fetchBatch();
      setData(json);
      setHistory(await fetchHistory());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error — the batch did not complete.");
    } finally {
      setLoading(false);
    }
  }

  // Auto-runs the default batch on first load — the headline numbers in
  // the hero are visible before anyone clicks anything, not gated behind
  // an action a first-time visitor has to know to take. Research on this
  // exact question (landing pages, SaaS dashboard "activation" patterns)
  // is consistent: lead with the proof, explain second. The `ignore` flag
  // also does real work beyond satisfying the linter: it skips setting
  // state if this effect's cleanup already ran before the fetch resolves.
  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const json = await fetchBatch();
        if (ignore) return;
        setData(json);
        const runs = await fetchHistory();
        if (!ignore) setHistory(runs);
      } catch (e) {
        if (!ignore) setError(e instanceof Error ? e.message : "Unknown error — the batch did not complete.");
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => {
      ignore = true;
    };
    // Intentionally empty deps — this is the one-time auto-run on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      <div className="mx-auto max-w-6xl px-6 py-8 space-y-10">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--series-current)] text-white shadow-sm">
              <Zap size={18} strokeWidth={2.5} />
            </div>
            <div>
              <h1 className="text-base font-semibold leading-tight">ReconIQ</h1>
              <p className="text-xs text-[var(--text-muted)]">Multi-rail settlement matching, honest exceptions</p>
            </div>
          </div>
          <span className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-medium text-[var(--text-secondary)]">
            Track 04 · AI Finance Controller
          </span>
        </header>

        {/* Hero: the headline claim, the proof, and the control to reproduce
            it, all in one screen — nothing below this should have to be
            scrolled to just to know whether the thing works. */}
        <section>
          <h2 className="max-w-3xl text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
            Catches what a naive reconciler misses.
          </h2>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-[var(--text-secondary)]">
            Razorpay settlements, the bank statement, and the merchant&apos;s own ledger — three records that
            don&apos;t naturally agree. ReconIQ matches them and survives India&apos;s live TDS regime transition,
            where a naive reconciler wrongly flags every new-regime settlement as an anomaly.
          </p>

          {error && (
            <div className="glass-panel mt-6 flex items-start gap-2 rounded-2xl border-[var(--status-critical)]/30 p-4 text-sm text-[var(--status-critical)]">
              <TriangleAlert size={16} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Live headline stat — populated by the auto-run on mount, not
              waiting for interaction. This is the entire "wow" moment; if
              a visitor reads nothing else on the page, this is it. */}
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <div className="glass-panel rounded-2xl border-[var(--status-critical)]/25 p-6">
              <p className="text-xs font-medium tracking-wide text-[var(--text-muted)] uppercase">
                Wrongly flagged by a naive reconciler
              </p>
              {loading && !data ? (
                <div className="mt-2 h-12 w-24 animate-pulse rounded bg-[var(--surface-raised)]" />
              ) : (
                <p className="mt-1 font-tabular text-5xl font-bold text-[var(--status-critical)]">{tdsDelta}</p>
              )}
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                transactions under the new Section 393(1)/code-1035 TDS regime
              </p>
            </div>
            <div className="glass-panel rounded-2xl border-[var(--status-good)]/25 p-6">
              <p className="text-xs font-medium tracking-wide text-[var(--text-muted)] uppercase">
                Wrongly flagged by this engine
              </p>
              {loading && !data ? (
                <div className="mt-2 h-12 w-24 animate-pulse rounded bg-[var(--surface-raised)]" />
              ) : (
                <p className="mt-1 font-tabular text-5xl font-bold text-[var(--status-good-text)]">
                  {data ? data.current.exceptionsByCategory.unrecognized_tds_regime : "—"}
                </p>
              )}
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                same batch, same transactions, both TDS regimes recognized
              </p>
            </div>
          </div>

          {/* Compact controls — secondary to the hero stat above, not a
              standalone section someone has to parse before seeing value. */}
          <div className="glass-panel mt-6 flex flex-wrap items-end gap-5 rounded-2xl p-4">
            <Field label="Seed" hint="Same seed = same batch">
              <input
                type="number"
                value={seed}
                onChange={(e) => setSeed(Number(e.target.value))}
                className="w-20 rounded-md border border-[var(--border)] bg-transparent px-2.5 py-1.5 text-sm font-tabular outline-none focus:border-[var(--series-current)] focus:ring-2 focus:ring-[var(--series-current)]/20"
              />
            </Field>
            <Field label="Orders" hint="Settlements to generate">
              <input
                type="number"
                value={orderCount}
                onChange={(e) => setOrderCount(Number(e.target.value))}
                className="w-20 rounded-md border border-[var(--border)] bg-transparent px-2.5 py-1.5 text-sm font-tabular outline-none focus:border-[var(--series-current)] focus:ring-2 focus:ring-[var(--series-current)]/20"
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
              className="ml-auto inline-flex items-center gap-2 rounded-lg bg-[var(--series-current)] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_0_0_1px_rgba(255,255,255,0.1)_inset,0_4px_16px_-4px_var(--series-current)] transition-transform hover:scale-[1.02] disabled:opacity-50 disabled:hover:scale-100"
            >
              {loading ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
              {loading ? "Generating batch and reconciling…" : "Run new batch"}
            </button>
          </div>
        </section>

        {/* Results — promoted to right after the hero, ahead of any
            explanatory content, per the same "proof before explanation"
            principle the hero follows. */}
        {data && (
          <>
            <section>
              <h2 className="mb-1 text-sm font-semibold">
                Results for this batch
                <span className="ml-2 font-normal text-[var(--text-muted)]">
                  what fraction of {data.orderCount} settlements reconciled automatically, and how fast
                </span>
              </h2>
              <p className="mb-3 font-mono text-xs text-[var(--text-secondary)]">
                match rate = (matched + matched by resolver) ÷ total settlements × 100. Computed server-side in{" "}
                <code className="rounded bg-[var(--surface-raised)] px-1 py-0.5">engine/match.ts</code> from the
                &ldquo;Run new batch&rdquo; click above, which calls{" "}
                <code className="rounded bg-[var(--surface-raised)] px-1 py-0.5">POST /api/run-batch</code> —
                nothing here is hardcoded or estimated, it&apos;s the literal count of this batch&apos;s results.
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

            <section className="glass-panel rounded-2xl p-6">
              <div className="mb-1 flex items-baseline justify-between">
                <h2 className="text-sm font-semibold">Naive baseline vs. current engine</h2>
                <span className="text-xs text-[var(--text-muted)]">
                  seed {data.seed} · {data.orderCount} orders
                </span>
              </div>
              <p className="mb-2 text-xs text-[var(--text-secondary)]">
                Same exact batch, run through two versions of the matcher. Watch the bar under
                &ldquo;unrecognized TDS regime&rdquo; — that&apos;s every new-393(1)/1035 settlement the naive
                matcher gets wrong, all at once.
              </p>
              <div className="mb-4 flex items-center gap-2 text-sm">
                <ShieldAlert size={16} className="shrink-0 text-[var(--status-critical)]" />
                <span className="font-tabular font-semibold text-[var(--status-critical)]">{tdsDelta}</span>
                <span className="text-[var(--text-secondary)]">
                  naive misses vs.{" "}
                  <span className="font-tabular font-semibold text-[var(--status-good-text)]">
                    {data.current.exceptionsByCategory.unrecognized_tds_regime}
                  </span>{" "}
                  from this engine, on the exact same input.
                </span>
              </div>
              <ComparisonChart data={comparisonData} />
            </section>
          </>
        )}

        {/* Explanatory content — moved below the results on purpose. Someone
            already convinced by the numbers above can dig into how; someone
            not yet convinced was never going to read this first anyway. */}
        <section className="glass-panel rounded-2xl p-5">
          <h2 className="mb-2 text-sm font-semibold">What this does</h2>
          <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
            A merchant&apos;s money passes through three records that don&apos;t naturally agree: what Razorpay
            says it settled, what actually landed in the bank (identified by a UTR number, not an order ID), and
            what the merchant&apos;s own order ledger expects. Reconciling them means matching those three
            sources back together and being honest about the ones that don&apos;t line up. Every batch above is
            freshly generated, synthetic test data built to include the same messiness real settlement files
            have — not real transactions.
          </p>
        </section>

        {data && (
          <>
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

            {(exampleMatched || exampleException) && (
              <section>
                <h2 className="mb-3 text-sm font-semibold">How the matching actually works</h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  {exampleMatched && <WorkedExample row={exampleMatched} />}
                  {exampleException && <WorkedExample row={exampleException} />}
                </div>
              </section>
            )}

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
                rows={resultsTab === "exceptions" ? exceptions : matched.slice(0, MATCHED_DISPLAY_CAP)}
                emptyMessage={
                  resultsTab === "exceptions" ? "No exceptions in this batch." : "No matches in this batch."
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
      <span className="max-w-[8rem] text-[10px] font-normal normal-case leading-tight text-[var(--text-muted)]">
        {hint}
      </span>
    </label>
  );
}
