// Vehicle programmes (models): which parts go into which model, and when a model's line would stop.
import type { Part, RiskAssessment, VehicleProgram } from "./types";

export const ALL_PROGRAMS = "all";

/** "K3 compact SUV (OEM A)" */
export const modelLabel = (g: VehicleProgram) => `${g.model} (${g.oem})`;

/** Parts that go into the programme; every part when programId is "all". */
export function partsOn(parts: Part[], programId: string): Part[] {
  return programId === ALL_PROGRAMS ? parts : parts.filter((p) => p.programIds?.includes(programId));
}

/** Days until the line stops for these parts, from the engine's per-part stop days.
 *  Falls back to the supplier-level value when the risk predates per-part stop days. */
export function stopDaysFor(risk: RiskAssessment, parts: Part[]): number | null {
  if (!risk.partStopDays) return risk.daysToLineStop;
  const days = parts.map((p) => risk.partStopDays![p.id]).filter((d): d is number => d != null);
  return days.length ? Math.min(...days) : null;
}

/** Programmes a set of parts goes into, in the order given. */
export function programsOf(parts: Part[], programs: VehicleProgram[]): VehicleProgram[] {
  const ids = new Set(parts.flatMap((p) => p.programIds ?? []));
  return programs.filter((g) => ids.has(g.id));
}
