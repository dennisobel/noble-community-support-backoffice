import type { Express } from "express";
import type request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drainJobs } from "../src/lib/jobs";
import { API, signedInAgent, startTestApp, stopTestApp } from "./helpers";
import {
  createParticipant,
  createRecord,
  createService,
  createStaff,
  pdfBuffer,
  pngBuffer,
  wavBuffer,
} from "./fixtures";

let app: Express;
let agent: request.Agent;
let ids: { clientId: string; staffId: string; serviceId: string };

beforeAll(async () => {
  app = await startTestApp();
  agent = await signedInAgent(app);
  const [service, staff, participant] = await Promise.all([
    createService(agent),
    createStaff(agent),
    createParticipant(agent),
  ]);
  ids = { clientId: participant.id, staffId: staff.id, serviceId: service.id };
});
afterAll(stopTestApp);

describe("documents", () => {
  it("uploads to a participant folder, lists it in the tree and downloads intact", async () => {
    const upload = await agent
      .post(`${API}/documents`)
      .field("scope", "participant")
      .field("participantId", ids.clientId)
      .field("folderKey", "agreement")
      .field("title", "Signed service agreement")
      .attach("files", pdfBuffer(), {
        filename: "agreement.pdf",
        contentType: "application/pdf",
      });
    expect(upload.status).toBe(201);
    const [doc] = upload.body;
    expect(doc).toMatchObject({
      title: "Signed service agreement",
      folderKey: "agreement",
      file: { mimeType: "application/pdf" },
    });

    const tree = await agent.get(
      `${API}/participants/${ids.clientId}/documents/tree`
    );
    const agreement = tree.body.children.find(
      (node: { folderKey?: string }) => node.folderKey === "agreement"
    );
    expect(agreement.children[0]).toMatchObject({
      kind: "file",
      documentId: doc.id,
    });
    expect(tree.body.title).toMatch(/^Client \d{3} – AC$/);

    const download = await agent
      .get(`${API}/documents/${doc.id}/download`)
      .buffer(true);
    expect(download.status).toBe(200);
    expect(download.headers["content-disposition"]).toContain("attachment");
    expect(download.headers["x-content-type-options"]).toBe("nosniff");
    expect(Buffer.from(download.body).equals(pdfBuffer())).toBe(true);

    const moved = await agent
      .patch(`${API}/documents/${doc.id}`)
      .send({ folderKey: "correspondence", title: "Agreement letter" });
    expect(moved.body).toMatchObject({
      folderKey: "correspondence",
      title: "Agreement letter",
    });
    expect((await agent.delete(`${API}/documents/${doc.id}`)).status).toBe(204);
    expect((await agent.get(`${API}/documents/${doc.id}`)).status).toBe(404);
  });

  it("rejects spoofed and unsupported files", async () => {
    const spoofed = await agent
      .post(`${API}/documents`)
      .field("scope", "organisation")
      .field("folderKey", "policies")
      .attach("files", Buffer.from("MZ this is not a pdf"), {
        filename: "policy.pdf",
        contentType: "application/pdf",
      });
    expect(spoofed.status).toBe(415);
    expect(spoofed.body.error.code).toBe("UNSUPPORTED_MEDIA_TYPE");

    const html = await agent
      .post(`${API}/documents`)
      .field("scope", "organisation")
      .field("folderKey", "policies")
      .attach("files", Buffer.from("<script>alert(1)</script>"), {
        filename: "page.html",
        contentType: "text/html",
      });
    expect(html.status).toBe(415);

    const badFolder = await agent
      .post(`${API}/documents`)
      .field("scope", "organisation")
      .field("folderKey", "agreement")
      .attach("files", pngBuffer(), {
        filename: "logo.png",
        contentType: "image/png",
      });
    expect(badFolder.status).toBe(422);
  });

  it("fills an organisation template slot", async () => {
    const tree = await agent.get(`${API}/documents/tree?scope=organisation`);
    const templates = tree.body.children.find(
      (node: { id: string }) => node.id === "templates-root"
    );
    const slot = templates.children[0];
    expect(slot).toMatchObject({ kind: "template", badge: "No file attached" });
    const filled = await agent
      .put(`${API}/documents/${slot.documentId}/file`)
      .attach("file", pdfBuffer(), {
        filename: "progress-note.pdf",
        contentType: "application/pdf",
      });
    expect(filled.status).toBe(200);
    expect(filled.body.file.originalName).toBe("progress-note.pdf");
    const inline = await agent.get(
      `${API}/documents/${slot.documentId}/download?inline=1`
    );
    expect(inline.headers["content-disposition"]).toContain("inline");
  });
});

