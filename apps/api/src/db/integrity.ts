import { DEFAULT_TRAVEL_RATE_CENTS } from "@shared/const";
import { NOTE_SECTIONS } from "@shared/enums";
import { computeBillables } from "@shared/logic/billing";
import { computeBudgetMetrics } from "@shared/logic/budget";
import { findOverlaps, ratioError } from "@shared/logic/roster";
import {
  addDays,
  durationHours,
  todayIn,
  zonedStartOfDay,
  minutesOf,
} from "@shared/logic/time";
import { shiftCostCents } from "../modules/budgets/service";
import { getWorkspace, invalidateWorkspaceCache } from "../lib/workspace";
import {
  Activity,
  Budget,
  Counter,
  Invoice,
  Participant,
  RosterShift,
  Service,
  ServiceRecord,
  Staff,
  type BudgetDoc,
  type InvoiceDoc,
  type ParticipantDoc,
  type RosterShiftDoc,
  type ServiceDoc,
  type ServiceRecordDoc,
  type StaffDoc,
} from "../models";

export interface IntegrityReport {
  problems: string[];
  counts: Record<string, number>;
}

const sameId = (a: unknown, b: unknown) => String(a) === String(b);

/**
 * Checks that the business data is internally consistent: every reference resolves, statuses match the
 * fields they imply, totals add up, counters are ahead of the ids in use and budgets fund what was delivered.
 * Read-only. Returns a list of plain-English problems (empty when everything ties together).
 */
