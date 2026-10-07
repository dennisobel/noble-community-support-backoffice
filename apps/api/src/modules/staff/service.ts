import type { Types } from "mongoose";
import type { z } from "zod";
import type { StaffApplicationDTO, StaffDTO, WithWarnings } from "@shared/dto";
import type { StaffAccountStatus } from "@shared/enums";
import { initialsOf } from "@shared/logic/ndis";
import { MESSAGES } from "@shared/messages";
import type {
  staffCreateSchema,
  staffListQuery,
  staffUpdateSchema,
} from "@shared/schemas/staff";
import type {
  applicationReviewSchema,
  staffDetailsSchema,
} from "@shared/schemas/staff-portal";
import { logActivity } from "../../lib/audit";
import { errors, isDuplicateKey } from "../../lib/errors";
import { escapeRegex, type RequestContext } from "../../lib/http";
import { actorDTO, assertRev, isoRequired } from "../../lib/mappers";
import { workspaceToday } from "../../lib/workspace";
import {
  RosterShift,
  Staff,
  StaffApplication,
  StaffProfile,
  User,
  type StaffApplicationDoc,
  type StaffDoc,
  type StaffProfileDoc,
  type UserDoc,
} from "../../models";
import { inviteStaffAccount, type InviteResult } from "../auth/service";
import { paySettingsDoc } from "../payroll/settings";
import {
  checklistItemsDTO,
  checklistProgress,
  defaultChecklist,
  type ChecklistProgress,
} from "../portal/checklist";

/** Access state derived from the linked account and any application for the same email. */
function accountStatusOf(
  staff: StaffDoc,
  account: Pick<UserDoc, "status" | "invitation"> | undefined,
  application: StaffApplicationDoc | undefined
): StaffAccountStatus {
  if (staff.userId && account) {
    if (account.status === "disabled") return "Disabled";
    return account.invitation?.acceptedAt ? "Active" : "Invited";
  }
  if (application?.status === "Pending") return "Pending approval";
  if (application?.status === "Rejected") return "Rejected";
  return "No access";
}

export function toStaffDTO(
  staff: StaffDoc,
  extras: {
    progress?: ChecklistProgress;
    accountStatus?: StaffAccountStatus;
    lastLoginAt?: string | null;
    /** Classification names by id, so the directory can show one without knowing any rate. */
    classifications?: Map<string, string>;
  } = {}
): StaffDTO {
  const progress = extras.progress ?? {
    approved: 0,
    total: 0,
    completePct: 0,
    expiring: 0,
    expired: 0,
    nextExpiry: null,
  };
  return {
    id: String(staff._id),
    name: staff.name,
    initials: initialsOf(staff.name),
    position: staff.position,
    team: staff.team,
    email: staff.email,
    phone: staff.phone ?? "",
    status: staff.status,
    notes: staff.notes ?? "",
    accountStatus:
      extras.accountStatus ?? (staff.userId ? "Invited" : "No access"),
    userId: staff.userId ? String(staff.userId) : null,
    lastLoginAt: extras.lastLoginAt ?? null,
    checklist: progress,
    employment: {
      type: staff.employment?.kind ?? null,
      classificationId: staff.employment?.classificationId ?? null,
      classificationName:
        extras.classifications?.get(
          staff.employment?.classificationId ?? ""
        ) ?? "",
      contractedHours: staff.employment?.contractedHours ?? 0,
      payrollId: staff.employment?.payrollId ?? "",
    },
    createdAt: isoRequired(staff.createdAt),
    updatedAt: isoRequired(staff.updatedAt),
    rev: staff.rev ?? 0,
  };
}

const duplicateEmail = () =>
  errors.conflict(
    "EMAIL_DUPLICATE",
    "A team member with this email address already exists."
  );

