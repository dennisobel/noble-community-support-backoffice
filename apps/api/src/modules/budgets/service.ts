import type { Types } from "mongoose";
import type { z } from "zod";
import type {
  BudgetAdjustmentDTO,
  BudgetDTO,
  BudgetMetricsDTO,
  BudgetOverviewItemDTO,
  BudgetResponseDTO,
} from "@shared/dto";
import type { RecordStatus, ShiftStatus } from "@shared/enums";
import {
  computeBudgetMetrics,
  type BudgetMetricsCents,
} from "@shared/logic/budget";
import {
  formatMoney,
  fromCents,
  lineSubtotalCents,
  toCents,
} from "@shared/logic/money";
import { durationHours, prettyDate } from "@shared/logic/time";
import type {
  budgetAdjustSchema,
  budgetPlanSchema,
  budgetSetupSchema,
} from "@shared/schemas/budgets";
import { logActivity } from "../../lib/audit";
import { withTransaction } from "../../lib/db";
import { errors, isDuplicateKey } from "../../lib/errors";
import type { RequestContext } from "../../lib/http";
import { actorDTO, assertRev, iso, isoRequired } from "../../lib/mappers";
import { getWorkspace, workspaceToday } from "../../lib/workspace";
import {
  Budget,
  BudgetAdjustment,
  Participant,
  RosterShift,
  Service,
  ServiceRecord,
  type BudgetAdjustmentDoc,
  type BudgetDoc,
  type ParticipantDoc,
  type ServiceDoc,
} from "../../models";
import { getParticipantDoc } from "../participants/service";

export function toBudgetDTO(budget: BudgetDoc): BudgetDTO {
  return {
    id: String(budget._id),
    clientId: String(budget.clientId),
    planStart: budget.planStart,
    planEnd: budget.planEnd,
    categories: budget.categories.map(category => ({
      name: category.name,
      allocation: fromCents(category.allocationCents),
    })),
    isCurrent: budget.isCurrent,
    confirmedAgainstPlanAt: iso(budget.confirmedAgainstPlanAt),
    createdAt: isoRequired(budget.createdAt),
    updatedAt: isoRequired(budget.updatedAt),
    rev: budget.rev ?? 0,
  };
}

function toMetricsDTO(
  metrics: BudgetMetricsCents,
  asOf: string
): BudgetMetricsDTO {
  return {
    categories: metrics.categories.map(category => ({
      name: category.name,
      allocation: fromCents(category.allocationCents),
      used: fromCents(category.usedCents),
      pending: fromCents(category.pendingCents),
      committed: fromCents(category.committedCents),
      remaining: fromCents(category.remainingCents),
    })),
    allocation: fromCents(metrics.allocationCents),
    used: fromCents(metrics.usedCents),
    pending: fromCents(metrics.pendingCents),
    committed: fromCents(metrics.committedCents),
    remaining: fromCents(metrics.remainingCents),
    status: metrics.status,
    asOf,
  };
}

/** Cost of a shift for one participant: hours × rate for hourly services, otherwise one unit. */
export function shiftCostCents(
  shift: { start: string; end: string },
  service: Pick<ServiceDoc, "unit" | "rateCents">
): number {
  return service.unit === "Hour"
    ? lineSubtotalCents(
        durationHours(shift.start, shift.end),
        service.rateCents
      )
    : service.rateCents;
}

export interface ProjectedShift {
  date: string;
  start: string;
  end: string;
  status: ShiftStatus;
  serviceId: string;
}

