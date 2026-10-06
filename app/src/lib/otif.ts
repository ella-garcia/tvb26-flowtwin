// Delivery history (OTIF) summary and A/B/C performance grade.
// The grade is backward-looking and kept separate from the risk light, which is forward-looking.

export type OtifGrade = "A" | "B" | "C";

/** Contract OTIF target used when the relationship has none. */
export const DEFAULT_OTIF_TARGET = 0.98;
/** B covers up to this many points below target; further below is C. */
export const GRADE_B_BAND = 0.03;

export interface OtifSummary {
  average: number;        // mean over the trend window, 0..1
  latest: number;
  /** Last 4 weeks vs first 4 weeks, in fraction points (same window the risk score uses). */
  change: number;
  target: number;
  grade: OtifGrade;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export function otifGrade(average: number, target = DEFAULT_OTIF_TARGET): OtifGrade {
  if (average >= target) return "A";
  if (average >= target - GRADE_B_BAND) return "B";
  return "C";
}

/** null when there are fewer than 2 weeks of data. */
export function otifSummary(trend: number[], target = DEFAULT_OTIF_TARGET): OtifSummary | null {
  if (trend.length < 2) return null;
  const k = Math.min(4, Math.floor(trend.length / 2));
  const average = mean(trend);
  return {
    average,
    latest: trend[trend.length - 1],
    change: mean(trend.slice(-k)) - mean(trend.slice(0, k)),
    target,
    grade: otifGrade(average, target),
  };
}
