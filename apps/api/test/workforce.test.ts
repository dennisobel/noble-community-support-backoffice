/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, startOfWeek, zonedInstant } from "@shared/logic/time";
import { RosterShift } from "../src/models";
import { API, signedInAgent, startTestApp, stopTestApp } from "./helpers";
import {
  createParticipant,
  createService,
  createStaff,
  today,
} from "./fixtures";

/*
 * Employment, availability and leave on the Staff side; timesheets, the award and pay runs on the
 * payroll side; and the roster warnings that join the two. Dates are last week's, so every shift
 * is in the past and inside one weekly pay period whatever day the suite runs.
 */

const ZONE = "Australia/Adelaide";
const MON = startOfWeek(addDays(today(), -7));
const TUE = addDays(MON, 1);
const WED = addDays(MON, 2);
const SAT = addDays(MON, 5);
const WEEK_BEFORE = addDays(MON, -7);
const PASSWORD = "a good long password";

let app: Express;
let admin: request.Agent;
let clientId: string;
let serviceId: string;
let classificationId: string;
/** Ava is casual, Ben is part-time, Cal has no employment details yet. */
let ava: { id: string; name: string; email: string };
let ben: { id: string; name: string; email: string };
let cal: { id: string; name: string; email: string };
let avaAgent: request.Agent;
let mondayShift: string;
let saturdayShift: string;
let benLeaveId: string;
let runId: string;

beforeAll(async () => {
  app = await startTestApp();
  admin = await signedInAgent(app);
  const [service, participant] = await Promise.all([
    createService(admin),
    createParticipant(admin),
  ]);
  serviceId = service.id;
  clientId = participant.id;
});
afterAll(stopTestApp);

const shiftBody = (
  staffId: string,
  date: string,
  start: string,
  end: string
) => ({
  date,
  start,
  end,
  ratio: "1:1",
  clientIds: [clientId],
  staffIds: [staffId],
  serviceId,
  location: "Marion Shopping Centre",
});

async function rosterShift(
  staffId: string,
  date: string,
  start: string,
  end: string
): Promise<string> {
  const created = await admin
    .post(`${API}/roster/shifts`)
    .send(shiftBody(staffId, date, start, end));
  if (created.status !== 201)
    throw new Error(`shift: ${created.status} ${JSON.stringify(created.body)}`);
  return created.body.id;
}

/** Invites a worker, sets their password from the invite link and signs them in to the portal. */
async function portalAgent(staff: { id: string; email: string }) {
  const invite = await admin.post(`${API}/staff/${staff.id}/invite`).send({});
  expect(invite.status).toBe(201);
  const token =
    new URL(invite.body.invite.link).searchParams.get("token") ?? "";
  await request(app)
    .post(`${API}/auth/reset-password`)
    .send({ token, password: PASSWORD });
  const agent = request.agent(app);
  const signedIn = await agent
    .post(`${API}/auth/login`)
    .send({ email: staff.email, password: PASSWORD });
  expect(signedIn.status).toBe(200);
  return agent;
}

/** An approved back-office account with exactly these modules. */
async function officeAgent(email: string, modules: string[]) {
  await request(app)
    .post(`${API}/auth/register`)
    .send({ name: "Office Person", email, password: PASSWORD });
  const user = (await admin.get(`${API}/users`)).body.find(
    (candidate: any) => candidate.email === email
  );
  await admin
    .post(`${API}/users/${user.id}/approve`)
    .send({ role: "coordinator", modules });
  const agent = request.agent(app);
  await agent.post(`${API}/auth/login`).send({ email, password: PASSWORD });
  return agent;
}

const warningsFor = async (body: Record<string, unknown>) =>
  (
    (await admin.post(`${API}/roster/shifts/validate`).send(body)).body
      .warnings as string[]
  ).join(" ");