async function computeMetrics(
  budget: Pick<BudgetDoc, "clientId" | "planStart" | "planEnd" | "categories">,
  options: { excludeShiftId?: string; extraShifts?: ProjectedShift[] } = {}
): Promise<BudgetMetricsCents & { asOf: string }> {
  const today = await workspaceToday();
  const shiftFrom = today > budget.planStart ? today : budget.planStart;
  const [records, shifts] = await Promise.all([
    ServiceRecord.find({
      clientId: budget.clientId,
      status: { $in: ["Submitted", "Approved", "Invoiced"] },
      date: { $gte: budget.planStart, $lte: budget.planEnd },
    })
      .select("date status budgetCategory totalCents")
      .lean<
        Array<{
          date: string;
          status: RecordStatus;
          budgetCategory: string;
          totalCents: number;
        }>
      >(),
    RosterShift.find({
      clientIds: budget.clientId,
      status: { $in: ["Planned", "Confirmed"] },
      date: { $gte: shiftFrom, $lte: budget.planEnd },
      ...(options.excludeShiftId
        ? { _id: { $ne: options.excludeShiftId } }
        : {}),
    })
      .select("date start end status serviceId")
      .lean<
        Array<{
          date: string;
          start: string;
          end: string;
          status: ShiftStatus;
          serviceId: Types.ObjectId;
        }>
      >(),
  ]);
  const allShifts: ProjectedShift[] = [
    ...shifts.map(shift => ({
      date: shift.date,
      start: shift.start,
      end: shift.end,
      status: shift.status,
      serviceId: String(shift.serviceId),
    })),
    ...(options.extraShifts ?? []),
  ];
  const serviceIds = [...new Set(allShifts.map(shift => shift.serviceId))];
  const services = new Map(
    (
      await Service.find({ _id: { $in: serviceIds } })
        .select("unit rateCents budgetCategory")
        .lean<ServiceDoc[]>()
    ).map(service => [String(service._id), service])
  );
  const metrics = computeBudgetMetrics({
    planStart: budget.planStart,
    planEnd: budget.planEnd,
    today,
    categories: budget.categories,
    records: records.map(record => ({
      date: record.date,
      status: record.status,
      category: record.budgetCategory,
      totalCents: record.totalCents,
    })),
    shifts: allShifts.flatMap(shift => {
      const service = services.get(shift.serviceId);
      return service
        ? [
            {
              date: shift.date,
              status: shift.status,
              category: service.budgetCategory,
              costCents: shiftCostCents(shift, service),
            },
          ]
        : [];
    }),
  });
  return { ...metrics, asOf: today };
}

export async function currentBudget(
  clientId: string | Types.ObjectId
): Promise<BudgetDoc | null> {
  return Budget.findOne({ clientId, isCurrent: true }).lean<BudgetDoc>();
}

async function requireCurrentBudget(clientId: string): Promise<BudgetDoc> {
  const budget = await currentBudget(clientId);
  if (!budget) throw errors.notFound("Plan budget");
  return budget;
}

/** Canonical category names from the workspace list (and, for adjustments, the budget's own categories). */
async function canonicalCategories(
  names: string[],
  extra: string[] = []
): Promise<string[]> {
  const known = [...(await getWorkspace()).budgetCategories, ...extra];
  return names.map(name => {
    const match = known.find(
      category => category.toLowerCase() === name.trim().toLowerCase()
    );
    if (!match)
      throw errors.validation(
        `“${name}” is not a budget category. Add it in Settings → Workspace first.`
      );
    return match;
  });
}

export async function getBudget(clientId: string): Promise<BudgetResponseDTO> {
  await getParticipantDoc(clientId);
  const budget = await currentBudget(clientId);
  if (!budget) return { budget: null, metrics: null };
  const metrics = await computeMetrics(budget);
  return {
    budget: toBudgetDTO(budget),
    metrics: toMetricsDTO(metrics, metrics.asOf),
  };
}

const budgetExists = () =>
  errors.conflict(
    "BUDGET_EXISTS",
    "This client already has a plan budget. Adjust the allocations or renew the plan instead."
  );

