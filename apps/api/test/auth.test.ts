import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN, API, cookieNames, startTestApp, stopTestApp } from "./helpers";

let app: Express;

beforeAll(async () => {
  app = await startTestApp();
});
afterAll(stopTestApp);

describe("first run and authentication", () => {
  it("reports that setup is required on a fresh workspace", async () => {
    const response = await request(app).get(`${API}/auth/bootstrap`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      setupRequired: true,
      setupCodeRequired: false,
    });
  });

  it("rejects protected routes without a session", async () => {
    for (const path of [
      "/auth/me",
      "/settings/workspace",
      "/participants",
      "/service-records",
      "/invoices",
    ]) {
      const response = await request(app).get(`${API}${path}`);
      expect(response.status, path).toBe(401);
      expect(response.body.error.code).toBe("UNAUTHENTICATED");
    }
  });

  it("validates the signup form with the UI's wording", async () => {
    const response = await request(app)
      .post(`${API}/auth/signup`)
      .send({ ...ADMIN, password: "short" });
    expect(response.status).toBe(422);
    expect(response.body.error.message).toBe(
      "Choose a password with at least 8 characters."
    );
  });

  it("creates exactly one Admin even when signups race", async () => {
    const attempts = await Promise.all(
      [1, 2, 3].map(index =>
        request(app)
          .post(`${API}/auth/signup`)
          .send({ ...ADMIN, email: `racer${index}@noble.test` })
      )
    );
    const statuses = attempts.map(response => response.status).sort();
    expect(statuses.filter(status => status === 201)).toHaveLength(1);
    expect(statuses.filter(status => status === 409)).toHaveLength(2);
    const created = attempts.find(response => response.status === 201)!;
    expect(cookieNames(created)).toEqual(
      expect.arrayContaining(["noble_access", "noble_refresh"])
    );
    const cookies = (created.headers["set-cookie"] as unknown as string[]).join(
      ";"
    );
    expect(cookies).toContain("HttpOnly");
    expect(cookies).toContain("SameSite=Lax");

    const bootstrap = await request(app).get(`${API}/auth/bootstrap`);
    expect(bootstrap.body.setupRequired).toBe(false);
  });

  it("signs in, restores the session, refreshes and signs out", async () => {
    const agent = request.agent(app);
    const bad = await agent
      .post(`${API}/auth/login`)
      .send({ email: "racer1@noble.test", password: "wrong password" });
    // racer1 may or may not have won the race above; find the winner by trying all three.
    expect([401]).toContain(bad.status);

    let email = "";
    for (const candidate of [
      "racer1@noble.test",
      "racer2@noble.test",
      "racer3@noble.test",
    ]) {
      const attempt = await agent
        .post(`${API}/auth/login`)
        .send({ email: candidate, password: ADMIN.password });
      if (attempt.status === 200) {
        email = candidate;
        expect(attempt.body.user.email).toBe(candidate);
        expect(attempt.body.workspace.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        break;
      }
    }
    expect(email).not.toBe("");

    const me = await agent.get(`${API}/auth/me`);
    expect(me.status).toBe(200);
    expect(me.body.user.role).toBe("admin");
    expect(me.body.preferences.voice.detailLevel).toBe("Balanced");

    const refreshed = await agent.post(`${API}/auth/refresh`);
    expect(refreshed.status).toBe(204);
    expect(cookieNames(refreshed)).toEqual(
      expect.arrayContaining(["noble_access", "noble_refresh"])
    );

    const sessions = await agent.get(`${API}/auth/sessions`);
    expect(
      sessions.body.some((session: { current: boolean }) => session.current)
    ).toBe(true);

    const logout = await agent.post(`${API}/auth/logout`);
    expect(logout.status).toBe(204);
    expect((await agent.get(`${API}/auth/me`)).status).toBe(401);
    expect((await agent.post(`${API}/auth/refresh`)).status).toBe(401);
  });

  it("revokes the session when a rotated refresh token is replayed after the grace window", async () => {
    const { AuthSession } = await import("../src/models");
    const agent = request.agent(app);
    const login = await agent
      .post(`${API}/auth/login`)
      .send({ email: await winnerEmail(), password: ADMIN.password });
    const oldRefresh = (login.headers["set-cookie"] as unknown as string[])
      .find(cookie => cookie.startsWith("noble_refresh="))!
      .split(";")[0];
    expect((await agent.post(`${API}/auth/refresh`)).status).toBe(204);
    // Age the rotation so it is outside the multi-tab grace window.
    await AuthSession.updateMany(
      {},
      { $set: { "previous.$[].rotatedAt": new Date(Date.now() - 5 * 60_000) } }
    );
    const replay = await request(app)
      .post(`${API}/auth/refresh`)
      .set("Cookie", oldRefresh);
    expect(replay.status).toBe(401);
    // The legitimate session is revoked too (token family compromised).
    expect((await agent.get(`${API}/auth/me`)).status).toBe(401);
  });

  it("locks the account after repeated failures", async () => {
    const email = await winnerEmail();
    let last: request.Response | undefined;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      last = await request(app)
        .post(`${API}/auth/login`)
        .send({ email, password: `wrong-${attempt}` });
    }
    expect(last!.status).toBe(423);
    expect(last!.body.error.code).toBe("ACCOUNT_LOCKED");
    const correct = await request(app)
      .post(`${API}/auth/login`)
      .send({ email, password: ADMIN.password });
    expect(correct.status).toBe(423);
    const { User } = await import("../src/models");
    await User.updateMany({}, { $set: { lockedUntil: null, failedLogins: 0 } });
  });

  it("resets a forgotten password with a single-use token and revokes sessions", async () => {
    const { PasswordReset } = await import("../src/models");
    const { sha256 } = await import("../src/modules/auth/tokens");
    const email = await winnerEmail();
    const agent = request.agent(app);
    await agent
      .post(`${API}/auth/login`)
      .send({ email, password: ADMIN.password });

    const unknown = await request(app)
      .post(`${API}/auth/forgot-password`)
      .send({ email: "nobody@noble.test" });
    expect(unknown.status).toBe(202);
    const known = await request(app)
      .post(`${API}/auth/forgot-password`)
      .send({ email });
    expect(known.status).toBe(202);
    expect(await PasswordReset.countDocuments()).toBe(1);

    // Tokens are stored hashed; swap in a known token to exercise the endpoint.
    const token = "known-reset-token-for-tests-0123456789";
    await PasswordReset.updateMany({}, { $set: { tokenHash: sha256(token) } });
    const reset = await request(app)
      .post(`${API}/auth/reset-password`)
      .send({ token, password: "a brand new password" });
    expect(reset.status).toBe(204);
    const again = await request(app)
      .post(`${API}/auth/reset-password`)
      .send({ token, password: "another new password" });
    expect(again.status).toBe(422);

    expect((await agent.get(`${API}/auth/me`)).status).toBe(401);
    const login = await request(app)
      .post(`${API}/auth/login`)
      .send({ email, password: "a brand new password" });
    expect(login.status).toBe(200);
  });

  it("blocks cross-site state-changing requests", async () => {
    const response = await request(app)
      .post(`${API}/auth/login`)
      .set("Origin", "https://evil.example")
      .send({ email: "a@b.co", password: "x" });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("answers the web app from an allowed address when the API is on its own host, and nobody else", async () => {
    const site = "http://localhost:3000";
    // What the browser asks before a request with a JSON body
    const ask = await request(app)
      .options(`${API}/auth/login`)
      .set("Origin", site)
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "content-type");
    expect(ask.status).toBe(204);
    expect(ask.headers["access-control-allow-origin"]).toBe(site);
    expect(ask.headers["access-control-allow-credentials"]).toBe("true");
    expect(ask.headers["access-control-allow-methods"]).toContain("PATCH");
    expect(ask.headers["access-control-allow-headers"]).toBe("content-type");
    expect(Number(ask.headers["access-control-max-age"])).toBeGreaterThan(0);

    // The request itself: readable by the site, cookies and all, including an error
    const read = await request(app).get(`${API}/auth/me`).set("Origin", site);
    expect(read.status).toBe(401);
    expect(read.headers["access-control-allow-origin"]).toBe(site);
    expect(read.headers["access-control-allow-credentials"]).toBe("true");
    expect(read.headers["access-control-expose-headers"]).toContain(
      "Content-Disposition"
    );
    expect(read.headers.vary).toContain("Origin");

    // Any other site is told nothing, so its pages can neither read nor get permission
    const stranger = await request(app)
      .get(`${API}/health`)
      .set("Origin", "https://evil.example");
    expect(stranger.status).toBe(200);
    expect(stranger.headers["access-control-allow-origin"]).toBeUndefined();
    const refused = await request(app)
      .options(`${API}/auth/login`)
      .set("Origin", "https://evil.example")
      .set("Access-Control-Request-Method", "POST");
    expect(refused.headers["access-control-allow-origin"]).toBeUndefined();
    expect(refused.headers["access-control-allow-methods"]).toBeUndefined();
  });
});

async function winnerEmail(): Promise<string> {
  const { User } = await import("../src/models");
  const user = await User.findOne().lean();
  return user!.email;
}
