import { describe, expect, it } from "vitest";
import { generateFixture } from "@/data/generator";
import { matchBatch } from "@/engine/match";

describe("naive baseline vs current engine — across multiple seeds, not one lucky one", () => {
  const seeds = [1, 7, 42, 99, 2026];

  it.each(seeds)("seed %i: naive misflags new-regime transactions, current never does", (seed) => {
    const fixture = generateFixture({ seed, orderCount: 300 });
    const batch = {
      settlements: fixture.settlements,
      bankEntries: fixture.bankEntries,
      ledgerEntries: fixture.ledgerEntries,
    };

    const naive = matchBatch(batch, { naiveTdsHandling: true });
    const current = matchBatch(batch);

    // Orphan settlements (no matching ledger order) are correctly caught by
    // that check before the TDS-regime check ever runs, in both naive and
    // current modes — an orphan has a more fundamental problem than its TDS
    // code. So the expected count excludes them, not just "all new-regime
    // settlements".
    const ledgerOrderIds = new Set(fixture.ledgerEntries.map((l) => l.orderId));
    const newRegimeCount = fixture.settlements.filter(
      (s) => s.tdsRegime === "new_393_1035" && ledgerOrderIds.has(s.orderId)
    ).length;

    // Every non-orphan new-regime settlement gets misflagged by the naive
    // baseline — not "usually", every single one, since the naive matcher's
    // whole point is that it doesn't know the new code exists.
    expect(naive.exceptionsByCategory.unrecognized_tds_regime).toBe(newRegimeCount);
    expect(current.exceptionsByCategory.unrecognized_tds_regime).toBe(0);
    expect(current.matchRatePct).toBeGreaterThan(naive.matchRatePct);
  });
});