describe("pay rules", () => {
  it("starts with the award's percentages and says what still has to be entered", async () => {
    const settings = await admin.get(`${API}/payroll/settings`);
    expect(settings.status).toBe(200);
    expect(settings.body.rules).toMatchObject({
      casualLoadingPct: 25,
      saturdayPct: 150,
      sundayPct: 200,
      publicHolidayPct: 250,
      minimumEngagementHours: 2,
      standardRateWeekly: 0,
    });
    expect(settings.body.classifications).toEqual([]);
    expect(settings.body.missing.join(" ")).toContain("hourly rate");
    expect(settings.body.missing.join(" ")).toContain("standard rate");
  });

  it("saves classifications with dated rates, the dollar amounts and the pay period", async () => {
    const saved = await admin.put(`${API}/payroll/settings`).send({
      payPeriod: { length: "Weekly", anchor: "2024-01-01" },
      rules: { standardRateWeekly: 1200, vehicleAllowancePerKm: 1 },
      classifications: [
        {
          name: "SACS Level 2.1",
          rates: [
            { effectiveFrom: "2020-07-01", hourly: 30 },
            { effectiveFrom: "2099-07-01", hourly: 99 },
          ],
        },
      ],
    });
    expect(saved.status).toBe(200);
    expect(saved.body.payPeriod.length).toBe("Weekly");
    expect(saved.body.rules.standardRateWeekly).toBe(1200);
    // The rate that has started applies; the one dated in the future waits its turn.
    expect(saved.body.classifications[0]).toMatchObject({
      name: "SACS Level 2.1",
      currentRate: 30,
    });
    classificationId = saved.body.classifications[0].id;

    const twoOnOneDay = await admin.put(`${API}/payroll/settings`).send({
      classifications: [
        {
          id: classificationId,
          name: "SACS Level 2.1",
          rates: [
            { effectiveFrom: "2020-07-01", hourly: 30 },
            { effectiveFrom: "2020-07-01", hourly: 31 },
          ],
        },
      ],
    });
    expect(twoOnOneDay.status).toBe(422);

    const period = await admin.get(`${API}/payroll/period?date=${WED}`);
    expect(period.body.period).toMatchObject({
      from: MON,
      to: addDays(MON, 6),
    });
  });
});

