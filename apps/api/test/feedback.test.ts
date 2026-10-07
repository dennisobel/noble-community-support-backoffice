/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addBusinessDays } from "@shared/logic/holidays";
import { addDays } from "@shared/logic/time";
import { API, signedInAgent, startTestApp, stopTestApp } from "./helpers";
import { createParticipant, createStaff, today } from "./fixtures";

const PASSWORD = "a good long password";

let app: Express;
let admin: request.Agent;
let adminId: string;
let clientId: string;
let staff: { id: string; email: string };
let complaintId: string;
let formToken: string;
let incidentId: string;

beforeAll(async () => {
  app = await startTestApp();
  admin = await signedInAgent(app);
  adminId = (await admin.get(`${API}/auth/me`)).body.user.id;
  clientId = (await createParticipant(admin)).id;
  const email = "riley.worker@noble.test";
  staff = { id: (await createStaff(admin, { name: "Riley Worker", email })).id, email };
});
afterAll(stopTestApp);

const status = (id: string, body: Record<string, unknown>) =>
  admin.post(`${API}/feedback/${id}/status`).send(body);

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

describe("the register", () => {
  it("logs a complaint with a date to acknowledge by and a date to resolve by", async () => {
    const created = await admin.post(`${API}/feedback`).send({
      kind: "Complaint",
      channel: "Phone",
      summary: "Worker arrived forty minutes late twice",
      details: "Sarah rang to say the Tuesday and Thursday visits both started late.",
      desiredOutcome: "A call when the worker is running late.",
      area: "Service delivery",
      raisedBy: {
        name: "Sarah Carter",
        relationship: "Family or carer",
        phone: "0411 200 619",
      },
      participantId: clientId,
      staffId: staff.id,
    });
    expect(created.status).toBe(201);
    complaintId = created.body.id;
    expect(complaintId).toMatch(/^FB-\d{4}$/);
    expect(created.body).toMatchObject({
      status: "New",
      priority: "Medium",
      receivedOn: today(),
      raisedByName: "Sarah Carter",
      participantName: "Mia",
      staffName: "Riley Worker",
      acknowledgeBy: addBusinessDays(today(), 2, new Set()),
      resolveBy: addDays(today(), 21),
      due: { label: "Acknowledge", overdue: false },
    });

    const tomorrow = await admin.post(`${API}/feedback`).send({
      kind: "Suggestion",
      summary: "Later",
      details: "Not yet",
      receivedOn: addDays(today(), 1),
    });
    expect(tomorrow.status).toBe(422);
  });

  it("moves through the steps and wants an outcome before a complaint is resolved", async () => {
    const acknowledged = await status(complaintId, {
      status: "Acknowledged",
      note: "Rang Sarah back and apologised.",
    });
    expect(acknowledged.status).toBe(200);
    expect(acknowledged.body.acknowledgedAt).toBeTruthy();
    expect(acknowledged.body.due).toMatchObject({ label: "Resolve" });
    expect(acknowledged.body.history.at(-1)).toMatchObject({
      action: "acknowledged",
      note: "Rang Sarah back and apologised.",
    });
    expect((await status(complaintId, { status: "Acknowledged" })).status).toBe(409);

    const tooSoon = await status(complaintId, { status: "Resolved" });
    expect(tooSoon.status).toBe(422);
    expect(tooSoon.body.error.message).toContain("outcome");

    await status(complaintId, { status: "Investigating" });
    const resolved = await status(complaintId, {
      status: "Resolved",
      outcome: "Travel time between the two visits was too short. Roster changed.",
      satisfaction: "Yes",
    });
    expect(resolved.body).toMatchObject({
      status: "Resolved",
      satisfaction: "Yes",
      due: null,
    });
    expect(resolved.body.resolvedAt).toBeTruthy();

    const closed = await status(complaintId, { status: "Closed" });
    expect(closed.body.closedAt).toBeTruthy();
    // Reopening starts the clock again.
    const reopened = await status(complaintId, {
      status: "Investigating",
      note: "It happened again.",
    });
    expect(reopened.body).toMatchObject({ resolvedAt: null, closedAt: null });
    expect(reopened.body.history.at(-1).action).toBe("reopened");
    expect(reopened.body.due.label).toBe("Resolve");
  });

  it("keeps the corrective actions, the owner and what will change for good", async () => {
    const added = await admin
      .post(`${API}/feedback/${complaintId}/actions`)
      .send({
        description: "Add 20 minutes of travel between the two visits",
        owner: "Coordinator",
        due: addDays(today(), -1),
      });
    expect(added.status).toBe(201);
    expect(added.body.openActions).toBe(1);
    const action = added.body.actions[0];
    expect(action.overdue).toBe(true);

    const done = await admin
      .patch(`${API}/feedback/${complaintId}/actions/${action.id}`)
      .send({ done: true });
    expect(done.body.actions[0].doneAt).toBeTruthy();
    expect(done.body.actions[0].overdue).toBe(false);
    expect(done.body.openActions).toBe(0);

    const owned = await admin.patch(`${API}/feedback/${complaintId}`).send({
      ownerId: adminId,
      improvementNeeded: true,
      improvement: "Minimum travel gap added to the rostering checklist.",
    });
    expect(owned.body.owner.name).toBe("Maya Thompson");
    expect(owned.body.improvementNeeded).toBe(true);
    expect(
      (
        await admin
          .patch(`${API}/feedback/${complaintId}`)
          .send({ ownerId: staff.id })
      ).status
    ).toBe(422);

    const noted = await admin
      .post(`${API}/feedback/${complaintId}/notes`)
      .send({ note: "Sarah confirmed the next two visits were on time." });
    expect(noted.body.history.at(-1)).toMatchObject({ action: "note" });
  });

  it("lists what is open with the late ones first, and finds a case by its words", async () => {
    const old = await admin.post(`${API}/feedback`).send({
      kind: "Complaint",
      summary: "Invoice sent to the wrong plan manager",
      details: "Billing went to the previous plan manager.",
      area: "Billing",
      receivedOn: addDays(today(), -30),
    });
    expect(old.body.due).toMatchObject({ label: "Acknowledge", overdue: true });
    await admin.post(`${API}/feedback`).send({
      kind: "Compliment",
      summary: "Thank you to Riley",
      details: "Riley went out of their way on Saturday.",
      raisedBy: { anonymous: true, name: "A neighbour" },
    });

    const open = await admin.get(`${API}/feedback`);
    expect(open.body.items).toHaveLength(3);
    expect(open.body.items[0].id).toBe(old.body.id);
    expect(open.body.totals).toMatchObject({
      open: 3,
      overdue: 1,
      unacknowledged: 2,
    });
    // Someone who asked not to be named is not named in the list.
    expect(
      open.body.items.find((item: any) => item.kind === "Compliment").raisedByName
    ).toBe("Anonymous");

    const found = await admin.get(`${API}/feedback?q=plan%20manager&status=all`);
    expect(found.body.items.map((item: any) => item.id)).toEqual([old.body.id]);
    const compliments = await admin.get(`${API}/feedback?kind=Compliment`);
    expect(compliments.body.items).toHaveLength(1);

    const bell = await admin.get(`${API}/notifications`);
    expect(bell.body.items.map((item: any) => item.type)).toContain(
      "feedback_open"
    );

    const options = await admin.get(`${API}/feedback/options`);
    expect(options.body.participants).toHaveLength(1);
    expect(options.body.owners.map((owner: any) => owner.name)).toContain(
      "Maya Thompson"
    );
  });
});

