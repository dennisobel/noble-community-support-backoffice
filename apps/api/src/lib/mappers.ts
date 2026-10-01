import type { Request } from "express";
import type { ActorRef, HistoryEntryDTO } from "@shared/dto";
import type { ActorRefSub, HistorySub } from "../models";
import { errors } from "./errors";

export const iso = (date: Date | null | undefined): string | null =>
  date ? new Date(date).toISOString() : null;
export const isoRequired = (date: Date): string => new Date(date).toISOString();

export const actorDTO = (
  actor: ActorRefSub | null | undefined
): ActorRef | null => (actor ? { id: actor.id, name: actor.name } : null);

export const historyDTO = (
  history: HistorySub[] | undefined
): HistoryEntryDTO[] =>
  (history ?? []).map(entry => ({
    at: isoRequired(entry.at),
    by: actorDTO(entry.by),
    action: entry.action,
    note: entry.note,
  }));

export const historyEntry = (
  actor: ActorRef | null,
  action: string,
  note?: string
): HistorySub => ({
  at: new Date(),
  by: actor ? { id: actor.id, name: actor.name } : null,
  action,
  ...(note ? { note } : {}),
});

/** Validates a 24-hex ObjectId route parameter (404 for anything else). */
export function objectIdParam(
  req: Request,
  name = "id",
  what = "Record"
): string {
  const value = req.params[name];
  if (typeof value !== "string" || !/^[a-f\d]{24}$/i.test(value))
    throw errors.notFound(what);
  return value;
}

/** Validates a business-code route parameter such as SR-1048 (404 for anything else). */
export function codeParam(
  req: Request,
  prefix: "SR" | "SH" | "VN" | "INV",
  what: string,
  name = "id"
): string {
  const value = req.params[name];
  const pattern =
    prefix === "INV"
      ? /^[A-Z0-9]{1,8}-\d{4}-\d{3,}$/
      : new RegExp(`^${prefix}-\\d+$`);
  if (typeof value !== "string" || !pattern.test(value))
    throw errors.notFound(what);
  return value;
}

/** Throws STALE_VERSION when the client edited an older revision. */
export function assertRev(
  current: { rev: number },
  rev: number | undefined
): void {
  if (rev !== undefined && current.rev !== rev) throw errors.stale();
}

export const uniqueIds = <T>(values: T[]): T[] => [...new Set(values)];