/** Loads the checklist, account and application context for a set of team members. */
async function contextFor(staff: StaffDoc[], today: string) {
  const ids = staff.map(member => member._id);
  const emails = staff.map(member => member.email);
  const [profiles, accounts, applications, pay] = await Promise.all([
    StaffProfile.find({ staffId: { $in: ids } }).lean<StaffProfileDoc[]>(),
    User.find({ staffId: { $in: ids } })
      .select("staffId status invitation lastLoginAt")
      .lean<
        Array<
          Pick<UserDoc, "staffId" | "status" | "invitation" | "lastLoginAt"> & {
            _id: Types.ObjectId;
          }
        >
      >(),
    StaffApplication.find({ email: { $in: emails } })
      .sort({ createdAt: -1 })
      .lean<StaffApplicationDoc[]>(),
    paySettingsDoc(),
  ]);
  const classifications = new Map(
    (pay.classifications ?? []).map(item => [item.id, item.name])
  );
  const profileByStaff = new Map(
    profiles.map(profile => [String(profile.staffId), profile])
  );
  const accountByStaff = new Map(
    accounts.map(account => [String(account.staffId), account])
  );
  const applicationByEmail = new Map<string, StaffApplicationDoc>();
  for (const application of applications)
    if (!applicationByEmail.has(application.email))
      applicationByEmail.set(application.email, application);
  return staff.map(member => {
    const items = checklistItemsDTO(
      member,
      profileByStaff.get(String(member._id)) ?? null,
      today
    );
    const account = accountByStaff.get(String(member._id));
    return toStaffDTO(member, {
      progress: checklistProgress(items),
      accountStatus: accountStatusOf(
        member,
        account,
        applicationByEmail.get(member.email)
      ),
      lastLoginAt: account?.lastLoginAt
        ? account.lastLoginAt.toISOString()
        : null,
      classifications,
    });
  });
}

interface EmploymentInput {
  employmentType?: StaffDTO["employment"]["type"] | "";
  classificationId?: string | null;
  contractedHours?: number;
  payrollId?: string;
}

/** The employment fields of a create or update. Only the ones that were sent are returned. */
async function employmentChanges(
  input: EmploymentInput
): Promise<Partial<StaffDoc["employment"] & object>> {
  const changes: Partial<StaffDoc["employment"] & object> = {};
  if (input.employmentType !== undefined)
    changes.kind = input.employmentType || null;
  if (input.classificationId !== undefined) {
    const id = input.classificationId || null;
    if (id) {
      const pay = await paySettingsDoc();
      if (!(pay.classifications ?? []).some(item => item.id === id))
        throw errors.validation(
          "Choose a classification from the list in Pay rules.",
          [{ path: "classificationId", message: "Unknown classification." }]
        );
    }
    changes.classificationId = id;
  }
  if (input.contractedHours !== undefined)
    changes.contractedHours = input.contractedHours;
  if (input.payrollId !== undefined) changes.payrollId = input.payrollId;
  return changes;
}

export async function listStaff(
  query: z.output<typeof staffListQuery>
): Promise<StaffDTO[]> {
  const filter: Record<string, unknown> = {};
  if (query.status === "assignable") filter.status = "Active";
  else if (query.status !== "all") filter.status = query.status;
  if (query.team) filter.team = query.team;
  if (query.q) {
    const pattern = new RegExp(escapeRegex(query.q), "i");
    filter.$or = [
      { name: pattern },
      { email: pattern },
      { position: pattern },
      { team: pattern },
    ];
  }
  const staff = await Staff.find(filter).sort({ name: 1 }).lean<StaffDoc[]>();
  return contextFor(staff, await workspaceToday());
}

export async function getStaff(id: string): Promise<StaffDTO> {
  const staff = await Staff.findById(id).lean<StaffDoc>();
  if (!staff) throw errors.notFound("Team member");
  const [dto] = await contextFor([staff], await workspaceToday());
  return dto!;
}

export async function createStaff(
  input: z.output<typeof staffCreateSchema>,
  ctx: RequestContext
): Promise<StaffDTO & { invite?: InviteResult }> {
  const employment = await employmentChanges(input);
  try {
    const created = await Staff.create({
      name: input.name,
      position: input.position,
      team: input.team,
      email: input.email,
      phone: input.phone ?? "",
      status: input.status ?? "Active",
      notes: input.notes ?? "",
      transportsParticipants: input.transportsParticipants ?? false,
      employment: {
        kind: null,
        classificationId: null,
        contractedHours: 0,
        payrollId: "",
        payRateOverrideCents: null,
        ...employment,
      },
    });
    await StaffProfile.create({
      staffId: created._id,
      checklist: defaultChecklist(created.toObject<StaffDoc>()),
    });
    await logActivity({
      actor: ctx.actor,
      action: "staff.created",
      entityType: "staff",
      entityId: String(created._id),
      summary: `added team member ${created.name}`,
      ip: ctx.ip,
    });
    const [dto] = await contextFor(
      [created.toObject<StaffDoc>()],
      await workspaceToday()
    );
    return dto!;
  } catch (error) {
    if (isDuplicateKey(error)) throw duplicateEmail();
    throw error;
  }
}