describe("employment, availability and leave", () => {
  it("records how each person is employed, without showing a rate on the Staff side", async () => {
    const make = async (name: string, extra: Record<string, unknown>) => {
      const email = `${name.toLowerCase().replace(/\s+/g, ".")}@noble.test`;
      const created = await createStaff(admin, { name, email, ...extra });
      return { id: created.id, name, email };
    };
    ava = await make("Ava Casual", {
      employmentType: "Casual",
      classificationId,
      payrollId: "E-001",
    });
    ben = await make("Ben Parttime", {
      employmentType: "Part-time",
      classificationId,
      contractedHours: 20,
    });
    cal = await make("Cal Unset", {});

    const listed = (await admin.get(`${API}/staff`)).body;
    const avaRow = listed.find((member: any) => member.id === ava.id);
    expect(avaRow.employment).toEqual({
      type: "Casual",
      classificationId,
      classificationName: "SACS Level 2.1",
      contractedHours: 0,
      payrollId: "E-001",
    });
    expect(JSON.stringify(avaRow)).not.toContain("payRate");
    expect(
      listed.find((member: any) => member.id === cal.id).employment.type
    ).toBeNull();

    const unknown = await admin
      .patch(`${API}/staff/${cal.id}`)
      .send({ classificationId: "nope" });
    expect(unknown.status).toBe(422);

    // A classification someone is on cannot be removed from under them.
    const removed = await admin
      .put(`${API}/payroll/settings`)
      .send({ classifications: [] });
    expect(removed.status).toBe(409);
    expect(removed.body.error.message).toContain("2 team members");
  });

  it("keeps a weekly availability pattern and warns the roster when a shift falls outside it", async () => {
    const unset = await admin.get(`${API}/staff/${ava.id}/availability`);
    expect(unset.body.set).toBe(false);
    expect(unset.body.days).toHaveLength(7);

    const week = unset.body.days.map((day: any) =>
      day.day === 2
        ? { ...day, mode: "Not available" }
        : day.day === 3
          ? { ...day, mode: "Set hours", from: "09:00", to: "15:00" }
          : day
    );
    const backwards = await admin
      .put(`${API}/staff/${ava.id}/availability`)
      .send({
        days: week.map((day: any) =>
          day.day === 3 ? { ...day, from: "15:00", to: "09:00" } : day
        ),
      });
    expect(backwards.status).toBe(422);

    const saved = await admin
      .put(`${API}/staff/${ava.id}/availability`)
      .send({ days: week, note: "School pick-up on Thursdays" });
    expect(saved.status).toBe(200);
    expect(saved.body.set).toBe(true);

    expect(await warningsFor(shiftBody(ava.id, WED, "09:00", "12:00"))).toContain(
      "not available on Wednesdays"
    );
    expect(
      await warningsFor(shiftBody(ava.id, addDays(MON, 3), "13:00", "17:00"))
    ).toContain("only available 09:00–15:00 on Thursdays");
    expect(
      await warningsFor(shiftBody(ava.id, addDays(MON, 3), "09:00", "12:00"))
    ).not.toContain("only available");
  });

  it("tells the roster what the award makes of a shift, in words and never in dollars", async () => {
    const text = await warningsFor(shiftBody(ava.id, SAT, "10:00", "11:00"));
    expect(text).toContain("Ava Casual's shift is on a Saturday, paid at 175%");
    expect(text).toContain("under the 2-hour minimum");
    expect(text).not.toContain("$");
    // An ordinary weekday shift says nothing about the worker.
    expect(
      await warningsFor(shiftBody(ben.id, MON, "09:00", "13:00"))
    ).not.toContain("Ben Parttime");
  });

  it("lets the office record leave, warns the roster and refuses a second request over the same days", async () => {
    const recorded = await admin.post(`${API}/staff/leave`).send({
      staffId: ben.id,
      type: "Annual leave",
      from: TUE,
      to: TUE,
      hours: 7.6,
      approve: true,
    });
    expect(recorded.status).toBe(201);
    expect(recorded.body).toMatchObject({
      status: "Approved",
      staffName: "Ben Parttime",
      days: 1,
      hours: 7.6,
    });
    benLeaveId = recorded.body.id;

    expect(await warningsFor(shiftBody(ben.id, TUE, "09:00", "13:00"))).toContain(
      "Ben Parttime has approved annual leave"
    );

    const again = await admin.post(`${API}/staff/leave`).send({
      staffId: ben.id,
      type: "Unpaid leave",
      from: MON,
      to: WED,
    });
    expect(again.status).toBe(409);

    const backwards = await admin.post(`${API}/staff/leave`).send({
      staffId: ben.id,
      type: "Unpaid leave",
      from: WED,
      to: MON,
    });
    expect(backwards.status).toBe(422);
  });

  it("lets a worker ask from the portal and the office decide", async () => {
    avaAgent = await portalAgent(ava);

    // Not being free on a day with nothing rostered needs nobody's approval.
    const unavailable = await avaAgent.post(`${API}/portal/leave`).send({
      type: "Unavailable",
      from: addDays(today(), 30),
      to: addDays(today(), 30),
      reason: "Family event",
    });
    expect(unavailable.status).toBe(201);
    expect(unavailable.body.status).toBe("Approved");

    const asked = await avaAgent.post(`${API}/portal/leave`).send({
      type: "Unpaid leave",
      from: addDays(today(), 40),
      to: addDays(today(), 42),
    });
    expect(asked.status).toBe(201);
    expect(asked.body).toMatchObject({ status: "Pending", days: 3 });

    const queue = await admin.get(`${API}/staff/leave?status=Pending`);
    expect(queue.body).toHaveLength(1);
    const bell = await admin.get(`${API}/notifications`);
    expect(bell.body.items.map((item: any) => item.type)).toContain(
      "leave_request"
    );

    const decided = await admin
      .post(`${API}/staff/leave/${asked.body.id}/decision`)
      .send({ decision: "Approved", note: "Enjoy the break" });
    expect(decided.status).toBe(200);
    expect(decided.body).toMatchObject({
      status: "Approved",
      decisionNote: "Enjoy the break",
    });
    expect(
      (
        await admin
          .post(`${API}/staff/leave/${asked.body.id}/decision`)
          .send({ decision: "Declined" })
      ).status
    ).toBe(409);

    // Each worker sees only their own requests, and can withdraw one that has not started.
    const mine = await avaAgent.get(`${API}/portal/leave`);
    expect(mine.body).toHaveLength(2);
    expect(mine.body.every((row: any) => row.staffId === ava.id)).toBe(true);
    const withdrawn = await avaAgent.post(
      `${API}/portal/leave/${asked.body.id}/cancel`
    );
    expect(withdrawn.body.status).toBe("Cancelled");
    expect(
      (await avaAgent.post(`${API}/portal/leave/${benLeaveId}/cancel`)).status
    ).toBe(404);
  });
});

