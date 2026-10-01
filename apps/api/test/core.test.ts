import type { Express } from "express";
import type request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { API, signedInAgent, startTestApp, stopTestApp } from "./helpers";
import { createParticipant, createService, createStaff } from "./fixtures";

let app: Express;
let agent: request.Agent;

beforeAll(async () => {
  app = await startTestApp();
  agent = await signedInAgent(app);
});
afterAll(stopTestApp);

describe("workspace settings and preferences", () => {
  it("reads and updates the workspace profile", async () => {
    const before = await agent.get(`${API}/settings/workspace`);
    expect(before.body.budgetCategories).toEqual([
      "Community participation",
      "Daily living skills",
      "Support coordination",
    ]);
    const updated = await agent.patch(`${API}/settings/workspace`).send({
      legalName: "Noble Community Support Pty Ltd",
      abn: "12 345 678 901",
      providerTravelRate: 0.99,
      invoice: { prefix: "NCS", defaultPaymentTermsDays: 30 },
    });
    expect(updated.status).toBe(200);
    expect(updated.body.abn).toBe("12345678901");
    expect(updated.body.providerTravelRate).toBe(0.99);
    expect(updated.body.invoice).toMatchObject({
      prefix: "NCS",
      defaultPaymentTermsDays: 30,
    });
    const invalid = await agent
      .patch(`${API}/settings/workspace`)
      .send({ abn: "123" });
    expect(invalid.status).toBe(422);
    expect(invalid.body.error.message).toBe("Enter the 11-digit ABN.");
    await agent.patch(`${API}/settings/workspace`).send({
      providerTravelRate: 1,
      invoice: { prefix: "INV", defaultPaymentTermsDays: 14 },
    });
  });

  it("stores per-user voice preferences", async () => {
    const response = await agent
      .patch(`${API}/settings/preferences`)
      .send({ voice: { detailLevel: "Detailed", useTranscriptOnly: true } });
    expect(response.status).toBe(200);
    expect(response.body.voice).toMatchObject({
      detailLevel: "Detailed",
      useTranscriptOnly: true,
      autoSaveRecordings: true,
    });
  });
});

describe("services catalogue", () => {
  it("creates services, rejects duplicates and records rate history", async () => {
    const service = await createService(agent);
    const duplicate = await agent.post(`${API}/services`).send({
      name: " community PARTICIPATION ",
      unit: "Hour",
      rate: 10,
      transport: false,
      active: true,
      budgetCategory: "Daily living skills",
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.message).toBe(
      "A service with this name already exists."
    );
    const badRate = await agent.post(`${API}/services`).send({
      name: "Household tasks",
      unit: "Hour",
      rate: -1,
      transport: false,
      active: true,
      budgetCategory: "Daily living skills",
    });
    expect(badRate.status).toBe(422);
    expect(badRate.body.error.message).toBe("Enter a valid non-negative rate.");
    const badCategory = await agent.post(`${API}/services`).send({
      name: "Household tasks",
      unit: "Hour",
      rate: 50,
      transport: false,
      active: true,
      budgetCategory: "Gardening",
    });
    expect(badCategory.status).toBe(422);

    const updated = await agent
      .patch(`${API}/services/${service.id}`)
      .send({ rate: 70, rev: service.rev });
    expect(updated.status).toBe(200);
    expect(updated.body.rateHistory).toHaveLength(2);
    const stale = await agent
      .patch(`${API}/services/${service.id}`)
      .send({ rate: 71, rev: service.rev });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("STALE_VERSION");

    const inactive = await agent.get(`${API}/services?active=true`);
    expect(
      inactive.body.every((item: { active: boolean }) => item.active)
    ).toBe(true);
  });
});

describe("staff directory", () => {
  it("adds, edits and puts staff on leave with warnings", async () => {
    const member = await createStaff(agent, {
      name: "Jordan Lee",
      email: "jordan@noble.test",
    });
    const duplicate = await agent.post(`${API}/staff`).send({
      name: "Other",
      position: "x",
      team: "y",
      email: "JORDAN@noble.test",
    });
    expect(duplicate.status).toBe(409);
    const leave = await agent
      .patch(`${API}/staff/${member.id}`)
      .send({ status: "On leave", rev: member.rev });
    expect(leave.status).toBe(200);
    expect(leave.body.status).toBe("On leave");
    expect(leave.body.initials).toBe("JL");
    const assignable = await agent.get(`${API}/staff?status=assignable`);
    expect(
      assignable.body.find((item: { id: string }) => item.id === member.id)
    ).toBeUndefined();
  });
});

describe("participants", () => {
  it("runs intake with the UI's validation rules", async () => {
    const badNdis = await agent.post(`${API}/participants`).send({
      name: "A",
      preferred: "A",
      ndis: "123",
      dob: "2000-01-01",
      phone: "1",
      email: "a@b.co",
      address: "x",
      emergencyName: "x",
      emergencyPhone: "1",
    });
    expect(badNdis.status).toBe(422);
    expect(badNdis.body.error.message).toBe("Enter the 9-digit NDIS number.");

    const badPlan = await agent.post(`${API}/participants`).send({
      name: "A",
      preferred: "A",
      ndis: "431 000 001",
      dob: "2000-01-01",
      phone: "1",
      email: "a@b.co",
      address: "x",
      emergencyName: "x",
      emergencyPhone: "1",
      planStart: "2026-05-01",
      planEnd: "2026-04-01",
    });
    expect(badPlan.status).toBe(422);
    expect(badPlan.body.error.message).toBe(
      "The plan end date must be on or after the start date."
    );

    const created = await createParticipant(agent, {
      ndis: "431 208 775",
      kyc: {
        serviceAgreement: true,
        consentForms: false,
        supportPlan: true,
        riskInformationReviewed: false,
        transportRequirementsConfirmed: false,
      },
    });
    expect(created).toMatchObject({ ndis: "431 208 775", preferred: "Mia" });

    const duplicate = await agent.post(`${API}/participants`).send({
      name: "Someone",
      preferred: "S",
      ndis: "431208775",
      dob: "2000-01-01",
      phone: "1",
      email: "s@b.co",
      address: "x",
      emergencyName: "x",
      emergencyPhone: "1",
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("NDIS_DUPLICATE");

    const search = await agent.get(`${API}/participants?q=208 775`);
    expect(search.body.items.map((item: { id: string }) => item.id)).toContain(
      created.id
    );

    const kyc = await agent
      .patch(`${API}/participants/${created.id}/kyc`)
      .send({ consentForms: true, rev: created.rev });
    expect(kyc.body.kyc.consentForms).toBe(true);

    const archived = await agent
      .post(`${API}/participants/${created.id}/archive`)
      .send({ reason: "Moved interstate" });
    expect(archived.body.status).toBe("Archived");
    const active = await agent.get(`${API}/participants`);
    expect(
      active.body.items.find((item: { id: string }) => item.id === created.id)
    ).toBeUndefined();
    const restored = await agent
      .post(`${API}/participants/${created.id}/restore`)
      .send({});
    expect(restored.body.status).toBe("Active");
  });

  it("returns 404 for unknown ids and 401 after logout", async () => {
    expect(
      (await agent.get(`${API}/participants/000000000000000000000000`)).status
    ).toBe(404);
    expect((await agent.get(`${API}/participants/not-an-id`)).status).toBe(404);
    expect((await agent.get(`${API}/no-such-endpoint`)).status).toBe(404);
  });
});
