import type { z } from "zod";
import type { InvoiceDTO, InvoiceSummaryDTO, Paginated } from "@shared/dto";
import type { InvoiceStatus } from "@shared/enums";
import { formatNdis } from "@shared/logic/ndis";
import { fromCents } from "@shared/logic/money";
import { addDays, shortDate, startOfMonth } from "@shared/logic/time";
import type {
  invoiceCreateSchema,
  invoiceListQuery,
  invoiceMarkPaidSchema,
  invoiceMarkSentSchema,
  invoiceUpdateSchema,
  invoiceVoidSchema,
} from "@shared/schemas/invoices";
import { logActivity } from "../../lib/audit";
import { nextIds } from "../../lib/counters";
import { withTransaction } from "../../lib/db";
import { errors } from "../../lib/errors";
import { escapeRegex, type RequestContext } from "../../lib/http";
import { emailEnabled, sendMail } from "../../lib/mailer";
import {
  assertRev,
  historyDTO,
  historyEntry,
  iso,
  isoRequired,
} from "../../lib/mappers";
import { getWorkspace, workspaceToday } from "../../lib/workspace";
import {
  Invoice,
  Participant,
  ServiceRecord,
  type InvoiceDoc,
  type ParticipantDoc,
  type ServiceRecordDoc,
} from "../../models";
import {
  participantLookup,
  requireActiveParticipant,
} from "../participants/service";
import { renderInvoicePdf } from "./pdf";

export function toInvoiceDTO(
  invoice: InvoiceDoc,
  clientName: string,
  today: string
): InvoiceDTO {
  return {
    id: invoice._id,
    title: invoice.title,
    clientId: String(invoice.clientId),
    clientName,
    recipient: invoice.recipient,
    recipientEmail: invoice.recipientEmail ?? "",
    billTo: {
      name: invoice.billTo?.name ?? "",
      address: invoice.billTo?.address ?? "",
      ndis: invoice.billTo?.ndis ?? "",
    },
    supplier: {
      name: invoice.supplier?.name ?? "",
      legalName: invoice.supplier?.legalName ?? "",
      abn: invoice.supplier?.abn ?? "",
      address: invoice.supplier?.address ?? "",
      phone: invoice.supplier?.phone ?? "",
      email: invoice.supplier?.email ?? "",
    },
    issue: invoice.issue,
    due: invoice.due,
    paymentTermsDays: invoice.paymentTermsDays,
    status: invoice.status,
    overdue: invoice.status === "Sent" && invoice.due < today,
    lines: invoice.lines.map(line => ({
      label: line.label,
      unit: line.unit,
      quantity: line.quantity,
      rate: fromCents(line.rateCents),
      subtotal: fromCents(line.subtotalCents),
      recordId: line.recordId,
    })),
    subtotal: fromCents(invoice.subtotalCents),
    tax: fromCents(invoice.taxCents),
    taxRatePct: invoice.taxRatePct ?? 0,
    total: fromCents(invoice.totalCents),
    recordIds: invoice.recordIds,
    notes: invoice.notes ?? "",
    footer: invoice.footer ?? "",
    paymentInstructions: invoice.paymentInstructions ?? "",
    sentAt: iso(invoice.sentAt),
    emailedAt: iso(invoice.emailedAt),
    paidAt: iso(invoice.paidAt),
    paidOn: invoice.paidOn ?? null,
    paidReference: invoice.paidReference ?? "",
    voidedAt: iso(invoice.voidedAt),
    voidReason: invoice.voidReason ?? "",
    history: historyDTO(invoice.history),
    createdAt: isoRequired(invoice.createdAt),
    updatedAt: isoRequired(invoice.updatedAt),
    rev: invoice.rev ?? 0,
  };
}

async function invoicesToDTOs(invoices: InvoiceDoc[]): Promise<InvoiceDTO[]> {
  const [participants, today] = await Promise.all([
    participantLookup(invoices.map(invoice => invoice.clientId)),
    workspaceToday(),
  ]);
  return invoices.map(invoice =>
    toInvoiceDTO(
      invoice,
      participants.get(String(invoice.clientId))?.preferred ?? "Unknown",
      today
    )
  );
}

export async function getInvoiceDoc(id: string): Promise<InvoiceDoc> {
  const invoice = await Invoice.findById(id).lean<InvoiceDoc>();
  if (!invoice) throw errors.notFound("Invoice");
  return invoice;
}

export async function getInvoice(id: string): Promise<InvoiceDTO> {
  return (await invoicesToDTOs([await getInvoiceDoc(id)]))[0];
}