describe("timesheets", () => {
  it("lists every rostered shift in the pay period against what was recorded", async () => {
    mondayShift = await rosterShift(ava.id, MON, "09:00", "12:00");
    saturdayShift = await rosterShift(ava.id, SAT, "10:00", "11:00");

    const list = await admin.get(`${API}/payroll/timesheets?date=${MON}`);
    expect(list.status).toBe(200);
    expect(list.body.period).toMatchObject({ from: MON, to: addDays(MON, 6) });
    expect(list.body.rows).toHaveLength(2);
    expect(list.body.rows.map((row: any) => row.status)).toEqual([
      "No sign-on",
      "No sign-on",
    ]);
    expect(list.body.totals).toMatchObject({ missing: 2, rosteredHours: 4 });
  });

  it("approves in one go the sign-offs that match the roster", async () => {
    // Ava signed on three minutes late and off four minutes late: inside the ten-minute tolerance.
    await RosterShift.updateOne(
      { _id: mondayShift },
      {
        $set: {
          timesheets: [
            {
              staffId: ava.id,
              startedAt: zonedInstant(MON, 9 * 60 + 3, ZONE),
              endedAt: zonedInstant(MON, 12 * 60 + 4, ZONE),
              breakMinutes: 0,
              kilometres: 0,
              notes: "",
            },
          ],
        },
      }
    );
    const waiting = await admin.get(`${API}/payroll/timesheets?date=${MON}`);
    const row = waiting.body.rows.find((r: any) => r.shiftId === mondayShift);
    expect(row).toMatchObject({ status: "Awaiting approval", clean: true });
    expect(row.actual).toMatchObject({ start: "09:03", end: "12:04" });
    expect(row.paid).toMatchObject({ start: "09:00", end: "12:00", minutes: 180 });
    const bell = await admin.get(`${API}/notifications`);
    expect(bell.body.items.map((item: any) => item.type)).toContain(
      "timesheets_pending"
    );

    const bulk = await admin
      .post(`${API}/payroll/timesheets/approve-clean`)
      .send({ date: MON });
    expect(bulk.body).toEqual({ approved: 1, left: 0 });
    const after = await admin.get(`${API}/payroll/timesheets?date=${MON}`);
    expect(
      after.body.rows.find((r: any) => r.shiftId === mondayShift).status
    ).toBe("Approved");
    // Approving the hours also marks the shift as worked.
    expect(
      (await admin.get(`${API}/roster/shifts/${mondayShift}`)).body.status
    ).toBe("Completed");
  });

  it("lets the office enter the hours itself and shows how they turn into pay", async () => {
    const path = `${API}/payroll/timesheets/${saturdayShift}/${ava.id}`;
    const backwards = await admin
      .post(`${path}/approve`)
      .send({ start: "11:00", end: "10:00" });
    expect(backwards.status).toBe(422);

    const approved = await admin
      .post(`${path}/approve`)
      .send({ start: "10:00", end: "11:00", kilometres: 10, note: "No phone signal" });
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({
      status: "Approved",
      costed: true,
      kilometres: 10,
      gross: 115,
    });
    const byCode = Object.fromEntries(
      approved.body.lines.map((line: any) => [line.code, line])
    );
    // One hour on a Saturday for a casual: 175% of $30.00, topped up to the two-hour minimum.
    expect(byCode.SAT).toMatchObject({ hours: 1, pct: 175, rate: 52.5, amount: 52.5 });
    expect(byCode.MIN).toMatchObject({ hours: 1, amount: 52.5 });
    expect(byCode.KM).toMatchObject({ units: 10, amount: 10 });
    expect(byCode.SAT.why).toContain("casual loading");

    const future = await rosterShift(ava.id, addDays(today(), 3), "09:00", "12:00");
    expect(
      (
        await admin
          .post(`${API}/payroll/timesheets/${future}/${ava.id}/approve`)
          .send({ start: "09:00", end: "12:00" })
      ).status
    ).toBe(409);
  });

  it("shows a worker their own hours, and stops them changing hours already approved", async () => {
    const mine = await avaAgent.get(`${API}/portal/timesheets?date=${MON}`);
    expect(mine.status).toBe(200);
    expect(mine.body.rows).toHaveLength(2);
    expect(JSON.stringify(mine.body)).not.toContain("gross");

    const changed = await avaAgent
      .post(`${API}/portal/shifts/${mondayShift}/timesheet`)
      .send({ action: "save", notes: "Actually I stayed later" });
    expect(changed.status).toBe(409);
    expect(changed.body.error.message).toContain("approved the hours");

    // The pay endpoints are the office's.
    expect((await avaAgent.get(`${API}/payroll/timesheets`)).status).toBe(403);
  });
});

