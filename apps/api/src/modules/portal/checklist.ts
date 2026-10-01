import {
  EXPIRY_REMINDER_DAYS,
  STAFF_CHECKLIST,
  type ChecklistItemStatus,
  type ExpiryState,
} from "@shared/enums";
import type { StaffChecklistItemDTO } from "@shared/dto";
import { addDays, daysBetween } from "@shared/logic/time";
import type { ChecklistItemSub, StaffDoc, StaffProfileDoc } from "../../models";

/** Days before expiry that turn a document amber. */
export const EXPIRING_SOON_DAYS = 30;

export interface ExpiryInfo {
  daysLeft: number | null;
  state: ExpiryState | null;
}

/** Turns an expiry date into "days left" plus the colour state both portals use. */
export function expiryInfo(
  expiry: string | null | undefined,
  today: string
): ExpiryInfo {
  if (!expiry) return { daysLeft: null, state: null };
  const daysLeft = daysBetween(today, expiry);
  return {
    daysLeft,
    state:
      daysLeft < 0
        ? "expired"
        : daysLeft <= 7
          ? "urgent"
          : daysLeft <= EXPIRING_SOON_DAYS
            ? "soon"
            : "ok",
  };
}

/** The checklist a worker must hold; vehicle items only matter when they transport. */
export function checklistFor(staff: Pick<StaffDoc, "transportsParticipants">) {
  return STAFF_CHECKLIST.filter(
    item => !item.transportOnly || staff.transportsParticipants
  );
}

/** Fresh checklist rows for a new profile (Not started, no expiry yet). */
export function defaultChecklist(
  staff: Pick<StaffDoc, "transportsParticipants">
): ChecklistItemSub[] {
  return checklistFor(staff).map(item => ({
    key: item.key,
    status: "Not started" as ChecklistItemStatus,
    expiry: null,
    documentId: null,
    reviewedAt: null,
    reviewedBy: null,
    reviewNote: "",
  }));
}

export function checklistItemsDTO(
  staff: StaffDoc,
  profile: StaffProfileDoc | null,
  today: string
): StaffChecklistItemDTO[] {
  const saved = new Map(
    (profile?.checklist ?? []).map(item => [item.key, item])
  );
  return checklistFor(staff).map(item => {
    const row = saved.get(item.key);
    const info = expiryInfo(row?.expiry ?? null, today);
    return {
      key: item.key,
      label: item.label,
      group: item.group,
      requiresExpiry: item.expiry,
      transportOnly: Boolean(item.transportOnly),
      status: row?.status ?? "Not started",
      expiry: row?.expiry ?? null,
      daysLeft: info.daysLeft,
      expiryState: info.state,
      documentId: row?.documentId ? String(row.documentId) : null,
      reviewedAt: row?.reviewedAt ? row.reviewedAt.toISOString() : null,
      reviewNote: row?.reviewNote ?? "",
    };
  });
}

export interface ChecklistProgress {
  approved: number;
  total: number;
  completePct: number;
  expiring: number;
  expired: number;
  nextExpiry: string | null;
}

export function checklistProgress(
  items: StaffChecklistItemDTO[]
): ChecklistProgress {
  const approved = items.filter(item => item.status === "Approved").length;
  const expiring = items.filter(
    item => item.expiryState === "soon" || item.expiryState === "urgent"
  ).length;
  const expired = items.filter(item => item.expiryState === "expired").length;
  const upcoming = items
    .map(item => item.expiry)
    .filter((expiry): expiry is string => Boolean(expiry))
    .sort();
  return {
    approved,
    total: items.length,
    completePct: items.length ? Math.round((approved / items.length) * 100) : 0,
    expiring,
    expired,
    nextExpiry: upcoming[0] ?? null,
  };
}

/** Reminder windows, tightest first, so each one is reached in turn as the date nears. */
const REMINDER_WINDOWS = [...EXPIRY_REMINDER_DAYS].sort((a, b) => a - b);

/**
 * The reminder window a document currently sits in, or null when the expiry is still
 * far off. Returning the *tightest* window it fits is what lets the sweep send one
 * reminder per stage (30, 14, 7 and 1 day out) instead of only the first.
 */
export function reminderThreshold(daysLeft: number | null): number | null {
  if (daysLeft === null || daysLeft < 0) return null;
  for (const days of REMINDER_WINDOWS) if (daysLeft <= days) return days;
  return null;
}

export const expiryWindowEnd = (today: string, days = EXPIRING_SOON_DAYS) =>
  addDays(today, days);
