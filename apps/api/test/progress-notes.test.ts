/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays } from "@shared/logic/time";
import { Activity, Invoice, RosterShift, ServiceRecord } from "../src/models";
import { API, signedInAgent, startTestApp, stopTestApp } from "./helpers";
import {
  completeNote,
  createParticipant,
  createRecord,
  createService,
  today,
} from "./fixtures";

let app: Express;
let admin: request.Agent;
let worker: request.Agent;
let staffId: string;
let clientId: string;
let otherClientId: string;
let serviceId: string;
/** Yesterday's shift, which has finished and needs a note. */
let shiftId: string;
let noteId: string;

const WORKER = {
  name: "Jordan Lee",
  email: "jordan.notes@noble.test",
  password: "a good long password",
};
const GOAL = "Build independence with community access";

const paths = (body: any): string[] =>
  (body.error.details ?? []).map((detail: { path: string }) => detail.path);
const overview = async (query = "") =>
  (await admin.get(`${API}/service-records/overview${query}`)).body;

beforeAll(async () => {
  app = await startTestApp();
  admin = await signedInAgent(app);
  const [service, participant, other] = await Promise.all([
    createService(admin),
    createParticipant(admin),
    createParticipant(admin, { name: "Noah Williams", preferred: "Noah" }),
  ]);
  serviceId = service.id;
  clientId = participant.id;
  otherClientId = other.id;

  // A support worker with a portal login, the way the office sets one up.
  await request(app).post(`${API}/auth/staff-signup`).send({
    name: WORKER.name,
    email: WORKER.email,
    phone: "08 5550 0141",
    position: "Support Worker",
  });
  const pending = await admin.get(`${API}/staff/applications?status=Pending`);
  const review = await admin
    .post(`${API}/staff/applications/${pending.body[0].id}/review`)
    .send({
      decision: "Approved",
      position: "Support Worker",
      team: "Community Support",
      grantAccess: true,
    });
  staffId = review.body.staff.id;
  await request(app)
    .post(`${API}/auth/reset-password`)
    .send({
      token: new URL(review.body.invite.link).searchParams.get("token"),
      password: WORKER.password,
    });
  worker = request.agent(app);
  await worker
    .post(`${API}/auth/login`)
    .send({ email: WORKER.email, password: WORKER.password });

  const shift = await admin.post(`${API}/roster/shifts`).send({
    date: addDays(today(), -1),
    start: "09:00",
    end: "12:00",
    ratio: "1:1",
    clientIds: [clientId],
    staffIds: [staffId],
    serviceId,
    location: "Marion Shopping Centre",
  });
  expect(shift.status).toBe(201);
  shiftId = shift.body.id;
});
afterAll(stopTestApp);