describe("pay runs", () => {
  it("works out gross pay for the period from approved timesheets and approved leave", async () => {
    const created = await admin
      .post(`${API}/payroll/pay-runs`)
      .send({ date: MON });
    expect(created.status).toBe(201);
    runId = created.body.id;
    expect(created.body).toMatchObject({
      status: "Draft",
      from: MON,
      staffCount: 2,
    });
    const item = (name: string) =>
      created.body.items.find((row: any) => row.staffName === name);
    // Ava: 3 h at 125% ($112.50) + Saturday hour and its top-up ($105.00) + 10 km ($10.00)
    expect(item("Ava Casual")).toMatchObject({
      payrollId: "E-001",
      employmentType: "Casual",
      hours: 5,
      gross: 227.5,
    });
    // Ben: 7.6 h of annual leave at $30.00 ($228.00) plus the 17.5% loading ($39.90)
    expect(item("Ben Parttime")).toMatchObject({ hours: 7.6, gross: 267.9 });
    expect(created.body.gross).toBe(495.4);

    // Asking for the same period again continues the draft instead of starting a second one.
    const again = await admin.post(`${API}/payroll/pay-runs`).send({ date: TUE });
    expect(again.body.id).toBe(runId);
  });

  it("takes an adjustment, then locks what it paid when it is finalised", async () => {
    const adjusted = await admin
      .post(`${API}/payroll/pay-runs/${runId}/adjustments`)
      .send({ staffId: ava.id, label: "First aid allowance", amount: 50 });
    expect(adjusted.status).toBe(201);
    expect(
      adjusted.body.items.find((row: any) => row.staffId === ava.id).gross
    ).toBe(277.5);
    expect(
      (
        await admin
          .post(`${API}/payroll/pay-runs/${runId}/adjustments`)
          .send({ staffId: cal.id, label: "Not in the run", amount: 5 })
      ).status
    ).toBe(422);

    const finalised = await admin
      .post(`${API}/payroll/pay-runs/${runId}/finalise`)
      .send({});
    expect(finalised.status).toBe(200);
    expect(finalised.body).toMatchObject({ status: "Finalised", gross: 545.4 });

    const rows = (await admin.get(`${API}/payroll/timesheets?date=${MON}`)).body
      .rows;
    expect(rows.map((row: any) => row.status)).toEqual([
      "In pay run",
      "In pay run",
    ]);
    const locked = await admin.post(
      `${API}/payroll/timesheets/${mondayShift}/${ava.id}/unapprove`
    );
    expect(locked.status).toBe(409);
    expect(locked.body.error.message).toContain(runId);
    expect(
      (await admin.post(`${API}/staff/leave/${benLeaveId}/cancel`)).status
    ).toBe(409);
    // Nothing is left to pay in that period, so a second run has nothing in it.
    expect(
      (await admin.post(`${API}/payroll/pay-runs`).send({ date: MON })).status
    ).toBe(409);
  });

  it("exports the run for the payroll system", async () => {
    const summary = await admin.get(`${API}/payroll/pay-runs/${runId}/export`);
    expect(summary.status).toBe(200);
    expect(summary.headers["content-type"]).toContain("text/csv");
    expect(summary.text).toContain("Gross pay");
    expect(summary.text).toContain("E-001,Ava Casual,Casual,SACS Level 2.1,30");

    const lines = await admin.get(
      `${API}/payroll/pay-runs/${runId}/export?detail=lines`
    );
    expect(lines.text).toContain("Saturday (175%)");
    expect(lines.text).toContain("Adjustment: First aid allowance");
  });

  it("can be reopened, which unlocks the timesheets again", async () => {
    const reopened = await admin.post(
      `${API}/payroll/pay-runs/${runId}/reopen`
    );
    expect(reopened.body.status).toBe("Draft");
    const rows = (await admin.get(`${API}/payroll/timesheets?date=${MON}`)).body
      .rows;
    expect(rows.every((row: any) => row.status === "Approved")).toBe(true);
    expect(
      (await admin.delete(`${API}/payroll/pay-runs/${runId}`)).status
    ).toBe(204);
    expect((await admin.get(`${API}/payroll/pay-runs`)).body).toEqual([]);
  });

  it("will not finalise while someone in the run has no employment type or pay rate", async () => {
    const shift = await rosterShift(cal.id, WEEK_BEFORE, "09:00", "12:00");
    const hours = await admin
      .post(`${API}/payroll/timesheets/${shift}/${cal.id}/approve`)
      .send({ start: "09:00", end: "12:00" });
    expect(hours.body).toMatchObject({ costed: false, gross: 0 });
    expect(hours.body.costNote).toContain("no employment type");

    const run = await admin
      .post(`${API}/payroll/pay-runs`)
      .send({ date: WEEK_BEFORE });
    expect(run.body.warnings.join(" ")).toContain("Cal Unset");
    const refused = await admin
      .post(`${API}/payroll/pay-runs/${run.body.id}/finalise`)
      .send({});
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toContain("Cal Unset");

    await admin
      .patch(`${API}/staff/${cal.id}`)
      .send({ employmentType: "Part-time", classificationId });
    const ready = await admin
      .post(`${API}/payroll/pay-runs/${run.body.id}/finalise`)
      .send({});
    expect(ready.status).toBe(200);
    expect(ready.body.gross).toBe(90);
  });
});

