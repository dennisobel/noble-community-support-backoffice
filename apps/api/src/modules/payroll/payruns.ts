import { Types } from "mongoose";
import type { z } from "zod";
import type {
  PayRunDTO,
  PayRunItemDTO,
  PayRunSummaryDTO,
} from "@shared/dto";
import { PAID_LEAVE_TYPES } from "@shared/enums";
import {
  PAY_CODE_LABELS,
  sumTotals,
  type PayLine,
} from "@shared/logic/award";
import { fromCents, toCents } from "@shared/logic/money";
import { addDays, hoursOf, prettyDate } from "@shared/logic/time";
import type {
  payAdjustmentSchema,
  payRunCreateSchema,
} from "@shared/schemas/payroll";
import { logActivity } from "../../lib/audit";
import { nextIds } from "../../lib/counters";
import { toCsv } from "../../lib/csv";
import { withTransaction } from "../../lib/db";
import { errors } from "../../lib/errors";
import type { RequestContext } from "../../lib/http";
import { actorDTO, assertRev, historyEntry, iso } from "../../lib/mappers";
import { workspaceToday } from "../../lib/workspace";
import {
  LeaveRequest,
  PayRun,
  RosterShift,
  Staff,
  type LeaveRequestDoc,
  type PayRunDoc,
  type PayRunItemSub,
  type StaffDoc,
} from "../../models";
import {
  baseRateOn,
  payContext,
  periodFor,
  type PayContext,
} from "./settings";
import { costRows, loadRows, toLineDTO, type SheetRow } from "./timesheets";

/*
 * A pay run is the gross pay for one pay period. A draft is worked out again every time it is
 * opened, so it always reflects the timesheets approved so far. Finalising keeps the figures as
 * they were and locks the timesheets and leave it paid, so nothing is paid twice.
 */

const label = (run: Pick<PayRunDoc, "from" | "to">) =>
  `${prettyDate(run.from)} – ${prettyDate(run.to)}`;

function leaveLines(
  request: LeaveRequestDoc,
  baseRateCents: number,
  loadingPct: number
): PayLine[] {
  const minutes = Math.round(request.hours * 60);
  const amountCents = Math.round((minutes * baseRateCents) / 60);
  const lines: PayLine[] = [
    {
      key: "",
      date: request.from,
      code: "LEAVE",
      label: request.type,
      minutes,
      units: null,
      pct: 100,
      rateCents: baseRateCents,
      amountCents,
      why: `Approved ${request.type.toLowerCase()} from ${prettyDate(request.from)} to ${prettyDate(request.to)}, paid at the ordinary rate.`,
    },
  ];
  if (request.type === "Annual leave" && loadingPct > 0)
    lines.push({
      key: "",
      date: request.from,
      code: "LOAD",
      label: `${PAY_CODE_LABELS.LOAD} (${loadingPct}%)`,
      minutes: 0,
      units: null,
      pct: 0,
      rateCents: Math.round((amountCents * loadingPct) / 100),
      amountCents: Math.round((amountCents * loadingPct) / 100),
      why: `Annual leave loading of ${loadingPct}% on the leave paid above.`,
    });
  return lines;
}

interface Built {
  items: PayRunItemSub[];
  warnings: string[];
}