export async function listInvoices(
  query: z.output<typeof invoiceListQuery>
): Promise<Paginated<InvoiceDTO>> {
  const filter: Record<string, unknown> = {};
  if (query.status !== "all") filter.status = query.status;
  if (query.clientId) filter.clientId = query.clientId;
  if (query.q) {
    const pattern = new RegExp(escapeRegex(query.q), "i");
    const participantIds = await Participant.find({
      $or: [{ name: pattern }, { preferred: pattern }],
    }).distinct("_id");
    filter.$or = [
      { _id: pattern },
      { recipient: pattern },
      { clientId: { $in: participantIds } },
    ];
  }
  const [items, total] = await Promise.all([
    Invoice.find(filter)
      .sort({ issue: -1, _id: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean<InvoiceDoc[]>(),
    Invoice.countDocuments(filter),
  ]);
  return {
    items: await invoicesToDTOs(items),
    page: query.page,
    limit: query.limit,
    total,
  };
}

export async function invoiceSummary(): Promise<InvoiceSummaryDTO> {
  const today = await workspaceToday();
  const monthStart = startOfMonth(today);
  const [sent, overdue, drafts, paid, awaitingInvoice] = await Promise.all([
    Invoice.find({ status: "Sent" })
      .select("totalCents")
      .lean<Array<{ totalCents: number }>>(),
    Invoice.countDocuments({ status: "Sent", due: { $lt: today } }),
    Invoice.countDocuments({ status: "Draft" }),
    Invoice.find({ status: "Paid", paidOn: { $gte: monthStart, $lte: today } })
      .select("totalCents")
      .lean<Array<{ totalCents: number }>>(),
    ServiceRecord.countDocuments({ status: "Approved" }),
  ]);
  const sum = (rows: Array<{ totalCents: number }>) =>
    fromCents(rows.reduce((total, row) => total + row.totalCents, 0));
  return {
    outstanding: sum(sent),
    overdue,
    drafts,
    paidThisPeriod: sum(paid),
    awaitingInvoice,
  };
}

function recipientFor(participant: ParticipantDoc): {
  recipient: string;
  recipientEmail: string;
} {
  const manager = (participant.manager ?? "").trim();
  if (
    manager &&
    !/^self[\s-]?managed$/i.test(manager) &&
    !/to confirm/i.test(manager)
  ) {
    return {
      recipient: manager,
      recipientEmail: participant.managerEmail ?? "",
    };
  }
  return {
    recipient: participant.name,
    recipientEmail: participant.email ?? "",
  };
}

export async function createInvoice(
  input: z.output<typeof invoiceCreateSchema>,
  ctx: RequestContext
): Promise<InvoiceDTO> {
  const participant = await requireActiveParticipant(
    input.clientId,
    "be invoiced"
  );
  const workspace = await getWorkspace();
  const today = await workspaceToday();
  const recordIds = [...new Set(input.recordIds)];
  const records = await ServiceRecord.find({ _id: { $in: recordIds } }).lean<
    ServiceRecordDoc[]
  >();
  if (records.length !== recordIds.length)
    throw errors.notFound("Service record");
  for (const record of records) {
    if (String(record.clientId) !== String(participant._id)) {
      throw errors.validation(
        "All records on an invoice must belong to the same participant."
      );
    }
    if (record.status !== "Approved" || record.invoiceId) {
      throw errors.conflict(
        "RECORD_NOT_APPROVED",
        `${record._id} is ${record.status.toLowerCase()}. Only approved records that are not yet invoiced can be added.`
      );
    }
  }
  records.sort(
    (a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start)
  );
  const lines = records.flatMap(record =>
    record.billables.map(line => ({
      label: `${line.label} — ${shortDate(record.date)}`,
      unit: line.unit,
      quantity: line.quantity,
      rateCents: line.rateCents,
      subtotalCents: line.subtotalCents,
      recordId: record._id,
    }))
  );
  const subtotalCents = lines.reduce(
    (total, line) => total + line.subtotalCents,
    0
  );
  const taxRatePct = workspace.gst?.ratePct ?? 0;
  const taxCents = Math.round((subtotalCents * taxRatePct) / 100);
  const issue = input.issueDate ?? today;
  const paymentTermsDays =
    input.paymentTermsDays ?? workspace.invoice?.defaultPaymentTermsDays ?? 14;
  const { recipient, recipientEmail } = recipientFor(participant);

  const invoice = await withTransaction(async session => {
    const id = await nextIds.invoice(
      workspace.invoice?.prefix ?? "INV",
      issue.slice(0, 4),
      session
    );
    const updated = await ServiceRecord.updateMany(
      {
        _id: { $in: recordIds },
        clientId: participant._id,
        status: "Approved",
        invoiceId: null,
      },
      {
        $set: { status: "Invoiced", invoiceId: id },
        $inc: { rev: 1 },
        $push: { history: historyEntry(ctx.actor, "invoiced", id) },
      },
      { session }
    );
    if (updated.modifiedCount !== recordIds.length) {
      throw errors.conflict(
        "RECORD_NOT_APPROVED",
        "One or more records changed while the invoice was being created. Reload and try again."
      );
    }
    const [created] = await Invoice.create(
      [
        {
          _id: id,
          clientId: participant._id,
          recordIds: records.map(record => record._id),
          status: "Draft",
          title: workspace.gst?.registered ? "Tax invoice" : "Invoice",
          recipient,
          recipientEmail,
          billTo: {
            name: participant.name,
            address: participant.address ?? "",
            ndis: formatNdis(participant.ndis),
          },
          supplier: {
            name: workspace.name,
            legalName: workspace.legalName ?? "",
            abn: workspace.abn ?? "",
            address: workspace.address ?? "",
            phone: workspace.phone ?? "",
            email: workspace.email ?? "",
          },
          issue,
          due: addDays(issue, paymentTermsDays),
          paymentTermsDays,
          lines,
          subtotalCents,
          taxCents,
          taxRatePct,
          totalCents: subtotalCents + taxCents,
          notes: input.notes ?? "",
          footer: workspace.invoice?.footer ?? "",
          paymentInstructions: workspace.invoice?.paymentInstructions ?? "",
          history: [historyEntry(ctx.actor, "created")],
          createdBy: ctx.actor,
        },
      ],
      { session }
    );
    return created.toObject<InvoiceDoc>();
  });
  await logActivity({
    actor: ctx.actor,
    action: "invoice.created",
    entityType: "invoice",
    entityId: invoice._id,
    participantId: participant._id,
    summary: `prepared invoice ${invoice._id}`,
    ip: ctx.ip,
  });
  return getInvoice(invoice._id);
}

async function transition(
  id: string,
  rev: number | undefined,
  from: InvoiceStatus[],
  set: Record<string, unknown>,
  action: string,
  ctx: RequestContext,
  note?: string
): Promise<InvoiceDoc> {
  const current = await getInvoiceDoc(id);
  if (!from.includes(current.status))
    throw errors.invalidState(
      `This invoice is ${current.status.toLowerCase()}; that action is not available.`
    );
  assertRev(current, rev);
  const updated = await Invoice.findOneAndUpdate(
    { _id: id, rev: current.rev, status: current.status },
    {
      $set: set,
      $inc: { rev: 1 },
      $push: { history: historyEntry(ctx.actor, action, note) },
    },
    { returnDocument: "after", lean: true }
  );
  if (!updated) throw errors.stale();
  return updated as InvoiceDoc;
}

export async function updateDraftInvoice(
  id: string,
  input: z.output<typeof invoiceUpdateSchema>,
  ctx: RequestContext
): Promise<InvoiceDTO> {
  const current = await getInvoiceDoc(id);
  const issue = input.issueDate ?? current.issue;
  const terms = input.paymentTermsDays ?? current.paymentTermsDays;
  await transition(
    id,
    input.rev,
    ["Draft"],
    {
      issue,
      paymentTermsDays: terms,
      due: addDays(issue, terms),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    },
    "updated",
    ctx
  );
  return getInvoice(id);
}

export async function markReady(
  id: string,
  rev: number | undefined,
  ctx: RequestContext
): Promise<InvoiceDTO> {
  await transition(
    id,
    rev,
    ["Draft"],
    { status: "Ready to send" },
    "ready_to_send",
    ctx
  );
  await logActivity({
    actor: ctx.actor,
    action: "invoice.ready",
    entityType: "invoice",
    entityId: id,
    summary: `marked ${id} ready to send`,
    ip: ctx.ip,
  });
  return getInvoice(id);
}

export async function markSent(
  id: string,
  input: z.output<typeof invoiceMarkSentSchema>,
  ctx: RequestContext
): Promise<InvoiceDTO> {
  const current = await getInvoiceDoc(id);
  if (!["Draft", "Ready to send"].includes(current.status))
    throw errors.invalidState(
      `This invoice is ${current.status.toLowerCase()}; it cannot be sent again.`
    );
  let emailedTo = "";
  if (input.sendEmail) {
    if (!emailEnabled())
      throw errors.validation(
        "Email is not configured on the server, so the invoice cannot be emailed."
      );
    if (!current.recipientEmail)
      throw errors.validation(
        "Add an email address for the plan manager or participant before emailing the invoice."
      );
    const pdf = await renderInvoicePdf({ ...current, status: "Sent" });
    await sendMail({
      to: current.recipientEmail,
      subject: `${current.title} ${current._id} from ${current.supplier?.name ?? "Noble Community Support"}`,
      text: `Hello,\n\nPlease find attached ${current.title.toLowerCase()} ${current._id} for ${current.billTo?.name}, due ${current.due}.\n\n${current.paymentInstructions ?? ""}\n\nThank you.\n`,
      attachments: [
        {
          filename: `${current._id}.pdf`,
          content: pdf,
          contentType: "application/pdf",
        },
      ],
    });
    emailedTo = current.recipientEmail;
  }
  const now = new Date();
  await transition(
    id,
    input.rev,
    ["Draft", "Ready to send"],
    { status: "Sent", sentAt: now, ...(emailedTo ? { emailedAt: now } : {}) },
    "sent",
    ctx,
    emailedTo ? `Emailed to ${emailedTo}` : undefined
  );
  await logActivity({
    actor: ctx.actor,
    action: "invoice.sent",
    entityType: "invoice",
    entityId: id,
    participantId: current.clientId,
    summary: emailedTo
      ? `emailed invoice ${id}`
      : `marked invoice ${id} as sent`,
    ip: ctx.ip,
  });
  return getInvoice(id);
}

export async function markPaid(
  id: string,
  input: z.output<typeof invoiceMarkPaidSchema>,
  ctx: RequestContext
): Promise<InvoiceDTO> {
  const updated = await transition(
    id,
    input.rev,
    ["Sent", "Ready to send"],
    {
      status: "Paid",
      paidAt: new Date(),
      paidOn: input.paidOn,
      paidReference: input.reference ?? "",
    },
    "paid",
    ctx,
    input.reference ? `Reference ${input.reference}` : undefined
  );
  await logActivity({
    actor: ctx.actor,
    action: "invoice.paid",
    entityType: "invoice",
    entityId: id,
    participantId: updated.clientId,
    summary: `recorded payment for invoice ${id}`,
    ip: ctx.ip,
  });
  return getInvoice(id);
}

/** Void (issued) or delete (draft): the linked records return to Approved so they can be invoiced again. */
async function releaseInvoice(
  id: string,
  mode: "void" | "delete",
  ctx: RequestContext,
  input: { reason?: string; rev?: number }
): Promise<void> {
  const current = await getInvoiceDoc(id);
  const allowed: InvoiceStatus[] =
    mode === "delete" ? ["Draft"] : ["Ready to send", "Sent"];
  if (!allowed.includes(current.status)) {
    throw errors.invalidState(
      mode === "delete"
        ? "Only draft invoices can be deleted. Void an issued invoice instead."
        : `A ${current.status.toLowerCase()} invoice cannot be voided.`
    );
  }
  assertRev(current, input.rev);
  await withTransaction(async session => {
    await ServiceRecord.updateMany(
      { invoiceId: id, status: "Invoiced" },
      {
        $set: { status: "Approved", invoiceId: null },
        $inc: { rev: 1 },
        $push: {
          history: historyEntry(
            ctx.actor,
            mode === "delete" ? "invoice_deleted" : "invoice_voided",
            id
          ),
        },
      },
      { session }
    );
    if (mode === "delete") {
      const result = await Invoice.deleteOne(
        { _id: id, rev: current.rev },
        { session }
      );
      if (!result.deletedCount) throw errors.stale();
    } else {
      const result = await Invoice.updateOne(
        { _id: id, rev: current.rev },
        {
          $set: {
            status: "Void",
            voidedAt: new Date(),
            voidReason: input.reason ?? "",
          },
          $inc: { rev: 1 },
          $push: { history: historyEntry(ctx.actor, "voided", input.reason) },
        },
        { session }
      );
      if (!result.matchedCount) throw errors.stale();
    }
  });
  await logActivity({
    actor: ctx.actor,
    action: mode === "delete" ? "invoice.deleted" : "invoice.voided",
    entityType: "invoice",
    entityId: id,
    participantId: current.clientId,
    summary:
      mode === "delete"
        ? `deleted draft invoice ${id}`
        : `voided invoice ${id}`,
    meta: input.reason ? { reason: input.reason } : undefined,
    ip: ctx.ip,
  });
}

export async function voidInvoice(
  id: string,
  input: z.output<typeof invoiceVoidSchema>,
  ctx: RequestContext
): Promise<InvoiceDTO> {
  await releaseInvoice(id, "void", ctx, input);
  return getInvoice(id);
}

export async function deleteInvoice(
  id: string,
  ctx: RequestContext
): Promise<void> {
  await releaseInvoice(id, "delete", ctx, {});
}

export async function invoicePdf(
  id: string
): Promise<{ filename: string; buffer: Buffer }> {
  const invoice = await getInvoiceDoc(id);
  return {
    filename: `${invoice._id}.pdf`,
    buffer: await renderInvoicePdf(invoice),
  };
}