describe("sleepovers and cancelled shifts", () => {
  /** A fortnight back, clear of the pay periods the tests above have already run. */
  const NIGHT = addDays(MON, -13);
  const MORNING = addDays(MON, -12);

  it("pays a sleepover service as an allowance, with time worked in the night at overtime rates", async () => {
    const sleepover = await createService(admin, {
      name: "Night-time sleepover",
      unit: "Session",
      payAs: "Sleepover",
    });
    const listed = (await admin.get(`${API}/services`)).body;
    expect(
      listed.find((service: any) => service.id === sleepover.id).payAs
    ).toBe("Sleepover");
    expect(
      listed.find((service: any) => service.id === serviceId).payAs
    ).toBe("Hours worked");

    // The roster holds a shift within one day, so the night is entered either side of midnight.
    const night = (start: string, end: string, date: string) => ({
      ...shiftBody(ben.id, date, start, end),
      serviceId: sleepover.id,
    });
    // Nothing about hours applies to a sleepover, so the roster has nothing to say about pay.
    expect(await warningsFor(night("22:00", "23:59", NIGHT))).not.toContain(
      "Ben Parttime's shift"
    );
    const evening = await admin
      .post(`${API}/roster/shifts`)
      .send(night("22:00", "23:59", NIGHT));
    const early = await admin
      .post(`${API}/roster/shifts`)
      .send(night("00:00", "06:00", MORNING));
    expect([evening.status, early.status]).toEqual([201, 201]);

    const first = await admin
      .post(`${API}/payroll/timesheets/${evening.body.id}/${ben.id}/approve`)
      .send({ start: "22:00", end: "23:59", sleepoverActiveMinutes: 20 });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      payAs: "Sleepover",
      sleepoverActiveMinutes: 20,
    });
    const second = await admin
      .post(`${API}/payroll/timesheets/${early.body.id}/${ben.id}/approve`)
      .send({ start: "00:00", end: "06:00" });
    expect(second.status).toBe(200);

    const paid = await admin.get(
      `${API}/payroll/timesheets/${evening.body.id}/${ben.id}`
    );
    const codes = paid.body.lines.map((line: any) => line.code).sort();
    // One allowance for the whole night (4.9% of the $1,200.00 standard rate), and the twenty
    // minutes worked paid as the one-hour minimum at 150% of $30.00. No hourly pay, no top-up.
    expect(codes).toEqual(["OT1", "SLP"]);
    const byCode = Object.fromEntries(
      paid.body.lines.map((line: any) => [line.code, line])
    );
    expect(byCode.SLP.amount).toBe(58.8);
    expect(byCode.OT1).toMatchObject({ hours: 1, pct: 150, amount: 45 });
    expect(paid.body.gross).toBe(103.8);
    // The second half of the same night adds nothing: it is the same sleepover.
    expect(
      (
        await admin.get(
          `${API}/payroll/timesheets/${early.body.id}/${ben.id}`
        )
      ).body
    ).toMatchObject({ lines: [], gross: 0 });
  });

  it("pays a cancelled shift only when the office says the worker is owed it", async () => {
    const shift = await rosterShift(ben.id, addDays(MON, -11), "09:00", "12:00");
    const current = (await admin.get(`${API}/roster/shifts/${shift}`)).body;
    const cancelled = await admin
      .post(`${API}/roster/shifts/${shift}/status`)
      .send({ status: "Cancelled", rev: current.rev });
    expect(cancelled.status).toBe(200);

    // A cancelled shift stays out of the list unless it is asked for.
    const period = `date=${addDays(MON, -11)}`;
    const hidden = await admin.get(`${API}/payroll/timesheets?${period}`);
    expect(hidden.body.rows.some((row: any) => row.shiftId === shift)).toBe(false);
    const shown = await admin.get(
      `${API}/payroll/timesheets?${period}&cancelled=true`
    );
    expect(
      shown.body.rows.find((row: any) => row.shiftId === shift).status
    ).toBe("Cancelled");

    const path = `${API}/payroll/timesheets/${shift}/${ben.id}/approve`;
    const refused = await admin.post(path).send({ start: "09:00", end: "12:00" });
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toContain("cancelled");

    const owed = await admin
      .post(path)
      .send({ start: "09:00", end: "12:00", payCancelled: true });
    expect(owed.status).toBe(200);
    expect(owed.body).toMatchObject({
      status: "Approved",
      payCancelled: true,
      shiftStatus: "Cancelled",
      gross: 90,
    });
    // Paying it does not put the shift back on the roster.
    expect((await admin.get(`${API}/roster/shifts/${shift}`)).body.status).toBe(
      "Cancelled"
    );
  });
});

