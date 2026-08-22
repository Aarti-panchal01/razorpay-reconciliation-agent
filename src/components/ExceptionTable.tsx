import { CategoryBadge, type BadgeKey } from "./CategoryBadge";

export interface ExceptionRow {
  paymentId: string;
  orderId: string;
  expectedNet: number;
  reasonCode?: string;
  reasonText?: string;
}

function money(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function ExceptionTable({ rows }: { rows: ExceptionRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="glass-panel rounded-2xl p-8 text-center text-sm text-[var(--text-muted)]">
        No exceptions in this batch — run one to see the honest exception list.
      </div>
    );
  }

  return (
    <div className="glass-panel overflow-x-auto rounded-2xl">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left border-b border-[var(--border)] text-xs text-[var(--text-muted)] uppercase tracking-wide">
            <th className="py-2.5 px-4 font-medium">Order</th>
            <th className="py-2.5 px-4 font-medium">Category</th>
            <th className="py-2.5 px-4 font-medium text-right">Expected</th>
            <th className="py-2.5 px-4 font-medium">Explanation</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={`${r.paymentId}-${r.orderId}-${i}`}
              className="border-b border-[var(--border)] last:border-0 align-top hover:bg-[color-mix(in_oklab,var(--foreground)_3%,transparent)]"
            >
              <td className="py-2.5 px-4 font-mono text-xs text-[var(--text-secondary)] whitespace-nowrap">
                {r.orderId}
              </td>
              <td className="py-2.5 px-4">
                {r.reasonCode ? <CategoryBadge category={r.reasonCode as BadgeKey} /> : null}
              </td>
              <td className="py-2.5 px-4 text-right font-tabular whitespace-nowrap">{money(r.expectedNet)}</td>
              <td className="py-2.5 px-4 text-[var(--text-secondary)]">{r.reasonText}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
