import { CheckCircle2, XCircle } from "lucide-react";
import { CategoryBadge, type BadgeKey } from "./CategoryBadge";

export interface WorkedExampleRow {
  paymentId: string;
  orderId: string;
  status: string;
  expectedNet: number;
  actualCredited?: number;
  matchedUtr?: string;
  reasonCode?: string;
  reasonText?: string;
}

function money(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
}

/**
 * One concrete record, shown as a worked example rather than a table row —
 * the point of this component is to be read BEFORE the aggregate stats, so
 * "43.1% match rate" means something by the time someone sees the number.
 */
export function WorkedExample({ row }: { row: WorkedExampleRow }) {
  const isMatched = row.status === "matched" || row.status === "matched_by_resolver";

  return (
    <div className="glass-panel rounded-2xl p-5">
      <div className="mb-3 flex items-center gap-2">
        {isMatched ? (
          <CheckCircle2 size={18} className="text-[var(--status-good-text)]" />
        ) : (
          <XCircle size={18} className="text-[var(--status-critical)]" />
        )}
        <span className="text-sm font-semibold">
          {isMatched ? "A settlement that reconciled cleanly" : "A settlement that didn't — and why"}
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-[var(--text-muted)]">Order</dt>
        <dd className="font-mono text-xs">{row.orderId}</dd>

        <dt className="text-[var(--text-muted)]">Razorpay says settled</dt>
        <dd className="font-tabular">{money(row.expectedNet)}</dd>

        <dt className="text-[var(--text-muted)]">Bank actually credited</dt>
        <dd className="font-tabular">{row.actualCredited !== undefined ? money(row.actualCredited) : "nothing found"}</dd>

        {row.matchedUtr && (
          <>
            <dt className="text-[var(--text-muted)]">Matched by</dt>
            <dd className="font-mono text-xs">UTR {row.matchedUtr}</dd>
          </>
        )}
      </dl>

      <div className="mt-3 flex items-start gap-2 border-t border-[var(--border)] pt-3">
        <CategoryBadge category={(row.reasonCode ?? row.status) as BadgeKey} />
        <p className="text-xs text-[var(--text-secondary)]">
          {row.reasonText ?? "Exact UTR match, amount agrees — nothing more to decide."}
        </p>
      </div>
    </div>
  );
}
