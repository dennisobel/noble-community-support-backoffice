/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { storage } from "../src/lib/storage";
import { NoteImage, RosterShift } from "../src/models";
import { ADMIN, API, signedInAgent, startTestApp, stopTestApp } from "./helpers";
import {
  createParticipant,
  createService,
  createStaff,
  pdfBuffer,
  pngBuffer,
  today,
} from "./fixtures";
import { addDays } from "@shared/logic/time";

let app: Express;
let admin: request.Agent;
let other: request.Agent;

const para = (text: string, marks?: Array<Record<string, unknown>>) => ({
  type: "paragraph",
  content: [{ type: "text", text, ...(marks ? { marks } : {}) }],
});
const doc = (...content: unknown[]) => ({ type: "doc", content });

beforeAll(async () => {
  app = await startTestApp();
  admin = await signedInAgent(app);
  // A second person with nothing ticked: they still get notes and their own day.
  const olive = { name: "Olive Other", email: "olive@noble.test", password: "correct horse battery" };
  await request(app).post(`${API}/auth/register`).send(olive);
  const found = (await admin.get(`${API}/users`)).body.find(
    (user: any) => user.email === olive.email
  );
  await admin.post(`${API}/users/${found.id}/approve`).send({ role: "finance", modules: [] });
  other = request.agent(app);
  await other.post(`${API}/auth/login`).send({ email: olive.email, password: olive.password });
});
afterAll(stopTestApp);

describe("typed notes", () => {
  let noteId: string;
  let rev: number;

  it("keeps formatting, labels and a plain-text preview", async () => {
    const created = await admin.post(`${API}/notes`).send({});
    expect(created.status).toBe(201);
    noteId = created.body.id;
    rev = created.body.rev;

    const content = doc(
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Visit plan" }] },
      { type: "paragraph", content: [{ type: "text", text: "Bring the " }, { type: "text", text: "red folder", marks: [{ type: "bold" }] }] },
      { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [para("Call the plan manager")] }] }
    );
    const saved = await admin
      .patch(`${API}/notes/${noteId}`)
      .send({ title: "Tuesday", content, labels: ["#Visits", "visits", " Planning "], rev });
    expect(saved.status).toBe(200);
    expect(saved.body.labels).toEqual(["visits", "planning"]);
    expect(saved.body.rev).toBe(rev + 1);
    expect(saved.body.snippet).toContain("Visit plan");
    expect(saved.body.snippet).toContain("Bring the red folder");

    const read = await admin.get(`${API}/notes/${noteId}`);
    expect(read.body.content.content[0]).toMatchObject({ type: "heading", attrs: { level: 1 } });
    expect(read.body.content.content[1].content[1].marks).toEqual([{ type: "bold" }]);
    expect(read.body.content.content[2].content[0].attrs).toEqual({ checked: true });
    rev = saved.body.rev;

    // Saving from a stale copy (another device got there first) is refused, not overwritten
    const stale = await admin.patch(`${API}/notes/${noteId}`).send({ title: "Old copy", rev: rev - 1 });
    expect(stale.status).toBe(409);
  });

  it("lists, searches, filters, pins and archives", async () => {
    const second = await admin.post(`${API}/notes`).send({ title: "Groceries", labels: ["home"] });
    await admin.patch(`${API}/notes/${second.body.id}`).send({ content: doc(para("milk and eggs")) });
    // A note nobody typed in is not listed
    await admin.post(`${API}/notes`).send({});

    const all = await admin.get(`${API}/notes`);
    expect(all.body.map((note: any) => note.title).sort()).toEqual(["Groceries", "Tuesday"]);
    expect((await admin.get(`${API}/notes`).query({ q: "EGGS" })).body).toHaveLength(1);
    expect((await admin.get(`${API}/notes`).query({ q: "red folder" })).body[0].title).toBe("Tuesday");
    expect((await admin.get(`${API}/notes`).query({ label: "visits" })).body).toHaveLength(1);

    const labels = await admin.get(`${API}/notes/labels`);
    expect(labels.body).toEqual([
      { label: "home", count: 1 },
      { label: "planning", count: 1 },
      { label: "visits", count: 1 },
    ]);

    await admin.patch(`${API}/notes/${second.body.id}`).send({ pinned: true });
    expect((await admin.get(`${API}/notes`)).body[0].title).toBe("Groceries");

    await admin.patch(`${API}/notes/${second.body.id}`).send({ archived: true });
    expect((await admin.get(`${API}/notes`)).body.map((n: any) => n.title)).toEqual(["Tuesday"]);
    expect((await admin.get(`${API}/notes`).query({ archived: "true" })).body.map((n: any) => n.title)).toEqual(["Groceries"]);
  });

  it("only ever stores formatting it understands, and links that are safe", async () => {
    const send = (content: unknown) => admin.patch(`${API}/notes/${noteId}`).send({ content });
    expect((await send(doc({ type: "script", content: [] }))).status).toBe(422);
    expect((await send({ type: "paragraph" })).status).toBe(422);
    expect(
      (await send(doc({ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "fontBomb" }] }] }))).status
    ).toBe(422);
    // A picture that is not one of this app's uploads is refused (no tracking pixels, no data: blobs)
    expect(
      (await send(doc({ type: "image", attrs: { src: "https://example.com/pixel.png" } }))).status
    ).toBe(422);
    expect((await send(doc(para("x".repeat(450_000))))).status).toBe(422);

    // An unsafe link loses its link but keeps its words
    const linked = await send(
      doc({ type: "paragraph", content: [{ type: "text", text: "click", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }, { type: "italic" }] }, { type: "text", text: " safe", marks: [{ type: "link", attrs: { href: "https://example.com", target: "_blank", onclick: "x()" } }] }] })
    );
    expect(linked.status).toBe(200);
    const read = (await admin.get(`${API}/notes/${noteId}`)).body.content.content[0].content;
    expect(read[0].marks).toEqual([{ type: "italic" }]);
    expect(read[1].marks).toEqual([{ type: "link", attrs: { href: "https://example.com" } }]);
  });

  it("keeps notes private to their author, Admins included", async () => {
    expect((await other.get(`${API}/notes`)).body).toEqual([]);
    expect((await other.get(`${API}/notes/${noteId}`)).status).toBe(404);
    expect((await other.patch(`${API}/notes/${noteId}`).send({ title: "Mine now" })).status).toBe(404);
    expect((await other.delete(`${API}/notes/${noteId}`)).status).toBe(404);
    expect((await request(app).get(`${API}/notes`)).status).toBe(401);

    // Their own, with nothing ticked: still allowed
    const mine = await other.post(`${API}/notes`).send({ title: "Olive's note" });
    expect(mine.status).toBe(201);
    expect((await admin.get(`${API}/notes/${mine.body.id}`)).status).toBe(404);
    expect((await other.get(`${API}/invoices`)).status).toBe(403);
  });

  it("stores pictures privately and tidies them away with the note", async () => {
    const picture = await admin
      .post(`${API}/notes/${noteId}/images`)
      .attach("file", pngBuffer(), { filename: "photo.png", contentType: "image/png" });
    expect(picture.status).toBe(201);
    expect(picture.body.url).toBe(`/api/v1/notes/images/${picture.body.id}`);

    const fetched = await admin.get(picture.body.url).buffer(true);
    expect(fetched.status).toBe(200);
    expect(fetched.headers["content-type"]).toBe("image/png");
    expect(fetched.headers["cache-control"]).toContain("private");
    expect((await request(app).get(picture.body.url)).status).toBe(401);
    expect((await other.get(picture.body.url)).status).toBe(404);

    // Not a picture: refused, whatever it is called
    const pdf = await admin
      .post(`${API}/notes/${noteId}/images`)
      .attach("file", pdfBuffer(), { filename: "plan.pdf", contentType: "application/pdf" });
    expect(pdf.status).toBe(415);
    const fake = await admin
      .post(`${API}/notes/${noteId}/images`)
      .attach("file", Buffer.from("not really a png"), { filename: "fake.png", contentType: "image/png" });
    expect(fake.status).toBe(415);
    expect(
      (await other.post(`${API}/notes/${noteId}/images`).attach("file", pngBuffer(), "x.png")).status
    ).toBe(404);

    // The note can show it; a made-up picture id cannot be smuggled in
    const withPicture = await admin
      .patch(`${API}/notes/${noteId}`)
      .send({ content: doc(para("Look:"), { type: "image", attrs: { src: picture.body.url } }) });
    expect(withPicture.status).toBe(200);
    expect(withPicture.body.imageCount).toBe(1);
    const stranger = await admin.patch(`${API}/notes/${noteId}`).send({
      content: doc({ type: "image", attrs: { src: "/api/v1/notes/images/000000000000000000000000" } }),
    });
    expect(stranger.status).toBe(422);

    const stored = await NoteImage.findById(picture.body.id).lean();
    expect(await storage.exists(stored!.storageKey)).toBe(true);
    expect((await admin.delete(`${API}/notes/${noteId}`)).status).toBe(204);
    expect(await storage.exists(stored!.storageKey)).toBe(false);
    expect((await admin.get(picture.body.url)).status).toBe(404);
  });
});