/** Works out every worker's pay for the period from the approved timesheets and approved leave. */
async function buildItems(
  run: Pick<PayRunDoc, "_id" | "from" | "to">,
  context: PayContext
): Promise<Built> {
  const [rows, leave, staff] = await Promise.all([
    // One day early, so a shift that carries on past midnight into the period is joined up.
    loadRows(addDays(run.from, -1), run.to, {
      toleranceMinutes: context.toleranceMinutes,
    }),
    LeaveRequest.find({
      status: "Approved",
      type: { $in: PAID_LEAVE_TYPES },
      hours: { $gt: 0 },
      from: { $gte: run.from, $lte: run.to },
      $or: [{ payRunId: null }, { payRunId: run._id }],
    }).lean<LeaveRequestDoc[]>(),
    Staff.find({}).sort({ name: 1 }).lean<StaffDoc[]>(),
  ]);
  const inPeriod = (row: SheetRow) => row.shift.date >= run.from;
  /** Approved here and not already paid by another run. */
  const mine = (row: SheetRow) =>
    inPeriod(row) &&
    row.status !== "Cancelled" &&
    Boolean(row.sheet?.approved) &&
    (!row.sheet?.payRunId || row.sheet.payRunId === run._id);

  const items: PayRunItemSub[] = [];
  for (const member of staff) {
    const id = String(member._id);
    // Hours another run already paid still count towards this period's overtime threshold.
    const approved = rows.filter(
      row =>
        row.staffId === id &&
        row.status !== "Cancelled" &&
        Boolean(row.sheet?.approved)
    );
    const paying = approved.filter(mine);
    const ownLeave = leave.filter(request => String(request.staffId) === id);
    if (!paying.length && !ownLeave.length) continue;

    const keys = new Set(paying.map(row => row.shift._id));
    const cost = costRows(member, approved, run, context, keys);
    const baseRateCents = baseRateOn(member, run.to, context) ?? 0;
    const kind = member.employment?.kind ?? null;
    const flags = cost.flags.map(flag => flag.message);
    if (!kind)
      flags.unshift("No employment type is recorded, so nothing is costed.");
    else if (!cost.costed || (ownLeave.length && !baseRateCents))
      flags.unshift("No pay rate applies on these dates, so the amounts are $0.");

    const lines = [...cost.lines];
    const leaveIds: Types.ObjectId[] = [];
    for (const request of ownLeave) {
      if (kind === "Casual") {
        flags.push(
          `${request.hours} h of ${request.type.toLowerCase()} was left out: casual staff are not paid leave.`
        );
        continue;
      }
      lines.push(
        ...leaveLines(
          request,
          baseRateOn(member, request.from, context) ?? 0,
          context.rules.annualLeaveLoadingPct
        )
      );
      leaveIds.push(request._id);
    }
    if (!lines.length) continue;

    const totals = sumTotals(lines);
    const classification = member.employment?.classificationId
      ? context.classifications.get(member.employment.classificationId)
      : undefined;
    items.push({
      staffId: member._id,
      staffName: member.name,
      payrollId: member.employment?.payrollId ?? "",
      employmentType: kind,
      classificationName: classification?.name ?? "",
      baseRateCents,
      workedMinutes: totals.workedMinutes,
      paidMinutes: totals.paidMinutes,
      ordinaryMinutes: totals.ordinaryMinutes,
      overtimeMinutes: totals.overtimeMinutes,
      allowanceCents: totals.allowanceCents,
      grossCents: totals.grossCents,
      lines,
      flags: [...new Set(flags)],
      shiftIds: [...keys],
      leaveIds,
    });
  }

  const warnings: string[] = [];
  const waiting = rows.filter(
    row =>
      inPeriod(row) &&
      (row.status === "Awaiting approval" ||
        row.status === "No sign-on" ||
        row.status === "In progress")
  ).length;
  if (waiting)
    warnings.push(
      `${waiting} timesheet${waiting === 1 ? " in this period is" : "s in this period are"} not approved yet, so ${waiting === 1 ? "it is" : "they are"} not in this run.`
    );
  const uncosted = items.filter(
    item => !item.employmentType || !item.baseRateCents
  );
  if (uncosted.length)
    warnings.push(
      `${uncosted.map(item => item.staffName).join(", ")} ${uncosted.length === 1 ? "has" : "have"} no employment type or pay rate, so their pay shows as $0.`
    );
  if (!context.rules.standardRateWeeklyCents)
    warnings.push(
      "The weekly standard rate is not set in Pay rules, so broken shift and sleepover allowances are $0."
    );
  return { items, warnings };
}

const adjustmentsFor = (run: PayRunDoc, staffId: string) =>
  (run.adjustments ?? []).filter(item => String(item.staffId) === staffId);

