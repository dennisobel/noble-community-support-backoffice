import { Router } from "express";
import type { Types } from "mongoose";
import type { z } from "zod";
import type { ReportsOverviewDTO } from "@shared/dto";
import type { RecordStatus } from "@shared/enums";
import { formatNdis } from "@shared/logic/ndis";
import { fromCents } from "@shared/logic/money";
import {
  addDays,
  durationHours,
  prettyDate,
  shortDate,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
} from "@shared/logic/time";
import { reportExportQuery, reportQuery } from "@shared/schemas/reports";
import { toCsv } from "../../lib/csv";
import { contentDisposition, parse } from "../../lib/http";
import { workspaceToday } from "../../lib/workspace";
import {
  Invoice,
  ServiceRecord,
  Staff,
  type InvoiceDoc,
  type ServiceRecordDoc,
  type StaffDoc,
} from "../../models";
import { participantLookup } from "../participants/service";

type Query = z.output<typeof reportQuery>;

async function rangeFor(
  query: Query
): Promise<{ from: string; to: string; label: string }> {
  const today = await workspaceToday();
  switch (query.period) {
    case "month":
      return { from: startOfMonth(today), to: today, label: "This month" };
    case "quarter":
      return { from: startOfQuarter(today), to: today, label: "This quarter" };
    case "custom":
      return {
        from: query.from!,
        to: query.to!,
        label: `${prettyDate(query.from)} – ${prettyDate(query.to)}`,
      };
    default:
      return { from: addDays(today, -29), to: today, label: "Last 30 days" };
  }
}

async function teamStaffIds(team?: string): Promise<Types.ObjectId[] | null> {
  if (!team) return null;
  return Staff.find({ team }).distinct("_id");
}

const inRange = (
  range: { from: string; to: string },
  staffIds: Types.ObjectId[] | null
) => ({
  date: { $gte: range.from, $lte: range.to },
  ...(staffIds ? { staffId: { $in: staffIds } } : {}),
});

export async function reportsOverview(
  query: Query
): Promise<ReportsOverviewDTO> {
  const range = await rangeFor(query);
  const staffIds = await teamStaffIds(query.team);
  const [records, approved, teams] = await Promise.all([
    ServiceRecord.find(inRange(range, staffIds))
      .select("_id clientId date status km")
      .lean<ServiceRecordDoc[]>(),
    ServiceRecord.find({
      status: "Approved",
      ...(staffIds ? { staffId: { $in: staffIds } } : {}),
    })
      .select("clientId totalCents")
      .lean<Array<{ clientId: Types.ObjectId; totalCents: number }>>(),
    Staff.distinct("team"),
  ]);

  const weeks: Array<{ weekStart: string; label: string; count: number }> = [];
  for (
    let week = startOfWeek(range.from);
    week <= range.to;
    week = addDays(week, 7)
  )
    weeks.push({ weekStart: week, label: shortDate(week), count: 0 });
  const delivered: RecordStatus[] = ["Submitted", "Approved", "Invoiced"];
  for (const record of records) {
    if (!delivered.includes(record.status)) continue;
    const bucket = weeks.find(
      week => week.weekStart === startOfWeek(record.date)
    );
    if (bucket) bucket.count += 1;
  }

  const count = (statuses: RecordStatus[]) =>
    records.filter(record => statuses.includes(record.status)).length;
  const byClient = new Map<string, { readyRecords: number; cents: number }>();
  for (const record of approved) {
    const row = byClient.get(String(record.clientId)) ?? {
      readyRecords: 0,
      cents: 0,
    };
    row.readyRecords += 1;
    row.cents += record.totalCents;
    byClient.set(String(record.clientId), row);
  }
  const participants = await participantLookup([
    ...byClient.keys(),
    ...records.map(record => record.clientId),
  ]);
  const withKm = records
    .filter(record => (record.km ?? 0) > 0)
    .sort((a, b) => b.date.localeCompare(a.date));

  return {
    range,
    serviceActivity: weeks,
    documentationStatus: {
      approvedOrInvoiced: count(["Approved", "Invoiced"]),
      submitted: count(["Submitted"]),
      draftOrReturned: count(["Draft", "Returned"]),
      returned: count(["Returned"]),
      total: records.length,
    },
    billingReadiness: {
      approvedNotInvoiced: approved.length,
      value: fromCents(
        approved.reduce((total, record) => total + record.totalCents, 0)
      ),
      rows: [...byClient.entries()]
        .map(([participantId, row]) => ({
          participantId,
          name: participants.get(participantId)?.preferred ?? "Unknown",
          readyRecords: row.readyRecords,
          value: fromCents(row.cents),
        }))
        .sort((a, b) => b.value - a.value),
    },
    transport: {
      totalKm:
        Math.round(
          records.reduce((total, record) => total + (record.km ?? 0), 0) * 10
        ) / 10,
      recent: withKm.slice(0, 5).map(record => ({
        recordId: record._id,
        clientName:
          participants.get(String(record.clientId))?.preferred ?? "Unknown",
        date: record.date,
        km: record.km,
      })),
    },
    teams: teams.filter(Boolean).sort(),
  };
}

