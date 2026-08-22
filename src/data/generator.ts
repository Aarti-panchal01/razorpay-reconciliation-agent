import type {
  BankStatementEntry,
  LedgerEntry,
  PaymentMethod,
  ReconciliationBatch,
  SettlementRecord,
  TdsRegime,
} from "@/domain/types";
import { computeTaxBreakdown, settlementLagDays } from "@/engine/tax";
import { mulberry32, randomAlnum, weightedPick } from "./rng";

/** Reference anchor date so fixtures are stable across runs, not tied to "today". */
const ANCHOR_DATE = new Date("2026-08-01T00:00:00Z");

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const METHOD_WEIGHTS: Record<PaymentMethod, number> = {
  upi_bank: 55,
  upi_wallet: 6,
  upi_rupay_credit: 2,
  card: 30,
  netbanking: 7,
};

// Ground truth label for evaluation — this is what a perfect reconciler
// should conclude about each record. Kept separate from the engine's own
// output so match-rate/accuracy numbers are measured against something the
// engine never sees, not self-reported.
export type GroundTruthLabel =
  | "clean"
  | "messy_narration"
  | "amount_mismatch"
  | "missing_bank_entry"
  | "duplicate_utr"
  | "orphan_settlement"
  | "no_settlement";

export interface LabeledSettlement {
  settlement: SettlementRecord;
  truth: GroundTruthLabel;
}

export interface GeneratedFixture extends ReconciliationBatch {
  groundTruth: Map<string, GroundTruthLabel>; // keyed by paymentId, or `ledger:<orderId>` for no_settlement
}

export interface GenerateOptions {
  seed?: number;
  orderCount?: number;
}

const NARRATION_TEMPLATES = [
  (orderFrag: string) => `UPI/RAZORPAY/${orderFrag}/PAYMENT`,
  (orderFrag: string) => `NEFT-RZPY${orderFrag}-SETTLEMENT`,
  (orderFrag: string) => `IMPS/RZP${orderFrag}/CR`,
];

const MESSY_NARRATIONS = [
  "NEFT CR-MISC SETTLEMENT BATCH",
  "BY TRANSFER-CLEARING",
  "UPI/000000000000/PAYMENT RECEIVED",
  "RTGS CREDIT-REF UNAVAILABLE",
];

