// Domain model for the reconciliation engine.
//
// Grounded in publicly documented Indian payment-settlement mechanics:
// - UPI bank-account (P2M) transactions carry zero MDR under the RBI/NPCI
//   zero-MDR mandate; wallet-on-UPI and RuPay-credit-on-UPI are NOT covered
//   by that mandate and carry interchange-bearing MDR.
// - GST is charged on MDR (18%) wherever MDR is non-zero.
// - GST TCS under Section 52 of the CGST Act applies to e-commerce-operator
//   facilitated supplies, separate from income-tax TDS.
// - Income-tax TDS on e-commerce transactions is mid-transition for the
//   Apr-2026 to Mar-2027 window: legacy Section 194O credits are still
//   closing out in Form 26AS while new transactions carry the Income Tax
//   Act 2025's renumbered Section 393(1), reporting code 1035. Both are
//   valid in the same batch during this window.
// - UPI typically settles T+1, cards typically settle T+2.
//
// This is a simplified, illustrative model built for a reconciliation
// exercise, not a certified tax computation — the point being demonstrated
// is that the matching engine must recognize both TDS regimes as legitimate
// rather than treating the newer one as an anomaly.

export type PaymentMethod =
  | "upi_bank"
  | "upi_wallet"
  | "upi_rupay_credit"
  | "card"
  | "netbanking";

export type TdsRegime = "legacy_194O" | "new_393_1035";

export interface SettlementRecord {
  paymentId: string;
  orderId: string;
  method: PaymentMethod;
  transactionDate: string; // ISO date
  grossAmount: number; // paise
  mdrAmount: number; // paise
  gstOnMdr: number; // paise
  tcsSection52: number; // paise, GST TCS
  tdsRegime: TdsRegime;
  tdsAmount: number; // paise, income-tax TDS
  netAmount: number; // paise — what should land in the bank
  settlementUtr: string;
  settlementDate: string; // ISO date, transactionDate + settlement lag
}

export interface BankStatementEntry {
  utr: string;
  creditAmount: number; // paise
  creditDate: string; // ISO date
  narration: string; // deliberately messy, real-bank-statement-shaped
}

export interface LedgerEntry {
  orderId: string;
  orderAmount: number; // paise, gross amount the merchant's own system expects
  customerRef: string;
  method: PaymentMethod;
  orderDate: string;
}

export type ExceptionCategory =
  | "unmatched_bank_credit" // settlement has no bank entry in window
  | "unmatched_ledger" // ledger order has no settlement at all
  | "amount_mismatch" // matched by UTR, amount off by more than rounding tolerance
  | "duplicate_utr" // two settlement records claim the same UTR
  | "ambiguous_narration" // needs the LLM resolver, deterministic pass gave up
  | "orphan_settlement" // settlement exists with no corresponding ledger order
  | "unmatched_ledger" // ledger order never produced a settlement at all
  | "unrecognized_tds_regime"; // naive-baseline-only: flags the new 393(1)/1035 code as an anomaly

export interface MatchResult {
  paymentId: string;
  orderId: string;
  status: "matched" | "matched_by_resolver" | "exception";
  matchedUtr?: string;
  expectedNet: number;
  actualCredited?: number;
  deltaPaise?: number;
  tdsRegime: TdsRegime;
  reasonCode?: ExceptionCategory;
  reasonText?: string; // human-readable, filled by resolver or rule engine
  candidates?: BankStatementEntry[]; // populated only for ambiguous_narration, for the resolver pass
}

export interface ReconciliationBatch {
  settlements: SettlementRecord[];
  bankEntries: BankStatementEntry[];
  ledgerEntries: LedgerEntry[];
}

export interface ReconciliationReport {
  totalRecords: number;
  matchedCount: number;
  matchedByResolverCount: number;
  exceptionCount: number;
  matchRatePct: number;
  throughputMsPerRecord: number;
  exceptionsByCategory: Record<ExceptionCategory, number>;
  results: MatchResult[];
}
