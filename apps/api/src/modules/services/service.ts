import type { z } from "zod";
import type { ServiceDTO } from "@shared/dto";
import { fromCents, toCents } from "@shared/logic/money";
import { MESSAGES } from "@shared/messages";
import type {
  serviceCreateSchema,
  serviceListQuery,
  serviceUpdateSchema,
} from "@shared/schemas/services";
import { logActivity } from "../../lib/audit";
import { errors, isDuplicateKey } from "../../lib/errors";
import type { RequestContext } from "../../lib/http";
import { actorDTO, assertRev, isoRequired } from "../../lib/mappers";
import { getWorkspace } from "../../lib/workspace";
import {
  RosterShift,
  Service,
  ServiceRecord,
  serviceNameKey,
  type ServiceDoc,
} from "../../models";

export function toServiceDTO(service: ServiceDoc): ServiceDTO {
  return {
    id: String(service._id),
    name: service.name,
    unit: service.unit,
    rate: fromCents(service.rateCents),
    transport: service.transportEnabled,
    transportUnit: service.transportEnabled
      ? (service.transportUnit ?? "Kilometre")
      : null,
    budgetCategory: service.budgetCategory,
    supportItemNumber: service.supportItemNumber ?? "",
    payAs: service.payAs ?? "Hours worked",
    active: service.active,
    rateHistory: (service.rateHistory ?? []).map(entry => ({
      rate: fromCents(entry.rateCents),
      changedAt: isoRequired(entry.changedAt),
      changedBy: actorDTO(entry.changedBy),
    })),
    createdAt: isoRequired(service.createdAt),
    updatedAt: isoRequired(service.updatedAt),
    rev: service.rev ?? 0,
  };
}

/** Resolves a category name against the workspace list (case-insensitive) and returns the canonical spelling. */
export async function canonicalCategory(name: string): Promise<string> {
  const workspace = await getWorkspace();
  const match = workspace.budgetCategories.find(
    category => category.toLowerCase() === name.trim().toLowerCase()
  );
  if (!match)
    throw errors.validation(
      "Choose a budget category from the workspace list.",
      [{ path: "budgetCategory", message: MESSAGES.serviceCategory }]
    );
  return match;
}

const nameTaken = () =>
  errors.conflict("SERVICE_NAME_EXISTS", MESSAGES.serviceNameExists);

export async function listServices(
  query: z.output<typeof serviceListQuery>
): Promise<ServiceDTO[]> {
  const filter =
    query.active === "all" ? {} : { active: query.active === "true" };
  const services = await Service.find(filter)
    .sort({ name: 1 })
    .lean<ServiceDoc[]>();
  return services.map(toServiceDTO);
}

export async function getServiceDoc(id: string): Promise<ServiceDoc> {
  const service = await Service.findById(id).lean<ServiceDoc>();
  if (!service) throw errors.notFound("Service");
  return service;
}

export async function createService(
  input: z.output<typeof serviceCreateSchema>,
  ctx: RequestContext
): Promise<ServiceDTO> {
  const budgetCategory = await canonicalCategory(input.budgetCategory);
  const rateCents = toCents(input.rate);
  try {
    const created = await Service.create({
      name: input.name,
      nameKey: serviceNameKey(input.name),
      unit: input.unit,
      rateCents,
      transportEnabled: input.transport,
      transportUnit: input.transport ? "Kilometre" : null,
      budgetCategory,
      supportItemNumber: input.supportItemNumber ?? "",
      payAs: input.payAs ?? "Hours worked",
      active: input.active,
      rateHistory: [{ rateCents, changedAt: new Date(), changedBy: ctx.actor }],
    });
    await logActivity({
      actor: ctx.actor,
      action: "service.created",
      entityType: "service",
      entityId: String(created._id),
      summary: `added the service ${created.name}`,
      ip: ctx.ip,
    });
    return toServiceDTO(created.toObject<ServiceDoc>());
  } catch (error) {
    if (isDuplicateKey(error)) throw nameTaken();
    throw error;
  }
}

export async function updateService(
  id: string,
  input: z.output<typeof serviceUpdateSchema>,
  ctx: RequestContext
): Promise<ServiceDTO> {
  const current = await getServiceDoc(id);
  assertRev(current, input.rev);
  const $set: Record<string, unknown> = {};
  const update: Record<string, unknown> = { $set, $inc: { rev: 1 } };
  if (input.name !== undefined) {
    $set.name = input.name;
    $set.nameKey = serviceNameKey(input.name);
  }
  if (input.unit !== undefined) $set.unit = input.unit;
  if (input.active !== undefined) $set.active = input.active;
  if (input.supportItemNumber !== undefined)
    $set.supportItemNumber = input.supportItemNumber;
  if (input.payAs !== undefined) $set.payAs = input.payAs;
  if (input.budgetCategory !== undefined)
    $set.budgetCategory = await canonicalCategory(input.budgetCategory);
  if (input.transport !== undefined) {
    $set.transportEnabled = input.transport;
    $set.transportUnit = input.transport ? "Kilometre" : null;
  }
  let rateChanged = false;
  if (input.rate !== undefined) {
    const rateCents = toCents(input.rate);
    if (rateCents !== current.rateCents) {
      rateChanged = true;
      $set.rateCents = rateCents;
      update.$push = {
        rateHistory: { rateCents, changedAt: new Date(), changedBy: ctx.actor },
      };
    }
  }
  try {
    const updated = await Service.findOneAndUpdate(
      { _id: id, rev: current.rev },
      update,
      { returnDocument: "after", lean: true }
    );
    if (!updated) throw errors.stale();
    await logActivity({
      actor: ctx.actor,
      action: "service.updated",
      entityType: "service",
      entityId: id,
      summary: rateChanged
        ? `changed the ${updated.name} rate from $${fromCents(current.rateCents).toFixed(2)} to $${fromCents(updated.rateCents).toFixed(2)}`
        : `updated the service ${updated.name}`,
      ip: ctx.ip,
    });
    return toServiceDTO(updated as ServiceDoc);
  } catch (error) {
    if (isDuplicateKey(error)) throw nameTaken();
    throw error;
  }
}

export async function deleteService(
  id: string,
  ctx: RequestContext
): Promise<void> {
  const current = await getServiceDoc(id);
  const [recordUse, shiftUse] = await Promise.all([
    ServiceRecord.exists({ serviceId: current._id }),
    RosterShift.exists({ serviceId: current._id }),
  ]);
  if (recordUse || shiftUse) {
    throw errors.conflict(
      "CONFLICT",
      "This service is used by service records or shifts. Mark it inactive instead of deleting it."
    );
  }
  await Service.deleteOne({ _id: id });
  await logActivity({
    actor: ctx.actor,
    action: "service.deleted",
    entityType: "service",
    entityId: id,
    summary: `deleted the service ${current.name}`,
    ip: ctx.ip,
  });
}