export async function updateStaff(
  id: string,
  input: z.output<typeof staffUpdateSchema>,
  ctx: RequestContext
): Promise<WithWarnings<StaffDTO>> {
  const current = await Staff.findById(id).lean<StaffDoc>();
  if (!current) throw errors.notFound("Team member");
  assertRev(current, input.rev);
  const warnings: string[] = [];
  if (
    input.status &&
    input.status !== "Active" &&
    current.status === "Active"
  ) {
    const upcoming = await RosterShift.countDocuments({
      staffIds: current._id,
      date: { $gte: await workspaceToday() },
      status: { $in: ["Planned", "Confirmed"] },
    });
    if (upcoming)
      warnings.push(
        `${current.name} is assigned to ${upcoming} upcoming shift${upcoming === 1 ? "" : "s"}. Reassign them in the roster.`
      );
  }
  const $set: Record<string, unknown> = {};
  for (const key of [
    "name",
    "position",
    "team",
    "email",
    "phone",
    "status",
    "notes",
    "transportsParticipants",
  ] as const) {
    if (input[key] !== undefined) $set[key] = input[key];
  }
  for (const [key, value] of Object.entries(await employmentChanges(input)))
    $set[`employment.${key}`] = value;
  try {
    const updated = await Staff.findOneAndUpdate(
      { _id: id, rev: current.rev },
      { $set, $inc: { rev: 1 } },
      { returnDocument: "after", lean: true }
    );
    if (!updated) throw errors.stale();
    const member = updated as StaffDoc;
    await ensureChecklistCovers(member, input.transportsParticipants);
    await logActivity({
      actor: ctx.actor,
      action: "staff.updated",
      entityType: "staff",
      entityId: id,
      summary:
        input.status && input.status !== current.status
          ? `set ${current.name} to ${input.status}`
          : `updated team member ${member.name}`,
      ip: ctx.ip,
    });
    const [dto] = await contextFor([member], await workspaceToday());
    return { ...dto!, warnings };
  } catch (error) {
    if (isDuplicateKey(error)) throw duplicateEmail();
    throw error;
  }
}

/**
 * Makes sure the stored checklist has a row per applicable item. Turning transport on
 * adds the vehicle rows; nothing is ever deleted, so history stays intact.
 */
async function ensureChecklistCovers(
  staff: StaffDoc,
  transports?: boolean
): Promise<void> {
  const wanted = defaultChecklist({
    ...staff,
    transportsParticipants: transports ?? staff.transportsParticipants,
  });
  const profile = await StaffProfile.findOne({ staffId: staff._id });
  if (!profile) {
    await StaffProfile.create({ staffId: staff._id, checklist: wanted });
    return;
  }
  const existing = new Set(profile.checklist.map(item => item.key));
  const missing = wanted.filter(item => !existing.has(item.key));
  if (missing.length)
    await StaffProfile.updateOne(
      { _id: profile._id },
      { $push: { checklist: { $each: missing } } }
    );
}

/* ───────────── Portal access ───────────── */

/** Creates (or re-invites) the worker account and emails a "choose your password" link. */
export async function inviteStaff(
  id: string,
  ctx: RequestContext
): Promise<StaffDTO & { invite: InviteResult }> {
  const staff = await Staff.findById(id).lean<StaffDoc>();
  if (!staff) throw errors.notFound("Team member");
  if (staff.status !== "Active")
    throw errors.invalidState(
      `${staff.name} is ${staff.status.toLowerCase()}, so portal access stays closed until they are active again.`
    );
  const invite = await inviteStaffAccount(staff, ctx);
  const [dto] = await contextFor([staff], await workspaceToday());
  return { ...dto!, invite };
}

/** Turns portal access off without touching the worker's history. */
export async function revokeStaffAccess(
  id: string,
  ctx: RequestContext
): Promise<StaffDTO> {
  const staff = await Staff.findById(id).lean<StaffDoc>();
  if (!staff) throw errors.notFound("Team member");
  if (!staff.userId) return getStaff(id);
  await User.updateOne({ _id: staff.userId }, { $set: { status: "disabled" } });
  await logActivity({
    actor: ctx.actor,
    action: "staff.access_revoked",
    entityType: "staff",
    entityId: id,
    summary: `turned off portal access for ${staff.name}`,
    ip: ctx.ip,
  });
  return getStaff(id);
}

