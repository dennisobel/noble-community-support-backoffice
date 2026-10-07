/* eslint-disable @typescript-eslint/no-explicit-any */
import { degrees, PDFDocument, PDFName } from "@cantoo/pdf-lib";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SignatureRequest } from "../src/models";
import {
  displayedSize,
  normaliseRotation,
  toPagePoint,
} from "../src/modules/signatures/geometry";
import { completeStuckRequests } from "../src/modules/signatures/signing";
import {
  ADMIN,
  API,
  signedInAgent,
  startTestApp,
  stopTestApp,
} from "./helpers";
import { createParticipant, pngBuffer } from "./fixtures";

let app: Express;
let admin: request.Agent;
let clientId: string;
let clientName: string;

const PNG_URL = `data:image/png;base64,${pngBuffer().toString("base64")}`;

/** A real PDF with `pages` pages of 400 × 300 points; page 2 is turned sideways when `turned`. */
async function samplePdf(pages = 2, turned = false): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < pages; index += 1) {
    const page = pdf.addPage([400, 300]);
    page.drawText(`Page ${index + 1}`, { x: 40, y: 250, size: 18 });
    if (turned && index === 1) page.setRotation(degrees(90));
  }
  return Buffer.from(await pdf.save());
}

const upload = (
  agent: request.Agent,
  file: Buffer,
  fields: Record<string, string> = {},
  filename = "agreement.pdf"
) => {
  let call = agent.post(`${API}/signatures`);
  for (const [key, value] of Object.entries(fields))
    call = call.field(key, value);
  return call.attach("file", file, {
    filename,
    contentType: "application/pdf",
  });
};

const tokenOf = (url: string) => url.split("/sign/")[1];
const publicApi = (token: string, tail = "") =>
  `${API}/public/sign/${token}${tail}`;
const download = (
  agent: request.Agent | ReturnType<typeof request>,
  url: string
) => (agent as any).get(url).buffer(true);

/** Uploads, lays out and sends a request with a client and a worker; returns the ids and links. */
async function sentRequest(extra: Record<string, unknown> = {}) {
  const created = await upload(admin, await samplePdf(2, true), {
    title: "Service agreement",
    participantId: clientId,
  });
  expect(created.status).toBe(201);
  const id = created.body.id as string;
  const layout = {
    signers: [
      {
        id: "client0001",
        name: "Alex Client",
        email: "alex@example.test",
        roleLabel: "Participant",
      },
      {
        id: "worker0001",
        name: "Sam Worker",
        email: "",
        roleLabel: "Support worker",
      },
    ],
    fields: [
      {
        id: "fsigA00001",
        signerId: "client0001",
        type: "signature",
        page: 1,
        x: 0.1,
        y: 0.6,
        w: 0.4,
        h: 0.15,
        required: true,
        label: "Sign here",
      },
      {
        id: "fdateA0001",
        signerId: "client0001",
        type: "date",
        page: 1,
        x: 0.55,
        y: 0.6,
        w: 0.25,
        h: 0.07,
        required: true,
      },
      {
        id: "ftextA0001",
        signerId: "client0001",
        type: "text",
        page: 2,
        x: 0.1,
        y: 0.2,
        w: 0.5,
        h: 0.07,
        required: true,
        label: "Full name",
      },
      {
        id: "fsigB00001",
        signerId: "worker0001",
        type: "signature",
        page: 2,
        x: 0.1,
        y: 0.7,
        w: 0.4,
        h: 0.15,
        required: true,
      },
      {
        id: "fcheckB001",
        signerId: "worker0001",
        type: "checkbox",
        page: 2,
        x: 0.6,
        y: 0.7,
        w: 0.05,
        h: 0.06,
        required: true,
        label: "I agree",
      },
    ],
    rev: created.body.rev,
    ...extra,
  };
  const saved = await admin.patch(`${API}/signatures/${id}`).send(layout);
  expect(saved.status).toBe(200);
  const sent = await admin
    .post(`${API}/signatures/${id}/send`)
    .send({ expiresInDays: 14, rev: saved.body.rev });
  expect(sent.status).toBe(200);
  const [client, worker] = sent.body.request.signers;
  return {
    id,
    sent,
    clientToken: tokenOf(client.url),
    workerToken: tokenOf(worker.url),
  };
}