describe("the public form", () => {
  it("is closed until the office turns it on", async () => {
    const guess = "A".repeat(32);
    expect((await request(app).get(`${API}/public/feedback/${guess}`)).body).toEqual({
      organisation: "Noble Community Support",
      open: false,
    });
    expect(
      (
        await request(app)
          .post(`${API}/public/feedback/${guess}`)
          .send({ kind: "Complaint", details: "Hello" })
      ).status
    ).toBe(404);

    const on = await admin.put(`${API}/feedback/form`).send({ enabled: true });
    expect(on.body.enabled).toBe(true);
    expect(on.body.url).toMatch(/\/feedback\/[A-Za-z0-9_-]{32}$/);
    formToken = on.body.url.split("/").pop();
  });

  it("takes feedback from anyone holding the link, named or not, and files it as new", async () => {
    const page = await request(app).get(`${API}/public/feedback/${formToken}`);
    expect(page.body.open).toBe(true);

    const sent = await request(app)
      .post(`${API}/public/feedback/${formToken}`)
      .send({
        kind: "Complaint",
        details: "Nobody told me my support worker had changed.\nI found out at the door.",
        about: "My Tuesday visits",
      });
    expect(sent.status).toBe(201);
    expect(sent.body.reference).toMatch(/^FB-\d{4}$/);

    const filed = await admin.get(`${API}/feedback/${sent.body.reference}`);
    expect(filed.body).toMatchObject({
      status: "New",
      channel: "Online form",
      viaPublicForm: true,
      raisedByName: "Anonymous",
      summary: "Nobody told me my support worker had changed.",
      aboutText: "My Tuesday visits",
      owner: null,
    });
    expect(filed.body.history[0].action).toBe("received from the public form");

    // Nothing can be read back through the public link.
    expect(
      (await request(app).get(`${API}/feedback/${sent.body.reference}`)).status
    ).toBe(401);
    expect(
      (
        await request(app)
          .post(`${API}/public/feedback/${formToken}`)
          .send({ kind: "Complaint", details: "" })
      ).status
    ).toBe(422);
  });

  it("drops what a script sends, and a new link stops the old one", async () => {
    const before = (await admin.get(`${API}/feedback?status=all`)).body.items
      .length;
    const bot = await request(app)
      .post(`${API}/public/feedback/${formToken}`)
      .send({ kind: "Suggestion", details: "Buy now", website: "http://spam.test" });
    expect(bot.status).toBe(201);
    expect((await admin.get(`${API}/feedback?status=all`)).body.items).toHaveLength(
      before
    );

    const fresh = await admin
      .put(`${API}/feedback/form`)
      .send({ enabled: true, regenerate: true });
    expect(fresh.body.url).not.toContain(formToken);
    expect(
      (await request(app).get(`${API}/public/feedback/${formToken}`)).body.open
    ).toBe(false);
    const off = await admin.put(`${API}/feedback/form`).send({ enabled: false });
    expect(off.body).toEqual({ enabled: false, url: null });
  });
});

