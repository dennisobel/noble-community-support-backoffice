import type { Express } from "express";
import { Types } from "mongoose";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, todayIn } from "@shared/logic/time";
import { StaffDocument } from "../src/models";
import { runExpirySweep } from "../src/modules/portal/expiry";
import { API, signedInAgent, startTestApp, stopTestApp } from "./helpers";
import { createParticipant, createService, today } from "./fixtures";

let app: Express;
/** The Admin who reviews applications and approves work. */
let admin: request.Agent;
/** The support worker, signed in to their own portal. */
let worker: request.Agent;
let staffId: string;
let shiftId: string;
let clientId: string;
let serviceId: string;

const WORKER = {
  name: "Jordan Lee",
  email: "jordan.lee@noble.test",
  password: "a good long password",
};

/** Pulls the one-time token out of the invite link so the test can set a password. */
const tokenFrom = (link: string) =>
  new URL(link).searchParams.get("token") ?? "";

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

describe("staff portal access", () => {
  it("turns a public request into a working login only after an Admin approves it", async () => {
    const applied = await request(app).post(`${API}/auth/staff-signup`).send({
      name: WORKER.name,
      email: WORKER.email,
      phone: "08 5550 0141",
      position: "Support Worker",
      experience: "Three years of community support.",
    });
    expect(applied.status).toBe(202);
    expect(applied.body.status).toBe("Pending");

    // Asking twice does not create a second application.
    const again = await request(app)
      .post(`${API}/auth/staff-signup`)
      .send({ name: WORKER.name, email: WORKER.email });
    expect(again.status).toBe(409);

    // Nothing exists to sign in with yet.
    const tooEarly = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: WORKER.email, password: WORKER.password });
    expect(tooEarly.status).toBe(401);

    const pending = await admin.get(`${API}/staff/applications?status=Pending`);
    expect(pending.status).toBe(200);
    expect(pending.body).toHaveLength(1);

    const review = await admin
      .post(`${API}/staff/applications/${pending.body[0].id}/review`)
      .send({
        decision: "Approved",
        position: "Support Worker",
        team: "Community Support",
        grantAccess: true,
      });
    expect(review.status).toBe(200);
    expect(review.body.staff.name).toBe(WORKER.name);
    expect(review.body.invite.link).toContain("/reset-password?token=");
    staffId = review.body.staff.id;

    // The invite link sets the password and opens the account.
    const accepted = await request(app)
      .post(`${API}/auth/reset-password`)
      .send({
        token: tokenFrom(review.body.invite.link),
        password: WORKER.password,
      });
    expect(accepted.status).toBe(204);

    worker = request.agent(app);
    const signedIn = await worker
      .post(`${API}/auth/login`)
      .send({ email: WORKER.email, password: WORKER.password });
    expect(signedIn.status).toBe(200);
    expect(signedIn.body.user.role).toBe("staff");
  });

  it("keeps workers out of the back office and Admins out of the portal", async () => {
    const intoBackOffice = await worker.get(`${API}/participants`);
    expect(intoBackOffice.status).toBe(403);
    const intoInvoices = await worker.get(`${API}/invoices`);
    expect(intoInvoices.status).toBe(403);

    const adminIntoPortal = await admin.get(`${API}/portal/home`);
    expect(adminIntoPortal.status).toBe(403);
  });
});

