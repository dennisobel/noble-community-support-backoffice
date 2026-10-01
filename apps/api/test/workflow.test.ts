import type { Express } from "express";
import type request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays } from "@shared/logic/time";
import { API, signedInAgent, startTestApp, stopTestApp } from "./helpers";
import {
  approvedRecord,
  completeNote,
  createParticipant,
  createRecord,
  createService,
  createStaff,
  today,
} from "./fixtures";

let app: Express;
let agent: request.Agent;
let ids: { clientId: string; staffId: string; serviceId: string };
let groupServiceId: string;

beforeAll(async () => {
  app = await startTestApp();
  agent = await signedInAgent(app);
  const [service, group, staff, participant] = await Promise.all([
    createService(agent),
    createService(agent, { name: "Group community access", rate: 34.15 }),
    createStaff(agent, { name: "Jordan Lee" }),
    createParticipant(agent),
  ]);
  ids = { clientId: participant.id, staffId: staff.id, serviceId: service.id };
  groupServiceId = group.id;
});
afterAll(stopTestApp);

describe("service record workflow", () => {
  it("computes billables, enforces submit rules and locks reviewed records", async () => {
    const draft = await createRecord(agent, ids, {
      confirmed: false,
      support: "",
    });
    expect(draft.status).toBe("Draft");
    expect(draft.id).toMatch(/^SR-\d{4}$/);
    // 3 h × $68.30 + 12.4 km × $1.00
    expect(draft.total).toBe(217.3);

    const noDeclaration = await agent
      .post(`${API}/service-records/${draft.id}/submit`)
      .send({ rev: draft.rev });
    expect(noDeclaration.status).toBe(422);
    expect(noDeclaration.body.error.message).toBe(
      "Please confirm the staff declaration before submitting."
    );

    const saved = await agent
      .patch(`${API}/service-records/${draft.id}`)
      .send({ confirmed: true, rev: draft.rev });
    const incomplete = await agent
      .post(`${API}/service-records/${draft.id}/submit`)
      .send({ rev: saved.body.rev });
    expect(incomplete.status).toBe(422);
    expect(incomplete.body.error.message).toBe(
      "Complete all progress note sections before submitting."
    );

    const completed = await agent
      .patch(`${API}/service-records/${draft.id}`)
      .send({ ...completeNote, rev: saved.body.rev });
    const submitted = await agent
      .post(`${API}/service-records/${draft.id}/submit`)
      .send({ rev: completed.body.rev });
    expect(submitted.status).toBe(200);
    expect(submitted.body).toMatchObject({
      status: "Submitted",
      billablesFrozen: true,
    });

    const locked = await agent
      .patch(`${API}/service-records/${draft.id}`)
      .send({ location: "Elsewhere" });
    expect(locked.status).toBe(409);
    expect(locked.body.error.code).toBe("INVALID_STATE");

    // Reviewer adjusts the travel line while submitted.
    const adjusted = await agent
      .patch(`${API}/service-records/${draft.id}/billables`)
      .send({ lines: [{ index: 1, quantity: 10 }], rev: submitted.body.rev });
    expect(adjusted.body.total).toBe(214.9);

    const returned = await agent
      .post(`${API}/service-records/${draft.id}/return`)
      .send({
        reason: "Add the departure and return points.",
        rev: adjusted.body.rev,
      });
    expect(returned.body).toMatchObject({
      status: "Returned",
      correction: "Add the departure and return points.",
    });

    // Saving a returned record keeps it Returned (the correction stays visible).
    const edited = await agent
      .patch(`${API}/service-records/${draft.id}`)
      .send({
        location: "Marion — from home and back",
        rev: returned.body.rev,
      });
    expect(edited.body.status).toBe("Returned");

    const resubmitted = await agent
      .post(`${API}/service-records/${draft.id}/submit`)
      .send({ rev: edited.body.rev });
    const approved = await agent
      .post(`${API}/service-records/${draft.id}/approve`)
      .send({ rev: resubmitted.body.rev });
    expect(approved.body.status).toBe("Approved");
    expect(approved.body.approvedBy.name).toBe("Maya Thompson");
    const actions = approved.body.history.map(
      (entry: { action: string }) => entry.action
    );
    expect(actions).toEqual(
      expect.arrayContaining([
        "created",
        "submitted",
        "billables_adjusted",
        "returned",
        "resubmitted",
        "approved",
      ])
    );

    // Frozen billables do not move when the rate changes later.
    const service = await agent.get(`${API}/services/${ids.serviceId}`);
    await agent
      .patch(`${API}/services/${ids.serviceId}`)
      .send({ rate: 99, rev: service.body.rev });
    expect(
      (await agent.get(`${API}/service-records/${draft.id}`)).body.total
    ).toBe(approved.body.total);
    await agent.patch(`${API}/services/${ids.serviceId}`).send({ rate: 68.3 });
  });

  it("rejects approving drafts and stale saves", async () => {
    const record = await createRecord(agent, ids);
    const approveDraft = await agent
      .post(`${API}/service-records/${record.id}/approve`)
      .send({});
    expect(approveDraft.status).toBe(409);
    await agent
      .patch(`${API}/service-records/${record.id}`)
      .send({ location: "A", rev: record.rev });
    const stale = await agent
      .patch(`${API}/service-records/${record.id}`)
      .send({ location: "B", rev: record.rev });
    expect(stale.body.error.code).toBe("STALE_VERSION");
    const deleted = await agent.delete(`${API}/service-records/${record.id}`);
    expect(deleted.status).toBe(204);
  });

  it("filters the review queue and counts statuses", async () => {
    const record = await createRecord(agent, ids);
    await agent.post(`${API}/service-records/${record.id}/submit`).send({});
    const queue = await agent.get(
      `${API}/service-records?status=Submitted&q=Mia`
    );
    expect(
      queue.body.items.every(
        (item: { status: string }) => item.status === "Submitted"
      )
    ).toBe(true);
    expect(queue.body.items[0]).toMatchObject({
      clientName: "Mia",
      staffName: "Jordan Lee",
    });
    const counts = await agent.get(`${API}/service-records/counts`);
    expect(counts.body.Submitted).toBeGreaterThanOrEqual(1);
  });
});

