import type { LucideIcon } from "lucide-react";

interface StatTileProps {
  label: string;
  value: string;
  icon: LucideIcon;
  hint?: string;
  emphasis?: "default" | "critical";
}

export function StatTile({ label, value, icon: Icon, hint, emphasis = "default" }: StatTileProps) {
  return (
    <div className="glass-panel flex flex-col gap-2 rounded-2xl p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-[var(--text-muted)]">{label}</span>
        <Icon
          size={16}
          strokeWidth={2}
          className={emphasis === "critical" ? "text-[var(--status-critical)]" : "text-[var(--text-muted)]"}
          aria-hidden
        />
      </div>
      <span
        className={`text-2xl font-semibold ${emphasis === "critical" ? "text-[var(--status-critical)]" : ""}`}
      >
        {value}
      </span>
      {hint && <span className="text-xs text-[var(--text-secondary)]">{hint}</span>}
    </div>
  );
}
