import { describe, expect, it } from "vitest";
import { generateFixture } from "@/data/generator";
import { matchBatch } from "@/engine/match";
import type { ExceptionCategory } from "@/domain/types";
import type { GroundTruthLabel } from "@/data/generator";

const TRUTH_TO_CATEGORY: Record<Exclude<GroundTruthLabel, "clean">, ExceptionCategory> = {
  messy_narration: "ambiguous_narration",
  amount_mismatch: "amount_mismatch",
  missing_bank_entry: "unmatched_bank_credit",
  duplicate_utr: "duplicate_utr",
  orphan_settlement: "orphan_settlement",
  no_settlement: "unmatched_ledger",
};

describe("generateFixture", () => {
  it("is deterministic for a given seed — reproducibility is the whole point", () => {
    const a = generateFixture({ seed: 7, orderCount: 100 });
    const b = generateFixture({ seed: 7, orderCount: 100 });
    expect(a.settlements).toEqual(b.settlements);
    expect(a.bankEntries).toEqual(b.bankEntries);
    expect(a.ledgerEntries).toEqual(b.ledgerEntries);
  });

  it("produces a different batch for a different seed", () => {
    const a = generateFixture({ seed: 1, orderCount: 50 });
    const b = generateFixture({ seed: 2, orderCount: 50 });
    expect(a.settlements).not.toEqual(b.settlements);
  });
});

describe("matchBatch against generated ground truth", () => {
  it("agrees with the ground truth label on the large majority of a full batch", () => {
    const fixture = generateFixture({ seed: 42, orderCount: 300 });
    const report = matchBatch(fixture);

    let agree = 0;
    let total = 0;

    for (const [key, truth] of fixture.groundTruth) {
      total++;
      const isLedgerOnly = key.startsWith("ledger:");
      const result = isLedgerOnly
        ? report.results.find((r) => r.orderId === key.replace("ledger:", "") && r.reasonCode === "unmatched_ledger")
        : report.results.find((r) => r.paymentId === key);

      if (!result) continue;

      if (truth === "clean") {
        if (result.status === "matched") agree++;
      } else {
        const expectedCategory = TRUTH_TO_CATEGORY[truth];
        if (result.reasonCode === expectedCategory) agree++;
      }
    }

    const accuracy = agree / total;
    // Not 100%: a small number of ambiguous candidates can legitimately
    // collide (see the "never double-counts" case in match.test.ts) and one
    // of the pair falls through to unmatched_bank_credit instead of
    // ambiguous_narration — that's correct behavior, not an engine bug, and
    // this test's threshold accounts for it rather than hiding it.
    expect(accuracy).toBeGreaterThan(0.9);
  });

  it("reports every exception with a reasonText — no silent drops in the audit trail", () => {
    const fixture = generateFixture({ seed: 42, orderCount: 150 });
    const report = matchBatch(fixture);
    const exceptions = report.results.filter((r) => r.status === "exception");
    expect(exceptions.length).toBeGreaterThan(0);
    for (const exception of exceptions) {
      expect(exception.reasonText).toBeTruthy();
      expect(exception.reasonCode).toBeTruthy();
    }
  });
});
