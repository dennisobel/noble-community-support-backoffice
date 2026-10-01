import type { Collection } from "mongoose";
import type { ActorRef } from "@shared/dto";
import { computeBudgetMetrics } from "@shared/logic/budget";
import { fromCents } from "@shared/logic/money";
import {
  addDays,
  addMonths,
  daysBetween,
  minutesOf,
  startOfMonth,
  startOfWeek,
  todayIn,
  ymdIn,
  zonedStartOfDay,
} from "@shared/logic/time";
import {
  budgetSetupSchema,
  invoiceCreateSchema,
  invoiceMarkPaidSchema,
  invoiceMarkSentSchema,
  participantArchiveSchema,
  participantCreateSchema,
  recordCreateSchema,
  recordReturnSchema,
  recordUpdateSchema,
  serviceCreateSchema,
  shiftCreateSchema,
  shiftStatusSchema,
  staffCreateSchema,
  staffUpdateSchema,
} from "@shared/schemas";
import { config } from "../config";
import type { RequestContext } from "../lib/http";
import { getWorkspace, invalidateWorkspaceCache } from "../lib/workspace";
import {
  Activity,
  Budget,
  BudgetAdjustment,
  Counter,
  Invoice,
  Participant,
  RosterShift,
  Service,
  ServiceRecord,
  Staff,
  User,
  type RosterShiftDoc,
  type ServiceDoc,
  type ServiceRecordDoc,
  type UserDoc,
} from "../models";
import {
  renewBudget,
  setupBudget,
  shiftCostCents,
} from "../modules/budgets/service";
import {
  createInvoice,
  markPaid,
  markReady,
  markSent,
} from "../modules/invoices/service";
import {
  archiveParticipant,
  createParticipant,
} from "../modules/participants/service";
import {
  approveRecord,
  createRecord,
  returnRecord,
  submitRecord,
  updateRecord,
} from "../modules/records/service";
import {
  changeShiftStatus,
  createRecordsFromShift,
  createShift,
} from "../modules/roster/service";
import { createService } from "../modules/services/service";
import { createStaff, updateStaff } from "../modules/staff/service";
import { checkIntegrity, type IntegrityReport } from "./integrity";
import {
  AD_HOC,
  GENERIC_SCRIPTS,
  LOCATION_KIND,
  LOCATION_KM,
  PARTICIPANTS,
  PATTERNS,
  PERSONAL_SCRIPTS,
  RETURN_CASES,
  SERVICES,
  STAFF,
  type NoteScript,
  type ParticipantKey,
  type ParticipantSeed,
  type ServiceKey,
  type ShiftPattern,
  type StaffKey,
} from "./sample-data";

/** Marks every audit entry written by the sample seed so it can be recognised (and removed) later. */
const SEED_IP = "sample-seed";
const HISTORY_WEEKS = 13;
const FUTURE_WEEKS = 2;

export interface SampleSeedOptions {
  /** Email of the Admin the data is attached to. Optional when there is exactly one Admin. */
  adminEmail?: string;
  log?: (message: string) => void;
}

export interface SampleSeedResult {
  adminEmail: string;
  report: IntegrityReport;
}

type CounterRow = { _id: string; seq: number };

/* ───────────── Small helpers ───────────── */