export async function checkIntegrity(): Promise<IntegrityReport> {
  invalidateWorkspaceCache();
  const workspace = await getWorkspace();
  const now = new Date();
  const today = todayIn(workspace.timezone, now);

  const [
    participants,
    staff,
    services,
    budgets,
    shifts,
    records,
    invoices,
    counters,
    activities,
  ] = await Promise.all([
    Participant.find().lean<ParticipantDoc[]>(),
    Staff.find().lean<StaffDoc[]>(),
    Service.find().lean<ServiceDoc[]>(),
    Budget.find().lean<BudgetDoc[]>(),
    RosterShift.find().lean<RosterShiftDoc[]>(),
    ServiceRecord.find().lean<ServiceRecordDoc[]>(),
    Invoice.find().lean<InvoiceDoc[]>(),
    Counter.find().lean<Array<{ _id: string; seq: number }>>(),
    Activity.find()
      .select("participantId at")
      .lean<Array<{ participantId: unknown; at: Date }>>(),
  ]);

  const problems: string[] = [];
  const problem = (message: string) => problems.push(message);

  const participantById = new Map(participants.map(p => [String(p._id), p]));
  const staffById = new Map(staff.map(s => [String(s._id), s]));
  const serviceById = new Map(services.map(s => [String(s._id), s]));
  const shiftById = new Map(shifts.map(s => [s._id, s]));
  const recordById = new Map(records.map(r => [r._id, r]));
  const invoiceById = new Map(invoices.map(i => [i._id, i]));
  const categories = new Set(workspace.budgetCategories);
  const nameOf = (id: unknown) =>
    participantById.get(String(id))?.preferred ?? String(id);

  /* Services and staff */
  for (const service of services) {
    if (!categories.has(service.budgetCategory))
      problem(
        `Service "${service.name}" uses the budget category "${service.budgetCategory}", which is not in the workspace list.`
      );
    if (service.transportEnabled !== (service.transportUnit === "Kilometre"))
      problem(`Service "${service.name}" has inconsistent transport settings.`);
    const lastRate = service.rateHistory.at(-1)?.rateCents;
    if (lastRate !== service.rateCents)
      problem(
        `Service "${service.name}" rate history does not end at the current rate.`
      );
  }
  const emails = new Set<string>();
  for (const member of staff) {
    if (emails.has(member.email))
      problem(`Two team members share the email ${member.email}.`);
    emails.add(member.email);
  }

  /* Participants and budgets */
  const currentBudget = new Map<string, BudgetDoc>();
  for (const budget of budgets) {
    const participant = participantById.get(String(budget.clientId));
    if (!participant) {
      problem(
        `A budget belongs to a participant that does not exist (${budget.clientId}).`
      );
      continue;
    }
    for (const category of budget.categories) {
      if (!categories.has(category.name))
        problem(
          `${participant.preferred}'s budget funds "${category.name}", which is not a workspace category.`
        );
      if (category.allocationCents < 0)
        problem(
          `${participant.preferred}'s budget has a negative allocation for "${category.name}".`
        );
    }
    if (budget.isCurrent) {
      if (currentBudget.has(String(budget.clientId)))
        problem(`${participant.preferred} has more than one current budget.`);
      currentBudget.set(String(budget.clientId), budget);
      if (
        participant.planStart !== budget.planStart ||
        participant.planEnd !== budget.planEnd
      )
        problem(
          `${participant.preferred}'s plan dates do not match their current budget.`
        );
    }
  }
  for (const participant of participants) {
    if (!/^\d{9}$/.test(participant.ndis))
      problem(`${participant.preferred} has an invalid NDIS number.`);
    if (
      participant.status === "Active" &&
      !currentBudget.has(String(participant._id))
    )
      problem(`${participant.preferred} has no current plan budget.`);
    if (participant.status === "Archived") {
      const stuck = records.filter(
        record =>
          sameId(record.clientId, participant._id) &&
          ["Draft", "Returned", "Submitted", "Approved"].includes(record.status)
      );
      if (stuck.length)
        problem(
          `Archived participant ${participant.preferred} still has ${stuck.length} record(s) that are not finished (${stuck.map(r => r._id).join(", ")}).`
        );
    }
  }

  /* Roster */
  const draftsByDate = new Map<string, RosterShiftDoc[]>();
  for (const shift of shifts) {
    const label = shift._id;
    const service = serviceById.get(String(shift.serviceId));
    if (!service) problem(`${label} uses a service that does not exist.`);
    else if (service.name !== shift.type)
      problem(
        `${label} is labelled "${shift.type}" but its service is "${service.name}".`
      );
    for (const id of shift.clientIds)
      if (!participantById.has(String(id)))
        problem(`${label} includes a participant that does not exist.`);
    for (const id of shift.staffIds)
      if (!staffById.has(String(id)))
        problem(`${label} includes a team member that does not exist.`);
    if (durationHours(shift.start, shift.end) <= 0)
      problem(`${label} finishes before it starts.`);
    const ratio = ratioError(
      shift.ratio,
      shift.clientIds.length,
      shift.staffIds.length
    );
    if (ratio) problem(`${label}: ${ratio}`);

    const endsAt = new Date(
      zonedStartOfDay(shift.date, workspace.timezone).getTime() +
        minutesOf(shift.end) * 60_000
    );
    if (shift.status === "Completed" && endsAt > now)
      problem(`${label} is marked completed but has not finished yet.`);
    if (
      shift.status !== "Completed" &&
      shift.status !== "Cancelled" &&
      shift.date < today
    )
      problem(
        `${label} is in the past but still ${shift.status.toLowerCase()}.`
      );

    const upcoming = shift.status === "Planned" || shift.status === "Confirmed";
    if (upcoming) {
      for (const id of shift.clientIds)
        if (participantById.get(String(id))?.status === "Archived")
          problem(`${label} includes archived participant ${nameOf(id)}.`);
      for (const id of shift.staffIds) {
        const member = staffById.get(String(id));
        if (member && member.status !== "Active")
          problem(
            `${label} is assigned to ${member.name}, who is ${member.status.toLowerCase()}.`
          );
      }
      if (service && !service.active)
        problem(`${label} uses the inactive service "${service.name}".`);
    }

    const linked = records.filter(r => r.shiftId === shift._id);
    if (shift.status === "Completed") {
      if (
        linked.length !== shift.clientIds.length ||
        shift.recordIds.length !== shift.clientIds.length
      )
        problem(`${label} should have one service record per participant.`);
    } else if (shift.recordIds.length || linked.length) {
      problem(
        `${label} is ${shift.status.toLowerCase()} but has service records.`
      );
    }
    for (const record of linked) {
      if (!shift.recordIds.includes(record._id))
        problem(`${record._id} points at ${label}, which does not list it.`);
      if (!shift.clientIds.some(id => sameId(id, record.clientId)))
        problem(`${record._id} is for a participant who is not on ${label}.`);
      if (!shift.staffIds.some(id => sameId(id, record.staffId)))
        problem(`${record._id} is by a team member who is not on ${label}.`);
      if (
        record.date !== shift.date ||
        record.start !== shift.start ||
        record.end !== shift.end ||
        !sameId(record.serviceId, shift.serviceId)
      )
        problem(
          `${record._id} does not match the date, time or service of ${label}.`
        );
    }
    for (const id of shift.recordIds)
      if (!recordById.has(id))
        problem(`${label} lists ${id}, which does not exist.`);

    if (shift.status !== "Cancelled") {
      const day = draftsByDate.get(shift.date) ?? [];
      day.push(shift);
      draftsByDate.set(shift.date, day);
    }
  }
  for (const day of draftsByDate.values()) {
    for (const shift of day) {
      const clash = findOverlaps(
        {
          id: shift._id,
          date: shift.date,
          start: shift.start,
          end: shift.end,
          clientIds: shift.clientIds.map(String),
          staffIds: shift.staffIds.map(String),
        },
        day.map(other => ({
          id: other._id,
          date: other.date,
          start: other.start,
          end: other.end,
          clientIds: other.clientIds.map(String),
          staffIds: other.staffIds.map(String),
          status: other.status,
        }))
      );
      if (clash.participantConflict)
        problem(
          `${shift._id} double-books a participant with ${clash.participantConflict.id}.`
        );
      if (clash.staffConflict)
        problem(
          `${shift._id} double-books a team member with ${clash.staffConflict.id}.`
        );
    }
  }

  /* Service records */
  for (const record of records) {
    const label = record._id;
    const service = serviceById.get(String(record.serviceId));
    const participant = participantById.get(String(record.clientId));
    if (!participant)
      problem(`${label} belongs to a participant that does not exist.`);
    if (!staffById.has(String(record.staffId)))
      problem(`${label} was delivered by a team member that does not exist.`);
    if (!service) {
      problem(`${label} uses a service that does not exist.`);
      continue;
    }
    if (
      record.type !== service.name ||
      record.budgetCategory !== service.budgetCategory ||
      record.unit !== service.unit
    )
      problem(`${label} does not match its service "${service.name}".`);
    if (record.date > today) problem(`${label} is dated in the future.`);
    if ((record.km ?? 0) > 0 && !service.transportEnabled)
      problem(
        `${label} records kilometres for a service that does not allow travel.`
      );

    const expected = computeBillables(
      {
        start: record.start,
        end: record.end,
        km: record.km ?? 0,
        quantity: record.quantity,
      },
      service,
      workspace.providerTravelRateCents ?? DEFAULT_TRAVEL_RATE_CENTS
    );
    if (JSON.stringify(expected) !== JSON.stringify(record.billables))
      problem(
        `${label} has billable lines that differ from its hours, kilometres and rates.`
      );
    if (
      record.totalCents !==
      record.billables.reduce((sum, line) => sum + line.subtotalCents, 0)
    )
      problem(`${label} total does not equal the sum of its billable lines.`);

    const submitted = record.status !== "Draft" && record.status !== "Returned";
    const wasSubmitted = record.submittedAt !== null;
    if (record.status === "Draft" && wasSubmitted)
      problem(`${label} is a draft but has a submission time.`);
    if (submitted || record.status === "Returned") {
      if (!wasSubmitted || !record.submittedBy)
        problem(
          `${label} is ${record.status.toLowerCase()} without a submission.`
        );
      if (!record.confirmed)
        problem(
          `${label} is ${record.status.toLowerCase()} without the staff declaration.`
        );
      for (const section of NOTE_SECTIONS)
        if (!record[section]?.trim())
          problem(
            `${label} is ${record.status.toLowerCase()} but its "${section}" note is empty.`
          );
    }
    if (submitted && !record.billablesFrozenAt)
      problem(
        `${label} is ${record.status.toLowerCase()} but its billing is not frozen.`
      );
    if (
      (record.status === "Approved" || record.status === "Invoiced") &&
      (!record.approvedBy || !record.reviewedAt)
    )
      problem(
        `${label} is ${record.status.toLowerCase()} without an approver.`
      );
    if (
      record.status === "Returned" &&
      (!record.correction.trim() || !record.returnedAt)
    )
      problem(`${label} is returned without a correction request.`);
    if (
      record.status === "Draft" &&
      record.correction.trim() &&
      !record.returnedAt
    )
      problem(`${label} has a correction request but was never returned.`);

    if (record.status === "Invoiced") {
      const invoice = record.invoiceId
        ? invoiceById.get(record.invoiceId)
        : undefined;
      if (!invoice)
        problem(`${label} is invoiced but its invoice does not exist.`);
      else {
        if (!invoice.recordIds.includes(label))
          problem(`${label} points at ${invoice._id}, which does not list it.`);
        if (!sameId(invoice.clientId, record.clientId))
          problem(
            `${label} is on ${invoice._id}, which belongs to a different participant.`
          );
        if (invoice.status === "Void")
          problem(
            `${label} is still attached to the voided invoice ${invoice._id}.`
          );
      }
    } else if (record.invoiceId) {
      problem(`${label} is ${record.status.toLowerCase()} but has an invoice.`);
    }

    if (record.shiftId) {
      const shift = shiftById.get(record.shiftId);
      if (!shift)
        problem(`${label} points at ${record.shiftId}, which does not exist.`);
    }
    /*
     * Both timestamps hold only the most recent event of their kind, so a record that was
     * returned and sent back in carries a submission that is newer than its last review.
     * Submission must follow review only while a review is still the latest word on it.
     */
    const ordered: Array<[string, Date, string, Date]> = [];
    if (record.submittedAt)
      ordered.push([
        "submitted",
        record.submittedAt,
        "created",
        record.createdAt,
      ]);
    if (record.reviewedAt) {
      ordered.push([
        "reviewed",
        record.reviewedAt,
        "created",
        record.createdAt,
      ]);
      if (record.status !== "Submitted" && record.submittedAt)
        ordered.push([
          "reviewed",
          record.reviewedAt,
          "submitted",
          record.submittedAt,
        ]);
    }
    for (const [name, when, before, earlier] of ordered) {
      if (when < earlier)
        problem(
          `${label} has workflow times out of order: ${name} ${when.toISOString()} is before ${before} ${earlier.toISOString()}.`
        );
    }
    if (
      [record.createdAt, record.submittedAt, record.reviewedAt].some(
        stamp => stamp instanceof Date && stamp > now
      )
    )
      problem(`${label} has a timestamp in the future.`);
    const history = record.history.map(entry => entry.at.getTime());
    if (history.some((time, i) => i > 0 && time < history[i - 1]))
      problem(`${label} has history entries out of order.`);
    if (record.history[0]?.action !== "created")
      problem(`${label} history does not start with its creation.`);
  }

  /* Invoices */
  for (const invoice of invoices) {
    const label = invoice._id;
    const participant = participantById.get(String(invoice.clientId));
    if (!participant)
      problem(`${label} belongs to a participant that does not exist.`);
    if (!invoice.recordIds.length) problem(`${label} has no service records.`);
    if (!label.includes(`-${invoice.issue.slice(0, 4)}-`))
      problem(
        `${label} was issued in ${invoice.issue.slice(0, 4)}, which its number does not reflect.`
      );
    let linesTotal = 0;
    for (const id of invoice.recordIds) {
      const record = recordById.get(id);
      if (!record) {
        problem(`${label} lists ${id}, which does not exist.`);
        continue;
      }
      if (!sameId(record.clientId, invoice.clientId))
        problem(
          `${label} includes ${id}, which belongs to a different participant.`
        );
      if (
        invoice.status !== "Void" &&
        (record.invoiceId !== label || record.status !== "Invoiced")
      )
        problem(
          `${label} includes ${id}, which is ${record.status.toLowerCase()} and not on this invoice.`
        );
      // Lines are grouped by support type and rate, so several records can share one line.
      // The amounts therefore have to agree in total rather than record by record.
      linesTotal += record.totalCents;
    }
    const billed = invoice.lines.reduce(
      (sum, line) => sum + line.subtotalCents,
      0
    );
    if (billed !== linesTotal)
      problem(
        `${label} bills ${(billed / 100).toFixed(2)} but its records total ${(linesTotal / 100).toFixed(2)}.`
      );
    if (invoice.lines.some(line => !invoice.recordIds.includes(line.recordId)))
      problem(`${label} has lines for records that are not on the invoice.`);
    if (invoice.subtotalCents !== billed)
      problem(`${label} subtotal does not equal its lines.`);
    if (invoice.totalCents !== invoice.subtotalCents + invoice.taxCents)
      problem(`${label} total does not equal subtotal plus tax.`);
    if (invoice.due !== addDays(invoice.issue, invoice.paymentTermsDays))
      problem(`${label} due date does not match its payment terms.`);
    if (
      (invoice.status === "Sent" || invoice.status === "Paid") &&
      !invoice.sentAt
    )
      problem(
        `${label} is ${invoice.status.toLowerCase()} without a sent time.`
      );
    if (
      invoice.status === "Paid" &&
      (!invoice.paidAt || !invoice.paidOn || invoice.paidOn < invoice.issue)
    )
      problem(`${label} is paid without a valid payment date.`);
    if (invoice.status !== "Paid" && invoice.paidOn)
      problem(
        `${label} has a payment date but is ${invoice.status.toLowerCase()}.`
      );
    if (invoice.status === "Draft" && invoice.sentAt)
      problem(`${label} is a draft but has a sent time.`);
    if (invoice.issue > today) problem(`${label} is issued in the future.`);
    if (invoice.history[0]?.action !== "created")
      problem(`${label} history does not start with its creation.`);
  }

  /* Budgets fund what has been delivered and planned */
  for (const participant of participants) {
    if (participant.status !== "Active") continue;
    const budget = currentBudget.get(String(participant._id));
    if (!budget) continue;
    const metrics = computeBudgetMetrics({
      planStart: budget.planStart,
      planEnd: budget.planEnd,
      today,
      categories: budget.categories,
      records: records
        .filter(r => sameId(r.clientId, participant._id))
        .map(r => ({
          date: r.date,
          status: r.status,
          category: r.budgetCategory,
          totalCents: r.totalCents,
        })),
      shifts: shifts
        .filter(s => s.clientIds.some(id => sameId(id, participant._id)))
        .flatMap(s => {
          const service = serviceById.get(String(s.serviceId));
          return service
            ? [
                {
                  date: s.date,
                  status: s.status,
                  category: service.budgetCategory,
                  costCents: shiftCostCents(s, service),
                },
              ]
            : [];
        }),
    });
    for (const category of metrics.categories) {
      if (category.remainingCents < 0)
        problem(
          `${participant.preferred}'s "${category.name}" budget is overspent (${(category.remainingCents / 100).toFixed(2)} remaining).`
        );
    }
  }

  /* Counters stay ahead of the ids in use */
  const counter = (key: string) => counters.find(c => c._id === key)?.seq ?? 0;
  const highest = (ids: string[], base = 0) =>
    Math.max(
      0,
      ...ids.map(id => Number(id.replace(/\D+/g, "").slice(-6)) - base)
    );
  if (
    counter("serviceRecord") <
    highest(
      records.map(r => r._id),
      1000
    )
  )
    problem("The service record counter is behind the ids in use.");
  if (
    counter("shift") <
    highest(
      shifts.map(s => s._id),
      2400
    )
  )
    problem("The shift counter is behind the ids in use.");
  if (
    counter("participant") <
    Math.max(0, ...participants.map(p => p.clientNumber))
  )
    problem("The participant counter is behind the client numbers in use.");
  for (const year of new Set(invoices.map(i => i._id.split("-")[1]))) {
    const numbers = invoices
      .filter(i => i._id.split("-")[1] === year)
      .map(i => Number(i._id.split("-")[2]));
    if (counter(`invoice:${year}`) < Math.max(...numbers))
      problem(`The ${year} invoice counter is behind the numbers in use.`);
  }

  /* Audit log points at real participants */
  for (const entry of activities) {
    if (
      entry.participantId &&
      !participantById.has(String(entry.participantId))
    )
      problem("An audit entry points at a participant that does not exist.");
    if (entry.at > now) problem("An audit entry is dated in the future.");
  }

  const tally = <T extends { status: string }>(rows: T[], prefix: string) =>
    Object.fromEntries(
      [...new Set(rows.map(row => row.status))].map(status => [
        `${prefix}.${status}`,
        rows.filter(row => row.status === status).length,
      ])
    );
  return {
    problems,
    counts: {
      participants: participants.length,
      staff: staff.length,
      services: services.length,
      budgets: budgets.length,
      shifts: shifts.length,
      records: records.length,
      invoices: invoices.length,
      ...tally(participants, "participants"),
      ...tally(shifts, "shifts"),
      ...tally(records, "records"),
      ...tally(invoices, "invoices"),
    },
  };
}