function toItemDTO(run: PayRunDoc, item: PayRunItemSub): PayRunItemDTO {
  const adjustments = adjustmentsFor(run, String(item.staffId));
  const adjusted = adjustments.reduce((sum, row) => sum + row.amountCents, 0);
  return {
    staffId: String(item.staffId),
    staffName: item.staffName,
    payrollId: item.payrollId ?? "",
    employmentType: item.employmentType ?? null,
    classificationName: item.classificationName ?? "",
    baseRate: fromCents(item.baseRateCents ?? 0),
    hours: hoursOf(item.paidMinutes ?? 0),
    ordinaryHours: hoursOf(item.ordinaryMinutes ?? 0),
    overtimeHours: hoursOf(item.overtimeMinutes ?? 0),
    allowances: fromCents(item.allowanceCents ?? 0),
    adjustmentsTotal: fromCents(adjusted),
    gross: fromCents((item.grossCents ?? 0) + adjusted),
    lines: (item.lines ?? []).map(toLineDTO),
    adjustments: adjustments.map(row => ({
      id: String(row._id),
      label: row.label,
      amount: fromCents(row.amountCents),
      by: actorDTO(row.by),
      at: row.at.toISOString(),
    })),
    flags: item.flags ?? [],
  };
}

function toSummaryDTO(run: PayRunDoc): PayRunSummaryDTO {
  const adjusted = (run.adjustments ?? [])
    .filter(row =>
      run.items.some(item => String(item.staffId) === String(row.staffId))
    )
    .reduce((sum, row) => sum + row.amountCents, 0);
  return {
    id: run._id,
    from: run.from,
    to: run.to,
    label: label(run),
    status: run.status,
    staffCount: run.items.length,
    hours: hoursOf(
      run.items.reduce((sum, item) => sum + (item.paidMinutes ?? 0), 0)
    ),
    gross: fromCents(
      run.items.reduce((sum, item) => sum + (item.grossCents ?? 0), 0) +
        adjusted
    ),
    createdAt: run.createdAt.toISOString(),
    createdBy: actorDTO(run.createdBy),
    finalisedAt: iso(run.finalisedAt),
    finalisedBy: actorDTO(run.finalisedBy),
  };
}

const toRunDTO = (run: PayRunDoc): PayRunDTO => ({
  ...toSummaryDTO(run),
  items: run.items.map(item => toItemDTO(run, item)),
  warnings: run.warnings ?? [],
  rev: run.rev ?? 0,
});

async function loadRun(id: string): Promise<PayRunDoc> {
  const run = await PayRun.findById(id).lean<PayRunDoc>();
  if (!run) throw errors.notFound("Pay run");
  return run;
}

/** Recalculates a draft from the timesheets as they stand now and saves the result. */
async function recalculate(run: PayRunDoc): Promise<PayRunDoc> {
  if (run.status !== "Draft") return run;
  const built = await buildItems(run, await payContext());
  const saved = await PayRun.findOneAndUpdate(
    { _id: run._id, status: "Draft" },
    { $set: { items: built.items, warnings: built.warnings } },
    { returnDocument: "after", lean: true }
  );
  return (saved as PayRunDoc | null) ?? run;
}

export async function listPayRuns(): Promise<PayRunSummaryDTO[]> {
  const runs = await PayRun.find({})
    .sort({ from: -1, createdAt: -1 })
    .limit(100)
    .lean<PayRunDoc[]>();
  return runs.map(toSummaryDTO);
}

export async function getPayRun(id: string): Promise<PayRunDTO> {
  return toRunDTO(await recalculate(await loadRun(id)));
}