beforeAll(async () => {
  app = await startTestApp();
  admin = await signedInAgent(app);
  const participant = (await createParticipant(admin)) as unknown as {
    id: string;
    name: string;
  };
  clientId = participant.id;
  clientName = participant.name;
});
afterAll(stopTestApp);

describe("where a box lands on the PDF", () => {
  const box = { x: 0, y: 0, width: 200, height: 100 };

  it("maps a point on the displayed page into PDF space for every rotation", () => {
    expect(toPagePoint({ ...box, rotation: 0 }, 10, 20)).toEqual({
      x: 10,
      y: 80,
    });
    expect(toPagePoint({ ...box, rotation: 90 }, 10, 20)).toEqual({
      x: 20,
      y: 10,
    });
    expect(toPagePoint({ ...box, rotation: 180 }, 10, 20)).toEqual({
      x: 190,
      y: 20,
    });
    expect(toPagePoint({ ...box, rotation: 270 }, 10, 20)).toEqual({
      x: 180,
      y: 90,
    });
  });

  it("honours a crop box that does not start at the origin", () => {
    expect(
      toPagePoint({ x: 30, y: 40, width: 200, height: 100, rotation: 0 }, 0, 0)
    ).toEqual({ x: 30, y: 140 });
  });

  it("swaps width and height for a page turned sideways", () => {
    expect(displayedSize({ ...box, rotation: 0 })).toEqual({
      width: 200,
      height: 100,
    });
    expect(displayedSize({ ...box, rotation: 90 })).toEqual({
      width: 100,
      height: 200,
    });
    expect(normaliseRotation(-90)).toBe(270);
    expect(normaliseRotation(450)).toBe(90);
    expect(normaliseRotation(45)).toBe(0);
  });
});