describe("budgets", () => {
  it("sets up a plan budget and tracks used, pending and committed spend", async () => {
    const participant = await createParticipant(agent, {
      name: "Noah Williams",
      preferred: "Noah",
    });
    const empty = await agent.get(
      `${API}/participants/${participant.id}/budget`
    );
    expect(empty.body).toEqual({ budget: null, metrics: null });

    const unconfirmed = await agent
      .put(`${API}/participants/${participant.id}/budget`)
      .send({
        planStart: participant.planStart,
        planEnd: participant.planEnd,
        categories: [{ name: "Community participation", allocation: 1000 }],
        confirmedAgainstPlan: false,
      });
    expect(unconfirmed.status).toBe(422);
    expect(unconfirmed.body.error.message).toBe(
      "Confirm the amounts against the approved client plan before saving."
    );

    const setup = await agent
      .put(`${API}/participants/${participant.id}/budget`)
      .send({
        planStart: participant.planStart,
        planEnd: participant.planEnd,
        categories: [
          { name: "Community participation", allocation: 1000 },
          { name: "Daily living skills", allocation: 500 },
        ],
        confirmedAgainstPlan: true,
      });
    expect(setup.status).toBe(201);
    expect(setup.body.metrics).toMatchObject({
      allocation: 1500,
      remaining: 1500,
      status: "Within plan",
    });

    const noahIds = { ...ids, clientId: participant.id };
    await approvedRecord(agent, noahIds); // $217.30 used
    const pending = await createRecord(agent, noahIds, { km: 0 }); // $204.90 pending
    await agent.post(`${API}/service-records/${pending.id}/submit`).send({});
    const shift = await agent.post(`${API}/roster/shifts`).send({
      date: addDays(today(), 1),
      start: "09:00",
      end: "11:00",
      ratio: "1:1",
      clientIds: [participant.id],
      staffIds: [ids.staffId],
      serviceId: ids.serviceId,
    });
    expect(shift.status).toBe(201);

    const budget = await agent.get(
      `${API}/participants/${participant.id}/budget`
    );
    const community = budget.body.metrics.categories.find(
      (row: { name: string }) => row.name === "Community participation"
    );
    expect(community).toMatchObject({
      used: 217.3,
      pending: 204.9,
      committed: 136.6,
      remaining: 441.2,
    });

    const noReason = await agent
      .post(`${API}/participants/${participant.id}/budget/adjustments`)
      .send({
        category: "Community participation",
        allocation: 100,
        reason: " ",
      });
    expect(noReason.body.error.message).toBe(
      "Add a reason for this allocation change."
    );
    const adjusted = await agent
      .post(`${API}/participants/${participant.id}/budget/adjustments`)
      .send({
        category: "Community participation",
        allocation: 400,
        reason: "Plan reassessment",
      });
    // The overall status uses the plan total (as the prototype did); the category row shows the overspend.
    expect(adjusted.body.metrics.status).toBe("Within plan");
    const overCategory = adjusted.body.metrics.categories.find(
      (row: { name: string }) => row.name === "Community participation"
    );
    expect(overCategory.remaining).toBeCloseTo(-158.8, 2);
    const history = await agent.get(
      `${API}/participants/${participant.id}/budget/adjustments`
    );
    expect(history.body[0]).toMatchObject({
      category: "Community participation",
      oldAllocation: 1000,
      newAllocation: 400,
      reason: "Plan reassessment",
    });

    // A new shift now warns that the budget would be over allocation.
    const warned = await agent.post(`${API}/roster/shifts`).send({
      date: addDays(today(), 2),
      start: "09:00",
      end: "10:00",
      ratio: "1:1",
      clientIds: [participant.id],
      staffIds: [ids.staffId],
      serviceId: ids.serviceId,
    });
    expect(warned.body.warnings.join(" ")).toContain("over allocation");
  });
});

