"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { categoryLabel, type BadgeKey } from "./CategoryBadge";

export interface ComparisonDatum {
  category: BadgeKey;
  naive: number;
  current: number;
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs shadow-sm">
      <p className="font-medium mb-1">{label}</p>
      {payload.map((entry) => (
        <p key={entry.name} className="flex items-center gap-1.5 text-[var(--text-secondary)]">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: entry.color }}
            aria-hidden
          />
          {entry.name}: <span className="font-tabular font-medium text-[var(--foreground)]">{entry.value}</span>
        </p>
      ))}
    </div>
  );
}

export function ComparisonChart({ data }: { data: ComparisonDatum[] }) {
  const chartData = data.map((d) => ({
    label: categoryLabel(d.category),
    Naive: d.naive,
    Current: d.current,
  }));

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 8, left: 0 }} barGap={2}>
          <CartesianGrid vertical={false} stroke="var(--gridline)" strokeDasharray="0" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: "var(--text-muted)" }}
            tickLine={false}
            axisLine={{ stroke: "var(--gridline)" }}
            interval={0}
            angle={-20}
            textAnchor="end"
            height={70}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "var(--text-muted)" }}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "var(--gridline)", opacity: 0.3 }} />
          <Legend
            wrapperStyle={{ fontSize: 12, color: "var(--text-secondary)" }}
            iconType="circle"
            iconSize={8}
          />
          <Bar dataKey="Naive" fill="var(--series-naive)" radius={[4, 4, 0, 0]} maxBarSize={24} />
          <Bar dataKey="Current" fill="var(--series-current)" radius={[4, 4, 0, 0]} maxBarSize={24} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
