import type { ShiftRatio } from "../enums";
import { MESSAGES } from "../messages";
import { timesOverlap } from "./time";

/** Ratio rule violation message, or null when the assignment fits the ratio. */
export function ratioError(
  ratio: ShiftRatio,
  clientCount: number,
  staffCount: number
): string | null {
  if (ratio === "1:1" && (clientCount !== 1 || staffCount !== 1))
    return MESSAGES.shiftRatio11;
  if (ratio === "1:M" && (staffCount !== 1 || clientCount < 2))
    return MESSAGES.shiftRatio1M;
  if (ratio === "M:M" && (staffCount < 2 || clientCount < 2))
    return MESSAGES.shiftRatioMM;
  if (!clientCount || !staffCount) return MESSAGES.shiftAssignment;
  return null;
}

export interface OverlapCandidate {
  id: string;
  date: string;
  start: string;
  end: string;
  clientIds: string[];
  staffIds: string[];
  status: string;
}

export interface OverlapResult {
  participantConflict?: OverlapCandidate;
  staffConflict?: OverlapCandidate;
}

/** First existing shift that double-books a participant or a staff member. Cancelled shifts never conflict. */
export function findOverlaps(
  draft: Omit<OverlapCandidate, "id" | "status"> & { id?: string },
  existing: OverlapCandidate[]
): OverlapResult {
  const overlapping = existing.filter(
    shift =>
      shift.id !== draft.id &&
      shift.status !== "Cancelled" &&
      shift.date === draft.date &&
      timesOverlap(draft.start, draft.end, shift.start, shift.end)
  );
  return {
    participantConflict: overlapping.find(shift =>
      draft.clientIds.some(id => shift.clientIds.includes(id))
    ),
    staffConflict: overlapping.find(shift =>
      draft.staffIds.some(id => shift.staffIds.includes(id))
    ),
  };
}
