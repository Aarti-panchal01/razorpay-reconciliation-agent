import { NextRequest, NextResponse } from "next/server";
import { generateFixture } from "@/data/generator";
import { matchBatch } from "@/engine/match";
import { resolveBatchAmbiguities } from "@/engine/resolve-batch";

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

  return NextResponse.json({
    seed,
    orderCount,
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
      ? results.map(({ candidates: _candidates, ...r }) => r)
      : undefined,
  };
}