describe("starting a request", () => {
  it("refuses anything that is not a readable PDF", async () => {
    const text = await admin
      .post(`${API}/signatures`)
      .attach("file", Buffer.from("just some words"), {
        filename: "notes.txt",
        contentType: "text/plain",
      });
    expect(text.status).toBe(415);
    expect(text.body.error.message).toContain("Only PDF");

    const disguised = await upload(
      admin,
      Buffer.from("not a pdf at all"),
      {},
      "fake.pdf"
    );
    expect(disguised.status).toBe(415);

    const missing = await admin
      .post(`${API}/signatures`)
      .field("title", "No file");
    expect(missing.status).toBe(422);
  });

  it("reads each page's displayed size, including a page turned sideways", async () => {
    const created = await upload(admin, await samplePdf(2, true), {
      title: "Two pages",
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      status: "draft",
      title: "Two pages",
      pageCount: 2,
      pages: [
        { width: 400, height: 300 },
        { width: 300, height: 400 },
      ],
    });
    expect(created.body.document.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(created.body.events[0].type).toBe("created");
  });
});

describe("drafts", () => {
  it("validates the layout and refuses to send an incomplete request", async () => {
    const created = await upload(admin, await samplePdf());
    const id = created.body.id;
    const signer = {
      id: "signer0001",
      name: "Pat Signer",
      email: "pat@example.test",
    };
    const field = {
      id: "field00001",
      signerId: "signer0001",
      type: "signature",
      page: 1,
      x: 0.1,
      y: 0.1,
      w: 0.3,
      h: 0.1,
      required: true,
    };

    // Nothing to send yet
    expect(
      (await admin.post(`${API}/signatures/${id}/send`).send({})).status
    ).toBe(422);
    // A box for a stranger, off the page, or sticking out of it
    expect(
      (
        await admin.patch(`${API}/signatures/${id}`).send({
          signers: [signer],
          fields: [{ ...field, signerId: "nobody0001" }],
        })
      ).status
    ).toBe(422);
    expect(
      (
        await admin
          .patch(`${API}/signatures/${id}`)
          .send({ signers: [signer], fields: [{ ...field, page: 3 }] })
      ).status
    ).toBe(422);
    expect(
      (
        await admin
          .patch(`${API}/signatures/${id}`)
          .send({ signers: [signer], fields: [{ ...field, x: 0.9 }] })
      ).status
    ).toBe(422);

    // A signer with no box cannot be sent
    const saved = await admin
      .patch(`${API}/signatures/${id}`)
      .send({ signers: [signer], fields: [], rev: created.body.rev });
    expect(saved.status).toBe(200);
    const none = await admin.post(`${API}/signatures/${id}/send`).send({});
    expect(none.status).toBe(422);
    expect(none.body.error.message).toContain("Pat Signer");

    // A stale copy is not allowed to overwrite a newer one
    const stale = await admin
      .patch(`${API}/signatures/${id}`)
      .send({ title: "Old", rev: created.body.rev });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("STALE_VERSION");

    // Removing a person takes their boxes with them
    const withBox = await admin
      .patch(`${API}/signatures/${id}`)
      .send({ signers: [signer], fields: [field] });
    expect(withBox.body.fields).toHaveLength(1);
    const removed = await admin
      .patch(`${API}/signatures/${id}`)
      .send({ signers: [] });
    expect(removed.body.signers).toEqual([]);
    expect(removed.body.fields).toEqual([]);

    // A draft can be deleted, and its file goes with it
    expect((await admin.delete(`${API}/signatures/${id}`)).status).toBe(204);
    expect((await admin.get(`${API}/signatures/${id}`)).status).toBe(404);
  });
});

describe("signing from a link", () => {
  let id: string;
  let clientToken: string;
  let workerToken: string;

  it("sends a request and gives each signer a private link", async () => {
    const result = await sentRequest();
    ({ id, clientToken, workerToken } = result);
    const request_ = result.sent.body.request;
    expect(request_.status).toBe("sent");
    expect(request_.signers.map((s: any) => s.url)).toEqual([
      `http://localhost:3000/sign/${clientToken}`,
      `http://localhost:3000/sign/${workerToken}`,
    ]);
    expect(clientToken).not.toBe(workerToken);
    expect(clientToken.length).toBeGreaterThanOrEqual(40);
    // No mail server in tests: the sender copies the links instead
    expect(result.sent.body.emailed).toEqual([]);
    expect(result.sent.body.emailConfigured).toBe(false);

    // What was sent is what the signers saw, so it can no longer change
    expect(
      (await admin.patch(`${API}/signatures/${id}`).send({ title: "Changed" }))
        .status
    ).toBe(409);
    expect(
      (await admin.post(`${API}/signatures/${id}/send`).send({})).status
    ).toBe(409);
  });

  it("shows each signer only their own boxes, with no session", async () => {
    const view = await request(app).get(publicApi(clientToken));
    expect(view.status).toBe(200);
    expect(view.headers["cache-control"]).toContain("no-store");
    expect(view.headers["x-robots-tag"]).toContain("noindex");
    expect(view.body).toMatchObject({
      state: "open",
      title: "Service agreement",
      signer: {
        name: "Alex Client",
        roleLabel: "Participant",
        status: "viewed",
      },
      others: [{ name: "Sam Worker", status: "pending" }],
    });
    expect(view.body.fields.map((f: any) => f.id).sort()).toEqual([
      "fdateA0001",
      "fsigA00001",
      "ftextA0001",
    ]);
    expect(view.body.pages).toHaveLength(2);
    expect(JSON.stringify(view.body)).not.toContain(workerToken);
    expect(JSON.stringify(view.body)).not.toContain("alex@example.test");

    const file = await download(request(app), publicApi(clientToken, "/pdf"));
    expect(file.status).toBe(200);
    expect(file.headers["content-type"]).toBe("application/pdf");
    expect(Buffer.from(file.body).subarray(0, 5).toString()).toBe("%PDF-");

    // The sender sees that it was opened
    const detail = await admin.get(`${API}/signatures/${id}`);
    const client = detail.body.signers.find(
      (s: any) => s.name === "Alex Client"
    );
    expect(client.status).toBe("viewed");
    expect(client.viewedAt).toBeTruthy();
    expect(detail.body.events.map((e: any) => e.type)).toContain("viewed");
  });

  it("does not reveal whether a link ever existed", async () => {
    const stranger = "A".repeat(43);
    expect((await request(app).get(publicApi(stranger))).status).toBe(404);
    expect(
      (await download(request(app), publicApi(stranger, "/pdf"))).status
    ).toBe(404);
    expect(
      (
        await request(app)
          .post(publicApi(stranger, "/submit"))
          .send({ consent: true })
      ).status
    ).toBe(404);
    expect((await request(app).get(publicApi("short"))).status).toBe(422);
  });

  it("insists on consent, every required box and a real signature picture", async () => {
    const send = (body: Record<string, unknown>) =>
      request(app).post(publicApi(clientToken, "/submit")).send(body);
    const values = [{ fieldId: "ftextA0001", value: "Alex Client" }];

    expect((await send({ signature: PNG_URL, values })).status).toBe(422);
    expect(
      (await send({ consent: false, signature: PNG_URL, values })).status
    ).toBe(422);
    expect(
      (await send({ consent: true, values })).body.error.message
    ).toContain("signature");
    expect(
      (await send({ consent: true, signature: PNG_URL, values: [] })).body.error
        .message
    ).toContain("Full name");
    expect(
      (
        await send({
          consent: true,
          signature: "data:image/png;base64,AAAA",
          values,
        })
      ).status
    ).toBe(422);
    expect(
      (
        await send({
          consent: true,
          signature: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
          values,
        })
      ).status
    ).toBe(422);
    // A text file posing as a picture
    const posing = `data:image/png;base64,${Buffer.from("hello world, definitely a png").toString("base64")}`;
    expect(
      (await send({ consent: true, signature: posing, values })).status
    ).toBe(422);
    // An answer for a box that is not theirs
    expect(
      (
        await send({
          consent: true,
          signature: PNG_URL,
          values: [...values, { fieldId: "fcheckB001", value: "true" }],
        })
      ).status
    ).toBe(422);

    // Nothing was recorded by the failures
    const detail = await admin.get(`${API}/signatures/${id}`);
    expect(detail.body.signedCount).toBe(0);
  });

  it("records the first signature and keeps waiting for the rest", async () => {
    const done = await request(app)
      .post(publicApi(clientToken, "/submit"))
      .set("User-Agent", "TestBrowser/1.0")
      .send({
        consent: true,
        signature: PNG_URL,
        values: [{ fieldId: "ftextA0001", value: "Alex Client" }],
      });
    expect(done.status).toBe(200);
    expect(done.body).toEqual({ state: "signed" });

    const detail = await admin.get(`${API}/signatures/${id}`);
    expect(detail.body.status).toBe("sent");
    expect(detail.body.signedCount).toBe(1);
    const text = detail.body.fields.find((f: any) => f.id === "ftextA0001");
    const date = detail.body.fields.find((f: any) => f.id === "fdateA0001");
    expect(text.value).toBe("Alex Client");
    expect(date.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(
      detail.body.events.find((e: any) => e.type === "signed")
    ).toMatchObject({
      by: "Alex Client",
    });

    // Signing twice is refused, and the page then says so
    const again = await request(app)
      .post(publicApi(clientToken, "/submit"))
      .send({
        consent: true,
        signature: PNG_URL,
        values: [{ fieldId: "ftextA0001", value: "Alex Client" }],
      });
    expect(again.status).toBe(409);
    const view = await request(app).get(publicApi(clientToken));
    expect(view.body).toMatchObject({
      state: "signed",
      fields: [],
      canDownload: false,
    });
    // Still the original while others sign
    const pdf = await download(request(app), publicApi(clientToken, "/pdf"));
    expect(pdf.status).toBe(200);
    expect(await completeStuckRequests()).toBe(0);
  });

  it("finishes when the last person signs: stamps the pages, adds a certificate and files a copy", async () => {
    const done = await request(app)
      .post(publicApi(workerToken, "/submit"))
      .send({
        consent: true,
        signature: PNG_URL,
        values: [{ fieldId: "fcheckB001", value: "true" }],
      });
    expect(done.status).toBe(200);
    expect(done.body).toEqual({ state: "completed" });

    const detail = await admin.get(`${API}/signatures/${id}`);
    expect(detail.body).toMatchObject({
      status: "completed",
      signedCount: 2,
      sealPending: false,
    });
    expect(detail.body.signedFile.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(detail.body.filedDocumentId).toBeTruthy();
    expect(detail.body.events.map((e: any) => e.type)).toContain("completed");

    // The original is untouched and still matches its recorded fingerprint
    const original = await download(admin, `${API}/signatures/${id}/original`);
    expect(original.status).toBe(200);
    const { createHash } = await import("node:crypto");
    expect(
      createHash("sha256").update(Buffer.from(original.body)).digest("hex")
    ).toBe(detail.body.document.sha256);

    // The signed copy: the original pages, the signatures drawn on them, and a certificate at the end
    const signed = await download(
      admin,
      `${API}/signatures/${id}/signed?download=1`
    );
    expect(signed.status).toBe(200);
    expect(signed.headers["content-disposition"]).toContain("attachment");
    const bytes = Buffer.from(signed.body);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      detail.body.signedFile.sha256
    );
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(3);
    expect(pdf.getPages()[1].getRotation().angle).toBe(90);
    let images = 0;
    for (const [, object] of pdf.context.enumerateIndirectObjects())
      if (
        (object as any).dict?.get?.(PDFName.of("Subtype")) ===
        PDFName.of("Image")
      )
        images += 1;
    expect(images).toBeGreaterThanOrEqual(2);

    // Everyone's link now serves the finished copy
    const theirs = await download(request(app), publicApi(clientToken, "/pdf"));
    expect(theirs.status).toBe(200);
    expect(Buffer.from(theirs.body).equals(bytes)).toBe(true);
    const view = await request(app).get(publicApi(clientToken));
    expect(view.body).toMatchObject({ state: "completed", canDownload: true });

    // It sits in the client's own folder, as its own file
    const tree = await admin.get(
      `${API}/participants/${clientId}/documents/tree`
    );
    const agreement = tree.body.children.find(
      (n: any) => n.folderKey === "agreement"
    );
    expect(agreement.children.map((n: any) => n.title)).toContain(
      "Service agreement (signed)"
    );
    const filed = await download(
      admin,
      `${API}/documents/${detail.body.filedDocumentId}/download`
    );
    expect(Buffer.from(filed.body).equals(bytes)).toBe(true);

    // A signed document is a record: it cannot be deleted or cancelled
    expect((await admin.delete(`${API}/signatures/${id}`)).status).toBe(409);
    expect(
      (await admin.post(`${API}/signatures/${id}/cancel`).send({})).status
    ).toBe(409);
    expect(clientName).toBeTruthy();
  });

  it("lists it with the right totals", async () => {
    const list = await admin.get(`${API}/signatures`);
    expect(list.status).toBe(200);
    const mine = list.body.items.find((item: any) => item.id === id);
    expect(mine).toMatchObject({
      status: "completed",
      signerCount: 2,
      signedCount: 2,
      participantName: clientName,
    });
    expect(list.body.totals.completed).toBeGreaterThanOrEqual(1);
    const found = await admin
      .get(`${API}/signatures`)
      .query({ q: "Sam Worker", status: "completed" });
    expect(found.body.items.map((item: any) => item.id)).toContain(id);
    const none = await admin
      .get(`${API}/signatures`)
      .query({ status: "declined" });
    expect(none.body.items.map((item: any) => item.id)).not.toContain(id);
  });
});

describe("declining, cancelling and expiring", () => {
  it("lets a signer decline, which stops everyone", async () => {
    const { id, clientToken, workerToken } = await sentRequest();
    const declined = await request(app)
      .post(publicApi(clientToken, "/decline"))
      .send({ reason: "The dates are wrong" });
    expect(declined.status).toBe(200);
    expect(declined.body).toEqual({ state: "declined" });

    const detail = await admin.get(`${API}/signatures/${id}`);
    expect(detail.body.status).toBe("declined");
    const client = detail.body.signers.find(
      (s: any) => s.name === "Alex Client"
    );
    expect(client).toMatchObject({
      status: "declined",
      declineReason: "The dates are wrong",
    });
    expect(detail.body.signers.every((s: any) => s.url === null)).toBe(true);

    expect((await request(app).get(publicApi(workerToken))).body).toMatchObject(
      {
        state: "declined",
        fields: [],
      }
    );
    expect(
      (await download(request(app), publicApi(workerToken, "/pdf"))).status
    ).toBe(404);
    expect(
      (
        await request(app)
          .post(publicApi(workerToken, "/submit"))
          .send({
            consent: true,
            signature: PNG_URL,
            values: [{ fieldId: "fcheckB001", value: "true" }],
          })
      ).status
    ).toBe(409);
    // Declined requests can be cleared away
    expect((await admin.delete(`${API}/signatures/${id}`)).status).toBe(204);
  });

  it("revokes every link when the sender cancels", async () => {
    const { id, clientToken, workerToken } = await sentRequest();
    const cancelled = await admin
      .post(`${API}/signatures/${id}/cancel`)
      .send({ reason: "Sent to the wrong person" });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe("cancelled");
    for (const token of [clientToken, workerToken]) {
      expect((await request(app).get(publicApi(token))).body.state).toBe(
        "cancelled"
      );
      expect(
        (await download(request(app), publicApi(token, "/pdf"))).status
      ).toBe(404);
    }
    expect(
      (await admin.post(`${API}/signatures/${id}/cancel`).send({})).status
    ).toBe(409);
  });

  it("stops working after the deadline until the sender extends it", async () => {
    const { id, clientToken } = await sentRequest();
    await SignatureRequest.updateOne(
      { _id: id },
      { $set: { expiresAt: new Date(Date.now() - 1000) } }
    );

    const view = await request(app).get(publicApi(clientToken));
    expect(view.body).toMatchObject({ state: "expired", fields: [] });
    expect(
      (
        await request(app)
          .post(publicApi(clientToken, "/submit"))
          .send({
            consent: true,
            signature: PNG_URL,
            values: [{ fieldId: "ftextA0001", value: "x" }],
          })
      ).status
    ).toBe(409);
    const list = await admin
      .get(`${API}/signatures`)
      .query({ status: "expired" });
    expect(list.body.items.map((item: any) => item.id)).toContain(id);
    expect(list.body.totals.needsAttention).toBeGreaterThanOrEqual(1);

    const extended = await admin
      .post(`${API}/signatures/${id}/extend`)
      .send({ days: 7 });
    expect(extended.status).toBe(200);
    expect(extended.body.status).toBe("sent");
    expect((await request(app).get(publicApi(clientToken))).body.state).toBe(
      "open"
    );
  });
});

describe("links", () => {
  it("replaces a link so the old one stops working, but not for someone who has signed", async () => {
    const { id, clientToken, workerToken } = await sentRequest();
    const fresh = await admin.post(
      `${API}/signatures/${id}/signers/client0001/new-link`
    );
    expect(fresh.status).toBe(200);
    const newToken = tokenOf(
      fresh.body.signers.find((s: any) => s.id === "client0001").url
    );
    expect(newToken).not.toBe(clientToken);
    expect((await request(app).get(publicApi(clientToken))).status).toBe(404);
    expect((await request(app).get(publicApi(newToken))).body.state).toBe(
      "open"
    );
    expect(fresh.body.events.map((e: any) => e.type)).toContain("link_reset");

    // The worker signs; their link is now fixed
    await request(app)
      .post(publicApi(workerToken, "/submit"))
      .send({
        consent: true,
        signature: PNG_URL,
        values: [{ fieldId: "fcheckB001", value: "true" }],
      });
    expect(
      (await admin.post(`${API}/signatures/${id}/signers/worker0001/new-link`))
        .status
    ).toBe(409);
    expect(
      (await admin.post(`${API}/signatures/${id}/signers/nobody00001/new-link`))
        .status
    ).toBe(409);
  });

  it("reminds by email only when there is an address and a mail server", async () => {
    const { id } = await sentRequest();
    const noAddress = await admin.post(
      `${API}/signatures/${id}/signers/worker0001/remind`
    );
    expect(noAddress.status).toBe(422);
    const noMail = await admin.post(
      `${API}/signatures/${id}/signers/client0001/remind`
    );
    expect(noMail.status).toBe(200);
    expect(noMail.body).toMatchObject({
      emailed: false,
      emailConfigured: false,
    });
    expect(
      (await admin.post(`${API}/signatures/${id}/signers/bad!/remind`)).status
    ).toBe(404);
  });
});

describe("signing it yourself", () => {
  const box = (id: string, signerId: string, y: number) => ({
    id,
    signerId,
    type: "signature",
    page: 1,
    x: 0.1,
    y,
    w: 0.4,
    h: 0.15,
    required: true,
  });
  const myself = (extra: Record<string, unknown> = {}) => ({
    id: "self000001",
    name: ADMIN.name,
    email: ADMIN.email,
    roleLabel: "Noble Community Support",
    ...extra,
  });
  const someoneElse = {
    id: "other00001",
    name: "Alex Client",
    email: "alex@example.test",
  };
  const userIds = (body: any) => body.signers.map((s: any) => s.userId);

  it("marks the signer who added themselves, and only ever as the person saving", async () => {
    const adminId = (await admin.get(`${API}/auth/me`)).body.user.id as string;
    const id = (await upload(admin, await samplePdf())).body.id as string;
    const save = (agent: request.Agent, signers: unknown[]) =>
      agent.patch(`${API}/signatures/${id}`).send({ signers });

    const saved = await save(admin, [myself({ me: true }), someoneElse]);
    expect(saved.status).toBe(200);
    expect(userIds(saved.body)).toEqual([adminId, null]);

    // A colleague working on the same draft
    await request(app).post(`${API}/auth/register`).send({
      name: "Casey Colleague",
      email: "colleague@noble.test",
      password: "correct horse battery",
    });
    const person = (await admin.get(`${API}/users`)).body.find(
      (u: any) => u.email === "colleague@noble.test"
    );
    await admin
      .post(`${API}/users/${person.id}/approve`)
      .send({ role: "coordinator", modules: ["files"] });
    const colleague = request.agent(app);
    await colleague.post(`${API}/auth/login`).send({
      email: "colleague@noble.test",
      password: "correct horse battery",
    });

    // Their save cannot take the marker away, and "me" on their side means them
    const theirs = await save(colleague, [
      myself({ me: false }),
      { ...someoneElse, me: true },
    ]);
    expect(userIds(theirs.body)).toEqual([adminId, person.id]);
    // Turning the card into someone else drops it; a card that is left alone keeps its marker
    const renamed = await save(colleague, [
      myself({ name: "Somebody Else", me: false }),
      someoneElse,
    ]);
    expect(userIds(renamed.body)).toEqual([null, person.id]);
    // The owner can take it back, and give it up
    expect(userIds((await save(admin, [myself({ me: true })])).body)).toEqual([
      adminId,
    ]);
    expect(userIds((await save(admin, [myself({ me: false })])).body)).toEqual([
      null,
    ]);
    expect((await admin.delete(`${API}/signatures/${id}`)).status).toBe(204);
  });

  it("lets the only signer sign straight away, with nothing sent to anyone", async () => {
    const id = (await upload(admin, await samplePdf())).body.id as string;
    await admin.patch(`${API}/signatures/${id}`).send({
      signers: [myself({ me: true })],
      fields: [box("fselfsig01", "self000001", 0.6)],
    });
    const sent = await admin.post(`${API}/signatures/${id}/send`).send({});
    expect(sent.status).toBe(200);
    expect(sent.body.emailed).toEqual([]);
    const [mine] = sent.body.request.signers;
    expect(mine.url).toContain("/sign/");
    expect(
      sent.body.request.events.find((e: any) => e.type === "sent").detail
    ).toBe(`Set up for ${ADMIN.name} to sign in the app`);

    // The app opens their own link for them: one signature finishes the document
    const done = await request(app)
      .post(publicApi(tokenOf(mine.url), "/submit"))
      .send({ consent: true, signature: PNG_URL, values: [] });
    expect(done.body).toEqual({ state: "completed" });
    const detail = await admin.get(`${API}/signatures/${id}`);
    expect(detail.body).toMatchObject({ status: "completed", signedCount: 1 });
    expect(detail.body.signers[0].userId).toBeTruthy();
  });

  it("sends to the others and leaves the sender to sign in the app", async () => {
    const id = (await upload(admin, await samplePdf())).body.id as string;
    await admin.patch(`${API}/signatures/${id}`).send({
      signers: [myself({ me: true }), someoneElse],
      fields: [
        box("fselfsig02", "self000001", 0.2),
        box("fothersig2", "other00001", 0.6),
      ],
    });
    const sent = await admin.post(`${API}/signatures/${id}/send`).send({});
    expect(sent.status).toBe(200);
    expect(
      sent.body.request.events.find((e: any) => e.type === "sent").detail
    ).toBe(`Sent to Alex Client; ${ADMIN.name} signs in the app`);
    expect(
      (await admin.post(`${API}/signatures/${id}/cancel`).send({})).status
    ).toBe(200);
  });
});

describe("who may use it", () => {
  it("follows the Organisation files and Clients access, and keeps the public links open to nobody else's session", async () => {
    const make = async (email: string, modules: string[]) => {
      await request(app)
        .post(`${API}/auth/register`)
        .send({ name: "Pat Person", email, password: "correct horse battery" });
      const person = (await admin.get(`${API}/users`)).body.find(
        (u: any) => u.email === email
      );
      await admin
        .post(`${API}/users/${person.id}/approve`)
        .send({ role: "coordinator", modules });
      const agent = request.agent(app);
      await agent
        .post(`${API}/auth/login`)
        .send({ email, password: "correct horse battery" });
      return agent;
    };
    const billing = await make("billing@noble.test", ["invoices"]);
    const files = await make("files@noble.test", ["files"]);

    expect((await billing.get(`${API}/signatures`)).status).toBe(403);
    expect((await billing.post(`${API}/signatures`)).status).toBe(403);
    expect((await files.get(`${API}/signatures`)).status).toBe(200);
    // They can pick signers from the team list and the client list
    expect((await files.get(`${API}/staff`)).status).toBe(200);
    expect((await files.get(`${API}/participants`)).status).toBe(200);
    // A signed-out visitor cannot reach the back-office side at all
    expect((await request(app).get(`${API}/signatures`)).status).toBe(401);
  });
});