export async function reportExport(
  query: z.output<typeof reportExportQuery>
): Promise<{ filename: string; csv: string }> {
  const range = await rangeFor(query);
  const staffIds = await teamStaffIds(query.team);
  const suffix = `${range.from}_to_${range.to}`;

  if (query.report === "billing") {
    const invoices = await Invoice.find({
      issue: { $gte: range.from, $lte: range.to },
    })
      .sort({ issue: 1 })
      .lean<InvoiceDoc[]>();
    const participants = await participantLookup(
      invoices.map(invoice => invoice.clientId)
    );
    return {
      filename: `noble-billing_${suffix}.csv`,
      csv: toCsv(
        [
          "Invoice",
          "Participant",
          "Recipient",
          "Issue date",
          "Due date",
          "Status",
          "Subtotal",
          "GST",
          "Total",
          "Paid on",
        ],
        invoices.map(invoice => [
          invoice._id,
          participants.get(String(invoice.clientId))?.name ?? "",
          invoice.recipient,
          invoice.issue,
          invoice.due,
          invoice.status,
          fromCents(invoice.subtotalCents),
          fromCents(invoice.taxCents),
          fromCents(invoice.totalCents),
          invoice.paidOn ?? "",
        ])
      ),
    };
  }

  const records = await ServiceRecord.find(inRange(range, staffIds))
    .sort({ date: 1, start: 1 })
    .lean<ServiceRecordDoc[]>();
  const [participants, staff] = await Promise.all([
    participantLookup(records.map(record => record.clientId)),
    Staff.find({
      _id: { $in: [...new Set(records.map(record => String(record.staffId)))] },
    }).lean<StaffDoc[]>(),
  ]);
  const staffById = new Map(staff.map(member => [String(member._id), member]));
  const who = (record: ServiceRecordDoc) =>
    participants.get(String(record.clientId));
  const worker = (record: ServiceRecordDoc) =>
    staffById.get(String(record.staffId));

  if (query.report === "transport") {
    return {
      filename: `noble-transport_${suffix}.csv`,
      csv: toCsv(
        [
          "Record",
          "Date",
          "Participant",
          "Staff",
          "Kilometres",
          "Location",
          "Status",
        ],
        records
          .filter(record => (record.km ?? 0) > 0)
          .map(record => [
            record._id,
            record.date,
            who(record)?.name ?? "",
            worker(record)?.name ?? "",
            record.km,
            record.location,
            record.status,
          ])
      ),
    };
  }
  if (query.report === "documentation") {
    return {
      filename: `noble-documentation_${suffix}.csv`,
      csv: toCsv(
        [
          "Record",
          "Date",
          "Participant",
          "Staff",
          "Status",
          "Submitted at",
          "Reviewed at",
          "Approved by",
          "Correction requested",
        ],
        records.map(record => [
          record._id,
          record.date,
          who(record)?.name ?? "",
          worker(record)?.name ?? "",
          record.status,
          record.submittedAt ? record.submittedAt.toISOString() : "",
          record.reviewedAt ? record.reviewedAt.toISOString() : "",
          record.approvedBy?.name ?? "",
          record.correction ?? "",
        ])
      ),
    };
  }
  return {
    filename: `noble-service-records_${suffix}.csv`,
    csv: toCsv(
      [
        "Record",
        "Date",
        "Start",
        "End",
        "Hours",
        "Participant",
        "NDIS number",
        "Staff",
        "Team",
        "Service",
        "Status",
        "Kilometres",
        "Total (AUD)",
        "Invoice",
      ],
      records.map(record => [
        record._id,
        record.date,
        record.start,
        record.end,
        durationHours(record.start, record.end),
        who(record)?.name ?? "",
        who(record) ? formatNdis(who(record)!.ndis) : "",
        worker(record)?.name ?? "",
        worker(record)?.team ?? "",
        record.type,
        record.status,
        record.km,
        fromCents(record.totalCents),
        record.invoiceId ?? "",
      ])
    ),
  };
}

export function reportsRouter(): Router {
  const router = Router();
  router.get("/overview", async (req, res) => {
    res.json(await reportsOverview(parse(reportQuery, req.query)));
  });
  router.get("/export", async (req, res) => {
    const { filename, csv } = await reportExport(
      parse(reportExportQuery, req.query)
    );
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      contentDisposition("attachment", filename)
    );
    res.send(csv);
  });
  return router;
}
