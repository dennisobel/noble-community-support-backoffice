import type { z } from "zod";
import { effectiveModules, ROLE_LABELS } from "@shared/access";
import type { AccessUserDTO } from "@shared/dto";
import { ACCESS_MODULES, type AccessModule } from "@shared/enums";
import type {
  approveUserSchema,
  declineUserSchema,
  updateUserAccessSchema,
} from "@shared/schemas/access";
import { config } from "../../config";
import { logActivity } from "../../lib/audit";
import { errors } from "../../lib/errors";
import type { RequestContext } from "../../lib/http";
import { logger } from "../../lib/logger";
import { emailEnabled, sendMail } from "../../lib/mailer";
import { iso } from "../../lib/mappers";
import { User, type UserDoc } from "../../models";

/*
 * Back-office accounts: people who asked for access, and what an Admin let them open.
 * Support workers are not listed here; they come in through the staff portal flow.
 */

/** Drops duplicates and puts modules in the order the sidebar shows them. */
const ordered = (modules: readonly string[]): AccessModule[] =>
  ACCESS_MODULES.filter(module => modules.includes(module));

export function toAccessUserDTO(user: UserDoc): AccessUserDTO {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    modules: effectiveModules(user.role, user.modules),
    status: user.status,
    message: user.request?.message ?? "",
    requestedAt: user.createdAt.toISOString(),
    reviewedAt: iso(user.request?.reviewedAt ?? null),
    reviewedBy: user.request?.reviewedBy?.name ?? "",
    note: user.request?.note ?? "",
    lastLoginAt: iso(user.lastLoginAt),
  };
}

export async function listAccessUsers(): Promise<AccessUserDTO[]> {
  const users = await User.find({ role: { $ne: "staff" } }).lean<UserDoc[]>();
  const rank = { pending: 0, active: 1, disabled: 2, rejected: 3 } as const;
  return users
    .sort(
      (a, b) =>
        rank[a.status] - rank[b.status] || a.name.localeCompare(b.name)
    )
    .map(toAccessUserDTO);
}

async function loadOffice(id: string): Promise<UserDoc> {
  const user = await User.findById(id).lean<UserDoc>();
  if (!user || user.role === "staff") throw errors.notFound("User");
  return user;
}

/** Best effort: they can also just try signing in, so a failed email never blocks an approval. */
async function tellApproved(
  user: Pick<UserDoc, "name" | "email" | "role">
): Promise<void> {
  if (!emailEnabled()) return;
  try {
    await sendMail({
      to: user.email,
      subject: "Your Noble Community Support access is approved",
      text: `Hi ${user.name},\n\nYour request was approved. You now have ${ROLE_LABELS[user.role]} access. Sign in here:\n\n${config().appUrl}/login\n`,
    });
  } catch (error) {
    logger().warn({ err: error }, "Could not email the approval");
  }
}

/** Approving is where the role and the modules are chosen. */
export async function approveUser(
  id: string,
  input: z.output<typeof approveUserSchema>,
  ctx: RequestContext
): Promise<AccessUserDTO> {
  const user = await loadOffice(id);
  if (user.status !== "pending" && user.status !== "rejected")
    throw errors.invalidState("This account has already been approved.");
  const updated = await User.findOneAndUpdate(
    { _id: id, status: user.status },
    {
      $set: {
        status: "active",
        role: input.role,
        // Admins can open everything, so there is nothing to list.
        modules: input.role === "admin" ? [] : ordered(input.modules),
        "request.reviewedAt": new Date(),
        "request.reviewedBy": ctx.actor,
        "request.note": "",
      },
    },
    { returnDocument: "after", lean: true }
  );
  if (!updated) throw errors.stale();
  await logActivity({
    actor: ctx.actor,
    action: "user.approved",
    entityType: "user",
    entityId: id,
    summary: `approved ${user.name} as ${ROLE_LABELS[input.role]}`,
    meta: { role: input.role, modules: updated.modules },
    ip: ctx.ip,
  });
  void tellApproved(updated);
  return toAccessUserDTO(updated as UserDoc);
}

export async function declineUser(
  id: string,
  input: z.output<typeof declineUserSchema>,
  ctx: RequestContext
): Promise<AccessUserDTO> {
  const user = await loadOffice(id);
  if (user.status !== "pending")
    throw errors.invalidState("Only a request that is waiting can be declined.");
  const updated = await User.findOneAndUpdate(
    { _id: id, status: "pending" },
    {
      $set: {
        status: "rejected",
        "request.reviewedAt": new Date(),
        "request.reviewedBy": ctx.actor,
        "request.note": input.note ?? "",
      },
    },
    { returnDocument: "after", lean: true }
  );
  if (!updated) throw errors.stale();
  await logActivity({
    actor: ctx.actor,
    action: "user.declined",
    entityType: "user",
    entityId: id,
    summary: `declined the access request from ${user.name}`,
    ip: ctx.ip,
  });
  return toAccessUserDTO(updated as UserDoc);
}

/** Change someone's role or modules later, or switch their account off and on. */
export async function updateUserAccess(
  id: string,
  input: z.output<typeof updateUserAccessSchema>,
  ctx: RequestContext
): Promise<AccessUserDTO> {
  const user = await loadOffice(id);
  if (user.status !== "active" && user.status !== "disabled")
    throw errors.invalidState("Approve or decline this request first.");
  if (String(user._id) === ctx.actor.id)
    throw errors.conflict(
      "CONFLICT",
      "You can't change your own access. Ask another Admin."
    );
  const role = input.role ?? user.role;
  const status = input.status ?? user.status;
  const modules = role === "admin" ? [] : ordered(input.modules ?? user.modules ?? []);
  const losesAdmin =
    user.role === "admin" && (role !== "admin" || status !== "active");
  if (
    losesAdmin &&
    (await User.countDocuments({
      role: "admin",
      status: "active",
      _id: { $ne: user._id },
    })) === 0
  )
    throw errors.conflict("CONFLICT", "Keep at least one active Admin.");

  const switchedOff = status === "disabled" && user.status !== "disabled";
  const updated = await User.findOneAndUpdate(
    { _id: id },
    {
      $set: { role, modules, status },
      // Ends any session that is still open.
      ...(switchedOff ? { $inc: { tokenVersion: 1 } } : {}),
    },
    { returnDocument: "after", lean: true }
  );
  if (!updated) throw errors.notFound("User");
  await logActivity({
    actor: ctx.actor,
    action: "user.access_changed",
    entityType: "user",
    entityId: id,
    summary: `changed access for ${user.name}: ${ROLE_LABELS[role]}, ${status}`,
    meta: { role, modules, status },
    ip: ctx.ip,
  });
  return toAccessUserDTO(updated as UserDoc);
}
