export type PeriodPreset = "all" | "week" | "month" | "year" | "custom";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Local calendar date YYYY-MM-DD */
export function toLocalYmd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function getDateRangeForPreset(
  preset: PeriodPreset,
  customFrom?: Date | null,
  customTo?: Date | null,
): { from: string; to: string } | null {
  const now = new Date();
  if (preset === "all") return null;

  if (preset === "custom") {
    if (!customFrom || !customTo) return null;
    const a = toLocalYmd(customFrom);
    const b = toLocalYmd(customTo);
    return a <= b ? { from: a, to: b } : { from: b, to: a };
  }

  const end = toLocalYmd(now);

  if (preset === "week") {
    const start = new Date(now);
    start.setDate(start.getDate() - 6);
    return { from: toLocalYmd(start), to: end };
  }

  if (preset === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: toLocalYmd(start), to: end };
  }

  if (preset === "year") {
    const start = new Date(now.getFullYear(), 0, 1);
    return { from: toLocalYmd(start), to: end };
  }

  return null;
}

export function formatRangeLabel(
  preset: PeriodPreset,
  range: { from: string; to: string } | null,
): string {
  if (preset === "all" || !range) return "All time";
  try {
    const a = new Date(range.from + "T12:00:00");
    const b = new Date(range.to + "T12:00:00");
    const fmt = (d: Date) =>
      d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
    return `${fmt(a)} – ${fmt(b)}`;
  } catch {
    return `${range.from} – ${range.to}`;
  }
}