describe("a worker's day", () => {
  it("shows only their own roster", async () => {
    const shift = await admin.post(`${API}/roster/shifts`).send({
      date: today(),
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

    const mine = await worker.get(
      `${API}/portal/shifts?from=${today()}&to=${today()}`
    );
    expect(mine.status).toBe(200);
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0].id).toBe(shiftId);
    // The care information the worker needs on the day comes with the shift.
    expect(mine.body[0].participants[0].preferred).toBeTruthy();

    const home = await worker.get(`${API}/portal/home`);
    expect(home.status).toBe(200);
    expect(home.body.todayShifts).toHaveLength(1);
  });

  it("records a tracked job and turns the distance into kilometres", async () => {
    const started = await worker.post(`${API}/portal/tracking/start`).send({
      shiftId,
      location: { lat: -34.92, lng: 138.6 },
      accuracy: 8,
    });
    expect(started.status).toBe(201);
    const sessionId = started.body.id;
    expect(started.body.status).toBe("Active");

    // Two jobs at once would make the distances meaningless.
    const second = await worker
      .post(`${API}/portal/tracking/start`)
      .send({ shiftId });
    expect(second.status).toBe(409);

    // Roughly 1.1 km north each time, two minutes apart — about 33 km/h.
    const minutesOn = (minutes: number) =>
      new Date(Date.now() + minutes * 60_000).toISOString();
    const pinged = await worker
      .post(`${API}/portal/tracking/${sessionId}/pings`)
      .send({
        pings: [
          { lat: -34.91, lng: 138.6, accuracy: 6, at: minutesOn(2) },
          { lat: -34.9, lng: 138.6, accuracy: 6, at: minutesOn(4) },
        ],
      });
    expect(pinged.status).toBe(200);
    expect(pinged.body.kilometres).toBeGreaterThan(1.5);
    expect(pinged.body.nextIntervalSec).toBeGreaterThan(0);

    // A fix that would mean teleporting is dropped rather than inflating the distance.
    const teleport = await worker
      .post(`${API}/portal/tracking/${sessionId}/pings`)
      .send({
        pings: [{ lat: -31.95, lng: 115.86, accuracy: 6, at: minutesOn(5) }],
      });
    expect(teleport.status).toBe(200);
    expect(teleport.body.kilometres).toBe(pinged.body.kilometres);

    const resumed = await worker.get(`${API}/portal/tracking/active`);
    expect(resumed.body.active.id).toBe(sessionId);

    // The back office sees it live.
    const live = await admin.get(`${API}/tracking/live`);
    expect(live.status).toBe(200);
    expect(live.body.active).toHaveLength(1);
    expect(live.body.active[0].staffName).toBe(WORKER.name);
    expect(live.body.totals.activeCount).toBe(1);

    const stopped = await worker
      .post(`${API}/portal/tracking/${sessionId}/stop`)
      .send({ location: { lat: -34.9, lng: 138.6 } });
    expect(stopped.status).toBe(200);
    expect(stopped.body.status).toBe("Ended");
    expect(stopped.body.kilometres).toBeGreaterThan(1.5);

    const after = await worker.get(`${API}/portal/tracking/active`);
    expect(after.body.active).toBeNull();

    // The distance it measured becomes a logbook entry, once, with the trip attached.
    const logbook = await worker.get(`${API}/portal/logbook`);
    const tracked = logbook.body.filter(
      (entry: { trackingId: string | null }) => entry.trackingId === sessionId
    );
    expect(tracked).toHaveLength(1);
    expect(tracked[0].kilometres).toBe(stopped.body.kilometres);
    expect(tracked[0].shiftId).toBe(shiftId);

    // Stopping an already-stopped job must not log the same trip twice.
    const stopAgain = await worker.post(
      `${API}/portal/tracking/${sessionId}/stop`
    );
    expect(stopAgain.status).toBe(200);
    const recheck = await worker.get(`${API}/portal/logbook`);
    expect(
      recheck.body.filter(
        (entry: { trackingId: string | null }) => entry.trackingId === sessionId
      )
    ).toHaveLength(1);
  });

  it("writes a progress note that lands in the Admin's review queue", async () => {
    const draft = await worker.post(`${API}/portal/notes`).send({
      clientId,
      serviceId,
      date: today(),
      start: "09:00",
      end: "12:00",
      location: "Marion Shopping Centre",
      shiftId,
      km: 12.4,
    });
    expect(draft.status).toBe(201);
    expect(draft.body.status).toBe("Draft");

    const incomplete = await worker.post(
      `${API}/portal/notes/${draft.body.id}/submit`
    );
    expect(incomplete.status).toBe(422);

    const filled = await worker
      .patch(`${API}/portal/notes/${draft.body.id}`)
      .send({
        support: "Supported Mia with community access and shopping.",
        response: "Settled and engaged throughout.",
        outcome: "Practised making choices in the community.",
        observations: "No concerns.",
        followUp: "Bring the meal-planning worksheet next time.",
        confirmed: true,
        rev: draft.body.rev,
      });
    expect(filled.status).toBe(200);

    const submitted = await worker
      .post(`${API}/portal/notes/${draft.body.id}/submit`)
      .send({ rev: filled.body.rev });
    expect(submitted.status).toBe(200);
    expect(submitted.body.status).toBe("Submitted");

    const queue = await admin.get(`${API}/service-records?status=Submitted`);
    expect(queue.body.items.map((item: { id: string }) => item.id)).toContain(
      draft.body.id
    );

    // Once submitted it is the office's to change, not the worker's.
    const locked = await worker
      .patch(`${API}/portal/notes/${draft.body.id}`)
      .send({ support: "Changed my mind." });
    expect(locked.status).toBe(409);
  });

  it("files an incident and an ABC report for the office to review", async () => {
    const incident = await worker.post(`${API}/portal/incidents`).send({
      shiftId,
      participantId: clientId,
      date: today(),
      time: "10:30",
      location: "Marion Shopping Centre",
      category: "Near miss",
      severity: "Minor",
      description: "A trolley was left in the walkway and was moved aside.",
      immediateActions: "Moved the trolley and told centre staff.",
      notified: ["Coordinator"],
    });
    expect(incident.status).toBe(201);

    const abc = await worker.post(`${API}/portal/abc`).send({
      shiftId,
      participantId: clientId,
      date: today(),
      time: "11:00",
      behaviour: "Refusal",
      intensity: 2,
      durationMinutes: 5,
      antecedent: "Asked to join a busy queue.",
      behaviourDescription: "Declined and stepped away from the counter.",
      consequence: "Waited in a quieter spot and returned a few minutes later.",
    });
    expect(abc.status).toBe(201);

    const incidents = await admin.get(`${API}/incidents`);
    expect(incidents.status).toBe(200);
    expect(incidents.body).toHaveLength(1);

    const reviewed = await admin
      .post(`${API}/incidents/${incidents.body[0].id}/status`)
      .send({ status: "Reviewed", note: "Followed up with the centre." });
    expect(reviewed.status).toBe(200);
    expect(reviewed.body.status).toBe("Reviewed");

    const seen = await worker.get(`${API}/portal/incidents`);
    expect(seen.body[0].reviewNote).toBe("Followed up with the centre.");
  });

  it("keeps a worker's own kilometres and documents to themselves", async () => {
    const logged = await worker.post(`${API}/portal/logbook`).send({
      date: today(),
      type: "Kilometres",
      fromLocation: "Participant home",
      toLocation: "Marion Shopping Centre",
      purpose: "Community access",
      kilometres: 12.4,
    });
    expect(logged.status).toBe(201);

    const mine = await worker.get(`${API}/portal/logbook`);
    expect(mine.body.length).toBeGreaterThanOrEqual(1);

    const profile = await worker.get(`${API}/portal/profile`);
    expect(profile.status).toBe(200);
    expect(profile.body.staff.name).toBe(WORKER.name);
    expect(profile.body.checklist.length).toBeGreaterThan(0);
    expect(profile.body.progress.total).toBe(profile.body.checklist.length);

    const saved = await worker.patch(`${API}/portal/profile`).send({
      phone: "08 5550 0141",
      nextOfKin: {
        name: "Sam Lee",
        relationship: "Brother",
        phone: "08 5550 0142",
      },
      emergencyContacts: [
        { name: "Sam Lee", phone: "08 5550 0142", primary: true },
      ],
    });
    expect(saved.status).toBe(200);
    expect(saved.body.details.nextOfKin.name).toBe("Sam Lee");
  });

  it("closes the portal when an Admin turns access off", async () => {
    const revoked = await admin.post(`${API}/staff/${staffId}/revoke-access`);
    expect(revoked.status).toBe(200);

    const locked = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: WORKER.email, password: WORKER.password });
    expect(locked.status).toBe(401);
  });
});