export async function createPayRun(
  input: z.output<typeof payRunCreateSchema>,
  ctx: RequestContext
): Promise<PayRunDTO> {
  const [context, today] = await Promise.all([payContext(), workspaceToday()]);
  const period = periodFor(context.doc, input.date ?? today, today);
  // One draft per period: opening the period again continues the draft that is already there.
  const draft = await PayRun.findOne({
    from: period.from,
    to: period.to,
    status: "Draft",
  }).lean<PayRunDoc>();
  if (draft) return toRunDTO(await recalculate(draft));

  const id = await nextIds.payRun();
  const built = await buildItems({ _id: id, ...period }, context);
  if (!built.items.length)
    throw errors.invalidState(
      "There is nothing to pay in this period yet. Approve the timesheets first."
    );
  const created = await PayRun.create({
    _id: id,
    from: period.from,
    to: period.to,
    length: period.length,
    status: "Draft",
    items: built.items,
    warnings: built.warnings,
    adjustments: [],
    createdBy: ctx.actor,
    history: [historyEntry(ctx.actor, "created")],
  });
  await logActivity({
    actor: ctx.actor,
    action: "payrun.created",
    entityType: "payRun",
    entityId: id,
    summary: `started pay run ${id} for ${label(period)}`,
    ip: ctx.ip,
  });
  return toRunDTO(created.toObject<PayRunDoc>());
}

async function draftRun(id: string): Promise<PayRunDoc> {
  const run = await loadRun(id);
  if (run.status !== "Draft")
    throw errors.invalidState(
      "This pay run is finalised. Reopen it to make changes."
    );
  return run;
}

export async function addAdjustment(
  id: string,
  input: z.output<typeof payAdjustmentSchema>,
  ctx: RequestContext
): Promise<PayRunDTO> {
  const run = await recalculate(await draftRun(id));
  if (!run.items.some(item => String(item.staffId) === input.staffId))
    throw errors.validation(
      "Choose someone who is in this pay run.",
      [{ path: "staffId", message: "Not in this pay run." }]
    );
  await PayRun.updateOne(
    { _id: id, status: "Draft" },
    {
      $push: {
        adjustments: {
          _id: new Types.ObjectId(),
          staffId: input.staffId,
          label: input.label,
          amountCents: toCents(input.amount),
          by: ctx.actor,
          at: new Date(),
        },
      },
      $inc: { rev: 1 },
    }
  );
  return toRunDTO(await loadRun(id));
}

export async function removeAdjustment(
  id: string,
  adjustmentId: string
): Promise<PayRunDTO> {
  await draftRun(id);
  await PayRun.updateOne(
    { _id: id, status: "Draft" },
    { $pull: { adjustments: { _id: adjustmentId } }, $inc: { rev: 1 } }
  );
  return toRunDTO(await loadRun(id));
}

export async function finalisePayRun(
  id: string,
  rev: number | undefined,
  ctx: RequestContext
): Promise<PayRunDTO> {
  const run = await recalculate(await draftRun(id));
  assertRev({ rev: run.rev ?? 0 }, rev);
  if (!run.items.length)
    throw errors.invalidState("There is nothing in this pay run to finalise.");
  const uncosted = run.items.filter(
    item => !item.employmentType || !item.baseRateCents
  );
  if (uncosted.length)
    throw errors.invalidState(
      `Give ${uncosted.map(item => item.staffName).join(", ")} an employment type and a pay rate before finalising, or their pay is $0.`
    );
  const finalised = await withTransaction(async session => {
    const claimed = await PayRun.findOneAndUpdate(
      { _id: id, status: "Draft", rev: run.rev ?? 0 },
      {
        $set: {
          status: "Finalised",
          finalisedBy: ctx.actor,
          finalisedAt: new Date(),
        },
        $push: { history: historyEntry(ctx.actor, "finalised") },
        $inc: { rev: 1 },
      },
      { returnDocument: "after", lean: true, session }
    );
    if (!claimed) throw errors.stale();
    // Lock everything this run paid so no later run can pay it again.
    for (const item of run.items) {
      for (const shiftId of item.shiftIds)
        await RosterShift.updateOne(
          { _id: shiftId, "timesheets.staffId": item.staffId },
          { $set: { "timesheets.$.payRunId": id } },
          { session }
        );
      if (item.leaveIds.length)
        await LeaveRequest.updateMany(
          { _id: { $in: item.leaveIds } },
          { $set: { payRunId: id } },
          { session }
        );
    }
    await logActivity(
      {
        actor: ctx.actor,
        action: "payrun.finalised",
        entityType: "payRun",
        entityId: id,
        summary: `finalised pay run ${id} for ${label(run)}`,
        ip: ctx.ip,
      },
      session
    );
    return claimed as PayRunDoc;
  });
  return toRunDTO(finalised);
}

