/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { API, signedInAgent, startTestApp, stopTestApp } from "./helpers";
import {
  createParticipant,
  createService,
  createStaff,
  today,
} from "./fixtures";

const PASSWORD = "a good long password";

let app: Express;
/** Maya is the Admin; Priya is a coordinator who does not manage the team. */
let maya: request.Agent;
let priya: request.Agent;
/** Riley and Sam are support workers with portal accounts. */
let riley: request.Agent;
let sam: request.Agent;
const ids: Record<"maya" | "priya" | "riley" | "sam", string> = {
  maya: "",
  priya: "",
  riley: "",
  sam: "",
};
let shiftId: string;
let directId: string;
let announcementId: string;

async function worker(name: string) {
  const email = `${name.toLowerCase()}@noble.test`;
  const staff = await createStaff(maya, { name: `${name} Worker`, email });
  const invite = await maya.post(`${API}/staff/${staff.id}/invite`).send({});
  const token = new URL(invite.body.invite.link).searchParams.get("token") ?? "";
  await request(app)
    .post(`${API}/auth/reset-password`)
    .send({ token, password: PASSWORD });
  const agent = request.agent(app);
  const signedIn = await agent
    .post(`${API}/auth/login`)
    .send({ email, password: PASSWORD });
  return { agent, staffId: staff.id, userId: signedIn.body.user.id as string };
}

beforeAll(async () => {
  app = await startTestApp();
  maya = await signedInAgent(app);
  ids.maya = (await maya.get(`${API}/auth/me`)).body.user.id;

  await request(app).post(`${API}/auth/register`).send({
    name: "Priya Nair",
    email: "priya@noble.test",
    password: PASSWORD,
  });
  const asked = (await maya.get(`${API}/users`)).body.find(
    (user: any) => user.email === "priya@noble.test"
  );
  await maya
    .post(`${API}/users/${asked.id}/approve`)
    .send({ role: "coordinator", modules: ["roster"] });
  ids.priya = asked.id;
  priya = request.agent(app);
  await priya
    .post(`${API}/auth/login`)
    .send({ email: "priya@noble.test", password: PASSWORD });

  const first = await worker("Riley");
  const second = await worker("Sam");
  riley = first.agent;
  sam = second.agent;
  ids.riley = first.userId;
  ids.sam = second.userId;

  const [service, participant] = await Promise.all([
    createService(maya),
    createParticipant(maya),
  ]);
  const shift = await maya.post(`${API}/roster/shifts`).send({
    date: today(),
    start: "09:00",
    end: "12:00",
    ratio: "1:1",
    clientIds: [participant.id],
    staffIds: [first.staffId],
    serviceId: service.id,
  });
  shiftId = shift.body.id;
});
afterAll(stopTestApp);

const direct = (agent: request.Agent, to: string, body: string) =>
  agent.post(`${API}/messages`).send({ kind: "direct", memberIds: [to], body });
const unread = async (agent: request.Agent) =>
  (await agent.get(`${API}/messages/unread`)).body.unread as number;

describe("who can write to whom", () => {
  it("lets the office reach everyone, and a worker reach the office only", async () => {
    const office = await maya.get(`${API}/messages/options`);
    expect(office.body.canAnnounce).toBe(true);
    expect(office.body.recipients.map((person: any) => person.name)).toEqual([
      "Priya Nair",
      "Riley Worker",
      "Sam Worker",
    ]);
    expect(
      office.body.recipients.find((person: any) => person.name === "Riley Worker")
    ).toMatchObject({ worker: true, roleLabel: "Support worker" });

    // Managing the team is what lets someone address everybody at once.
    expect((await priya.get(`${API}/messages/options`)).body.canAnnounce).toBe(
      false
    );

    const portal = await riley.get(`${API}/messages/options`);
    expect(portal.body.recipients.map((person: any) => person.name)).toEqual([
      "Maya Thompson",
      "Priya Nair",
    ]);
    expect(portal.body.canAnnounce).toBe(false);

    expect((await direct(riley, ids.sam, "Swap shifts?")).status).toBe(422);
    expect(
      (
        await riley
          .post(`${API}/messages`)
          .send({ kind: "group", memberIds: [ids.maya, ids.priya], body: "Hi" })
      ).status
    ).toBe(403);
    expect((await request(app).get(`${API}/messages`)).status).toBe(401);
  });
});