describe("writing a progress note", () => {
  it("lists a finished shift with no note as missing", async () => {
    const before = await overview();
    expect(before.missing).toBe(1);
    expect(before.missingNotes[0]).toMatchObject({
      shiftId,
      clientId,
      staffId,
      staffName: WORKER.name,
    });
    // Narrowed to someone else, the same shift is not theirs to chase
    expect((await overview(`?clientId=${otherClientId}`)).missing).toBe(0);
  });

  it("only lets a worker write about the people on their roster", async () => {
    const stranger = await worker.post(`${API}/portal/notes`).send({
      clientId: otherClientId,
      serviceId,
      date: today(),
      start: "09:00",
      end: "10:00",
    });
    expect(stranger.status).toBe(403);
  });

  it("keeps a draft until every section is complete, then submits it", async () => {
    const draft = await worker.post(`${API}/portal/notes`).send({
      clientId,
      serviceId,
      date: addDays(today(), -1),
      start: "09:00",
      end: "12:00",
      location: "Marion Shopping Centre",
      shiftId,
    });
    expect(draft.status).toBe(201);
    noteId = draft.body.id;
    expect(draft.body).toMatchObject({ status: "Draft", shiftId, staffId });

    // The shift is no longer missing a note: it is waiting to be finished
    const drafted = await overview();
    expect(drafted.missing).toBe(0);
    expect(drafted.awaitingSubmission).toBe(1);

    const declared = await worker
      .patch(`${API}/portal/notes/${noteId}`)
      .send({ confirmed: true, rev: draft.body.rev });
    const empty = await worker.post(`${API}/portal/notes/${noteId}/submit`);
    expect(empty.status).toBe(422);
    expect(paths(empty.body)).toEqual([
      "supportTypes",
      "summary",
      "health",
      "incident",
    ]);

    // A health concern and an incident each ask for their own details
    const partial = await worker.patch(`${API}/portal/notes/${noteId}`).send({
      supportTypes: ["Community access", "Other support"],
      summary: "Mia chose the cafe and ordered for herself.",
      goals: [GOAL],
      health: ["Health concern identified", "Medication support provided"],
      incident: ["Incident occurred"],
      rev: declared.body.rev,
    });
    expect(partial.status).toBe(200);
    const unfinished = await worker.post(
      `${API}/portal/notes/${noteId}/submit`
    );
    expect(unfinished.status).toBe(422);
    expect(paths(unfinished.body)).toEqual(["healthDetails", "incidentDetails"]);
    // "No concerns" cannot sit beside a concern
    const muddled = await worker.patch(`${API}/portal/notes/${noteId}`).send({
      health: ["No concerns", "Health concern identified"],
      rev: partial.body.rev,
    });
    expect(
      paths((await worker.post(`${API}/portal/notes/${noteId}/submit`)).body)
    ).toContain("health");

    const complete = await worker.patch(`${API}/portal/notes/${noteId}`).send({
      support: "Helped Mia practise using her bank card at the counter.",
      outcome: "Mia paid without prompting for the first time.",
      achievements: "First unprompted card payment.",
      health: ["Health concern identified", "Medication support provided"],
      healthDetails: "Mia mentioned a headache at 11:00. Told the office.",
      incident: ["No incident"],
      followUp: "Check with Mia whether the headache has passed.",
      rev: muddled.body.rev,
    });
    expect(complete.status).toBe(200);
    const submitted = await worker
      .post(`${API}/portal/notes/${noteId}/submit`)
      .send({ rev: complete.body.rev });
    expect(submitted.status).toBe(200);
    expect(submitted.body).toMatchObject({
      status: "Submitted",
      attention: true,
      amended: false,
      goals: [GOAL],
      shiftId,
    });
    expect(submitted.body.submittedAt).toBeTruthy();
    expect(submitted.body.submittedBy.name).toBe(WORKER.name);

    const after = await overview();
    expect(after).toMatchObject({
      completedToday: 1,
      awaitingSubmission: 0,
      missing: 0,
      needsReview: 1,
      flagged: 1,
    });
    // The concern is put in front of the people who review notes
    const bell = await admin.get(`${API}/notifications`);
    expect(bell.body.items.map((item: any) => item.type)).toContain(
      "note_flagged"
    );
  });

  it("does not approve the timesheet or raise an invoice by itself", async () => {
    const shift = await RosterShift.findById(shiftId).lean();
    expect(shift!.recordIds).toContain(noteId);
    expect((shift!.timesheets ?? []).every(sheet => !sheet.approved)).toBe(
      true
    );
    expect(await Invoice.countDocuments()).toBe(0);
    expect(
      (await admin.get(`${API}/service-records/${noteId}`)).body.status
    ).toBe("Submitted");
  });
});

describe("correcting a submitted note", () => {
  let requestId: string;

  it("is closed to the worker, who asks for an amendment instead", async () => {
    const edit = await worker
      .patch(`${API}/portal/notes/${noteId}`)
      .send({ summary: "Changed after the fact." });
    expect(edit.status).toBe(409);

    const vague = await worker
      .post(`${API}/portal/notes/${noteId}/amendment-requests`)
      .send({ reason: "  " });
    expect(vague.status).toBe(422);
    const asked = await worker
      .post(`${API}/portal/notes/${noteId}/amendment-requests`)
      .send({ reason: "The headache was at 10:00, not 11:00." });
    expect(asked.status).toBe(200);
    expect(asked.body.amendmentRequests).toHaveLength(1);
    expect(asked.body.amendmentRequests[0]).toMatchObject({
      status: "Open",
      by: { name: WORKER.name },
    });
    requestId = asked.body.amendmentRequests[0].id;
    // The note itself has not moved
    expect(asked.body.healthDetails).toContain("11:00");
    const twice = await worker
      .post(`${API}/portal/notes/${noteId}/amendment-requests`)
      .send({ reason: "Again." });
    expect(twice.status).toBe(409);
    expect((await overview()).amendmentRequests).toBe(1);
  });

  it("is amended by the office with a reason, keeping what it said before", async () => {
    const current = (await admin.get(`${API}/service-records/${noteId}`)).body;
    const base = `${API}/service-records/${noteId}/amend`;
    expect(
      (await admin.post(base).send({ healthDetails: "x", rev: current.rev }))
        .status
    ).toBe(422);
    const nothing = await admin
      .post(base)
      .send({ reason: "No change", rev: current.rev });
    expect(nothing.status).toBe(422);
    // An amendment cannot leave the note incomplete
    const hollow = await admin
      .post(base)
      .send({ summary: "", reason: "Clearing it", rev: current.rev });
    expect(hollow.status).toBe(422);
    expect(paths(hollow.body)).toEqual(["summary"]);

    const fixed = "Mia mentioned a headache at 10:00. Told the office.";
    const amended = await admin.post(base).send({
      healthDetails: fixed,
      reason: "Time corrected at the worker's request",
      requestId,
      rev: current.rev,
    });
    expect(amended.status).toBe(200);
    expect(amended.body).toMatchObject({
      status: "Submitted",
      amended: true,
      healthDetails: fixed,
    });
    expect(amended.body.amendments).toHaveLength(1);
    expect(amended.body.amendments[0]).toMatchObject({
      reason: "Time corrected at the worker's request",
      requestId,
      by: { name: "Maya Thompson" },
      changes: [
        {
          field: "healthDetails",
          label: "Health details",
          before: current.healthDetails,
          after: fixed,
        },
      ],
    });
    expect(amended.body.amendmentRequests[0]).toMatchObject({
      status: "Applied",
      resolvedBy: { name: "Maya Thompson" },
    });
    expect(amended.body.history.map((entry: any) => entry.action)).toContain(
      "amended"
    );
    // The same request cannot be answered twice
    const again = await admin.post(base).send({
      followUp: "Something else",
      reason: "Second go",
      requestId,
      rev: amended.body.rev,
    });
    expect(again.status).toBe(409);

    // A worker's later request can be declined, with the note untouched
    const second = await worker
      .post(`${API}/portal/notes/${noteId}/amendment-requests`)
      .send({ reason: "Please remove the headache altogether." });
    const declined = await admin
      .post(
        `${base}ment-requests/${second.body.amendmentRequests[1].id}/decline`
      )
      .send({ note: "It happened, so it stays on the record." });
    expect(declined.status).toBe(200);
    expect(declined.body.amendmentRequests[1]).toMatchObject({
      status: "Declined",
      resolution: "It happened, so it stays on the record.",
    });
    expect(declined.body.healthDetails).toBe(fixed);
  });

  it("leaves a draft to be edited the ordinary way", async () => {
    const draft = await createRecord(admin, { clientId, staffId, serviceId });
    const amend = await admin
      .post(`${API}/service-records/${draft.id}/amend`)
      .send({ summary: "New text", reason: "Trying", rev: draft.rev });
    expect(amend.status).toBe(409);
    expect(
      (await admin.delete(`${API}/service-records/${draft.id}`)).status
    ).toBe(204);
  });
});

