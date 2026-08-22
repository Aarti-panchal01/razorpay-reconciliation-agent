import { describe, expect, it } from "vitest";
import { computeTaxBreakdown, settlementLagDays } from "@/engine/tax";

describe("computeTaxBreakdown", () => {
  it("charges zero MDR on bank-account UPI (RBI/NPCI nil-MDR mandate)", () => {
    const result = computeTaxBreakdown(100_000, "upi_bank", "legacy_194O");
    expect(result.mdrAmount).toBe(0);
    expect(result.gstOnMdr).toBe(0); // no MDR means nothing to charge GST on
  });

  it("charges MDR + GST on MDR for wallet-on-UPI, which is not covered by the nil-MDR mandate", () => {
    const result = computeTaxBreakdown(100_000, "upi_wallet", "legacy_194O");
    expect(result.mdrAmount).toBeGreaterThan(0);
    expect(result.gstOnMdr).toBe(Math.round(result.mdrAmount * 0.18));
  });

  it("applies the same TDS rate under both the legacy and new regime — only the statute differs", () => {
    const legacy = computeTaxBreakdown(500_000, "card", "legacy_194O");
    const modern = computeTaxBreakdown(500_000, "card", "new_393_1035");
    expect(legacy.tdsAmount).toBe(modern.tdsAmount);
    expect(legacy.netAmount).toBe(modern.netAmount);
  });

  it("never lets the deduction stack exceed the gross amount for realistic transaction sizes", () => {
    const result = computeTaxBreakdown(20_000, "upi_rupay_credit", "new_393_1035");
    expect(result.netAmount).toBeGreaterThan(0);
    expect(result.netAmount).toBeLessThan(20_000);
  });
});

describe("settlementLagDays", () => {
  it("settles UPI rails at T+1", () => {
    expect(settlementLagDays("upi_bank")).toBe(1);
    expect(settlementLagDays("upi_wallet")).toBe(1);
    expect(settlementLagDays("upi_rupay_credit")).toBe(1);
  });

  it("settles cards at T+2", () => {
    expect(settlementLagDays("card")).toBe(2);
  });
});
