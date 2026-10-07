/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACCESS_MODULES } from "@shared/enums";
import { API, signedInAgent, startTestApp, stopTestApp } from "./helpers";
import { createStaff } from "./fixtures";

let app: Express;
let admin: request.Agent;
let adminId: string;
let member: request.Agent;
let personId: string;

const person = {
  name: "Priya Nair",
  email: "priya@noble.test",
  password: "correct horse battery",
};
const NOBODY = "000000000000000000000000";
/** The request got past the access check (it may still fail validation, which is fine here). */
const allowed = (response: request.Response) =>
  response.status !== 403 && response.status !== 401;

beforeAll(async () => {
  app = await startTestApp();
  admin = await signedInAgent(app);
  adminId = (await admin.get(`${API}/auth/me`)).body.user.id;
});
afterAll(stopTestApp);

async function signIn(email: string, password: string) {
  const agent = request.agent(app);
  const response = await agent
    .post(`${API}/auth/login`)
    .send({ email, password });
  return { agent, response };
}
const ask = (body: Record<string, unknown>) =>
  request(app).post(`${API}/auth/register`).send(body);
const listed = async (email: string) =>
  (await admin.get(`${API}/users`)).body.find((u: any) => u.email === email);

describe("asking for access", () => {
  it("lets anyone ask, but they cannot sign in until an Admin approves", async () => {
    const weak = await ask({ ...person, password: "short" });
    expect(weak.status).toBe(422);

    const asked = await ask({ ...person, message: "I coordinate supports" });
    expect(asked.status).toBe(202);
    expect(asked.body.status).toBe("Pending");
    expect((await ask(person)).status).toBe(409);

    // Only someone who knows the password learns where their request stands.
    const waiting = await signIn(person.email, person.password);
    expect(waiting.response.status).toBe(403);
    expect(waiting.response.body.error.message).toContain("waiting");
    expect((await signIn(person.email, "not the password")).response.status).toBe(
      401
    );
  });

  it("shows the request to an Admin, and to no one else", async () => {
    const pending = await listed(person.email);
    expect(pending).toMatchObject({
      status: "pending",
      message: "I coordinate supports",
    });
    personId = pending.id;
    expect((await request(app).get(`${API}/users`)).status).toBe(401);
    const bell = await admin.get(`${API}/notifications`);
    expect(bell.body.items.map((item: any) => item.type)).toContain(
      "access_request"
    );
  });
});

