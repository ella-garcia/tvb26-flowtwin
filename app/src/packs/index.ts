// Industry packs. Everything that differs by industry is configuration here; no code
// elsewhere may check for "Tier 1" / "Tier 2" — use these labels and helpers instead.
import type { ChainPosition, SizeBand } from "../lib/types";

export interface SegmentRule { label: string; chainPosition: ChainPosition; sizeBands: SizeBand[] }

export interface Pack {
  id: string;
  name: string;
  labels: {
    keyCustomer: string;          // what this industry calls the key customer
    keyCustomerPlural: string;
    approvalProcess: string;      // name of the "customer must re-approve" process
  };
  segments: SegmentRule[];
  certifications: string[];
  materials: { id: string; label: string }[];
}

export const AUTO: Pack = {
  id: "auto",
  name: "Automotive",
  labels: { keyCustomer: "Tier 1", keyCustomerPlural: "Tier 1s", approvalProcess: "PPAP" },
  segments: [
    { label: "Tier 1", chainPosition: "direct", sizeBands: ["small", "medium", "large"] },
    { label: "Tier 2", chainPosition: "sub", sizeBands: ["small", "medium", "large"] },
    { label: "Tier 3", chainPosition: "raw", sizeBands: ["micro", "small", "medium", "large"] },
  ],
  certifications: ["IATF 16949", "ISO 9001", "ISO 14001"],
  materials: [
    { id: "steel-coil", label: "Steel coil" },
    { id: "packaging", label: "Packaging" },
    { id: "fasteners", label: "Fasteners" },
  ],
};

export const PACKS: Pack[] = [AUTO];
export const getPack = (id: string) => PACKS.find((p) => p.id === id) ?? AUTO;

/** Segment label for a supplier in a relationship, e.g. "Tier 2". Falls back to a size description. */
export function segmentLabel(pack: Pack, chainPosition: ChainPosition, sizeBand: SizeBand): string {
  const rule = pack.segments.find((s) => s.chainPosition === chainPosition && s.sizeBands.includes(sizeBand));
  return rule?.label ?? `${sizeBand[0].toUpperCase()}${sizeBand.slice(1)} supplier`;
}