describe("a direct conversation", () => {
  it("shows up unread for the other person and is named after whoever they are talking to", async () => {
    const sent = await direct(maya, ids.riley, "Can you cover Thursday morning?");
    expect(sent.status).toBe(201);
    directId = sent.body.id;
    expect(sent.body).toMatchObject({
      kind: "direct",
      title: "Riley Worker",
      unread: 0,
      canReply: true,
    });
    expect(sent.body.messages).toHaveLength(1);
    expect(sent.body.messages[0]).toMatchObject({ mine: true });

    expect(await unread(riley)).toBe(1);
    const inbox = await riley.get(`${API}/messages`);
    expect(inbox.body.items).toHaveLength(1);
    expect(inbox.body.items[0]).toMatchObject({
      id: directId,
      title: "Maya Thompson",
      unread: 1,
      lastMessage: { body: "Can you cover Thursday morning?" },
    });
  });

  it("is read once it has been opened, and answers come back the other way", async () => {
    const opened = await riley.get(`${API}/messages/${directId}`);
    expect(opened.body.messages[0]).toMatchObject({
      mine: false,
      sender: { name: "Maya Thompson" },
    });
    expect((await riley.post(`${API}/messages/${directId}/read`)).status).toBe(204);
    expect(await unread(riley)).toBe(0);

    const reply = await riley
      .post(`${API}/messages/${directId}/messages`)
      .send({ body: "Yes, I can do 9 to 12." });
    expect(reply.status).toBe(201);
    expect(await unread(maya)).toBe(1);
    const bell = await maya.get(`${API}/notifications`);
    expect(bell.body.items.map((item: any) => item.type)).toContain(
      "message_unread"
    );

    // Maya can see that Riley has read her message.
    const seen = await maya.get(`${API}/messages/${directId}`);
    expect(
      seen.body.members.find((member: any) => member.id === ids.riley).lastReadAt
    ).toBeTruthy();
    expect(
      (await riley.post(`${API}/messages/${directId}/messages`).send({ body: " " }))
        .status
    ).toBe(422);
  });

  it("continues the same thread when either person writes again", async () => {
    const again = await direct(maya, ids.riley, "Thanks, it is on the roster.");
    expect(again.body.id).toBe(directId);
    expect(again.body.messages).toHaveLength(3);
    const fromWorker = await direct(riley, ids.maya, "See you then.");
    expect(fromWorker.body.id).toBe(directId);

    const page = await maya.get(`${API}/messages/${directId}?limit=2`);
    expect(page.body.messages.map((message: any) => message.body)).toEqual([
      "Thanks, it is on the roster.",
      "See you then.",
    ]);
    expect(page.body.hasMore).toBe(true);
    const older = await maya.get(
      `${API}/messages/${directId}?limit=2&before=${encodeURIComponent(page.body.messages[0].sentAt)}`
    );
    expect(older.body.messages.map((message: any) => message.body)).toEqual([
      "Can you cover Thursday morning?",
      "Yes, I can do 9 to 12.",
    ]);
    expect(older.body.hasMore).toBe(false);
  });

  it("does not exist for anyone who is not in it, the Admin included", async () => {
    for (const outsider of [sam, priya])
      expect((await outsider.get(`${API}/messages/${directId}`)).status).toBe(404);
    expect(
      (await sam.post(`${API}/messages/${directId}/messages`).send({ body: "Hi" }))
        .status
    ).toBe(404);

    const between = await direct(riley, ids.priya, "Is my roster final?");
    expect((await maya.get(`${API}/messages/${between.body.id}`)).status).toBe(404);
    expect((await maya.get(`${API}/messages`)).body.items).toHaveLength(1);
  });
});