export function generateFixture(opts: GenerateOptions = {}): GeneratedFixture {
  const seed = opts.seed ?? 42;
  const orderCount = opts.orderCount ?? 300;
  const rand = mulberry32(seed);

  const ledgerEntries: LedgerEntry[] = [];
  const settlements: SettlementRecord[] = [];
  const bankEntries: BankStatementEntry[] = [];
  const groundTruth = new Map<string, GroundTruthLabel>();

  for (let i = 0; i < orderCount; i++) {
    const orderId = `ORD-${String(100000 + i)}`;
    const method = weightedPick(rand, METHOD_WEIGHTS);
    const orderAmount = Math.round((200 + rand() * 14800) * 100); // paise, Rs.200-15000
    const orderDate = addDays(ANCHOR_DATE, Math.floor(rand() * 30));
    const customerRef = `CUST-${randomAlnum(rand, 6)}`;

    ledgerEntries.push({
      orderId,
      orderAmount,
      customerRef,
      method,
      orderDate: isoDate(orderDate),
    });

    // ~6% of orders never reach settlement (pending/cancelled/failed).
    if (rand() < 0.06) {
      groundTruth.set(`ledger:${orderId}`, "no_settlement");
      continue;
    }

    const tdsRegime: TdsRegime = rand() < 0.5 ? "legacy_194O" : "new_393_1035";
    const breakdown = computeTaxBreakdown(orderAmount, method, tdsRegime);
    const lag = settlementLagDays(method);
    const settlementDate = addDays(orderDate, lag);
    const paymentId = `pay_${randomAlnum(rand, 14)}`;
    const utr = `UTR${randomAlnum(rand, 10)}`;

    const settlement: SettlementRecord = {
      paymentId,
      orderId,
      method,
      transactionDate: isoDate(orderDate),
      grossAmount: orderAmount,
      mdrAmount: breakdown.mdrAmount,
      gstOnMdr: breakdown.gstOnMdr,
      tcsSection52: breakdown.tcsSection52,
      tdsRegime,
      tdsAmount: breakdown.tdsAmount,
      netAmount: breakdown.netAmount,
      settlementUtr: utr,
      settlementDate: isoDate(settlementDate),
    };
    settlements.push(settlement);

    const noise = rand();
    const orderFrag = orderId.replace("ORD-", "");

    if (noise < 0.03) {
      // Missing bank entry entirely — money is genuinely stuck/delayed.
      groundTruth.set(paymentId, "missing_bank_entry");
    } else if (noise < 0.05) {
      // Duplicate UTR: a bank-side clearing glitch double-posts the same UTR
      // as a second, stray entry. Self-contained (doesn't touch any other
      // settlement's UTR) so it never contaminates an unrelated record's
      // ground truth.
      bankEntries.push({
        utr,
        creditAmount: settlement.netAmount,
        creditDate: isoDate(settlementDate),
        narration: pickTemplate(rand)(orderFrag),
      });
      bankEntries.push({
        utr,
        creditAmount: Math.round(rand() * 100) + 1, // stray phantom leg, a few paise
        creditDate: isoDate(settlementDate),
        narration: "NEFT CR-MISC SETTLEMENT BATCH",
      });
      groundTruth.set(paymentId, "duplicate_utr");
    } else if (noise < 0.08) {
      // Amount mismatch — a partial refund or fee miscalculation upstream.
      const delta = Math.round((5 + rand() * 200) * 100) * (rand() < 0.5 ? -1 : 1);
      bankEntries.push({
        utr,
        creditAmount: settlement.netAmount + delta,
        creditDate: isoDate(settlementDate),
        narration: pickTemplate(rand)(orderFrag),
      });
      groundTruth.set(paymentId, "amount_mismatch");
    } else if (noise < 0.13) {
      // Real bank feeds sometimes don't propagate the true UTR cleanly, and
      // the narration doesn't carry a parseable order reference either — the
      // only way back to this settlement is amount+date proximity, which is
      // genuinely ambiguous, not just inconvenient. Masking the UTR here is
      // what makes this case different from a clean match, not the narration
      // text alone.
      bankEntries.push({
        utr: `UTR${"0".repeat(10)}`,
        creditAmount: settlement.netAmount,
        creditDate: isoDate(settlementDate),
        narration: MESSY_NARRATIONS[Math.floor(rand() * MESSY_NARRATIONS.length)],
      });
      groundTruth.set(paymentId, "messy_narration");
    } else {
      bankEntries.push({
        utr,
        creditAmount: settlement.netAmount,
        creditDate: isoDate(settlementDate),
        narration: pickTemplate(rand)(orderFrag),
      });
      groundTruth.set(paymentId, "clean");
    }
  }

  // A small number of orphan settlements: a settlement exists referencing an
  // orderId that was never in the ledger (test transactions, data entry slips).
  const orphanCount = Math.max(1, Math.round(orderCount * 0.02));
  for (let j = 0; j < orphanCount; j++) {
    const orphanOrderId = `ORD-ORPHAN-${j}`;
    const method = weightedPick(rand, METHOD_WEIGHTS);
    const grossAmount = Math.round((200 + rand() * 5000) * 100);
    const tdsRegime: TdsRegime = rand() < 0.5 ? "legacy_194O" : "new_393_1035";
    const breakdown = computeTaxBreakdown(grossAmount, method, tdsRegime);
    const orderDate = addDays(ANCHOR_DATE, Math.floor(rand() * 30));
    const settlementDate = addDays(orderDate, settlementLagDays(method));
    const paymentId = `pay_${randomAlnum(rand, 14)}`;
    const utr = `UTR${randomAlnum(rand, 10)}`;

    settlements.push({
      paymentId,
      orderId: orphanOrderId,
      method,
      transactionDate: isoDate(orderDate),
      grossAmount,
      mdrAmount: breakdown.mdrAmount,
      gstOnMdr: breakdown.gstOnMdr,
      tcsSection52: breakdown.tcsSection52,
      tdsRegime,
      tdsAmount: breakdown.tdsAmount,
      netAmount: breakdown.netAmount,
      settlementUtr: utr,
      settlementDate: isoDate(settlementDate),
    });
    bankEntries.push({
      utr,
      creditAmount: breakdown.netAmount,
      creditDate: isoDate(settlementDate),
      narration: pickTemplate(rand)(orphanOrderId.replace("ORD-", "")),
    });
    groundTruth.set(paymentId, "orphan_settlement");
  }

  return { settlements, bankEntries, ledgerEntries, groundTruth };
}

function pickTemplate(rand: () => number) {
  return NARRATION_TEMPLATES[Math.floor(rand() * NARRATION_TEMPLATES.length)];
}