async function createBudget(
  participant: ParticipantDoc,
  input: z.output<typeof budgetSetupSchema>,
  ctx: RequestContext,
  mode: "setup" | "renew"
): Promise<BudgetResponseDTO> {
  const names = await canonicalCategories(
    input.categories.map(category => category.name)
  );
  const categories = input.categories.map((category, index) => ({
    name: names[index],
    allocationCents: toCents(category.allocation),
  }));
  try {
    await withTransaction(async session => {
      if (mode === "renew") {
        const retired = await Budget.updateOne(
          { clientId: participant._id, isCurrent: true },
          { $set: { isCurrent: false }, $inc: { rev: 1 } },
          { session }
        );
        if (!retired.matchedCount) throw errors.notFound("Plan budget");
      }
      await Budget.create(
        [
          {
            clientId: participant._id,
            planStart: input.planStart,
            planEnd: input.planEnd,
            categories,
            isCurrent: true,
            confirmedAgainstPlanAt: new Date(),
            createdBy: ctx.actor,
          },
        ],
        { session }
      );
      await Participant.updateOne(
        { _id: participant._id },
        {
          $set: { planStart: input.planStart, planEnd: input.planEnd },
          $inc: { rev: 1 },
        },
        { session }
      );
    });
  } catch (error) {
    if (isDuplicateKey(error)) throw budgetExists();
    throw error;
  }
  await logActivity({
    actor: ctx.actor,
    action: mode === "setup" ? "budget.created" : "budget.renewed",
    entityType: "budget",
    entityId: String(participant._id),
    participantId: participant._id,
    summary:
      mode === "setup"
        ? `set up ${participant.preferred}'s plan budget`
        : `renewed ${participant.preferred}'s plan (${prettyDate(input.planStart)} – ${prettyDate(input.planEnd)})`,
    ip: ctx.ip,
  });
  return getBudget(String(participant._id));
}

export async function setupBudget(
  clientId: string,
  input: z.output<typeof budgetSetupSchema>,
  ctx: RequestContext
): Promise<BudgetResponseDTO> {
  const participant = await getParticipantDoc(clientId);
  if (await Budget.exists({ clientId: participant._id, isCurrent: true }))
    throw budgetExists();
  return createBudget(participant, input, ctx, "setup");
}

export async function renewBudget(
  clientId: string,
  input: z.output<typeof budgetSetupSchema>,
  ctx: RequestContext
): Promise<BudgetResponseDTO> {
  const participant = await getParticipantDoc(clientId);
  return createBudget(participant, input, ctx, "renew");
}

export async function adjustAllocation(
  clientId: string,
  input: z.output<typeof budgetAdjustSchema>,
  ctx: RequestContext
): Promise<BudgetResponseDTO> {
  const participant = await getParticipantDoc(clientId);
  const budget = await requireCurrentBudget(clientId);
  assertRev(budget, input.rev);
  const [category] = await canonicalCategories(
    [input.category],
    budget.categories.map(item => item.name)
  );
  const existing = budget.categories.find(item => item.name === category);
  const oldCents = existing?.allocationCents ?? 0;
  const newCents = toCents(input.allocation);
  const categories = existing
    ? budget.categories.map(item =>
        item.name === category
          ? { name: item.name, allocationCents: newCents }
          : item
      )
    : [...budget.categories, { name: category, allocationCents: newCents }];
  await withTransaction(async session => {
    const updated = await Budget.updateOne(
      { _id: budget._id, rev: budget.rev },
      { $set: { categories }, $inc: { rev: 1 } },
      { session }
    );
    if (!updated.matchedCount) throw errors.stale();
    await BudgetAdjustment.create(
      [
        {
          budgetId: budget._id,
          clientId: participant._id,
          category,
          oldAllocationCents: oldCents,
          newAllocationCents: newCents,
          reason: input.reason,
          by: ctx.actor,
          at: new Date(),
        },
      ],
      { session }
    );
    await logActivity(
      {
        actor: ctx.actor,
        action: "budget.adjusted",
        entityType: "budget",
        entityId: String(budget._id),
        participantId: participant._id,
        summary: `changed ${participant.preferred}'s ${category} allocation from ${formatMoney(fromCents(oldCents))} to ${formatMoney(fromCents(newCents))}`,
        meta: { reason: input.reason },
        ip: ctx.ip,
      },
      session
    );
  });
  return getBudget(clientId);
}