describe("approving with a role and modules", () => {
  it("approves with a role and modules, then lets the person sign in", async () => {
    const approved = await admin
      .post(`${API}/users/${personId}/approve`)
      .send({ role: "coordinator", modules: ["clients", "roster"] });
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({
      status: "active",
      role: "coordinator",
      modules: ["roster", "clients"],
    });
    expect(
      (await admin.post(`${API}/users/${personId}/approve`).send({
        role: "finance",
        modules: ["invoices"],
      })).status
    ).toBe(409);

    const signedIn = await signIn(person.email, person.password);
    expect(signedIn.response.status).toBe(200);
    expect(signedIn.response.body.user).toMatchObject({
      role: "coordinator",
      modules: ["roster", "clients"],
    });
    member = signedIn.agent;
  });

  it("lets a member use only what they were given", async () => {
    // Their own modules, including writes
    expect(allowed(await member.get(`${API}/participants`))).toBe(true);
    expect(allowed(await member.post(`${API}/participants`).send({}))).toBe(true);
    expect(allowed(await member.get(`${API}/roster/shifts`))).toBe(true);
    // Lookups those modules need, read-only
    expect(allowed(await member.get(`${API}/services`))).toBe(true);
    expect(allowed(await member.get(`${API}/staff`))).toBe(true);
    expect(allowed(await member.get(`${API}/voice-notes`))).toBe(true);
    expect((await member.post(`${API}/services`).send({})).status).toBe(403);
    expect((await member.post(`${API}/voice-notes`).send({})).status).toBe(403);
    expect((await member.get(`${API}/staff/${NOBODY}/compliance`)).status).toBe(403);
    // Everyone in the back office
    expect((await member.get(`${API}/notifications`)).status).toBe(200);
    expect((await member.get(`${API}/settings/workspace`)).status).toBe(200);
    expect((await member.get(`${API}/settings/preferences`)).status).toBe(200);
    // Not theirs
    for (const path of [
      "/invoices",
      "/dashboard",
      "/reports/overview",
      "/staff/applications",
      "/tracking/live",
      "/users",
      "/activity",
      "/integrations/xero/status",
    ])
      expect((await member.get(`${API}${path}`)).status, path).toBe(403);
    expect(
      (await member.patch(`${API}/settings/workspace`).send({ name: "Mine now" }))
        .status
    ).toBe(403);

    // Search only returns groups from modules they have, and notifications follow suit
    const found = await member.get(`${API}/search`).query({ q: "an" });
    expect(found.status).toBe(200);
    expect(found.body.invoices).toEqual([]);
    expect(found.body.voiceNotes).toEqual([]);
    const bell = await member.get(`${API}/notifications`);
    expect(
      bell.body.items.map((item: any) => item.type)
    ).not.toContain("access_request");
  });

  it("applies a change on the next request and protects the Admin from themselves", async () => {
    const changed = await admin
      .patch(`${API}/users/${personId}`)
      .send({ modules: ["invoices"] });
    expect(changed.status).toBe(200);
    expect(changed.body.modules).toEqual(["invoices"]);

    // Same session, new rights
    expect(allowed(await member.get(`${API}/invoices`))).toBe(true);
    expect(allowed(await member.get(`${API}/participants`))).toBe(true); // names to bill
    expect((await member.post(`${API}/participants`).send({})).status).toBe(403);
    expect((await member.get(`${API}/roster/shifts`)).status).toBe(403);
    expect((await member.get(`${API}/staff`)).status).toBe(403);

    const self = await admin
      .patch(`${API}/users/${adminId}`)
      .send({ role: "manager", modules: ["clients"] });
    expect(self.status).toBe(409);
    expect(self.body.error.message).toContain("own access");
    // Nothing ticked is allowed: everyone approved still gets their own day and their notes.
    const bare = await admin
      .patch(`${API}/users/${personId}`)
      .send({ modules: [] });
    expect(bare.status).toBe(200);
    expect(bare.body.modules).toEqual([]);
    expect((await member.get(`${API}/me/day`)).status).toBe(200);
    expect((await member.get(`${API}/notes`)).status).toBe(200);
    expect((await member.get(`${API}/invoices`)).status).toBe(403);
  });

  it("can make another Admin, who then has every module and the user list", async () => {
    await ask({ name: "Sam Admin", email: "sam@noble.test", password: person.password });
    const sam = await listed("sam@noble.test");
    const made = await admin
      .post(`${API}/users/${sam.id}/approve`)
      .send({ role: "admin", modules: [] });
    expect(made.status).toBe(200);
    expect(made.body.modules).toEqual([...ACCESS_MODULES]);
    const second = await signIn("sam@noble.test", person.password);
    expect(second.response.status).toBe(200);
    expect((await second.agent.get(`${API}/users`)).status).toBe(200);
    expect((await second.agent.get(`${API}/invoices`)).status).toBe(200);
  });
});

describe("declining and switching off", () => {
  it("tells a declined person so, and lets an Admin change their mind", async () => {
    await ask({ name: "Rina Cole", email: "rina@noble.test", password: person.password });
    const rina = await listed("rina@noble.test");
    const declined = await admin
      .post(`${API}/users/${rina.id}/decline`)
      .send({ note: "Not part of the team" });
    expect(declined.status).toBe(200);
    expect(declined.body).toMatchObject({ status: "rejected", note: "Not part of the team" });

    const refused = await signIn("rina@noble.test", person.password);
    expect(refused.response.status).toBe(403);
    expect(refused.response.body.error.message).toContain("declined");
    // A request that already has an answer cannot be declined again
    expect(
      (await admin.post(`${API}/users/${rina.id}/decline`).send({})).status
    ).toBe(409);

    const changedMind = await admin
      .post(`${API}/users/${rina.id}/approve`)
      .send({ role: "finance", modules: ["invoices", "reports"] });
    expect(changedMind.status).toBe(200);
    expect(
      (await signIn("rina@noble.test", person.password)).response.status
    ).toBe(200);
  });

  it("ends a disabled person's session at once", async () => {
    const off = await admin
      .patch(`${API}/users/${personId}`)
      .send({ status: "disabled" });
    expect(off.status).toBe(200);
    expect((await member.get(`${API}/invoices`)).status).toBe(401);
    expect((await signIn(person.email, person.password)).response.status).toBe(401);

    const on = await admin
      .patch(`${API}/users/${personId}`)
      .send({ status: "active" });
    expect(on.body.status).toBe("active");
    expect((await signIn(person.email, person.password)).response.status).toBe(200);
  });

  it("never turns an office account into a worker login through a staff invite", async () => {
    const staff = await createStaff(admin, { email: person.email });
    const invite = await admin.post(`${API}/staff/${staff.id}/invite`).send({});
    expect(invite.status).toBe(409);
    expect(invite.body.error.message).toContain("office account");
  });
});