describe("rostering", () => {
  it("applies ratio rules, overlap checks and status transitions", async () => {
    const [second, secondStaff] = await Promise.all([
      createParticipant(agent, { name: "Priya Nair", preferred: "Priya" }),
      createStaff(agent, { name: "Maya Thompson" }),
    ]);
    const date = addDays(today(), 3);
    const base = {
      date,
      start: "09:00",
      end: "12:00",
      serviceId: groupServiceId,
    };

    const badRatio = await agent.post(`${API}/roster/shifts`).send({
      ...base,
      ratio: "1:M",
      clientIds: [ids.clientId],
      staffIds: [ids.staffId],
    });
    expect(badRatio.status).toBe(422);
    expect(badRatio.body.error.message).toBe(
      "A 1:M shift requires one staff member and at least two participants."
    );

    const badTimes = await agent.post(`${API}/roster/shifts`).send({
      ...base,
      end: "08:00",
      ratio: "1:1",
      clientIds: [ids.clientId],
      staffIds: [ids.staffId],
    });
    expect(badTimes.body.error.message).toBe(
      "Choose a date and an end time later than the start time."
    );

    const group = await agent.post(`${API}/roster/shifts`).send({
      ...base,
      ratio: "1:M",
      clientIds: [ids.clientId, second.id],
      staffIds: [ids.staffId],
    });
    expect(group.status).toBe(201);
    expect(group.body.id).toMatch(/^SH-\d+$/);

    const overlap = await agent.post(`${API}/roster/shifts`).send({
      ...base,
      start: "11:00",
      end: "13:00",
      ratio: "1:1",
      clientIds: [second.id],
      staffIds: [secondStaff.id],
    });
    expect(overlap.status).toBe(409);
    expect(overlap.body.error).toMatchObject({
      code: "SHIFT_OVERLAP",
      message: `A participant is already rostered during this time (${group.body.id}). Resolve the overlap before saving.`,
    });

    const confirmed = await agent
      .post(`${API}/roster/shifts/${group.body.id}/status`)
      .send({ status: "Confirmed" });
    expect(confirmed.body.status).toBe("Confirmed");
    const completed = await agent
      .post(`${API}/roster/shifts/${group.body.id}/status`)
      .send({ status: "Completed" });
    expect(completed.body.status).toBe("Completed");
    const lockedEdit = await agent
      .patch(`${API}/roster/shifts/${group.body.id}`)
      .send({ location: "Somewhere" });
    expect(lockedEdit.status).toBe(409);

    const records = await agent
      .post(`${API}/roster/shifts/${group.body.id}/create-records`)
      .send({});
    expect(records.status).toBe(201);
    expect(records.body).toHaveLength(2);
    expect(records.body[0]).toMatchObject({
      status: "Draft",
      shiftId: group.body.id,
      type: "Group community access",
    });

    const week = await agent.get(
      `${API}/roster/shifts?from=${date}&to=${date}`
    );
    expect(week.body[0].recordIds).toHaveLength(2);
  });
});

