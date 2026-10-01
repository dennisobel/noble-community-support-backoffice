import type { ClientSession, Types } from "mongoose";
import type { ActorRef } from "@shared/dto";
import { Activity } from "../models";
import { logger } from "./logger";

export interface ActivityEntry {
  actor: ActorRef | null;
  action: string;
  entityType: string;
  entityId: string;
  participantId?: string | Types.ObjectId | null;
  summary: string;
  meta?: Record<string, unknown>;
  ip?: string;
}

/**
 * Appends an audit entry. Inside a transaction the entry commits or rolls back with the change;
 * outside one, a logging failure is reported but never fails the user's request.
 */
export async function logActivity(
  entry: ActivityEntry,
  session?: ClientSession
): Promise<void> {
  const doc = {
    at: new Date(),
    actor: entry.actor,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    participantId: entry.participantId ?? null,
    summary: entry.summary,
    meta: entry.meta ?? null,
    ip: entry.ip ?? "",
  };
  if (session) {
    await Activity.create([doc], { session });
    return;
  }
  try {
    await Activity.create(doc);
  } catch (error) {
    logger().error(
      { err: error, action: entry.action, entityId: entry.entityId },
      "Failed to write activity log"
    );
  }
}
