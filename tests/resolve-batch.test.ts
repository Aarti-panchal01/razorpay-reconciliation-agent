import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { matchBatch } from "@/engine/match";
import { resolveBatchAmbiguities } from "@/engine/resolve-batch";
import type { ReconciliationBatch } from "@/domain/types";

const savedKey = process.env.OPENROUTER_API_KEY;

beforeEach(() => {
  delete process.env.OPENROUTER_API_KEY;
});

afterEach(() => {
  if (savedKey) process.env.OPENROUTER_API_KEY = savedKey;
});

function ambiguousBatch(): ReconciliationBatch {
  return {
    settlements: [
      {
        paymentId: "pay_AMBIG0000001",
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
      },
    ],
    bankEntries: [
      {
        utr: "UTR0000000000",
        creditAmount: 99_800,
        creditDate: "2026-08-02",
        narration: "NEFT CR-MISC SETTLEMENT BATCH",
      },
    ],
    ledgerEntries: [
      {
        orderId: "ORD-100000",
        orderAmount: 100_000,
        customerRef: "CUST-AMBIG01",
        method: "upi_bank",
        orderDate: "2026-08-01",
      },
    ],
  };
}

describe("resolveBatchAmbiguities — fails closed when the resolver is unavailable", () => {
  it("leaves ambiguous cases as exceptions rather than guessing when no API key is configured", async () => {
    const fixture = ambiguousBatch();
    const report = matchBatch(fixture);
    expect(report.exceptionsByCategory.ambiguous_narration).toBe(1);

    const resolved = await resolveBatchAmbiguities(report, fixture.settlements);

    // Fails closed: no key means no confirmed match, ever.
    expect(resolved.matchedByResolverCount).toBe(0);
    expect(resolved.exceptionCount).toBe(1);
    const stillException = resolved.results.find((r) => r.paymentId === "pay_AMBIG0000001");
    expect(stillException?.status).toBe("exception");
    expect(stillException?.reasonText).toContain("Resolver:");
  });

  it("is a no-op when there are no ambiguous cases to resolve", async () => {
    const clean: ReconciliationBatch = {
      settlements: [
        {
          paymentId: "pay_CLEAN0000001",
          orderId: "ORD-200000",
          method: "upi_bank",
          transactionDate: "2026-08-01",
          grossAmount: 100_000,
          mdrAmount: 0,
          gstOnMdr: 0,
          tcsSection52: 100,
          tdsRegime: "legacy_194O",
          tdsAmount: 100,
          netAmount: 99_800,
          settlementUtr: "UTR0000000005",
          settlementDate: "2026-08-02",
        },
      ],
      bankEntries: [
        {
          utr: "UTR0000000005",
          creditAmount: 99_800,
          creditDate: "2026-08-02",
          narration: "UPI/RAZORPAY/200000/PAYMENT",
        },
      ],
      ledgerEntries: [
        {
          orderId: "ORD-200000",
          orderAmount: 100_000,
          customerRef: "CUST-CLEAN01",
          method: "upi_bank",
          orderDate: "2026-08-01",
        },
      ],
    };
    const report = matchBatch(clean);
    const resolved = await resolveBatchAmbiguities(report, clean.settlements);
    expect(resolved).toEqual(report);
  });
});
