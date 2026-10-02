import type { z } from "zod";
import type { PreferencesDTO, WorkspaceDTO } from "@shared/dto";
import { DEFAULT_TRAVEL_RATE_CENTS } from "@shared/const";
import { fromCents, toCents } from "@shared/logic/money";
import type {
  preferencesPatchSchema,
  workspacePatchSchema,
} from "@shared/schemas/settings";
import { logActivity } from "../../lib/audit";
import { errors } from "../../lib/errors";
import type { RequestContext } from "../../lib/http";
import { getWorkspace, invalidateWorkspaceCache } from "../../lib/workspace";
import {
  Budget,
  Service,
  User,
  Workspace,
  WORKSPACE_ID,
  type UserDoc,
  type WorkspaceDoc,
} from "../../models";

export function toWorkspaceDTO(ws: WorkspaceDoc): WorkspaceDTO {
  return {
    name: ws.name,
    legalName: ws.legalName ?? "",
    abn: ws.abn ?? "",
    address: ws.address ?? "",
    phone: ws.phone ?? "",
    email: ws.email ?? "",
    timezone: ws.timezone,
    currency: ws.currency ?? "AUD",
    gst: {
      registered: Boolean(ws.gst?.registered),
      ratePct: ws.gst?.ratePct ?? 0,
    },
    invoice: {
      prefix: ws.invoice?.prefix ?? "INV",
      defaultPaymentTermsDays: ws.invoice?.defaultPaymentTermsDays ?? 14,
      footer: ws.invoice?.footer ?? "",
      paymentInstructions: ws.invoice?.paymentInstructions ?? "",
    },
    bank: {
      accountName: ws.bank?.accountName ?? "",
      bsb: ws.bank?.bsb ?? "",
      accountNumber: ws.bank?.accountNumber ?? "",
      payInstruction: ws.bank?.payInstruction ?? "",
    },
    providerTravelRate: fromCents(
      ws.providerTravelRateCents ?? DEFAULT_TRAVEL_RATE_CENTS
    ),
    budgetCategories: ws.budgetCategories ?? [],
    setupCompletedAt: ws.setupCompletedAt
      ? ws.setupCompletedAt.toISOString()
      : null,
  };
}

export function toPreferencesDTO(
  user: Pick<UserDoc, "preferences">
): PreferencesDTO {
  const voice = user.preferences?.voice;
  const notifications = user.preferences?.notifications;
  return {
    voice: {
      generationTemplate:
        voice?.generationTemplate ?? "Community support progress note",
      detailLevel: voice?.detailLevel ?? "Balanced",
      autoSaveRecordings: voice?.autoSaveRecordings ?? true,
      useTranscriptOnly: voice?.useTranscriptOnly ?? false,
      notifyDraftReady: voice?.notifyDraftReady ?? true,
    },
    notifications: {
      recordReturned: notifications?.recordReturned ?? true,
      reviewQueue: notifications?.reviewQueue ?? true,
      budgetAlerts: notifications?.budgetAlerts ?? true,
      invoiceOverdue: notifications?.invoiceOverdue ?? true,
      voiceDraftReady: notifications?.voiceDraftReady ?? true,
    },
  };
}

export async function getWorkspaceSettings(): Promise<WorkspaceDTO> {
  return toWorkspaceDTO(await getWorkspace());
}

export async function updateWorkspaceSettings(
  input: z.output<typeof workspacePatchSchema>,
  ctx: RequestContext
): Promise<WorkspaceDTO> {
  const workspace = await getWorkspace();
  const $set: Record<string, unknown> = {};
  for (const key of [
    "name",
    "legalName",
    "abn",
    "address",
    "phone",
    "email",
    "timezone",
  ] as const) {
    if (input[key] !== undefined) $set[key] = input[key];
  }
  if (input.gst) $set.gst = input.gst;
  if (input.invoice)
    for (const [key, value] of Object.entries(input.invoice))
      if (value !== undefined) $set[`invoice.${key}`] = value;
  if (input.bank)
    for (const [key, value] of Object.entries(input.bank))
      if (value !== undefined) $set[`bank.${key}`] = value;
  if (input.providerTravelRate !== undefined)
    $set.providerTravelRateCents = toCents(input.providerTravelRate);
  if (input.budgetCategories) {
    const next = input.budgetCategories.map(name => name.trim());
    const removed = workspace.budgetCategories.filter(
      name =>
        !next.some(candidate => candidate.toLowerCase() === name.toLowerCase())
    );
    for (const name of removed) {
      const [serviceUse, budgetUse] = await Promise.all([
        Service.exists({ budgetCategory: name }),
        Budget.exists({ isCurrent: true, "categories.name": name }),
      ]);
      if (serviceUse || budgetUse) {
        throw errors.conflict(
          "CONFLICT",
          `“${name}” is still used by a service or a client budget. Reassign it before removing it.`
        );
      }
    }
    $set.budgetCategories = next;
  }
  if (Object.keys($set).length) {
    await Workspace.updateOne({ _id: WORKSPACE_ID }, { $set });
    invalidateWorkspaceCache();
    await logActivity({
      actor: ctx.actor,
      action: "settings.workspace_updated",
      entityType: "workspace",
      entityId: WORKSPACE_ID,
      summary: "updated the workspace settings",
      meta: { fields: Object.keys(input) },
      ip: ctx.ip,
    });
  }
  return toWorkspaceDTO(await getWorkspace());
}

export async function getPreferences(userId: string): Promise<PreferencesDTO> {
  const user = await User.findById(userId)
    .select("preferences")
    .lean<Pick<UserDoc, "preferences">>();
  if (!user) throw errors.notFound("User");
  return toPreferencesDTO(user);
}

export async function updatePreferences(
  userId: string,
  input: z.output<typeof preferencesPatchSchema>
): Promise<PreferencesDTO> {
  const $set: Record<string, unknown> = {};
  for (const group of ["voice", "notifications"] as const) {
    const values = input[group];
    if (values)
      for (const [key, value] of Object.entries(values))
        if (value !== undefined) $set[`preferences.${group}.${key}`] = value;
  }
  if (Object.keys($set).length) await User.updateOne({ _id: userId }, { $set });
  return getPreferences(userId);
}