describe("voice notes", () => {
  it("records, transcribes, drafts and turns a voice note into a service record", async () => {
    const upload = await agent
      .post(`${API}/voice-notes`)
      .field("clientId", ids.clientId)
      .field("title", "Mia — community access follow-up")
      .field("durationSec", "102")
      .attach("audio", wavBuffer(), {
        filename: "recording.wav",
        contentType: "audio/wav",
      });
    expect(upload.status).toBe(201);
    const voice = upload.body;
    expect(voice).toMatchObject({
      id: expect.stringMatching(/^VN-\d{3}$/),
      duration: "01:42",
      hasAudio: true,
      transcriptStatus: "Not transcribed",
    });

    const audio = await agent
      .get(`${API}/voice-notes/${voice.id}/audio`)
      .set("Range", "bytes=0-9")
      .buffer(true);
    expect(audio.status).toBe(206);
    expect(audio.headers["content-type"]).toBe("audio/wav");

    const tooEarly = await agent
      .post(`${API}/voice-notes/${voice.id}/generate-draft`)
      .send({
        template: "Community support progress note",
        sections: ["support"],
        detailLevel: "Balanced",
        transcriptOnly: false,
      });
    expect(tooEarly.status).toBe(422);
    expect(tooEarly.body.error.code).toBe("TRANSCRIPT_REQUIRED");

    const transcribing = await agent
      .post(`${API}/voice-notes/${voice.id}/transcribe`)
      .send({});
    expect(transcribing.status).toBe(202);
    expect(transcribing.body.transcriptStatus).toBe("Processing");
    await drainJobs();
    const transcribed = await agent.get(`${API}/voice-notes/${voice.id}`);
    expect(transcribed.body).toMatchObject({
      transcriptStatus: "Ready",
      transcriptProvider: "mock",
    });

    const generating = await agent
      .post(`${API}/voice-notes/${voice.id}/generate-draft`)
      .send({
        template: "Community support progress note",
        sections: [
          "support",
          "response",
          "outcome",
          "observations",
          "followUp",
        ],
        detailLevel: "Balanced",
        transcriptOnly: false,
      });
    expect(generating.body.generationStatus).toBe("Processing");
    await drainJobs();
    const drafted = await agent.get(`${API}/voice-notes/${voice.id}`);
    expect(drafted.body).toMatchObject({
      generationStatus: "Draft ready",
      status: "Draft ready",
    });
    expect(drafted.body.draft.support).toContain("Mia");

    // Start a record from the draft; both sides of the link are set.
    const record = await createRecord(agent, ids, {
      ...drafted.body.draft,
      voiceNoteId: voice.id,
    });
    expect(
      (await agent.get(`${API}/voice-notes/${voice.id}`)).body.recordId
    ).toBe(record.id);
    expect(
      (await agent.get(`${API}/service-records/${record.id}`)).body.voiceId
    ).toBe(voice.id);

    // Apply the draft to another draft record through attach.
    const other = await createRecord(agent, ids, { support: "Original text" });
    const attached = await agent
      .post(`${API}/voice-notes/${voice.id}/attach`)
      .send({ recordId: other.id, applyDraft: true });
    expect(attached.status).toBe(200);
    expect(attached.body.record.support).toBe(drafted.body.draft.support);
    expect(
      attached.body.record.history.map(
        (entry: { action: string }) => entry.action
      )
    ).toContain("draft_applied");
    expect(
      (await agent.get(`${API}/service-records/${record.id}`)).body.voiceId
    ).toBeNull();

    // A recording that supports a submitted record cannot be deleted, only archived.
    await agent.post(`${API}/service-records/${other.id}/submit`).send({});
    const blocked = await agent.delete(`${API}/voice-notes/${voice.id}`);
    expect(blocked.status).toBe(409);
    const archived = await agent
      .post(`${API}/voice-notes/${voice.id}/archive`)
      .send({});
    expect(archived.body.status).toBe("Archived");
    const inbox = await agent.get(`${API}/voice-notes`);
    expect(
      inbox.body.items.find((item: { id: string }) => item.id === voice.id)
    ).toBeUndefined();
    const archivedList = await agent.get(`${API}/voice-notes?status=Archived`);
    expect(archivedList.body.items[0].id).toBe(voice.id);
  });

  it("rejects non-audio uploads and deletes unlinked recordings with their audio", async () => {
    const bad = await agent
      .post(`${API}/voice-notes`)
      .field("clientId", ids.clientId)
      .field("title", "Not audio")
      .field("durationSec", "5")
      .attach("audio", pngBuffer(), {
        filename: "clip.wav",
        contentType: "audio/wav",
      });
    expect(bad.status).toBe(415);

    const upload = await agent
      .post(`${API}/voice-notes`)
      .field("clientId", ids.clientId)
      .field("title", "Short clip")
      .field("durationSec", "3")
      .attach("audio", wavBuffer(), {
        filename: "clip.wav",
        contentType: "audio/wav",
      });
    expect(
      (await agent.delete(`${API}/voice-notes/${upload.body.id}`)).status
    ).toBe(204);
    expect(
      (await agent.get(`${API}/voice-notes/${upload.body.id}/audio`)).status
    ).toBe(404);
  });
});