function hashString(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Deterministic random numbers, so the same workspace is produced on every run. */
function rng(key: string): () => number {
  let a = hashString(key);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const between = (random: () => number, min: number, max: number) =>
  min + Math.floor(random() * (max - min + 1));
const pick = <T>(random: () => number, items: T[]): T =>
  items[Math.floor(random() * items.length)];

const weekday = (ymd: string) => new Date(`${ymd}T00:00:00Z`).getUTCDay();
const nextBusinessDay = (ymd: string) => {
  const day = weekday(ymd);
  return addDays(ymd, day === 5 ? 3 : day === 6 ? 2 : 1);
};
const addBusinessDays = (ymd: string, count: number) => {
  let day = ymd;
  for (let i = 0; i < count; i += 1) day = nextBusinessDay(day);
  return day;
};
const businessDayOnOrAfter = (ymd: string) => {
  const day = weekday(ymd);
  return day === 6 ? addDays(ymd, 2) : day === 0 ? addDays(ymd, 1) : ymd;
};
const endOfMonth = (ymd: string) =>
  addDays(addMonths(startOfMonth(ymd), 1), -1);

const context = (actor: ActorRef): RequestContext => ({
  actor,
  ip: SEED_IP,
  requestId: "sample-seed",
});

/* ───────────── Dating history ───────────── */

const COLLECTIONS = {
  participants: Participant,
  staff: Staff,
  services: Service,
  budgets: Budget,
  shifts: RosterShift,
  records: ServiceRecord,
  invoices: Invoice,
} as const;
type Touch = keyof typeof COLLECTIONS;

/** Collects the path of every Date written during the call (>= since), wherever it sits in the document. */
function collectStale(
  value: unknown,
  since: Date,
  path: string,
  out: string[]
): void {
  if (value instanceof Date) {
    if (value >= since) out.push(path);
  } else if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectStale(item, since, `${path}.${index}`, out)
    );
  } else if (
    value &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    for (const [key, child] of Object.entries(value))
      collectStale(child, since, path ? `${path}.${key}` : key, out);
  }
}

/**
 * The services stamp "now" on everything they write. This returns a runner that executes a service call
 * and then dates everything it wrote (documents and audit entries) at the moment it would really have
 * happened, never later than `latest`.
 */
function makeStamper(latest: Date) {
  return async function stamped<T>(
    when: Date,
    touches: Touch[],
    run: () => Promise<T>
  ): Promise<T> {
    const target = when > latest ? latest : when;
    const since = new Date();
    const result = await run();
    await Activity.updateMany(
      { at: { $gte: since } },
      { $set: { at: target } }
    );
    for (const touch of touches) {
      const collection: Collection = COLLECTIONS[touch].collection;
      const docs = await collection
        .find({ updatedAt: { $gte: since } })
        .toArray();
      for (const doc of docs) {
        const paths: string[] = [];
        collectStale(doc, since, "", paths);
        if (!paths.length) continue;
        await collection.updateOne(
          { _id: doc._id },
          { $set: Object.fromEntries(paths.map(path => [path, target])) }
        );
      }
    }
    return result;
  };
}

/* ───────────── Preconditions and clean-up ───────────── */

async function findAdmin(email?: string): Promise<UserDoc> {
  if (email) {
    const admin = await User.findOne({
      email: email.trim().toLowerCase(),
      role: "admin",
    }).lean<UserDoc>();
    if (!admin) throw new Error(`No Admin account with the email ${email}.`);
    return admin;
  }
  const admins = await User.find({ role: "admin" }).limit(2).lean<UserDoc[]>();
  if (admins.length === 0)
    throw new Error(
      "There is no Admin account yet. Set up the workspace first (or run create-admin)."
    );
  if (admins.length > 1)
    throw new Error(
      "There is more than one Admin. Pass --email to choose one."
    );
  return admins[0];
}

async function assertNoBusinessData(): Promise<void> {
  const counts = await Promise.all([
    Participant.estimatedDocumentCount(),
    Staff.estimatedDocumentCount(),
    Service.estimatedDocumentCount(),
    Budget.estimatedDocumentCount(),
    RosterShift.estimatedDocumentCount(),
    ServiceRecord.estimatedDocumentCount(),
    Invoice.estimatedDocumentCount(),
  ]);
  if (counts.some(count => count > 0))
    throw new Error(
      "This workspace already has clients, staff, services or records. Sample data is only added to an empty workspace, so nothing was changed."
    );
}

/** Undoes a failed run. The workspace was verified empty at the start, so everything here is the seed's own. */
async function removeSampleData(counters: CounterRow[]): Promise<void> {
  await Promise.all([
    Participant.deleteMany({}),
    Staff.deleteMany({}),
    Service.deleteMany({}),
    Budget.deleteMany({}),
    BudgetAdjustment.deleteMany({}),
    RosterShift.deleteMany({}),
    ServiceRecord.deleteMany({}),
    Invoice.deleteMany({}),
    Activity.deleteMany({ ip: SEED_IP }),
  ]);
  await Counter.deleteMany({});
  if (counters.length) await Counter.insertMany(counters);
}