describe("my day", () => {
  it("shows a person their own shifts, found by their sign-in email", async () => {
    const [client, service, me, someoneElse] = await Promise.all([
      createParticipant(admin),
      createService(admin),
      createStaff(admin, { name: "Maya Thompson", email: ADMIN.email }),
      createStaff(admin, { name: "Someone Else" }),
    ]);
    const base = { ratio: "1:1", clientIds: [client.id], serviceId: service.id, type: "Community participation", location: "Marion", notes: "", recordIds: [], timesheets: [], rev: 0 };
    const tomorrow = addDays(today(), 1);
    await RosterShift.create([
      { ...base, _id: "SH-9001", date: today(), start: "09:00", end: "12:00", staffIds: [me.id], status: "Confirmed" },
      { ...base, _id: "SH-9002", date: today(), start: "13:00", end: "14:30", staffIds: [me.id], status: "Cancelled" },
      { ...base, _id: "SH-9003", date: today(), start: "09:00", end: "12:00", staffIds: [someoneElse.id], status: "Planned" },
      { ...base, _id: "SH-9004", date: tomorrow, start: "10:00", end: "11:00", staffIds: [me.id], status: "Planned" },
    ] as never);

    const day = await admin.get(`${API}/me/day`);
    expect(day.status).toBe(200);
    expect(day.body.staff).toMatchObject({ name: "Maya Thompson" });
    expect(day.body.shifts.map((shift: any) => shift.id)).toEqual(["SH-9001"]);
    expect(day.body.hours).toBe(3);

    const next = await admin.get(`${API}/me/day`).query({ date: tomorrow });
    expect(next.body.shifts.map((shift: any) => shift.id)).toEqual(["SH-9004"]);

    // Someone who is not in the staff directory just gets an empty day, with the reason
    const empty = await other.get(`${API}/me/day`);
    expect(empty.status).toBe(200);
    expect(empty.body).toMatchObject({ staff: null, shifts: [], email: "olive@noble.test" });
    expect((await request(app).get(`${API}/me/day`)).status).toBe(401);
  });
});
