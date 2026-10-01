import type { PortalHomeDTO, PortalShiftDTO } from "@shared/dto";
import { addDays, startOfMonth, startOfWeek } from "@shared/logic/time";
import {
  AbcReport,
  IncidentReport,
  LogbookEntry,
  RosterShift,
  ServiceRecord,
  type RosterShiftDoc,
} from "../../models";
import { workspaceToday } from "../../lib/workspace";
import { checklistItemsDTO, checklistProgress } from "./checklist";
import { listPortalShifts } from "./shifts";
import { ensureProfile, requireStaffDoc } from "./service";
import { ownNotesCount } from "./notes";

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

export async function portalHome(staffId: string): Promise<PortalHomeDTO> {
  const staff = await requireStaffDoc(staffId);
  const today = await workspaceToday();
  const weekStart = startOfWeek(today);
  const monthStart = startOfMonth(today);

  const [
    profile,
    todayShifts,
    weekShifts,
    monthShifts,
    notes,
    incidentDrafts,
    abcDrafts,
  ] = await Promise.all([
    ensureProfile(staff),
    listPortalShifts(staffId, { from: today, to: today }),
    listPortalShifts(staffId, {
      from: weekStart,
      to: addDays(weekStart, 6),
      includeCancelled: false,
    }),
    RosterShift.find({
      staffIds: staff._id,
      date: { $gte: monthStart, $lte: today },
    })
      .select("timesheets date")
      .lean<Pick<RosterShiftDoc, "timesheets" | "date">[]>(),
    ownNotesCount(staffId),
    IncidentReport.countDocuments({ staffId, status: "Draft" }),
    AbcReport.countDocuments({ staffId, status: "Draft" }),
  ]);
  const monthKm = await LogbookEntry.aggregate([
    { $match: { staffId: staff._id, date: { $gte: monthStart, $lte: today } } },
    { $group: { _id: null, km: { $sum: "$kilometres" } } },
  ]);
  const hoursThisMonth = monthShifts.reduce((total, shift) => {
    const row = shift.timesheets?.find(t => String(t.staffId) === staffId);
    if (row?.startedAt && row.endedAt)
      return (
        total +
        Math.max(
          0,
          (row.endedAt.getTime() - row.startedAt.getTime()) / 3_600_000 -
            (row.breakMinutes ?? 0) / 60
        )
      );
    return total;
  }, 0);
  const weekHours = weekShifts.reduce(
    (total, shift) =>
      total + (shift.timesheet.workedMinutes ?? shift.hours * 60) / 60,
    0
  );

  const upcoming = todayShifts
    .filter(
      shift => shift.status !== "Completed" && shift.status !== "Cancelled"
    )
    .sort((a, b) => a.start.localeCompare(b.start));
  const nextShift: PortalShiftDTO | null =
    upcoming.find(
      shift => shift.status === "Confirmed" || shift.status === "Planned"
    ) ??
    upcoming[0] ??
    null;

  const checklist = checklistItemsDTO(staff, profile, today);
  const progress = checklistProgress(checklist);
  const alerts: PortalHomeDTO["alerts"] = [];
  const expired = checklist.filter(item => item.expiryState === "expired");
  const soon = checklist.filter(
    item => item.expiryState === "soon" || item.expiryState === "urgent"
  );
  if (expired.length)
    alerts.push({
      key: `expired:${expired.length}`,
      severity: "danger",
      title: `${expired.length} document${expired.length === 1 ? " has" : "s have"} expired`,
      message: expired
        .slice(0, 2)
        .map(item => item.label)
        .join(", "),
      link: "/staff/profile",
    });
  if (soon.length)
    alerts.push({
      key: `expiring:${soon.length}`,
      severity: "warning",
      title: `${soon.length} document${soon.length === 1 ? " expires" : "s expire"} soon`,
      message: soon
        .slice(0, 2)
        .map(item => `${item.label} (${item.daysLeft}d)`)
        .join(", "),
      link: "/staff/profile",
    });

  const returned = await ServiceRecord.countDocuments({
    staffId,
    status: "Returned",
  });
  if (returned)
    alerts.push({
      key: `returned:${returned}`,
      severity: "warning",
      title: "Notes need correction",
      message: `${returned} progress note${returned === 1 ? " was" : "s were"} returned for changes.`,
      link: "/staff/notes?status=Returned",
    });
  if (progress.completePct < 100 && !expired.length && !soon.length)
    alerts.push({
      key: "checklist",
      severity: "info",
      title: `${progress.completePct}% profile complete`,
      message: `${progress.total - progress.approved} checklist item${progress.total - progress.approved === 1 ? "" : "s"} left to complete.`,
      link: "/staff/profile",
    });

  return {
    today,
    greetingName: firstName(staff.name),
    nextShift,
    todayShifts,
    weekShifts,
    weekHours: Math.round(weekHours * 10) / 10,
    hoursThisMonth: Math.round(hoursThisMonth * 10) / 10,
    kmThisMonth: Number(monthKm[0]?.km ?? 0),
    openNotes: notes.open,
    drafts: { reports: incidentDrafts + abcDrafts, notes: notes.drafts },
    alerts,
  };
}