export async function reopenPayRun(
  id: string,
  ctx: RequestContext
): Promise<PayRunDTO> {
  const run = await loadRun(id);
  if (run.status !== "Finalised")
    throw errors.invalidState("Only a finalised pay run can be reopened.");
  const reopened = await withTransaction(async session => {
    const claimed = await PayRun.findOneAndUpdate(
      { _id: id, status: "Finalised" },
      {
        $set: { status: "Draft", finalisedBy: null, finalisedAt: null },
        $push: { history: historyEntry(ctx.actor, "reopened") },
        $inc: { rev: 1 },
      },
      { returnDocument: "after", lean: true, session }
    );
    if (!claimed) throw errors.stale();
    await RosterShift.updateMany(
      { "timesheets.payRunId": id },
      { $set: { "timesheets.$[row].payRunId": null } },
      { arrayFilters: [{ "row.payRunId": id }], session }
    );
    await LeaveRequest.updateMany(
      { payRunId: id },
      { $set: { payRunId: null } },
      { session }
    );
    await logActivity(
      {
        actor: ctx.actor,
        action: "payrun.reopened",
        entityType: "payRun",
        entityId: id,
        summary: `reopened pay run ${id}`,
        ip: ctx.ip,
      },
      session
    );
    return claimed as PayRunDoc;
  });
  return toRunDTO(await recalculate(reopened));
}

export async function deletePayRun(
  id: string,
  ctx: RequestContext
): Promise<void> {
  await draftRun(id);
  const result = await PayRun.deleteOne({ _id: id, status: "Draft" });
  if (!result.deletedCount) throw errors.stale();
  await logActivity({
    actor: ctx.actor,
    action: "payrun.deleted",
    entityType: "payRun",
    entityId: id,
    summary: `deleted draft pay run ${id}`,
    ip: ctx.ip,
  });
}

/** The run as a spreadsheet: one row per person, or one row per pay line. */
export async function exportPayRun(
  id: string,
  detail: "summary" | "lines"
): Promise<{ filename: string; csv: string }> {
  const run = await getPayRun(id);
  if (detail === "lines") {
    const rows = run.items.flatMap(item => [
      ...item.lines.map(line => [
        item.payrollId,
        item.staffName,
        line.date,
        line.shiftId,
        line.label,
        line.hours || "",
        line.units ?? "",
        line.rate,
        line.amount,
        line.why,
      ]),
      ...item.adjustments.map(row => [
        item.payrollId,
        item.staffName,
        row.at.slice(0, 10),
        "",
        `Adjustment: ${row.label}`,
        "",
        "",
        "",
        row.amount,
        "Added by hand to this pay run.",
      ]),
    ]);
    return {
      filename: `${run.id}-lines.csv`,
      csv: toCsv(
        [
          "Payroll ID",
          "Name",
          "Date",
          "Shift",
          "Pay item",
          "Hours",
          "Units",
          "Rate",
          "Amount",
          "Rule",
        ],
        rows
      ),
    };
  }
  return {
    filename: `${run.id}-summary.csv`,
    csv: toCsv(
      [
        "Payroll ID",
        "Name",
        "Employment",
        "Classification",
        "Ordinary rate",
        "Ordinary hours",
        "Overtime hours",
        "Paid hours",
        "Allowances",
        "Adjustments",
        "Gross pay",
        "Period start",
        "Period end",
      ],
      run.items.map(item => [
        item.payrollId,
        item.staffName,
        item.employmentType ?? "",
        item.classificationName,
        item.baseRate,
        item.ordinaryHours,
        item.overtimeHours,
        item.hours,
        item.allowances,
        item.adjustmentsTotal,
        item.gross,
        run.from,
        run.to,
      ])
    ),
  };
}