describe("expiring documents", () => {
  it("counts an expiring certificate on the worker's compliance record", async () => {
    const compliance = await admin.get(`${API}/staff/${staffId}/compliance`);
    expect(compliance.status).toBe(200);
    expect(compliance.body.staffId).toBe(staffId);
    expect(compliance.body.today).toBe(todayIn("Australia/Adelaide"));
    // Nothing uploaded yet, so nothing is approved and nothing is expiring.
    expect(compliance.body.progress.approved).toBe(0);
    expect(compliance.body.progress.expiring).toBe(0);

    const reviewed = await admin
      .patch(`${API}/staff/${staffId}/checklist/nationalPoliceCheck`)
      .send({ status: "Approved", note: "Sighted the original." });
    expect(reviewed.status).toBe(200);
    const item = (reviewed.body as Array<{ key: string; status: string }>).find(
      entry => entry.key === "nationalPoliceCheck"
    );
    expect(item?.status).toBe("Approved");
  });

  it("reminds once per threshold as a certificate runs down, then flags it expired", async () => {
    const expiry = addDays(today(), 30);
    const document = await StaffDocument.create({
      staffId: new Types.ObjectId(staffId),
      checklistKey: "firstAidCertificate",
      title: "First aid certificate",
      expiry,
      uploadedBy: null,
    });

    // 30 days out is the first reminder threshold.
    const first = await runExpirySweep(today());
    expect(first.remindersSent).toBe(1);
    expect(first.notifiedDocuments[0].title).toBe("First aid certificate");

    // The same day does not send a second copy.
    const repeat = await runExpirySweep(today());
    expect(repeat.remindersSent).toBe(0);

    // A day later is still inside the 30-day window, so no new threshold is crossed.
    const quiet = await runExpirySweep(addDays(today(), 1));
    expect(quiet.remindersSent).toBe(0);

    // Crossing into the 7-day window earns another reminder.
    const urgent = await runExpirySweep(addDays(expiry, -7));
    expect(urgent.remindersSent).toBe(1);

    // Past the date it counts as expired, not as a reminder.
    const lapsed = await runExpirySweep(addDays(expiry, 1));
    expect(lapsed.expired).toBe(1);

    await StaffDocument.deleteOne({ _id: document._id });
  });
});
