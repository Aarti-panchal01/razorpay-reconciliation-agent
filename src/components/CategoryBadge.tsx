import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  HelpCircle,
  ShieldAlert,
  Sparkles,
  Unlink,
  type LucideIcon,
} from "lucide-react";

export type BadgeKey =
  | "matched"
  | "matched_by_resolver"
  | "unmatched_bank_credit"
  | "unmatched_ledger"
  | "amount_mismatch"
  | "duplicate_utr"
  | "ambiguous_narration"
  | "orphan_settlement"
  | "unrecognized_tds_regime";

type Status = "good" | "warning" | "serious" | "critical";

const CONFIG: Record<BadgeKey, { label: string; status: Status; icon: LucideIcon }> = {
  matched: { label: "Matched", status: "good", icon: CheckCircle2 },
  matched_by_resolver: { label: "Matched (resolver)", status: "good", icon: Sparkles },
  ambiguous_narration: { label: "Ambiguous narration", status: "warning", icon: HelpCircle },
  unmatched_ledger: { label: "No settlement", status: "warning", icon: Clock },
  unmatched_bank_credit: { label: "Bank credit missing", status: "serious", icon: AlertTriangle },
  orphan_settlement: { label: "Orphan settlement", status: "serious", icon: Unlink },
  amount_mismatch: { label: "Amount mismatch", status: "critical", icon: AlertCircle },
  duplicate_utr: { label: "Duplicate UTR", status: "critical", icon: Copy },
  unrecognized_tds_regime: { label: "Unrecognized TDS regime", status: "critical", icon: ShieldAlert },
};

// No `dark:` variants — this app is dark-only now (see globals.css). The
// previous version's warning/serious colors had a light-mode text color as
// the unconditional default and a `dark:` override for the dark value;
// with the light/dark toggle removed entirely, that default would render
// as near-invisible dark-brown-on-black for anyone whose OS reports a
// light color-scheme preference, since Tailwind's `dark:` variant still
// checks that even with no in-app toggle left to drive it.
const STATUS_CLASSES: Record<Status, string> = {
  good: "text-[var(--status-good-text)] bg-[color-mix(in_oklab,var(--status-good)_14%,transparent)] ring-1 ring-inset ring-[color-mix(in_oklab,var(--status-good)_35%,transparent)]",
  warning:
    "text-[var(--status-warning)] bg-[color-mix(in_oklab,var(--status-warning)_18%,transparent)] ring-1 ring-inset ring-[color-mix(in_oklab,var(--status-warning)_45%,transparent)]",
  serious:
    "text-[var(--status-serious)] bg-[color-mix(in_oklab,var(--status-serious)_16%,transparent)] ring-1 ring-inset ring-[color-mix(in_oklab,var(--status-serious)_40%,transparent)]",
  critical:
    "text-[var(--status-critical)] bg-[color-mix(in_oklab,var(--status-critical)_14%,transparent)] ring-1 ring-inset ring-[color-mix(in_oklab,var(--status-critical)_40%,transparent)]",
};

export function CategoryBadge({ category }: { category: BadgeKey }) {
  const cfg = CONFIG[category];
  const Icon = cfg.icon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap ${STATUS_CLASSES[cfg.status]}`}
    >
      <Icon size={13} strokeWidth={2.25} aria-hidden />
      {cfg.label}
    </span>
  );
}

export function categoryLabel(category: BadgeKey): string {
  return CONFIG[category].label;
}
