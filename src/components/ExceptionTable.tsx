import { CategoryBadge, type BadgeKey } from "./CategoryBadge";

export interface ExceptionRow {
  paymentId: string;
  orderId: string;
  status: "matched" | "matched_by_resolver" | "exception";
  expectedNet: number;
  actualCredited?: number;
  matchedUtr?: string;
  reasonCode?: string;
  reasonText?: string;
}

function money(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Renders one batch's worth of per-record outcomes — matched or exception,
 * whichever set the caller hands it. Showing ONLY exceptions (the original
 * shape of this component) makes the good outcomes invisible, which reads
 * as "did anything actually work?" to anyone who hasn't read the code —
 * the caller now decides which slice to show, and page.tsx offers both via
 * a tab rather than picking one for the viewer.
 */
export function ExceptionTable({ rows, emptyMessage }: { rows: ExceptionRow[]; emptyMessage: string }) {
  if (rows.length === 0) {
    return (
      <div className="glass-panel rounded-2xl p-8 text-center text-sm text-[var(--text-muted)]">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="glass-panel overflow-x-auto rounded-2xl">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left border-b border-[var(--border)] text-xs text-[var(--text-muted)] uppercase tracking-wide">
            <th className="py-2.5 px-4 font-medium">Order</th>
            <th className="py-2.5 px-4 font-medium">Outcome</th>
            <th className="py-2.5 px-4 font-medium text-right">Expected</th>
            <th className="py-2.5 px-4 font-medium text-right">Bank credited</th>
            <th className="py-2.5 px-4 font-medium">Why</th>
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
                <CategoryBadge category={(r.reasonCode ?? r.status) as BadgeKey} />
              </td>
              <td className="py-2.5 px-4 text-right font-tabular whitespace-nowrap">{money(r.expectedNet)}</td>
              <td className="py-2.5 px-4 text-right font-tabular whitespace-nowrap text-[var(--text-secondary)]">
                {r.actualCredited !== undefined ? money(r.actualCredited) : "—"}
              </td>
              <td className="py-2.5 px-4 text-[var(--text-secondary)]">
                {r.reasonText ?? (r.matchedUtr ? `UTR ${r.matchedUtr} matched exactly, amount agrees.` : "—")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