describe("reportable incidents", () => {
  const flag = (body: Record<string, unknown>) =>
    admin.post(`${API}/incidents/${incidentId}/reportable`).send(body);
  const hoursAgo = (hours: number) =>
    new Date(Date.now() - hours * 3_600_000).toISOString();

  it("starts with nothing flagged on a worker's incident", async () => {
    const invite = await admin.post(`${API}/staff/${staff.id}/invite`).send({});
    const token =
      new URL(invite.body.invite.link).searchParams.get("token") ?? "";
    await request(app)
      .post(`${API}/auth/reset-password`)
      .send({ token, password: PASSWORD });
    const worker = request.agent(app);
    await worker
      .post(`${API}/auth/login`)
      .send({ email: staff.email, password: PASSWORD });
    const logged = await worker.post(`${API}/portal/incidents`).send({
      participantId: clientId,
      date: today(),
      time: "10:15",
      category: "Participant injury",
      severity: "Major",
      description: "Mia fell on the kerb and hurt her wrist.",
    });
    expect(logged.status).toBe(201);
    incidentId = logged.body.id;
    expect(logged.body.reportable).toMatchObject({ flagged: false, next: null });
    // Workers file incidents; deciding whether one is reportable is the office's.
    expect(
      (
        await worker
          .post(`${API}/incidents/${incidentId}/reportable`)
          .send({ flagged: true })
      ).status
    ).toBe(403);
  });

  it("counts 24 hours and five business days from when the office became aware", async () => {
    expect((await flag({ flagged: true })).status).toBe(422);
    expect(
      (
        await flag({
          flagged: true,
          type: "Serious injury of a participant",
          awareAt: new Date(Date.now() + 3_600_000).toISOString(),
        })
      ).status
    ).toBe(422);

    const awareAt = hoursAgo(2);
    const flagged = await flag({
      flagged: true,
      type: "Serious injury of a participant",
      awareAt,
    });
    expect(flagged.status).toBe(200);
    const { reportable } = flagged.body;
    expect(reportable.flagged).toBe(true);
    const aware = new Date(awareAt).getTime();
    expect(new Date(reportable.notifyBy).getTime() - aware).toBe(24 * 3_600_000);
    // Five business days always cross one weekend: a week on the calendar.
    expect(
      Math.round((new Date(reportable.fiveDayBy).getTime() - aware) / 86_400_000)
    ).toBe(7);
    expect(reportable.next).toMatchObject({
      label: "Immediate notification",
      overdue: false,
    });
  });

  it("moves on to the five-day report once the notification is lodged, then has nothing left", async () => {
    const notified = await flag({
      flagged: true,
      notified: true,
      notifiedReference: "RI-204417",
    });
    expect(notified.body.reportable).toMatchObject({
      notifiedReference: "RI-204417",
      next: { label: "Five-day report" },
    });
    expect(notified.body.reportable.notifiedAt).toBeTruthy();

    const done = await flag({ flagged: true, fiveDaySubmitted: true });
    expect(done.body.reportable.next).toBeNull();
    expect(done.body.reportable.fiveDayAt).toBeTruthy();
  });

  it("gives a restrictive practice that caused no harm five business days and no 24-hour step", async () => {
    const practice = await flag({
      flagged: true,
      type: "Unauthorised use of a restrictive practice",
      harm: false,
      notified: false,
      fiveDaySubmitted: false,
    });
    expect(practice.body.reportable.notifyBy).toBeNull();
    expect(practice.body.reportable.next.label).toBe("Five-day report");

    const harmful = await flag({ flagged: true, harm: true });
    expect(harmful.body.reportable.next.label).toBe("Immediate notification");
  });

  it("rings the bell when a deadline has passed, for people who review worker reports", async () => {
    const late = await flag({
      flagged: true,
      type: "Abuse or neglect of a participant",
      awareAt: hoursAgo(30),
    });
    expect(late.body.reportable.next).toMatchObject({
      label: "Immediate notification",
      overdue: true,
    });
    const bell = await admin.get(`${API}/notifications`);
    const item = bell.body.items.find(
      (candidate: any) => candidate.type === "incident_reportable"
    );
    expect(item.title).toBe("Immediate notification is overdue");
    expect(item.severity).toBe("danger");

    const cleared = await flag({ flagged: false });
    expect(cleared.body.reportable).toMatchObject({ flagged: false, next: null });
  });
});

describe("who can open the register", () => {
  it("needs the feedback module, which brings its own lists and nothing else", async () => {
    const feedbackOnly = await officeAgent("quality@noble.test", ["feedback"]);
    expect((await feedbackOnly.get(`${API}/feedback`)).status).toBe(200);
    expect((await feedbackOnly.get(`${API}/feedback/options`)).status).toBe(200);
    for (const path of ["/incidents", "/participants", "/staff", "/payroll/settings"])
      expect((await feedbackOnly.get(`${API}${path}`)).status, path).toBe(403);

    const reviewer = await officeAgent("reports@noble.test", ["worker-reports"]);
    expect((await reviewer.get(`${API}/feedback`)).status).toBe(403);
    expect(
      (
        await reviewer
          .post(`${API}/incidents/${incidentId}/reportable`)
          .send({ flagged: false })
      ).status
    ).toBe(200);
  });
});
