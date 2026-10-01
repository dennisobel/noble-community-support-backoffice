import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config, loadConfig, setConfig } from "../src/config";
import { seedDemo } from "../src/db/seed";
import { API, startTestApp, stopTestApp } from "./helpers";

let app: Express;

beforeAll(async () => {
  setConfig(
    loadConfig({
      ...process.env,
      DEMO_ENABLED: "true",
      DEMO_ADMIN_PASSWORD: "demo-password-123",
    })
  );
  app = await startTestApp();
});
afterAll(stopTestApp);

describe("demo seed", () => {
  it("loads the prototype's sample data and signs in through the demo endpoint", async () => {
    const result = await seedDemo();
    expect(result).toMatchObject({
      seeded: true,
      email: config().demo.adminEmail,
      generatedPassword: null,
    });
    expect((await seedDemo({ onlyIfEmpty: true })).seeded).toBe(false);

    const agent = request.agent(app);
    const demo = await agent.post(`${API}/auth/demo`).send({});
    expect(demo.status).toBe(200);
    expect(demo.body.user.name).toBe("Maya Thompson");

    const participants = await agent.get(`${API}/participants`);
    expect(participants.body.total).toBe(5);
    const counts = await agent.get(`${API}/service-records/counts`);
    expect(counts.body).toEqual({
      Draft: 1,
      Submitted: 1,
      Returned: 1,
      Approved: 1,
      Invoiced: 1,
    });
    const dashboard = await agent.get(`${API}/dashboard`);
    expect(dashboard.body.kpis).toEqual({
      awaitingReview: 1,
      needsCompletion: 2,
      readyToInvoice: 1,
      activeParticipants: 5,
    });
    expect(dashboard.body.todayShifts).toHaveLength(3);

    // Sample ids continue from the seeded sequences.
    const service = (await agent.get(`${API}/services`)).body[0];
    const staff = (await agent.get(`${API}/staff?status=assignable`)).body[0];
    const record = await agent.post(`${API}/service-records`).send({
      clientId: participants.body.items[0].id,
      staffId: staff.id,
      serviceId: service.id,
      date: dashboard.body.today,
      start: "09:00",
      end: "10:00",
    });
    expect(record.body.id).toBe("SR-1049");

    const login = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: config().demo.adminEmail, password: "demo-password-123" });
    expect(login.status).toBe(200);
  });
});