describe("finding and reading notes", () => {
  it("filters by what a note flags and searches what it says", async () => {
    const ids = async (query: string) =>
      (await admin.get(`${API}/service-records?${query}`)).body.items.map(
        (item: any) => item.id
      );
    expect(await ids("flag=amended")).toEqual([noteId]);
    expect(await ids("flag=attention")).toEqual([noteId]);
    expect(await ids("flag=requests")).toEqual([]);
    expect(await ids("q=bank%20card")).toEqual([noteId]);
    expect(await ids(`clientId=${otherClientId}`)).toEqual([]);
    expect(
      await ids(`staffId=${staffId}&from=${addDays(today(), -1)}&to=${today()}`)
    ).toEqual([noteId]);
  });

  it("exports a PDF to someone allowed to read it, and logs the export", async () => {
    const pdf = await admin
      .get(`${API}/service-records/${noteId}/pdf?download=1`)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on("data", chunk => chunks.push(chunk as Buffer));
        res.on("end", () => done(null, Buffer.concat(chunks)));
      });
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toContain("application/pdf");
    expect(pdf.headers["content-disposition"]).toContain(
      `progress-note-${noteId}.pdf`
    );
    expect(pdf.headers["cache-control"]).toContain("no-store");
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe("%PDF-");
    expect(
      await Activity.countDocuments({
        action: "record.exported",
        entityId: noteId,
      })
    ).toBe(1);

    // Not for a worker, and not without signing in
    expect(
      (await worker.get(`${API}/service-records/${noteId}/pdf`)).status
    ).toBe(403);
    expect(
      (await request(app).get(`${API}/service-records/${noteId}/pdf`)).status
    ).toBe(401);
  });

  it("hands the last notes to the next worker on the roster, and nobody else", async () => {
    const handover = await worker.get(
      `${API}/portal/participants/${clientId}/handover`
    );
    expect(handover.status).toBe(200);
    expect(handover.body).toHaveLength(1);
    expect(handover.body[0]).toMatchObject({
      id: noteId,
      staffName: WORKER.name,
      followUp: "Check with Mia whether the headache has passed.",
    });
    const closed = await worker.get(
      `${API}/portal/participants/${otherClientId}/handover`
    );
    expect(closed.status).toBe(404);
  });

  it("reads a note written before the shift summary was one box", async () => {
    const old = await createRecord(admin, { clientId, staffId, serviceId });
    await ServiceRecord.updateOne(
      { _id: old.id },
      {
        $set: {
          summary: "",
          response: "Settled throughout.",
          observations: "No incidents observed.",
        },
      }
    );
    const read = (await admin.get(`${API}/service-records/${old.id}`)).body;
    expect(read.summary).toBe("Settled throughout.\n\nNo incidents observed.");
    // Saving it stores the one box and retires the two it was read from
    const saved = await admin
      .patch(`${API}/service-records/${old.id}`)
      .send({
        summary: "Settled throughout; nothing to report.",
        rev: read.rev,
      });
    expect(saved.body.summary).toBe("Settled throughout; nothing to report.");
    const stored = await ServiceRecord.findById(old.id).lean();
    expect(stored).toMatchObject({ response: "", observations: "" });
    expect(completeNote.supportTypes.length).toBeGreaterThan(0);
  });
});
