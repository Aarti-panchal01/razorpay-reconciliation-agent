import type {
  BankStatementEntry,
  ExceptionCategory,
  MatchResult,
  ReconciliationBatch,
  ReconciliationReport,
  SettlementRecord,
} from "@/domain/types";

const AMOUNT_TOLERANCE_PAISE = 0; // exact match required; any delta is a real exception
const DATE_WINDOW_DAYS = 1; // fallback candidate search window either side of settlement date

export interface MatchOptions {
  /**
   * Simulates an older reconciliation system that only recognizes the
   * legacy Section 194O TDS code and treats the new Section 393(1)/code
   * 1035 as an anomaly. Exists purely to produce the baseline-vs-current
   * comparison in the report — never used in the real matcher.
   */
  naiveTdsHandling?: boolean;
}

function daysBetween(a: string, b: string): number {
  const diffMs = new Date(a).getTime() - new Date(b).getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Deterministic reconciliation core. No LLM anywhere in this file —
 * every dollar this reports as matched or exceptioned is reproducible from
 * the same inputs every time, which is the property that actually matters
 * when the output determines whether money is considered accounted for.
 */
export function matchBatch(
  batch: ReconciliationBatch,
  options: MatchOptions = {}
): ReconciliationReport {
  const start = performance.now();
  const { settlements, bankEntries, ledgerEntries } = batch;

  const ledgerByOrderId = new Map(ledgerEntries.map((l) => [l.orderId, l]));

  // Exact-UTR lookup index. Multiple entries under the same UTR is itself
  // signal (a duplicate-posting glitch), so this stores arrays, not a
  // single entry.
  const bankByUtr = new Map<string, BankStatementEntry[]>();
  bankEntries.forEach((entry) => {
    const list = bankByUtr.get(entry.utr) ?? [];
    list.push(entry);
    bankByUtr.set(entry.utr, list);
  });

  // Which bank entries a fallback candidate search is allowed to consider —
  // excludes anything already claimed by an exact-UTR match so one bank
  // credit can't be double-counted across two settlements.
  const claimed = new Set<BankStatementEntry>();

  const results: MatchResult[] = [];
  const exceptionsByCategory: Record<ExceptionCategory, number> = {
    unmatched_bank_credit: 0,
    unmatched_ledger: 0,
    amount_mismatch: 0,
    duplicate_utr: 0,
    ambiguous_narration: 0,
    orphan_settlement: 0,
    unrecognized_tds_regime: 0,
  };

  const exceptionResult = (
    s: SettlementRecord,
    category: ExceptionCategory,
    reasonText: string,
    actualCredited?: number,
    candidates?: BankStatementEntry[]
  ): MatchResult => {
    exceptionsByCategory[category]++;
    return {
      paymentId: s.paymentId,
      orderId: s.orderId,
      status: "exception",
      expectedNet: s.netAmount,
      actualCredited,
      deltaPaise: actualCredited !== undefined ? actualCredited - s.netAmount : undefined,
      tdsRegime: s.tdsRegime,
      reasonCode: category,
      reasonText,
      candidates,
    };
  };

  for (const settlement of settlements) {
    if (!ledgerByOrderId.has(settlement.orderId)) {
      results.push(
        exceptionResult(
          settlement,
          "orphan_settlement",
          `Settlement references order ${settlement.orderId}, which does not exist in the ledger.`
        )
      );
      continue;
    }

    if (options.naiveTdsHandling && settlement.tdsRegime === "new_393_1035") {
      results.push(
        exceptionResult(
          settlement,
          "unrecognized_tds_regime",
          "TDS reporting code 1035 (Section 393(1)) is not recognized by this reconciler; expected legacy Section 194O."
        )
      );
      continue;
    }

    const exact = bankByUtr.get(settlement.settlementUtr) ?? [];
    if (exact.length > 1) {
      results.push(
        exceptionResult(
          settlement,
          "duplicate_utr",
          `UTR ${settlement.settlementUtr} appears ${exact.length} times in the bank statement; cannot uniquely attribute the credit.`
        )
      );
      continue;
    }

    if (exact.length === 1) {
      const bankEntry = exact[0];
      claimed.add(bankEntry);
      const delta = bankEntry.creditAmount - settlement.netAmount;
      if (Math.abs(delta) <= AMOUNT_TOLERANCE_PAISE) {
        results.push({
          paymentId: settlement.paymentId,
          orderId: settlement.orderId,
          status: "matched",
          matchedUtr: bankEntry.utr,
          expectedNet: settlement.netAmount,
          actualCredited: bankEntry.creditAmount,
          deltaPaise: 0,
          tdsRegime: settlement.tdsRegime,
        });
      } else {
        results.push(
          exceptionResult(
            settlement,
            "amount_mismatch",
            `Expected ₹${(settlement.netAmount / 100).toFixed(2)}, bank credited ₹${(
              bankEntry.creditAmount / 100
            ).toFixed(2)} (delta ₹${(delta / 100).toFixed(2)}).`,
            bankEntry.creditAmount
          )
        );
      }
      continue;
    }

    // No exact UTR hit. Search for an unclaimed candidate by amount + date
    // proximity before giving up — this is the boundary between "genuinely
    // missing" and "ambiguous, needs the resolver".
    const candidates = bankEntries.filter(
      (entry) =>
        !claimed.has(entry) &&
        entry.creditAmount === settlement.netAmount &&
        Math.abs(daysBetween(entry.creditDate, settlement.settlementDate)) <= DATE_WINDOW_DAYS
    );

    if (candidates.length === 1) {
      const candidate = candidates[0];
      claimed.add(candidate);
      results.push(
        exceptionResult(
          settlement,
          "ambiguous_narration",
          `No UTR match, but one bank credit of the right amount landed on ${candidate.creditDate} with narration "${candidate.narration}" — needs review to confirm attribution.`,
          candidate.creditAmount,
          candidates
        )
      );
    } else if (candidates.length > 1) {
      candidates.forEach((c) => claimed.add(c));
      results.push(
        exceptionResult(
          settlement,
          "ambiguous_narration",
          `No UTR match, and ${candidates.length} bank credits of the right amount landed in the settlement window — cannot disambiguate automatically.`,
          undefined,
          candidates
        )
      );
    } else {
      results.push(
        exceptionResult(
          settlement,
          "unmatched_bank_credit",
          `No bank credit of ₹${(settlement.netAmount / 100).toFixed(
            2
          )} found within ${DATE_WINDOW_DAYS} day(s) of the expected settlement date ${settlement.settlementDate}.`
        )
      );
    }
  }

  // Ledger orders that never produced a settlement at all.
  const settledOrderIds = new Set(settlements.map((s) => s.orderId));
  for (const ledgerEntry of ledgerEntries) {
    if (!settledOrderIds.has(ledgerEntry.orderId)) {
      exceptionsByCategory.unmatched_ledger++;
      results.push({
        paymentId: `(none)`,
        orderId: ledgerEntry.orderId,
        status: "exception",
        expectedNet: ledgerEntry.orderAmount,
        tdsRegime: "legacy_194O", // not applicable, no settlement exists
        reasonCode: "unmatched_ledger",
        reasonText: `Order ${ledgerEntry.orderId} has no corresponding settlement — likely pending, cancelled, or failed upstream.`,
      });
    }
  }

  const matchedCount = results.filter((r) => r.status === "matched").length;
  const matchedByResolverCount = results.filter((r) => r.status === "matched_by_resolver").length;
  const exceptionCount = results.filter((r) => r.status === "exception").length;
  const elapsedMs = performance.now() - start;

  return {
    totalRecords: results.length,
    matchedCount,
    matchedByResolverCount,
    exceptionCount,
    matchRatePct: results.length > 0 ? ((matchedCount + matchedByResolverCount) / results.length) * 100 : 0,
    throughputMsPerRecord: results.length > 0 ? elapsedMs / results.length : 0,
    exceptionsByCategory,
    results,
  };
}
