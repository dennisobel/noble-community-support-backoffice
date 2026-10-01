import { Router } from "express";
import { z } from "zod";
import type { ActivityDTO, Paginated } from "@shared/dto";
import { objectId, pagination, ymd } from "@shared/schemas/common";
import { zonedStartOfDay, addDays } from "@shared/logic/time";
import { parse } from "../../lib/http";
import { actorDTO, isoRequired } from "../../lib/mappers";
import { workspaceTimezone } from "../../lib/workspace";
import { Activity, type ActivityDoc } from "../../models";

export function toActivityDTO(entry: ActivityDoc): ActivityDTO {
  return {
    id: String(entry._id),
    at: isoRequired(entry.at),
    actor: actorDTO(entry.actor),
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    participantId: entry.participantId ? String(entry.participantId) : null,
    summary: entry.summary,
  };
}

export const activityQuery = z.object({
  entityType: z.string().trim().max(40).optional(),
  entityId: z.string().trim().max(60).optional(),
  participantId: objectId.optional(),
  actorId: z.string().trim().max(60).optional(),
  from: ymd.optional(),
  to: ymd.optional(),
  includeAuth: z.enum(["true", "false"]).default("false"),
  ...pagination,
  limit: z.coerce.number().int().min(1).max(200).default(20),
});

export async function listActivity(
  query: z.output<typeof activityQuery>
): Promise<Paginated<ActivityDTO>> {
  const filter: Record<string, unknown> = {};
  if (query.entityType) filter.entityType = query.entityType;
  if (query.entityId) filter.entityId = query.entityId;
  if (query.participantId) filter.participantId = query.participantId;
  if (query.actorId) filter["actor.id"] = query.actorId;
  if (query.includeAuth !== "true") filter.action = { $not: /^auth\./ };
  if (query.from || query.to) {
    const timezone = await workspaceTimezone();
    filter.at = {
      ...(query.from ? { $gte: zonedStartOfDay(query.from, timezone) } : {}),
      ...(query.to
        ? { $lt: zonedStartOfDay(addDays(query.to, 1), timezone) }
        : {}),
    };
  }
  const [items, total] = await Promise.all([
    Activity.find(filter)
      .sort({ at: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean<ActivityDoc[]>(),
    Activity.countDocuments(filter),
  ]);
  return {
    items: items.map(toActivityDTO),
    page: query.page,
    limit: query.limit,
    total,
  };
}

export function activityRouter(): Router {
  const router = Router();
  router.get("/", async (req, res) => {
    res.json(await listActivity(parse(activityQuery, req.query)));
  });
  return router;
}