export async function updatePlanWindow(
  clientId: string,
  input: z.output<typeof budgetPlanSchema>,
  ctx: RequestContext
): Promise<BudgetResponseDTO> {
  const participant = await getParticipantDoc(clientId);
  const budget = await requireCurrentBudget(clientId);
  assertRev(budget, input.rev);
  await withTransaction(async session => {
    const updated = await Budget.updateOne(
      { _id: budget._id, rev: budget.rev },
      {
        $set: { planStart: input.planStart, planEnd: input.planEnd },
        $inc: { rev: 1 },
      },
      { session }
    );
    if (!updated.matchedCount) throw errors.stale();
    await Participant.updateOne(
      { _id: participant._id },
      {
        $set: { planStart: input.planStart, planEnd: input.planEnd },
        $inc: { rev: 1 },
      },
      { session }
    );
  });
  await logActivity({
    actor: ctx.actor,
    action: "budget.plan_updated",
    entityType: "budget",
    entityId: String(budget._id),
    participantId: participant._id,
    summary: `changed ${participant.preferred}'s plan period to ${prettyDate(input.planStart)} – ${prettyDate(input.planEnd)}`,
    ip: ctx.ip,
  });
  return getBudget(clientId);
}

export async function listAdjustments(
  clientId: string
): Promise<BudgetAdjustmentDTO[]> {
  await getParticipantDoc(clientId);
  const rows = await BudgetAdjustment.find({ clientId })
    .sort({ at: -1 })
    .limit(100)
    .lean<BudgetAdjustmentDoc[]>();
  return rows.map(row => ({
    id: String(row._id),
    category: row.category,
    oldAllocation: fromCents(row.oldAllocationCents),
    newAllocation: fromCents(row.newAllocationCents),
    reason: row.reason,
    by: actorDTO(row.by),
    at: isoRequired(row.at),
  }));
}

/** Budget health for every Active participant with a current plan budget. */
export async function budgetOverview(): Promise<BudgetOverviewItemDTO[]> {
  const participants = await Participant.find({ status: "Active" })
    .select("name preferred")
    .lean<ParticipantDoc[]>();
  const budgets = await Budget.find({
    isCurrent: true,
    clientId: { $in: participants.map(participant => participant._id) },
  }).lean<BudgetDoc[]>();
  const byId = new Map(
    participants.map(participant => [String(participant._id), participant])
  );
  const items = await Promise.all(
    budgets.map(async budget => {
      const metrics = await computeMetrics(budget);
      return {
        clientId: String(budget.clientId),
        clientName: byId.get(String(budget.clientId))?.preferred ?? "Unknown",
        planEnd: budget.planEnd,
        status: metrics.status,
        allocation: fromCents(metrics.allocationCents),
        remaining: fromCents(metrics.remainingCents),
      };
    })
  );
  return items.sort((a, b) => a.clientName.localeCompare(b.clientName));
}

/** Non-blocking warnings about how a planned shift affects each participant's plan budget. */
export async function projectShiftImpact(
  participants: ParticipantDoc[],
  shift: { date: string; start: string; end: string; serviceId: string },
  excludeShiftId?: string
): Promise<string[]> {
  const warnings: string[] = [];
  const today = await workspaceToday();
  const service = await Service.findById(shift.serviceId)
    .select("budgetCategory")
    .lean<Pick<ServiceDoc, "budgetCategory">>();
  for (const participant of participants) {
    const budget = await currentBudget(participant._id);
    if (!budget) {
      warnings.push(`${participant.preferred} has no plan budget on file.`);
      continue;
    }
    if (shift.date < budget.planStart || shift.date > budget.planEnd) {
      warnings.push(
        `${prettyDate(shift.date)} is outside ${participant.preferred}'s plan period.`
      );
      continue;
    }
    if (shift.date < today || !service) continue;
    const projected = await computeMetrics(budget, {
      excludeShiftId,
      extraShifts: [{ ...shift, status: "Planned" }],
    });
    const row = projected.categories.find(
      category => category.name === service.budgetCategory
    );
    if (row && row.remainingCents < 0) {
      warnings.push(
        `${participant.preferred}'s ${row.name} budget would be ${formatMoney(fromCents(-row.remainingCents))} over allocation.`
      );
    }
  }
  return warnings;
}
