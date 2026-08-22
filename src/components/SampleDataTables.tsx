export interface SampleSettlement {
  paymentId: string;
  orderId: string;
  method: string;
  grossAmount: number;
  netAmount: number;
  settlementUtr: string;
  settlementDate: string;
}

export interface SampleBankEntry {
  utr: string;
  creditAmount: number;
  creditDate: string;
  narration: string;
}

export interface SampleLedgerEntry {
  orderId: string;
  orderAmount: number;
  customerRef: string;
}

function money(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
}

function Table({
  title,
  caption,
  headers,
  children,
}: {
  title: string;
  caption: string;
  headers: string[];
  children: React.ReactNode;
}) {
  return (
    // min-w-0 is load-bearing: CSS Grid items default to min-width:auto,
    // which refuses to shrink below the content's intrinsic width — that
    // silently defeats the overflow-x-auto below (it never gets narrow
    // enough to need scrolling, and instead of scrolling, the last column
    // just gets visually clipped by the panel edge). Found by screenshot,
    // not by reading the CSS — this is exactly the kind of bug that looks
    // fine in the type system and build but is only visible by eye.
    <div className="glass-panel min-w-0 rounded-2xl p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mb-3 text-xs text-[var(--text-muted)]">{caption}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="text-left border-b border-[var(--border)] text-[var(--text-muted)] uppercase tracking-wide">
              {headers.map((h) => (
                <th key={h} className="py-1.5 pr-3 font-medium whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="font-tabular">{children}</tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * The three raw inputs being reconciled, shown as-is — this is "what are we
 * matching" made literal. Deliberately not just a KPI summary: seeing that
 * these three sources don't share a single obvious join key (settlements
 * key off paymentId+UTR, the bank statement only has UTR+narration, and the
 * ledger only knows orderId) is the whole reason reconciliation is a real
 * problem instead of one SQL join.
 */
export function SampleDataTables({
  settlements,
  bankEntries,
  ledgerEntries,
}: {
  settlements: SampleSettlement[];
  bankEntries: SampleBankEntry[];
  ledgerEntries: SampleLedgerEntry[];
}) {
  return (
    // Stacked full-width, not a 3-column grid. Three across at this data
    // density (up to 5 columns per table) meant real content — the UTR and
    // narration columns specifically, the two fields the whole point of
    // this section is to show — got clipped by the panel edge with no
    // visible scrollbar to hint there was more. Full width means every
    // column fits without scrolling anything.
    <div className="grid gap-4">
      <Table
        title="Razorpay settlement report"
        caption="What Razorpay says it settled — gross amount before deductions, net amount after MDR/GST/TCS/TDS."
        headers={["Order", "Method", "Gross", "Net", "UTR"]}
      >
        {settlements.map((s) => (
          <tr key={s.paymentId} className="border-b border-[var(--border)] last:border-0">
            <td className="py-1.5 pr-3 font-mono whitespace-nowrap">{s.orderId}</td>
            <td className="py-1.5 pr-3 whitespace-nowrap">{s.method}</td>
            <td className="py-1.5 pr-3 whitespace-nowrap">{money(s.grossAmount)}</td>
            <td className="py-1.5 pr-3 whitespace-nowrap">{money(s.netAmount)}</td>
            <td className="py-1.5 pr-3 font-mono whitespace-nowrap">{s.settlementUtr}</td>
          </tr>
        ))}
      </Table>

      <Table
        title="Bank statement"
        caption="What actually landed in the bank — keyed by UTR, not order ID. Narrations are deliberately messy."
        headers={["UTR", "Credited", "Date", "Narration"]}
      >
        {bankEntries.map((b, i) => (
          <tr key={`${b.utr}-${i}`} className="border-b border-[var(--border)] last:border-0">
            <td className="py-1.5 pr-3 font-mono whitespace-nowrap">{b.utr}</td>
            <td className="py-1.5 pr-3 whitespace-nowrap">{money(b.creditAmount)}</td>
            <td className="py-1.5 pr-3 whitespace-nowrap">{b.creditDate}</td>
            <td className="py-1.5 pr-3 whitespace-nowrap text-[var(--text-secondary)]">{b.narration}</td>
          </tr>
        ))}
      </Table>

      <Table
        title="Merchant's internal ledger"
        caption="What the merchant's own order system expects — keyed by order ID, knows nothing about UTRs or deductions."
        headers={["Order", "Amount", "Customer"]}
      >
        {ledgerEntries.map((l) => (
          <tr key={l.orderId} className="border-b border-[var(--border)] last:border-0">
            <td className="py-1.5 pr-3 font-mono whitespace-nowrap">{l.orderId}</td>
            <td className="py-1.5 pr-3 whitespace-nowrap">{money(l.orderAmount)}</td>
            <td className="py-1.5 pr-3 whitespace-nowrap">{l.customerRef}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
