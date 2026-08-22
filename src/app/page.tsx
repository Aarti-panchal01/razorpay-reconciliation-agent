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
  status: string;
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

interface RunBatchResponse {
  seed: number;
  orderCount: number;
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

  // Not just `loadHistory()` directly — that flags "avoid calling setState
  // synchronously within an effect" because the linter can't see into a
  // separately-defined function. The `ignore` flag also does something
  // loadHistory() alone wouldn't: it skips the setState if this effect's
  // cleanup already ran (component unmounted) before the fetch resolves.
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

  const exceptions: MatchResultRow[] =
    data?.current.results?.filter((r) => r.status === "exception") ?? [];

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

        <section className="glass-panel rounded-2xl p-5">
          <div className="flex flex-wrap items-end gap-5">
            <Field label="Seed">
              <input
                type="number"
                value={seed}
                onChange={(e) => setSeed(Number(e.target.value))}
                className="w-24 rounded-md border border-[var(--border)] bg-transparent px-2.5 py-1.5 text-sm font-tabular outline-none focus:border-[var(--series-current)] focus:ring-2 focus:ring-[var(--series-current)]/20"
              />
            </Field>
            <Field label="Order count">
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
              {loading ? "Running…" : "Run batch"}
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
              No batch run yet — set a seed and order count, then run one.
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

            <section className="grid grid-cols-2 gap-4 sm:grid-cols-5">
              <StatTile label="Match rate" value={`${data.current.matchRatePct.toFixed(1)}%`} icon={Gauge} />
              <StatTile label="Matched" value={String(data.current.matchedCount)} icon={CheckCircle2} />
              <StatTile
                label="Matched by resolver"
                value={String(data.current.matchedByResolverCount)}
                icon={Sparkles}
              />
              <StatTile
                label="Exceptions"
                value={String(data.current.exceptionCount)}
                icon={TriangleAlert}
                emphasis={data.current.exceptionCount > 0 ? "critical" : "default"}
              />
              <StatTile
                label="Throughput"
                value={`${data.current.throughputMsPerRecord.toFixed(3)} ms`}
                icon={Zap}
                hint="per record"
              />
            </section>

            <section className="glass-panel rounded-2xl p-5">
              <div className="mb-1 flex items-baseline justify-between">
                <h2 className="text-sm font-semibold">Naive baseline vs. current engine</h2>
                <span className="text-xs text-[var(--text-muted)]">
                  seed {data.seed} · {data.orderCount} orders
                </span>
              </div>
              <p className="mb-3 text-xs text-[var(--text-secondary)]">
                Same batch, run through both. The naive reconciler only recognizes legacy Section 194O.
              </p>
              <ComparisonChart data={comparisonData} />
            </section>

            <section>
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="text-sm font-semibold">
                  Honest exception list
                  <span className="ml-2 font-normal text-[var(--text-muted)]">
                    {exceptions.length} record{exceptions.length === 1 ? "" : "s"}, full list — nothing cherry-picked
                  </span>
                </h2>
              </div>
              <ExceptionTable rows={exceptions} />
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-[var(--text-muted)]">
      {label}
      {children}
    </label>
  );
}
