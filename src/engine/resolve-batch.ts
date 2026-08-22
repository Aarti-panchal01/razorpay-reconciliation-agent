import type { ReconciliationReport, SettlementRecord } from "@/domain/types";
import { resolveAmbiguousCase } from "@/resolver/ambiguous-resolver";

/**
 * Second pass over a ReconciliationReport: sends only the results the
 * deterministic engine explicitly could not close (reasonCode
 * "ambiguous_narration") to the LLM resolver, and folds its verdicts back
 * in. Every other result — matched, amount_mismatch, duplicate_utr, orphan,
 * unmatched — is untouched, because those are decisions the deterministic
 * core already made correctly and confidently; sending them through an LLM
 * would only add cost and a new source of error to a number that was
 * already right.
 *
 * Takes the original settlements so the resolver prompt sees the real
 * method/date/amount context, not a fabricated stand-in — a resolver that
 * reasons over made-up data is worse than one that just escalates.
 */
export async function resolveBatchAmbiguities(
  report: ReconciliationReport,
  settlements: SettlementRecord[]
): Promise<ReconciliationReport> {
  const settlementByPaymentId = new Map(settlements.map((s) => [s.paymentId, s]));

  const ambiguous = report.results.filter(
    (r) => r.status === "exception" && r.reasonCode === "ambiguous_narration" && r.candidates?.length
  );

  if (ambiguous.length === 0) return report;

  const verdicts = await Promise.all(
    ambiguous.map((r) => {
      const settlement = settlementByPaymentId.get(r.paymentId);
      if (!settlement) {
        // Shouldn't happen — every result traces back to a real settlement —
        // but if it ever does, escalate rather than fabricate one.
        return Promise.resolve({
          paymentId: r.paymentId,
          verdict: "escalate" as const,
          explanation: "Resolver could not locate the source settlement record — escalated to human review.",
        });
      }
      return resolveAmbiguousCase(
        settlement,
        r.candidates!.map((bankEntry) => ({ bankEntry }))
      );
    })
  );

  const resultsByPaymentId = new Map(report.results.map((r) => [r.paymentId, r]));
  let resolvedCount = 0;

  for (const verdict of verdicts) {
    const result = resultsByPaymentId.get(verdict.paymentId);
    if (!result) continue;

    if (verdict.verdict === "confirm_match" && verdict.matchedUtr) {
      result.status = "matched_by_resolver";
      result.matchedUtr = verdict.matchedUtr;
      result.reasonText = verdict.explanation;
      resolvedCount++;
    } else {
      // Stays an exception — the resolver's job here is to make the escalation
      // legible, not to force a resolution it isn't confident about.
      result.reasonText = `${result.reasonText ?? ""} Resolver: ${verdict.explanation}`.trim();
    }
  }

  const matchedCount = report.results.filter((r) => r.status === "matched").length;
  const matchedByResolverCount = report.results.filter((r) => r.status === "matched_by_resolver").length;
  const exceptionCount = report.results.filter((r) => r.status === "exception").length;

  return {
    ...report,
    matchedCount,
    matchedByResolverCount,
    exceptionCount,
    matchRatePct:
      report.totalRecords > 0
        ? ((matchedCount + matchedByResolverCount) / report.totalRecords) * 100
        : 0,
    exceptionsByCategory: {
      ...report.exceptionsByCategory,
      ambiguous_narration: report.exceptionsByCategory.ambiguous_narration - resolvedCount,
    },
  };
}