describe("who can see pay", () => {
  it("gives the Staff module classification names only, and payroll the rates", async () => {
    const staffOnly = await officeAgent("people@noble.test", ["staff"]);
    expect((await staffOnly.get(`${API}/payroll/classifications`)).body).toEqual([
      { id: classificationId, name: "SACS Level 2.1" },
    ]);
    expect((await staffOnly.get(`${API}/staff/leave`)).status).toBe(200);
    for (const path of ["/payroll/settings", "/payroll/staff", "/payroll/pay-runs"])
      expect((await staffOnly.get(`${API}${path}`)).status, path).toBe(403);

    const payroll = await officeAgent("pay@noble.test", ["payroll"]);
    expect((await payroll.get(`${API}/payroll/settings`)).status).toBe(200);
    const people = await payroll.get(`${API}/payroll/staff`);
    expect(
      people.body.find((row: any) => row.staffId === ava.id)
    ).toMatchObject({ baseRate: 30, payRateOverride: null, missing: "" });

    // A rate agreed with one person replaces their classification's.
    const agreed = await payroll
      .put(`${API}/payroll/staff/${ava.id}/rate`)
      .send({ payRateOverride: 35 });
    expect(agreed.body).toMatchObject({ baseRate: 35, payRateOverride: 35 });
    expect((await payroll.get(`${API}/staff/leave`)).status).toBe(403);
  });
});
