import { describe, expect, it } from "vitest";
import { matchBatch } from "@/engine/match";
import type {
  BankStatementEntry,
  LedgerEntry,
  ReconciliationBatch,
  SettlementRecord,
} from "@/domain/types";

function settlement(overrides: Partial<SettlementRecord> = {}): SettlementRecord {
  return {
    paymentId: "pay_TEST0000000001",
    orderId: "ORD-100000",
    method: "upi_bank",
    transactionDate: "2026-08-01",
    grossAmount: 100_000,
    mdrAmount: 0,
    gstOnMdr: 0,
    tcsSection52: 100,
    tdsRegime: "legacy_194O",
    tdsAmount: 100,
    netAmount: 99_800,
    settlementUtr: "UTR0000000001",
    settlementDate: "2026-08-02",
    ...overrides,
  };
}

function ledger(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    orderId: "ORD-100000",
    orderAmount: 100_000,
    customerRef: "CUST-TEST01",
    method: "upi_bank",
    orderDate: "2026-08-01",
    ...overrides,
  };
}

function bank(overrides: Partial<BankStatementEntry> = {}): BankStatementEntry {
  return {
    utr: "UTR0000000001",
    creditAmount: 99_800,
    creditDate: "2026-08-02",
    narration: "UPI/RAZORPAY/100000/PAYMENT",
    ...overrides,
  };
}

function batch(overrides: Partial<ReconciliationBatch> = {}): ReconciliationBatch {
  return {
    settlements: [settlement()],
    bankEntries: [bank()],
    ledgerEntries: [ledger()],
    ...overrides,
  };
}

describe("matchBatch — the cases the honest exception list depends on", () => {
  it("matches a clean settlement exactly by UTR and amount", () => {
    const report = matchBatch(batch());
    expect(report.matchedCount).toBe(1);
    expect(report.exceptionCount).toBe(0);
    expect(report.results[0].status).toBe("matched");
  });

  it("flags an amount mismatch instead of silently accepting a close-enough credit", () => {
    const report = matchBatch(
      batch({ bankEntries: [bank({ creditAmount: 98_000 })] })
    );
    expect(report.exceptionsByCategory.amount_mismatch).toBe(1);
    expect(report.results[0].deltaPaise).toBe(98_000 - 99_800);
  });

  it("flags a duplicate UTR rather than guessing which posting is correct", () => {
    const report = matchBatch(
      batch({ bankEntries: [bank(), bank({ creditAmount: 50 })] })
    );
    expect(report.exceptionsByCategory.duplicate_utr).toBe(1);
    expect(report.matchedCount).toBe(0);
  });

  it("falls back to amount+date candidate search when the UTR is masked, and flags it as ambiguous rather than auto-matching", () => {
    const report = matchBatch(
      batch({
        bankEntries: [
          bank({ utr: "UTR0000000000", narration: "NEFT CR-MISC SETTLEMENT BATCH" }),
        ],
      })
    );
    expect(report.exceptionsByCategory.ambiguous_narration).toBe(1);
    expect(report.results[0].status).toBe("exception");
  });

  it("reports genuinely missing money as unmatched_bank_credit, not ambiguous", () => {
    const report = matchBatch(batch({ bankEntries: [] }));
    expect(report.exceptionsByCategory.unmatched_bank_credit).toBe(1);
  });

  it("flags a settlement referencing a nonexistent order as orphan_settlement", () => {
    const report = matchBatch(
      batch({ ledgerEntries: [ledger({ orderId: "ORD-999999" })] })
    );
    expect(report.exceptionsByCategory.orphan_settlement).toBe(1);
  });

  it("reports a ledger order with no settlement as unmatched_ledger, not silently dropped", () => {
    const report = matchBatch(
      batch({
        ledgerEntries: [ledger(), ledger({ orderId: "ORD-200000" })],
      })
    );
    expect(report.exceptionsByCategory.unmatched_ledger).toBe(1);
  });

  it("never double-counts one bank credit across two settlements", () => {
    // Both settlements keep their own distinct real UTR (neither of which
    // has a bank entry) — the single bank credit is masked, so it can only
    // ever be found via the amount+date fallback, never an exact-key hit.
    const report = matchBatch(
      batch({
        settlements: [
          settlement({ settlementUtr: "UTR0000000001" }),
          settlement({ paymentId: "pay_TEST0000000002", orderId: "ORD-100001", settlementUtr: "UTR0000000002" }),
        ],
        ledgerEntries: [ledger(), ledger({ orderId: "ORD-100001" })],
        bankEntries: [bank({ utr: "UTR0000000000", narration: "NEFT CR-MISC SETTLEMENT BATCH" })],
      })
    );
    // Exactly one settlement can claim the single ambiguous candidate; the
    // other must fall through to genuinely unmatched, not a phantom second match.
    const ambiguous = report.results.filter((r) => r.reasonCode === "ambiguous_narration");
    const missing = report.results.filter((r) => r.reasonCode === "unmatched_bank_credit");
    expect(ambiguous.length).toBe(1);
    expect(missing.length).toBe(1);
  });

  it("the real matcher accepts the new Section 393(1)/code 1035 TDS regime as valid", () => {
    const report = matchBatch(batch({ settlements: [settlement({ tdsRegime: "new_393_1035" })] }));
    expect(report.matchedCount).toBe(1);
    expect(report.exceptionsByCategory.unrecognized_tds_regime).toBe(0);
  });

  it("the naive baseline incorrectly flags the new TDS regime as an anomaly — this is the comparison the pitch relies on", () => {
    const report = matchBatch(
      batch({ settlements: [settlement({ tdsRegime: "new_393_1035" })] }),
      { naiveTdsHandling: true }
    );
    expect(report.exceptionsByCategory.unrecognized_tds_regime).toBe(1);
    expect(report.matchedCount).toBe(0);
  });
});