/* ───────────── Applications ───────────── */

export function toApplicationDTO(
  application: StaffApplicationDoc
): StaffApplicationDTO {
  return {
    id: String(application._id),
    name: application.name,
    email: application.email,
    phone: application.phone ?? "",
    position: application.position ?? "",
    team: application.team ?? "",
    suburb: application.suburb ?? "",
    experience: application.experience ?? "",
    message: application.message ?? "",
    status: application.status,
    reviewedAt: application.reviewedAt
      ? application.reviewedAt.toISOString()
      : null,
    reviewedBy: actorDTO(application.reviewedBy),
    reviewNote: application.reviewNote ?? "",
    staffId: application.staffId ? String(application.staffId) : null,
    createdAt: isoRequired(application.createdAt),
  };
}

export async function listApplications(
  status?: string
): Promise<StaffApplicationDTO[]> {
  const filter: Record<string, string> = {};
  if (status && status !== "all") filter.status = status;
  const applications = await StaffApplication.find(filter)
    .sort({ status: 1, createdAt: -1 })
    .limit(200)
    .lean<StaffApplicationDoc[]>();
  return applications.map(toApplicationDTO);
}

export async function countPendingApplications(): Promise<number> {
  return StaffApplication.countDocuments({ status: "Pending" });
}

export interface ApplicationReviewResult {
  application: StaffApplicationDTO;
  staff: StaffDTO | null;
  invite: InviteResult | null;
}

/**
 * Approves or rejects a self-registered worker. Approval creates the team member record
 * (with a fresh checklist) and invites them, so one click ends in a working login.
 */
export async function reviewApplication(
  id: string,
  input: z.output<typeof applicationReviewSchema>,
  ctx: RequestContext
): Promise<ApplicationReviewResult> {
  const application =
    await StaffApplication.findById(id).lean<StaffApplicationDoc>();
  if (!application) throw errors.notFound("Application");
  if (application.status !== "Pending")
    throw errors.invalidState(MESSAGES.applicationReviewed);
  const note = input.note ?? "";

  if (input.decision === "Rejected") {
    const rejected = await StaffApplication.findOneAndUpdate(
      { _id: id, status: "Pending" },
      {
        $set: {
          status: "Rejected",
          reviewNote: note,
          reviewedAt: new Date(),
          reviewedBy: ctx.actor,
        },
      },
      { returnDocument: "after", lean: true }
    );
    if (!rejected) throw errors.invalidState(MESSAGES.applicationReviewed);
    await logActivity({
      actor: ctx.actor,
      action: "staff.application_rejected",
      entityType: "staffApplication",
      entityId: id,
      summary: `declined ${application.name}'s application`,
      ip: ctx.ip,
    });
    return {
      application: toApplicationDTO(rejected as StaffApplicationDoc),
      staff: null,
      invite: null,
    };
  }

  let staff = await Staff.findOne({
    email: application.email,
  }).lean<StaffDoc>();
  if (!staff) {
    const created = await Staff.create({
      name: application.name,
      position: input.position ?? application.position ?? "Support worker",
      team: input.team ?? application.team ?? "Community support",
      email: application.email,
      phone: application.phone ?? "",
      status: "Active",
      notes: [application.experience, application.message]
        .filter(Boolean)
        .join("\n\n"),
    });
    staff = created.toObject<StaffDoc>();
    await StaffProfile.create({
      staffId: staff._id,
      address: application.suburb ?? "",
      checklist: defaultChecklist(staff),
    });
  }
  const grant = input.grantAccess ?? true;
  const invite = grant ? await inviteStaffAccount(staff, ctx) : null;
  const approved = await StaffApplication.findOneAndUpdate(
    { _id: id, status: "Pending" },
    {
      $set: {
        status: "Approved",
        reviewNote: note,
        reviewedAt: new Date(),
        reviewedBy: ctx.actor,
        staffId: staff._id,
        userId: invite ? invite.userId : null,
      },
    },
    { returnDocument: "after", lean: true }
  );
  if (!approved) throw errors.invalidState(MESSAGES.applicationReviewed);
  await logActivity({
    actor: ctx.actor,
    action: "staff.application_approved",
    entityType: "staffApplication",
    entityId: id,
    summary: `approved ${application.name} and opened portal access`,
    ip: ctx.ip,
  });
  return {
    application: toApplicationDTO(approved as StaffApplicationDoc),
    staff: await getStaff(String(staff._id)),
    invite,
  };
}
