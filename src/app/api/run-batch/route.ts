import { NextRequest, NextResponse } from "next/server";
import { generateFixture } from "@/data/generator";
import { matchBatch } from "@/engine/match";
import { resolveBatchAmbiguities } from "@/engine/resolve-batch";
import { persistRun } from "@/lib/persist-run";

export async function POST(request: NextRequest) {
  let body: { seed?: number; orderCount?: number; useResolver?: boolean } = {};
  try {
    body = await request.json();
  } catch {
    // No body is fine — defaults apply. A malformed body is not a reason to 500.
  }

  const seed = body.seed ?? 42;
  const orderCount = Math.min(Math.max(body.orderCount ?? 300, 10), 2000);
  const useResolver = body.useResolver ?? true;

  const fixture = generateFixture({ seed, orderCount });
  const batch = {
    settlements: fixture.settlements,
    bankEntries: fixture.bankEntries,
    ledgerEntries: fixture.ledgerEntries,
  };

  const naiveReport = matchBatch(batch, { naiveTdsHandling: true });
  let realReport = matchBatch(batch);

  if (useResolver) {
    realReport = await resolveBatchAmbiguities(realReport, fixture.settlements);
  }

  // No-ops if Supabase isn't configured — see persist-run.ts. Awaited so a
  // freshly-run batch shows up immediately in the history list, but it can
  // never fail the response the dashboard is waiting on.
  await persistRun({
    seed,
    orderCount,
    usedResolver: useResolver,
    naiveReport,
    currentReport: realReport,
  });

  return NextResponse.json({
    seed,
    orderCount,
    // A sample of the actual three input sources being reconciled — this is
    // "what are we matching" made concrete, not just an aggregate number.
    // Capped at 5 rows each; the point is to show shape and mismatch, not
    // to ship the whole batch back over the wire twice.
    sample: {
      settlements: fixture.settlements.slice(0, 5),
      bankEntries: fixture.bankEntries.slice(0, 5),
      ledgerEntries: fixture.ledgerEntries.slice(0, 5),
    },
    naive: summarize(naiveReport),
    current: summarize(realReport, true),
  });
}

// Trim the per-record `candidates` payload from the API response — it's an
// internal detail for the resolver pass, not something the dashboard needs
// to render, and it roughly doubles the response size for no benefit.
function summarize(report: ReturnType<typeof matchBatch>, includeResults = false) {
  const { results, ...rest } = report;
  return {
    ...rest,
    results: includeResults
      ? results.map((r) => ({
          paymentId: r.paymentId,
          orderId: r.orderId,
          status: r.status,
          matchedUtr: r.matchedUtr,
          expectedNet: r.expectedNet,
          actualCredited: r.actualCredited,
          deltaPaise: r.deltaPaise,
          tdsRegime: r.tdsRegime,
          reasonCode: r.reasonCode,
          reasonText: r.reasonText,
        }))
      : undefined,
  };
}