describe("invoicing", () => {
  it("invoices approved records atomically and reverts them when the draft is deleted", async () => {
    const participant = await createParticipant(agent, {
      name: "Grace Chen",
      preferred: "Grace",
    });
    const graceIds = { ...ids, clientId: participant.id };
    const [first, second] = await Promise.all([
      approvedRecord(agent, graceIds),
      approvedRecord(agent, graceIds, { start: "13:00", end: "15:00", km: 0 }),
    ]);
    const draftRecord = await createRecord(agent, graceIds);

    const notApproved = await agent.post(`${API}/invoices`).send({
      clientId: participant.id,
      recordIds: [first.id, draftRecord.id],
    });
    expect(notApproved.status).toBe(409);
    expect(notApproved.body.error.code).toBe("RECORD_NOT_APPROVED");

    // Two simultaneous attempts for the same record: exactly one succeeds.
    const attempts = await Promise.all([
      agent.post(`${API}/invoices`).send({
        clientId: participant.id,
        recordIds: [first.id, second.id],
        paymentTermsDays: 7,
      }),
      agent
        .post(`${API}/invoices`)
        .send({ clientId: participant.id, recordIds: [first.id] }),
    ]);
    const created = attempts.find(response => response.status === 201)!;
    expect(attempts.filter(response => response.status === 201)).toHaveLength(
      1
    );
    expect(attempts.filter(response => response.status === 409)).toHaveLength(
      1
    );
    const invoice = created.body;
    expect(invoice.id).toMatch(/^INV-\d{4}-\d{3}$/);
    expect(invoice.recipient).toBe("Bright Path Plan Management");

    const record = await agent.get(`${API}/service-records/${first.id}`);
    expect(record.body).toMatchObject({
      status: "Invoiced",
      invoiceId: invoice.id,
    });

    const pdf = await agent
      .get(`${API}/invoices/${invoice.id}/pdf?download=1`)
      .buffer(true);
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    expect(pdf.headers["content-disposition"]).toContain("attachment");
    expect(Buffer.from(pdf.body).subarray(0, 5).toString()).toBe("%PDF-");

    const deleted = await agent.delete(`${API}/invoices/${invoice.id}`);
    expect(deleted.status).toBe(204);
    expect(
      (await agent.get(`${API}/service-records/${first.id}`)).body
    ).toMatchObject({ status: "Approved", invoiceId: null });

    const again = await agent
      .post(`${API}/invoices`)
      .send({ clientId: participant.id, recordIds: [first.id, second.id] });
    expect(again.status).toBe(201);
    const sent = await agent
      .post(`${API}/invoices/${again.body.id}/mark-sent`)
      .send({});
    expect(sent.body.status).toBe("Sent");
    const paid = await agent
      .post(`${API}/invoices/${again.body.id}/mark-paid`)
      .send({ paidOn: today(), reference: "EFT 1234" });
    expect(paid.body).toMatchObject({
      status: "Paid",
      paidReference: "EFT 1234",
    });
    const summary = await agent.get(`${API}/invoices/summary`);
    expect(summary.body.paidThisPeriod).toBeGreaterThan(0);
  });
});

describe("dashboard, reports, notifications, search and activity", () => {
  it("aggregates live data", async () => {
    const dashboard = await agent.get(`${API}/dashboard`);
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.kpis.activeParticipants).toBeGreaterThanOrEqual(3);
    expect(dashboard.body.recentActivity.length).toBeGreaterThan(0);

    const reports = await agent.get(`${API}/reports/overview?period=last30`);
    expect(reports.body.documentationStatus.total).toBeGreaterThan(0);
    expect(reports.body.serviceActivity.length).toBeGreaterThanOrEqual(5);

    const csv = await agent.get(
      `${API}/reports/export?report=service-records&period=month`
    );
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.text.split("\r\n")[0]).toContain("Record,Date,Start,End");

    const notifications = await agent.get(`${API}/notifications`);
    expect(
      notifications.body.items.some(
        (item: { type: string }) => item.type === "review_pending"
      )
    ).toBe(true);
    await agent.post(`${API}/notifications/read`).send({});
    expect((await agent.get(`${API}/notifications`)).body.unread).toBe(0);

    const search = await agent.get(`${API}/search?q=Grace`);
    expect(search.body.participants[0].preferred).toBe("Grace");

    const activity = await agent.get(`${API}/activity?limit=5`);
    expect(activity.body.items).toHaveLength(5);
  });
});
