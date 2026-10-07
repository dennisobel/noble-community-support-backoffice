import { Router } from "express";
import type { MyDayDTO } from "@shared/dto";
import { myDayQuery } from "@shared/schemas/notes";
import { parse, requireAuth } from "../../lib/http";
import { workspaceToday } from "../../lib/workspace";
import { Staff, type StaffDoc } from "../../models";
import { listShifts } from "../roster/service";

/*
 * "My day": the signed-in person's own roster. They are matched to a team member by the
 * staff record linked to their account or, failing that, by their sign-in email, so adding
 * someone to the Staff directory with the same email is all it takes. Everyone approved
 * gets this page; it never shows anyone else's shifts.
 */
export async function myDay(
  user: { id: string; email: string },
  date?: string
): Promise<MyDayDTO> {
  const day = date ?? (await workspaceToday());
  const staff = await Staff.findOne({
    $or: [{ userId: user.id }, { email: user.email.toLowerCase() }],
  })
    .select("name")
    .lean<Pick<StaffDoc, "_id" | "name">>();
  if (!staff) return { date: day, email: user.email, staff: null, shifts: [], hours: 0 };
  const shifts = (
    await listShifts({ from: day, to: day, staffId: String(staff._id) })
  ).filter(shift => shift.status !== "Cancelled");
  const hours = shifts.reduce((total, shift) => total + shift.hours, 0);
  return {
    date: day,
    email: user.email,
    staff: { id: String(staff._id), name: staff.name },
    shifts,
    hours: Math.round(hours * 100) / 100,
  };
}

export function meRouter(): Router {
  const router = Router();
  router.get("/day", async (req, res) => {
    res.json(
      await myDay(requireAuth(req).user, parse(myDayQuery, req.query).date)
    );
  });
  return router;
}
