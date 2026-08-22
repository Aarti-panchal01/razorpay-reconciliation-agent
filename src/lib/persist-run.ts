import { getSupabaseServerClient } from "./supabase-server";
import type { ReconciliationReport } from "@/domain/types";

export interface PersistRunInput {
  seed: number;
  orderCount: number;
  usedResolver: boolean;
  naiveReport: ReconciliationReport;
  currentReport: ReconciliationReport;
}

/**
 * Persists a batch run and its current-engine match results. Silently
 * no-ops if Supabase isn't configured — persistence is a nice-to-have on
 * top of a fully-working engine, not a dependency of it, so a missing
 * env var here must never break the actual reconciliation response the
 * dashboard is waiting on.
 */
export async function persistRun(input: PersistRunInput): Promise<void> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return;

  try {
    const { results: currentResults, ...currentSummary } = input.currentReport;
    const { results: _naiveResults, ...naiveSummary } = input.naiveReport;

    const { data: run, error: runError } = await supabase
      .from("batch_runs")
      .insert({
        seed: input.seed,
        order_count: input.orderCount,
        used_resolver: input.usedResolver,
        naive_summary: naiveSummary,
        current_summary: currentSummary,
      })
      .select("id")
      .single();

    if (runError || !run) {
      console.error("persistRun: failed to insert batch_runs row", runError);
      return;
    }

    if (currentResults.length > 0) {
      const rows = currentResults.map((r) => ({
        batch_run_id: run.id,
        payment_id: r.paymentId,
        order_id: r.orderId,
        status: r.status,
        expected_net: r.expectedNet,
        actual_credited: r.actualCredited ?? null,
        delta_paise: r.deltaPaise ?? null,
        tds_regime: r.tdsRegime,
        reason_code: r.reasonCode ?? null,
        reason_text: r.reasonText ?? null,
      }));

      const { error: resultsError } = await supabase.from("match_results").insert(rows);
      if (resultsError) {
        console.error("persistRun: failed to insert match_results rows", resultsError);
      }
    }
  } catch (error) {
    // Fails closed, same principle as the LLM resolver: a persistence
    // failure degrades to "this run wasn't saved", never to a 500 on the
    // response the user is actually waiting on.
    console.error("persistRun: unexpected error", error);
  }
}

export interface RunHistoryEntry {
  id: string;
  createdAt: string;
  seed: number;
  orderCount: number;
  usedResolver: boolean;
  matchRatePct: number;
  exceptionCount: number;
}

/** Lists recent batch runs, most recent first. Returns [] if Supabase isn't configured. */
export async function listRecentRuns(limit = 20): Promise<RunHistoryEntry[]> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("batch_runs")
    .select("id, created_at, seed, order_count, used_resolver, current_summary")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data) {
    console.error("listRecentRuns: failed to query batch_runs", error);
    return [];
  }

  return data.map((row) => {
    const summary = row.current_summary as { matchRatePct?: number; exceptionCount?: number };
    return {
      id: row.id,
      createdAt: row.created_at,
      seed: row.seed,
      orderCount: row.order_count,
      usedResolver: row.used_resolver,
      matchRatePct: summary.matchRatePct ?? 0,
      exceptionCount: summary.exceptionCount ?? 0,
    };
  });
}