describe("a conversation about a shift", () => {
  it("goes to the workers rostered on it when nobody is named", async () => {
    const thread = await priya.post(`${API}/messages`).send({
      kind: "group",
      context: { type: "shift", id: shiftId },
      body: "The lift at Marion is out, use the ramp on the east side.",
    });
    expect(thread.status).toBe(201);
    expect(thread.body.context).toMatchObject({ type: "shift", id: shiftId });
    expect(thread.body.title).toContain("Community participation");
    expect(thread.body.members.map((member: any) => member.name)).toEqual([
      "Priya Nair",
      "Riley Worker",
    ]);
    expect((await sam.get(`${API}/messages/${thread.body.id}`)).status).toBe(404);

    // A worker writing to the office about their shift stays in the one thread they share,
    // and the message itself says which shift it is about.
    const fromShift = await riley.post(`${API}/messages`).send({
      kind: "direct",
      memberIds: [ids.maya],
      context: { type: "shift", id: shiftId },
      body: "Running ten minutes late to this one.",
    });
    expect(fromShift.body.id).toBe(directId);
    expect(fromShift.body.context).toBeNull();
    expect(fromShift.body.messages.at(-1).context).toMatchObject({
      type: "shift",
      id: shiftId,
    });
    expect(fromShift.body.messages[0].context).toBeNull();

    // A worker cannot open a thread about someone else's shift.
    expect(
      (
        await sam.post(`${API}/messages`).send({
          kind: "direct",
          memberIds: [ids.maya],
          context: { type: "shift", id: shiftId },
          body: "About this shift",
        })
      ).status
    ).toBe(404);
  });
});

describe("an announcement", () => {
  it("reaches everyone in the audience, who can read it but not answer", async () => {
    expect(
      (
        await priya.post(`${API}/messages`).send({
          kind: "announcement",
          audience: "workers",
          body: "Hello all",
        })
      ).status
    ).toBe(403);

    const sent = await maya.post(`${API}/messages`).send({
      kind: "announcement",
      audience: "workers",
      title: "New sign-on steps from Monday",
      body: "Please sign on in the portal when you arrive, not before.",
    });
    expect(sent.status).toBe(201);
    announcementId = sent.body.id;
    expect(sent.body).toMatchObject({
      kind: "announcement",
      audience: "workers",
      memberCount: 3,
      readBy: 0,
      canReply: true,
    });

    const received = await riley.get(`${API}/messages/${announcementId}`);
    expect(received.body).toMatchObject({
      title: "New sign-on steps from Monday",
      canReply: false,
      readBy: null,
    });
    // Who else it went to, and who has read it, is the sender's to see.
    expect(received.body.members).toEqual([]);
    const answer = await riley
      .post(`${API}/messages/${announcementId}/messages`)
      .send({ body: "Got it" });
    expect(answer.status).toBe(403);
    expect(answer.body.error.message).toContain("Message the sender directly");
    // The office team was not the audience.
    expect((await priya.get(`${API}/messages/${announcementId}`)).status).toBe(404);
  });

  it("tells the sender how many people have opened it", async () => {
    await riley.post(`${API}/messages/${announcementId}/read`);
    const afterOne = await maya.get(`${API}/messages/${announcementId}`);
    expect(afterOne.body.readBy).toBe(1);
    expect(
      afterOne.body.members
        .filter((member: any) => member.lastReadAt && member.id !== ids.maya)
        .map((member: any) => member.name)
    ).toEqual(["Riley Worker"]);

    // A follow-up from the sender is unread again for everyone.
    await maya
      .post(`${API}/messages/${announcementId}/messages`)
      .send({ body: "This starts on the 12th." });
    expect((await maya.get(`${API}/messages/${announcementId}`)).body.readBy).toBe(0);
    expect(await unread(sam)).toBe(1);
  });
});