/**
 * Adds a realistic sample workspace to an empty one: team, services, clients, a 13-week roster history and
 * two weeks ahead, service records at every stage of review, invoices at every stage of payment and plan
 * budgets. Everything is created through the same services the API uses, so ids, counters, links, billing
 * and the audit log are exactly what the app would have produced. Rolls back completely if anything fails.
 */
export async function seedSampleData(
  options: SampleSeedOptions = {}
): Promise<SampleSeedResult> {
  if (config().production)
    throw new Error("Refusing to load sample data in production.");
  const log = options.log ?? (() => undefined);
  const admin = await findAdmin(options.adminEmail);
  await assertNoBusinessData();
  const counterSnapshot = await Counter.find().lean<CounterRow[]>();
  try {
    await populate(admin, log);
    const report = await checkIntegrity();
    if (report.problems.length)
      throw new Error(
        `The sample data failed its consistency check:\n  ${report.problems.slice(0, 15).join("\n  ")}`
      );
    return { adminEmail: admin.email, report };
  } catch (error) {
    log("Something went wrong; removing the partly created sample data…");
    await removeSampleData(counterSnapshot);
    throw error;
  }
}

/* ───────────── The seed ───────────── */

interface PlannedShift {
  pattern: ShiftPattern;
  date: string;
  location: string;
  notes: string;
  cancelled: boolean;
}

interface RecordState {
  clientKey: ParticipantKey;
  date: string;
  approvedAt: Date | null;
  invoiced: boolean;
}

interface BillingRun {
  seed: ParticipantSeed;
  issue: string;
  cutoff: string;
}

