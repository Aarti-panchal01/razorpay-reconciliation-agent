import type { PaymentMethod, TdsRegime } from "@/domain/types";

const GST_RATE_ON_MDR = 0.18;
const TCS_SECTION_52_RATE = 0.001; // 0.1% of net taxable value, GST TCS
const TDS_RATE = 0.001; // 0.1%, applies under both 194O (legacy) and 393(1) (new)

// MDR rates by rail. Bank-account UPI is nil-MDR under the RBI/NPCI mandate;
// wallet-on-UPI and RuPay-credit-on-UPI are not covered by that mandate.
const MDR_RATE: Record<PaymentMethod, number> = {
  upi_bank: 0,
  upi_wallet: 0.003,
  upi_rupay_credit: 0.02,
  card: 0.018,
  netbanking: 0.009,
};

export interface TaxBreakdown {
  mdrAmount: number;
  gstOnMdr: number;
  tcsSection52: number;
  tdsAmount: number;
  netAmount: number;
}

/**
 * Unpacks the deduction stack a Razorpay-style settlement file nets out
 * before crediting the merchant: MDR, GST on MDR, GST TCS (Section 52),
 * and income-tax TDS (194O legacy or 393(1)/code 1035 new — same rate,
 * different statute, both valid during the Apr-2026–Mar-2027 transition).
 * All amounts in paise, rounded to the nearest paise at each step the way
 * a real settlement file would.
 */
export function computeTaxBreakdown(
  grossAmount: number,
  method: PaymentMethod,
  _tdsRegime: TdsRegime
): TaxBreakdown {
  const mdrAmount = Math.round(grossAmount * MDR_RATE[method]);
  const gstOnMdr = Math.round(mdrAmount * GST_RATE_ON_MDR);
  const tcsSection52 = Math.round(grossAmount * TCS_SECTION_52_RATE);
  // TDS rate is identical across both regimes; only the reporting statute/
  // code differs. The engine must not treat the new code as a rate anomaly.
  const tdsAmount = Math.round(grossAmount * TDS_RATE);

  const netAmount = grossAmount - mdrAmount - gstOnMdr - tcsSection52 - tdsAmount;

  return { mdrAmount, gstOnMdr, tcsSection52, tdsAmount, netAmount };
}

/** Settlement lag by rail: UPI typically T+1, cards typically T+2. */
export function settlementLagDays(method: PaymentMethod): number {
  return method === "card" ? 2 : 1;
}
