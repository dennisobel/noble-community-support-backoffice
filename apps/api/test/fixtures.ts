import type request from "supertest";
import { addDays, todayIn } from "@shared/logic/time";
import { API } from "./helpers";

type Agent = request.Agent;

export const today = () => todayIn("Australia/Adelaide");

export async function createService(
  agent: Agent,
  overrides: Record<string, unknown> = {}
) {
  const response = await agent.post(`${API}/services`).send({
    name: "Community participation",
    unit: "Hour",
    rate: 68.3,
    transport: true,
    active: true,
    budgetCategory: "Community participation",
    ...overrides,
  });
  if (response.status !== 201)
    throw new Error(
      `service: ${response.status} ${JSON.stringify(response.body)}`
    );
  return response.body as {
    id: string;
    name: string;
    rate: number;
    rev: number;
  };
}

let staffCounter = 0;
export async function createStaff(
  agent: Agent,
  overrides: Record<string, unknown> = {}
) {
  staffCounter += 1;
  const response = await agent.post(`${API}/staff`).send({
    name: `Worker ${staffCounter}`,
    position: "Support Worker",
    team: "Community Support",
    email: `worker${staffCounter}-${Date.now()}@noble.test`,
    ...overrides,
  });
  if (response.status !== 201)
    throw new Error(
      `staff: ${response.status} ${JSON.stringify(response.body)}`
    );
  return response.body as { id: string; name: string; rev: number };
}

let ndisCounter = 100000;
export async function createParticipant(
  agent: Agent,
  overrides: Record<string, unknown> = {}
) {
  ndisCounter += 1;
  const start = addDays(today(), -60);
  const response = await agent.post(`${API}/participants`).send({
    name: "Amelia Carter",
    preferred: "Mia",
    ndis: `431${ndisCounter}`,
    dob: "1996-04-12",
    phone: "0412 830 144",
    email: "amelia@example.org",
    address: "14 Gilbert Street, Adelaide SA 5000",
    planStart: start,
    planEnd: addDays(start, 364),
    manager: "Bright Path Plan Management",
    managerEmail: "invoices@brightpath.example",
    emergencyName: "Sarah Carter",
    emergencyPhone: "0411 200 619",
    goals: ["Build independence with community access"],
    ...overrides,
  });
  if (response.status !== 201)
    throw new Error(
      `participant: ${response.status} ${JSON.stringify(response.body)}`
    );
  return response.body as {
    id: string;
    preferred: string;
    planStart: string;
    planEnd: string;
    rev: number;
  };
}

export const completeNote = {
  support: "Supported Mia with community access and grocery shopping.",
  response: "Mia was settled and engaged throughout.",
  outcome: "Practised making independent choices in the community.",
  observations: "No incidents observed.",
  followUp: "Bring the meal-planning worksheet next visit.",
};

export async function createRecord(
  agent: Agent,
  ids: { clientId: string; staffId: string; serviceId: string },
  overrides: Record<string, unknown> = {}
) {
  const response = await agent.post(`${API}/service-records`).send({
    ...ids,
    date: today(),
    start: "09:00",
    end: "12:00",
    location: "Marion Shopping Centre",
    km: 12.4,
    confirmed: true,
    ...completeNote,
    ...overrides,
  });
  if (response.status !== 201)
    throw new Error(
      `record: ${response.status} ${JSON.stringify(response.body)}`
    );
  return response.body as {
    id: string;
    rev: number;
    total: number;
    status: string;
  };
}

/** Creates a record and moves it to Approved. */
export async function approvedRecord(
  agent: Agent,
  ids: { clientId: string; staffId: string; serviceId: string },
  overrides: Record<string, unknown> = {}
) {
  const record = await createRecord(agent, ids, overrides);
  const submitted = await agent
    .post(`${API}/service-records/${record.id}/submit`)
    .send({ rev: record.rev });
  if (submitted.status !== 200)
    throw new Error(
      `submit: ${submitted.status} ${JSON.stringify(submitted.body)}`
    );
  const approved = await agent
    .post(`${API}/service-records/${record.id}/approve`)
    .send({ rev: submitted.body.rev });
  if (approved.status !== 200)
    throw new Error(
      `approve: ${approved.status} ${JSON.stringify(approved.body)}`
    );
  return approved.body as { id: string; rev: number; total: number };
}

/** A tiny valid PCM WAV file (0.1 s of silence). */
export function wavBuffer(): Buffer {
  const sampleRate = 8000;
  const samples = 800;
  const data = Buffer.alloc(samples * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** A minimal valid one-page PDF. */
export function pdfBuffer(): Buffer {
  return Buffer.from(
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"
  );
}

/** A 1×1 PNG. */
export function pngBuffer(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64"
  );
}