async function populate(
  admin: UserDoc,
  log: (message: string) => void
): Promise<void> {
  invalidateWorkspaceCache();
  const workspace = await getWorkspace();
  const tz = workspace.timezone;
  const now = new Date();
  const latest = new Date(now.getTime() - 60_000);
  const stamped = makeStamper(latest);
  const today = todayIn(tz, now);
  const thisMonday = startOfWeek(today);
  const historyStart = addDays(thisMonday, -HISTORY_WEEKS * 7);
  const weekDate = (week: number, day: number) =>
    addDays(thisMonday, week * 7 + day);

  const at = (ymd: string, time: string | number): Date =>
    new Date(
      zonedStartOfDay(ymd, tz).getTime() +
        (typeof time === "number" ? time : minutesOf(time)) * 60_000
    );
  const later = (instant: Date, minutes: number) =>
    new Date(instant.getTime() + minutes * 60_000);
  /** Keeps a date between a floor and the present. */
  const bound = (value: Date, floor: Date) =>
    new Date(
      Math.min(Math.max(value.getTime(), floor.getTime()), latest.getTime())
    );
  const localDay = (instant: Date) => ymdIn(tz, instant);

  const adminActor: ActorRef = { id: String(admin._id), name: admin.name };
  const adminCtx = context(adminActor);

  /* ── Team and services, set up before the first week of history ── */
  log("Adding team members and services…");
  const setupAt = at(addDays(historyStart, -75), "09:00");
  const staffId = {} as Record<StaffKey, string>;
  const staffActor = {} as Record<StaffKey, ActorRef>;
  for (const row of STAFF) {
    const dto = await stamped(setupAt, ["staff"], () =>
      createStaff(
        staffCreateSchema.parse({
          name: row.name,
          position: row.position,
          team: row.team,
          email: row.email,
          phone: row.phone,
          notes: row.notes,
        }),
        adminCtx
      )
    );
    staffId[row.key] = dto.id;
    staffActor[row.key] = { id: dto.id, name: dto.name };
  }
  const serviceId = {} as Record<ServiceKey, string>;
  for (const row of SERVICES) {
    const dto = await stamped(later(setupAt, 30), ["services"], () =>
      createService(
        serviceCreateSchema.parse({
          name: row.name,
          unit: row.unit,
          rate: row.rate,
          transport: row.transport,
          active: row.active,
          budgetCategory: row.category,
          supportItemNumber: row.item,
        }),
        adminCtx
      )
    );
    serviceId[row.key] = dto.id;
  }
  const serviceRow = (key: ServiceKey) =>
    SERVICES.find(row => row.key === key)!;

  /* ── Clients. A renewed plan keeps the plan it replaced as history ── */
  log("Adding clients…");
  const monthStart = startOfMonth(today);
  const planStartOf = (monthsAgo: number) => addMonths(monthStart, -monthsAgo);
  const planEndOf = (start: string) => addDays(addMonths(start, 12), -1);
  const participantId = {} as Record<ParticipantKey, string>;
  const onboardedAt = {} as Record<ParticipantKey, Date>;
  for (const row of PARTICIPANTS) {
    const firstPlanStart = planStartOf(
      row.previousPlanMonthsAgo ?? row.planMonthsAgo
    );
    const created = bound(at(addDays(firstPlanStart, 1), "10:00"), setupAt);
    onboardedAt[row.key] = created;
    const dto = await stamped(created, ["participants"], () =>
      createParticipant(
        participantCreateSchema.parse({
          name: row.name,
          preferred: row.preferred,
          ndis: row.ndis,
          dob: row.dob,
          phone: row.phone,
          email: row.email,
          address: row.address,
          planStart: firstPlanStart,
          planEnd: planEndOf(firstPlanStart),
          manager: row.manager,
          managerEmail: row.managerEmail,
          nominee: row.nominee,
          emergencyName: row.emergencyName,
          emergencyPhone: row.emergencyPhone,
          alerts: row.alerts,
          goals: row.goals,
          communication: row.communication,
          mobility: row.mobility,
          transport: row.transport,
          support: row.support,
          risks: row.risks,
          allergies: row.allergies,
          preferences: row.preferences,
          kyc: row.kyc,
        }),
        adminCtx
      )
    );
    participantId[row.key] = dto.id;
  }
  const seedOf = (key: ParticipantKey) =>
    PARTICIPANTS.find(row => row.key === key)!;

  /* ── The roster: the standing weekly pattern over the history and the coming two weeks ── */
  const planned: PlannedShift[] = [];
  let cancellableSeen = 0;
  for (let week = -HISTORY_WEEKS; week <= FUTURE_WEEKS; week += 1) {
    for (const pattern of PATTERNS) {
      const from = pattern.fromWeek ?? -HISTORY_WEEKS;
      if (week < from || week > (pattern.toWeek ?? FUTURE_WEEKS)) continue;
      if (pattern.onlyWeek !== undefined && week !== pattern.onlyWeek) continue;
      const every = pattern.every ?? 1;
      const step = week - from - (pattern.offset ?? 0);
      if (((step % every) + every) % every !== 0) continue;
      for (const key of pattern.clients) {
        const { startWeek, endWeek } = seedOf(key);
        if (week < startWeek || week > (endWeek ?? FUTURE_WEEKS))
          throw new Error(
            `${pattern.id} schedules ${key} outside their service dates.`
          );
      }
      const date = weekDate(week, pattern.day);
      const random = rng(`shift:${pattern.id}:${date}`);
      // A few finished one-to-one shifts fell through: every 28th such shift, so there are always some.
      const cancellable =
        at(date, pattern.end) <= now &&
        pattern.ratio === "1:1" &&
        pattern.service !== "coord" &&
        pattern.service !== "review";
      const cancelled = cancellable && cancellableSeen++ % 28 === 27;
      planned.push({
        pattern,
        date,
        location:
          pattern.locations[
            (week + HISTORY_WEEKS + hashString(pattern.id)) %
              pattern.locations.length
          ],
        notes: cancelled
          ? pick(random, [
              "Cancelled — participant unwell.",
              "Cancelled by the participant with 24 hours' notice.",
              "Cancelled — participant away.",
            ])
          : (pattern.notes ?? ""),
        cancelled,
      });
    }
  }
  planned.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.pattern.start.localeCompare(b.pattern.start) ||
      a.pattern.id.localeCompare(b.pattern.id)
  );

  log(`Building the roster (${planned.length} shifts)…`);
  const completed: Array<{ id: string; shift: PlannedShift; endedAt: Date }> =
    [];
  for (const shift of planned) {
    const { pattern } = shift;
    const random = rng(`plan:${pattern.id}:${shift.date}`);
    const notBefore = later(
      new Date(
        Math.max(
          setupAt.getTime(),
          ...pattern.clients.map(key => onboardedAt[key].getTime())
        )
      ),
      60
    );
    // Past shifts were planned a few days ahead; the coming weeks were rostered over the last week or so.
    const upcoming = at(shift.date, pattern.end) > now;
    const createdAt = bound(
      at(
        upcoming
          ? addDays(today, -between(random, 1, 9))
          : addDays(shift.date, -between(random, 3, 6)),
        between(random, 9 * 60, 16 * 60)
      ),
      notBefore
    );
    const dto = await stamped(createdAt, ["shifts"], () =>
      createShift(
        shiftCreateSchema.parse({
          date: shift.date,
          start: pattern.start,
          end: pattern.end,
          ratio: pattern.ratio,
          clientIds: pattern.clients.map(key => participantId[key]),
          staffIds: pattern.staff.map(key => staffId[key]),
          serviceId: serviceId[pattern.service],
          location: shift.location,
          notes: shift.notes,
        }),
        adminCtx
      )
    );
    const endedAt = at(shift.date, pattern.end);
    const setStatus = (
      status: "Confirmed" | "Completed" | "Cancelled",
      when: Date
    ) =>
      stamped(when, ["shifts"], () =>
        changeShiftStatus(dto.id, shiftStatusSchema.parse({ status }), adminCtx)
      );
    if (shift.cancelled) {
      await setStatus(
        "Cancelled",
        bound(at(addDays(shift.date, -1), 15 * 60), later(createdAt, 30))
      );
    } else if (endedAt <= now) {
      const confirmedAt = bound(
        at(addDays(shift.date, -1), 16 * 60),
        later(createdAt, 30)
      );
      await setStatus("Confirmed", confirmedAt);
      await setStatus("Completed", bound(later(endedAt, 5), confirmedAt));
      completed.push({ id: dto.id, shift, endedAt });
    } else if (shift.date <= addDays(today, 3)) {
      await setStatus(
        "Confirmed",
        bound(
          at(
            addDays(today, -between(random, 1, 3)),
            between(random, 9 * 60, 16 * 60)
          ),
          later(createdAt, 30)
        )
      );
    }
  }

  /* ── Service records: created from completed shifts (plus a few unrostered visits), then worked through review ── */
  log("Writing up service records…");
  const states = new Map<string, RecordState>();
  const scriptCounts = new Map<string, number>();
  let recentReviews = 0;

  const nextScript = (
    seed: ParticipantSeed,
    service: ServiceKey,
    location: string
  ): NoteScript => {
    const personal = PERSONAL_SCRIPTS[seed.key]?.[service] ?? [];
    const pool = personal.length ? personal : GENERIC_SCRIPTS[service];
    const kind = LOCATION_KIND[location];
    const fitting = pool.filter(
      item => !item.kinds || (kind && item.kinds.includes(kind))
    );
    const list = fitting.length ? fitting : pool;
    const key = `${seed.key}:${service}`;
    const count = scriptCounts.get(key) ?? 0;
    scriptCounts.set(key, count + 1);
    return list[count % list.length];
  };

  /** Notes, travel, submission, review and (sometimes) a return for one record, dated as they would have happened. */
  const workRecord = async (
    record: { id: string; staffId: string },
    seed: ParticipantSeed,
    service: ServiceKey,
    date: string,
    location: string,
    endedAt: Date
  ): Promise<void> => {
    const random = rng(`record:${record.id}`);
    const worker = (Object.keys(staffId) as StaffKey[]).find(
      key => staffId[key] === record.staffId
    )!;
    const workerCtx = context(staffActor[worker]);
    const script = nextScript(seed, service, location);
    const fill = (text: string) =>
      text
        .replaceAll("{n}", seed.preferred)
        .replaceAll("{loc}", location)
        .replaceAll("{goal}", seed.goals[0] ?? "the goals in the support plan");
    const notes = {
      support: fill(script.support),
      response: fill(script.response),
      outcome: fill(script.outcome),
      observations: fill(pick(random, script.observations)),
      followUp: fill(pick(random, script.followUp)),
    };
    const km = serviceRow(service).transport
      ? Math.round((LOCATION_KM[location] ?? 0) * (0.9 + random() * 0.2) * 10) /
        10
      : 0;
    // A client who has left is billed off promptly so their file can be closed.
    const fastTrack = Boolean(seed.archivedReason);
    const state: RecordState = {
      clientKey: seed.key,
      date,
      approvedAt: null,
      invoiced: false,
    };
    states.set(record.id, state);

    const neglected =
      daysBetween(date, today) >= 1 &&
      daysBetween(date, today) <= 6 &&
      random() < 0.15;
    const editAt = later(endedAt, between(random, 40, 180));
    const submitAt =
      random() < 0.7
        ? later(editAt, between(random, 5, 45))
        : at(addDays(date, 1), between(random, 8 * 60 + 20, 10 * 60 + 30));
    // Reviews happen in batches, one to three business days after submission.
    const lagRoll = random();
    const reviewLag = fastTrack ? 1 : lagRoll < 0.5 ? 1 : lagRoll < 0.8 ? 2 : 3;
    const reviewAt = at(
      addBusinessDays(localDay(submitAt), reviewLag),
      between(random, 9 * 60, 16 * 60 + 30)
    );
    const decision = !fastTrack && random() < 0.11 ? "return" : "approve";
    const returned = RETURN_CASES[Math.floor(random() * RETURN_CASES.length)];
    const fixAt = later(reviewAt, between(random, 60, 26 * 60));
    const resubmitAt = later(fixAt, between(random, 5, 30));
    const reapproveAt = at(
      nextBusinessDay(localDay(resubmitAt)),
      between(random, 9 * 60, 16 * 60 + 30)
    );

    if (neglected || editAt > now) return;
    await stamped(editAt, ["records"], () =>
      updateRecord(
        record.id,
        recordUpdateSchema.parse({ ...notes, km, confirmed: true }),
        workerCtx
      )
    );
    if (submitAt > now) return;
    await stamped(submitAt, ["records"], () =>
      submitRecord(record.id, undefined, workerCtx)
    );
    if (reviewAt > now) return;
    // Every fourth recent review is sent back and is still waiting on the worker's correction.
    const stalled = daysBetween(date, today) <= 8 && recentReviews++ % 4 === 1;
    if (decision === "approve" && !stalled) {
      await stamped(reviewAt, ["records"], () =>
        approveRecord(record.id, undefined, adminCtx)
      );
      state.approvedAt = reviewAt;
      return;
    }
    await stamped(reviewAt, ["records"], () =>
      returnRecord(
        record.id,
        recordReturnSchema.parse({ reason: returned.reason }),
        adminCtx
      )
    );
    if (stalled || fixAt > now) return;
    const addition = returned.addition.replaceAll(
      "{goal}",
      seed.goals[0] ?? "the support plan"
    );
    await stamped(fixAt, ["records"], () =>
      updateRecord(
        record.id,
        recordUpdateSchema.parse({
          [returned.field]: `${notes[returned.field]} ${addition}`,
        }),
        workerCtx
      )
    );
    if (resubmitAt > now) return;
    await stamped(resubmitAt, ["records"], () =>
      submitRecord(record.id, undefined, workerCtx)
    );
    if (reapproveAt > now) return;
    await stamped(reapproveAt, ["records"], () =>
      approveRecord(record.id, undefined, adminCtx)
    );
    state.approvedAt = reapproveAt;
  };

  const jobs: Array<{ at: Date; run: () => Promise<void> }> = [];
  for (const done of completed) {
    const { pattern, date, location } = done.shift;
    jobs.push({
      at: later(done.endedAt, 10),
      run: async () => {
        const created = await stamped(
          later(done.endedAt, 10),
          ["records", "shifts"],
          () => createRecordsFromShift(done.id, adminCtx)
        );
        for (const record of created) {
          const seed = PARTICIPANTS.find(
            row => participantId[row.key] === record.clientId
          )!;
          await workRecord(
            record,
            seed,
            pattern.service,
            date,
            location,
            done.endedAt
          );
        }
      },
    });
  }
  for (const item of AD_HOC) {
    const date = weekDate(-item.weeksAgo, item.day);
    const endedAt = at(date, item.end);
    if (endedAt > now) continue;
    jobs.push({
      at: later(endedAt, 15),
      run: async () => {
        const created = await stamped(later(endedAt, 15), ["records"], () =>
          createRecord(
            recordCreateSchema.parse({
              clientId: participantId[item.client],
              staffId: staffId[item.staff],
              serviceId: serviceId[item.service],
              date,
              start: item.start,
              end: item.end,
              location: item.location,
            }),
            context(staffActor[item.staff])
          )
        );
        await workRecord(
          created,
          seedOf(item.client),
          item.service,
          date,
          item.location,
          endedAt
        );
      },
    });
  }
  jobs.sort((a, b) => a.at.getTime() - b.at.getTime());
  for (const job of jobs) await job.run();
  log(`  ${states.size} service records`);

  /* ── Invoices: each billing run picks up the records approved before it, per participant ── */
  log("Raising invoices…");
  const runs: BillingRun[] = [];
  for (const seed of PARTICIPANTS) {
    if (seed.cadence === "monthly") {
      // On the second business day of each month, for everything up to the end of the month before.
      for (
        let month = addMonths(startOfMonth(historyStart), 2);
        month <= today;
        month = addMonths(month, 1)
      ) {
        const issue = nextBusinessDay(businessDayOnOrAfter(month));
        if (issue <= today)
          runs.push({ seed, issue, cutoff: endOfMonth(addMonths(month, -1)) });
      }
    } else {
      // Every second Monday, for everything up to the Friday before.
      for (let week = 0; week >= -HISTORY_WEEKS + 2; week -= 2) {
        const issue = weekDate(week, 0);
        runs.push({ seed, issue, cutoff: addDays(issue, -3) });
      }
    }
  }
  runs.sort(
    (a, b) =>
      a.issue.localeCompare(b.issue) ||
      PARTICIPANTS.indexOf(a.seed) - PARTICIPANTS.indexOf(b.seed)
  );
  const lastInvoiceOf = new Map<ParticipantKey, string>();
  let invoiceCount = 0;
  for (const run of runs) {
    const eligible = [...states.entries()]
      .filter(
        ([, state]) =>
          state.clientKey === run.seed.key &&
          !state.invoiced &&
          state.approvedAt !== null &&
          state.date <= run.cutoff &&
          state.approvedAt <= at(run.issue, 8 * 60)
      )
      .map(([id]) => id)
      .sort();
    if (!eligible.length) continue;
    const random = rng(`invoice:${run.seed.key}:${run.issue}`);
    const createdAt = bound(
      at(run.issue, between(random, 9 * 60, 9 * 60 + 40)),
      setupAt
    );
    const invoice = await stamped(createdAt, ["invoices", "records"], () =>
      createInvoice(
        invoiceCreateSchema.parse({
          clientId: participantId[run.seed.key],
          recordIds: eligible,
          issueDate: run.issue,
          paymentTermsDays: run.seed.terms,
        }),
        adminCtx
      )
    );
    for (const id of eligible) states.get(id)!.invoiced = true;
    lastInvoiceOf.set(run.seed.key, run.issue);
    invoiceCount += 1;

    // Recent invoices are still being prepared; older ones have been sent, and most have been paid.
    const age = daysBetween(run.issue, today);
    const paidOn = addDays(
      run.issue,
      run.seed.terms + run.seed.paymentHabit + between(random, -1, 1)
    );
    if (age <= 3) {
      if (run.seed.recentInvoice === "Draft") continue;
      await stamped(later(createdAt, 25), ["invoices"], () =>
        markReady(invoice.id, undefined, adminCtx)
      );
      continue;
    }
    await stamped(later(createdAt, 25), ["invoices"], () =>
      markReady(invoice.id, undefined, adminCtx)
    );
    const sentAt = later(createdAt, 70);
    await stamped(sentAt, ["invoices"], () =>
      markSent(invoice.id, invoiceMarkSentSchema.parse({}), adminCtx)
    );
    if (paidOn <= addDays(today, -1))
      await stamped(bound(at(paidOn, 14 * 60), sentAt), ["invoices"], () =>
        markPaid(
          invoice.id,
          invoiceMarkPaidSchema.parse({
            paidOn,
            reference: `REM-${between(random, 10000, 99999)}`,
          }),
          adminCtx
        )
      );
  }
  log(`  ${invoiceCount} invoices`);

  /* ── Plan budgets, sized from the activity so that they fund what was delivered and what is planned ── */
  log("Setting up plan budgets…");
  const services = await Service.find().lean<ServiceDoc[]>();
  const serviceById = new Map(
    services.map(service => [String(service._id), service])
  );
  const unusedCategory: Record<string, number> = {
    "Community participation": 6000,
    "Daily living skills": 4000,
    "Support coordination": 3000,
  };
  const allocationsFor = async (
    seed: ParticipantSeed,
    planStart: string,
    planEnd: string,
    utilisation: number
  ) => {
    const [records, shifts] = await Promise.all([
      ServiceRecord.find({
        clientId: participantId[seed.key],
        status: { $in: ["Submitted", "Approved", "Invoiced"] },
      }).lean<ServiceRecordDoc[]>(),
      RosterShift.find({
        clientIds: participantId[seed.key],
        status: { $in: ["Planned", "Confirmed"] },
      }).lean<RosterShiftDoc[]>(),
    ]);
    const metrics = computeBudgetMetrics({
      planStart,
      planEnd,
      today,
      categories: seed.categories.map(name => ({ name, allocationCents: 0 })),
      records: records.map(record => ({
        date: record.date,
        status: record.status,
        category: record.budgetCategory,
        totalCents: record.totalCents,
      })),
      shifts: shifts.flatMap(shift => {
        const service = serviceById.get(String(shift.serviceId));
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
    const step = utilisation >= 0.9 ? 1_000 : 50_000;
    return metrics.categories.map(category => {
      const spend =
        category.usedCents + category.pendingCents + category.committedCents;
      const cents = spend
        ? Math.ceil(spend / utilisation / step) * step
        : (unusedCategory[category.name] ?? 2000) * 100;
      return { name: category.name, allocation: fromCents(cents) };
    });
  };
  for (const seed of PARTICIPANTS) {
    const plans: Array<{
      start: string;
      setUp: Date;
      renew: boolean;
      utilisation: number;
    }> = [];
    if (seed.previousPlanMonthsAgo !== undefined) {
      const start = planStartOf(seed.previousPlanMonthsAgo);
      plans.push({
        start,
        setUp: at(addDays(start, 2), "11:00"),
        renew: false,
        utilisation: seed.previousUtilisation ?? seed.utilisation,
      });
    }
    const start = planStartOf(seed.planMonthsAgo);
    const renewed = seed.previousPlanMonthsAgo !== undefined;
    plans.push({
      start,
      setUp: at(addDays(start, renewed ? -5 : 2), "11:00"),
      renew: renewed,
      utilisation: seed.utilisation,
    });
    for (const plan of plans) {
      const end = planEndOf(plan.start);
      const input = budgetSetupSchema.parse({
        planStart: plan.start,
        planEnd: end,
        categories: await allocationsFor(
          seed,
          plan.start,
          end,
          plan.utilisation
        ),
        confirmedAgainstPlan: true,
      });
      await stamped(
        bound(plan.setUp, onboardedAt[seed.key]),
        ["budgets", "participants"],
        () =>
          plan.renew
            ? renewBudget(participantId[seed.key], input, adminCtx)
            : setupBudget(participantId[seed.key], input, adminCtx)
      );
    }
  }

  /* ── How things stand today ── */
  log("Finishing up…");
  await stamped(bound(at(weekDate(-3, 0), "09:00"), setupAt), ["staff"], () =>
    updateStaff(
      staffId.sam,
      staffUpdateSchema.parse({ status: "On leave" }),
      adminCtx
    )
  );
  for (const seed of PARTICIPANTS.filter(row => row.archivedReason)) {
    const lastService = weekDate(seed.endWeek ?? 0, 4);
    const closedOn = nextBusinessDay(
      addDays(
        [lastService, lastInvoiceOf.get(seed.key) ?? lastService]
          .sort()
          .at(-1)!,
        2
      )
    );
    await stamped(
      bound(at(closedOn, "10:00"), onboardedAt[seed.key]),
      ["participants"],
      () =>
        archiveParticipant(
          participantId[seed.key],
          participantArchiveSchema.parse({ reason: seed.archivedReason }),
          adminCtx
        )
    );
  }
}
