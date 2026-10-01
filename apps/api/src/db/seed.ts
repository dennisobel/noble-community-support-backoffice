import { randomBytes } from "node:crypto";
import mongoose, { type Types } from "mongoose";
import {
  EMPTY_KYC,
  type Kyc,
  type RecordStatus,
  type ShiftRatio,
  type ShiftStatus,
} from "@shared/enums";
import { computeBillables, totalCents } from "@shared/logic/billing";
import { formatNdis } from "@shared/logic/ndis";
import { toCents } from "@shared/logic/money";
import {
  addDays,
  shortDate,
  todayIn,
  zonedStartOfDay,
} from "@shared/logic/time";
import { config } from "../config";
import { ensureCounterAtLeast } from "../lib/counters";
import { ensureModels } from "../lib/db";
import { ensureWorkspace, invalidateWorkspaceCache } from "../lib/workspace";
import {
  Activity,
  Budget,
  Invoice,
  Participant,
  RosterShift,
  Service,
  ServiceRecord,
  Staff,
  User,
  VoiceNote,
  Workspace,
  WORKSPACE_ID,
  type ServiceDoc,
} from "../models";
import { hashPassword } from "../modules/auth/service";
import { ensureTemplateSlots } from "../modules/documents/service";

export interface SeedResult {
  seeded: boolean;
  email: string;
  generatedPassword: string | null;
  reason?: string;
}

/** Fictional sample data matching the original prototype. Development and demos only. */
export async function seedDemo(
  options: { onlyIfEmpty?: boolean; reset?: boolean } = {}
): Promise<SeedResult> {
  const cfg = config();
  const email = cfg.demo.adminEmail;
  if (cfg.production)
    throw new Error("Refusing to load demo data in production.");
  if (options.reset) {
    await mongoose.connection.dropDatabase();
    await ensureModels();
  }
  const hasData =
    (await User.estimatedDocumentCount()) > 0 ||
    (await Participant.estimatedDocumentCount()) > 0;
  if (hasData) {
    if (options.onlyIfEmpty)
      return {
        seeded: false,
        email,
        generatedPassword: null,
        reason: "The database already contains data.",
      };
    throw new Error(
      "The database is not empty. Re-run with --reset to wipe it first (development only)."
    );
  }

  invalidateWorkspaceCache();
  const workspace = await ensureWorkspace();
  const tz = workspace.timezone;
  const today = todayIn(tz);
  const at = (ymd: string, hm: string) =>
    new Date(
      zonedStartOfDay(ymd, tz).getTime() +
        (Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3))) * 60_000
    );

  await Workspace.updateOne(
    { _id: WORKSPACE_ID },
    {
      $set: {
        name: "Noble Community Support",
        legalName: "Noble Community Support Pty Ltd",
        address: "Adelaide, South Australia",
        email: "accounts@noble.example",
        setupCompletedAt: new Date(),
        "invoice.footer":
          "Noble Community Support · Adelaide, South Australia. Thank you for your continued partnership.",
      },
    }
  );
  invalidateWorkspaceCache();

  const generatedPassword = cfg.demo.adminPassword
    ? null
    : randomBytes(9).toString("base64url");
  const admin = await User.create({
    name: "Maya Thompson",
    email,
    passwordHash: await hashPassword(
      cfg.demo.adminPassword ?? generatedPassword!
    ),
    role: "admin",
  });
  const mayaActor = { id: String(admin._id), name: admin.name };

  /* Staff */
  const staffRows = [
    {
      key: "s1",
      name: "Jordan Lee",
      position: "Support Worker",
      team: "Community Support",
      email: "jordan.lee@noble.example",
      status: "Active",
    },
    {
      key: "s2",
      name: "Maya Thompson",
      position: "Operations Lead",
      team: "Operations",
      email: "maya.thompson@noble.example",
      status: "Active",
    },
    {
      key: "s3",
      name: "Alex Rivera",
      position: "Administrator",
      team: "Administration",
      email: "alex.rivera@noble.example",
      status: "Active",
    },
    {
      key: "s4",
      name: "Sam Patel",
      position: "Support Worker",
      team: "Community Support",
      email: "sam.patel@noble.example",
      status: "On leave",
    },
  ] as const;
  const staff: Record<string, Types.ObjectId> = {};
  for (const row of staffRows) {
    const { key, ...doc } = row;
    staff[key] = (
      await Staff.create({ ...doc, userId: key === "s2" ? admin._id : null })
    )._id;
  }

  /* Services */
  const serviceRows = [
    {
      key: "r1",
      name: "Community participation",
      rate: 68.3,
      transport: true,
      category: "Community participation",
      item: "04_104_0125_6_1",
    },
    {
      key: "r2",
      name: "Daily living skills",
      rate: 68.3,
      transport: true,
      category: "Daily living skills",
      item: "01_011_0107_1_1",
    },
    {
      key: "r3",
      name: "Support coordination",
      rate: 100.14,
      transport: false,
      category: "Support coordination",
      item: "07_002_0106_8_3",
    },
    {
      key: "r4",
      name: "Group community access",
      rate: 34.15,
      transport: true,
      category: "Community participation",
      item: "04_102_0136_6_1",
    },
  ];
  const services: Record<string, ServiceDoc> = {};
  for (const row of serviceRows) {
    const created = await Service.create({
      name: row.name,
      nameKey: row.name.toLowerCase(),
      unit: "Hour",
      rateCents: toCents(row.rate),
      transportEnabled: row.transport,
      transportUnit: row.transport ? "Kilometre" : null,
      budgetCategory: row.category,
      supportItemNumber: row.item,
      active: true,
      rateHistory: [
        {
          rateCents: toCents(row.rate),
          changedAt: new Date(),
          changedBy: mayaActor,
        },
      ],
    });
    services[row.key] = created.toObject<ServiceDoc>();
  }

  /* Participants and plan budgets */
  const kyc = (overrides: Partial<Kyc> = {}): Kyc => ({
    ...EMPTY_KYC,
    serviceAgreement: true,
    consentForms: true,
    supportPlan: true,
    riskInformationReviewed: true,
    transportRequirementsConfirmed: true,
    ...overrides,
  });
  const participantRows = [
    {
      key: "p1",
      name: "Amelia Carter",
      preferred: "Mia",
      ndis: "431208775",
      dob: "1996-04-12",
      phone: "0412 830 144",
      email: "amelia.carter@example.org",
      address: "14 Gilbert Street, Adelaide SA 5000",
      planStart: "2026-02-01",
      planEnd: "2027-01-31",
      manager: "Bright Path Plan Management",
      managerEmail: "invoices@brightpath.example",
      nominee: "Sarah Carter (mother)",
      emergencyName: "Sarah Carter",
      emergencyPhone: "0411 200 619",
      alerts: [
        "Anaphylaxis — carry EpiPen",
        "Advance notice preferred for schedule changes",
      ],
      goals: [
        "Build independence with community access",
        "Develop meal-planning skills",
        "Increase confidence using public transport",
      ],
      communication:
        "Allow extra processing time. Use clear, short instructions and check understanding.",
      mobility: "No mobility aid required.",
      transport: "Prefers familiar staff for community transport.",
      support: "Community access, daily living skills, meal planning.",
      risks: "May become anxious in crowded, unfamiliar settings.",
      allergies: "Peanuts — anaphylaxis",
      preferences: "Likes quiet cafés, gardening and written reminders.",
      kyc: kyc(),
      budget: [10500, 7000, 3000],
    },
    {
      key: "p2",
      name: "Noah Williams",
      preferred: "Noah",
      ndis: "431662090",
      dob: "2001-09-03",
      phone: "0438 552 761",
      email: "noah.williams@example.org",
      address: "7 Jetty Road, Glenelg SA 5045",
      planStart: "2026-05-01",
      planEnd: "2027-04-30",
      manager: "Horizon Plan Services",
      managerEmail: "accounts@horizonplans.example",
      nominee: "Mark Williams (father)",
      emergencyName: "Mark Williams",
      emergencyPhone: "0403 151 884",
      alerts: ["Uses a communication board when tired"],
      goals: ["Practice independent travel", "Build social connections"],
      communication: "Speak face-to-face; offer visual choices.",
      mobility: "No mobility aid required.",
      transport: "Wheelchair accessible vehicle not required.",
      support: "Social participation and travel training.",
      risks: "Check road-crossing safety.",
      allergies: "None recorded",
      preferences: "Enjoys basketball and music.",
      kyc: kyc({ transportRequirementsConfirmed: false }),
      budget: [8000, 5000, 2000],
    },
    {
      key: "p3",
      name: "Priya Nair",
      preferred: "Priya",
      ndis: "431054823",
      dob: "1988-11-21",
      phone: "0401 788 025",
      email: "priya.nair@example.org",
      address: "29 Unley Road, Parkside SA 5063",
      planStart: "2026-01-15",
      planEnd: "2027-01-14",
      manager: "Self-managed",
      managerEmail: "",
      nominee: "",
      emergencyName: "Arun Nair",
      emergencyPhone: "0422 007 555",
      alerts: [],
      goals: ["Maintain daily routines", "Explore volunteering opportunities"],
      communication: "Prefers a written agenda before appointments.",
      mobility: "Uses a walking stick for longer distances.",
      transport: "Allow additional time for vehicle access.",
      support: "Daily living, appointments, community participation.",
      risks: "Uneven surfaces can affect balance.",
      allergies: "Latex sensitivity",
      preferences: "Enjoys art galleries and cooking.",
      kyc: kyc(),
      budget: [7000, 8500, 2500],
    },
    {
      key: "p4",
      name: "Ethan Brooks",
      preferred: "Ethan",
      ndis: "431810445",
      dob: "1999-02-17",
      phone: "0420 293 014",
      email: "ethan.brooks@example.org",
      address: "3 / 18 Henley Beach Road, Mile End SA 5031",
      planStart: "2026-03-01",
      planEnd: "2027-02-28",
      manager: "Bright Path Plan Management",
      managerEmail: "invoices@brightpath.example",
      nominee: "",
      emergencyName: "Lara Brooks",
      emergencyPhone: "0419 007 221",
      alerts: ["Medication reminder at 12:00"],
      goals: ["Develop cooking confidence", "Practice budgeting"],
      communication: "",
      mobility: "",
      transport: "",
      support: "Capacity building and meal preparation.",
      risks: "",
      allergies: "None recorded",
      preferences: "Likes step-by-step recipes.",
      kyc: kyc({ consentForms: false, riskInformationReviewed: false }),
      budget: [4500, 6500, 1500],
    },
    {
      key: "p5",
      name: "Grace Chen",
      preferred: "Grace",
      ndis: "431425992",
      dob: "1993-06-30",
      phone: "0417 233 920",
      email: "grace.chen@example.org",
      address: "6 Stirling Street, Norwood SA 5067",
      planStart: "2025-09-01",
      planEnd: "2026-08-31",
      manager: "New Horizons Plan Management",
      managerEmail: "billing@newhorizons.example",
      nominee: "Ming Chen (sister)",
      emergencyName: "Ming Chen",
      emergencyPhone: "0400 334 122",
      alerts: ["Plan review due this month"],
      goals: [
        "Build confidence in social settings",
        "Maintain healthy routines",
      ],
      communication: "Prefers one-to-one conversations.",
      mobility: "",
      transport: "",
      support: "Social and community participation.",
      risks: "",
      allergies: "Shellfish",
      preferences: "Enjoys swimming and podcasts.",
      kyc: kyc(),
      budget: [11000, 5000, 2500],
    },
  ];
  const participants: Record<
    string,
    {
      _id: Types.ObjectId;
      preferred: string;
      name: string;
      address: string;
      ndis: string;
      manager: string;
      managerEmail: string;
    }
  > = {};
  let clientNumber = 0;
  for (const row of participantRows) {
    const { key, budget, ...doc } = row;
    clientNumber += 1;
    const created = await Participant.create({
      ...doc,
      clientNumber,
      createdBy: mayaActor,
    });
    participants[key] = created.toObject();
    await Budget.create({
      clientId: created._id,
      planStart: row.planStart,
      planEnd: row.planEnd,
      categories: [
        {
          name: "Community participation",
          allocationCents: toCents(budget[0]),
        },
        { name: "Daily living skills", allocationCents: toCents(budget[1]) },
        { name: "Support coordination", allocationCents: toCents(budget[2]) },
      ],
      isCurrent: true,
      confirmedAgainstPlanAt: new Date(),
      createdBy: mayaActor,
    });
  }

  /* Service records */
  const note = (
    support: string,
    response: string,
    outcome: string,
    observations: string,
    followUp: string
  ) => ({ support, response, outcome, observations, followUp });
  const invoiceIssue = addDays(today, -10);
  const invoiceId = `INV-${invoiceIssue.slice(0, 4)}-091`;
  const jordan = { id: String(staff.s1), name: "Jordan Lee" };
  const sam = { id: String(staff.s4), name: "Sam Patel" };
  const recordRows: Array<{
    id: string;
    client: string;
    date: string;
    start: string;
    end: string;
    staff: string;
    service: string;
    location: string;
    km: number;
    status: RecordStatus;
    created: string;
    notes: ReturnType<typeof note>;
    correction?: string;
    submittedBy?: typeof jordan;
    voice?: string;
  }> = [
    {
      id: "SR-1048",
      client: "p1",
      date: today,
      start: "09:00",
      end: "12:00",
      staff: "s1",
      service: "r1",
      location: "Marion Shopping Centre",
      km: 12.4,
      status: "Submitted",
      created: "12:08",
      submittedBy: jordan,
      voice: "VN-028",
      notes: note(
        "Supported Mia with community access and grocery shopping. She selected items from her list with verbal prompting when needed.",
        "Mia appeared settled and engaged throughout. She asked for help comparing two products.",
        "Practised making independent choices in the community.",
        "No incidents observed. A quieter environment supported focus.",
        "Bring the meal-planning worksheet next visit."
      ),
    },
    {
      id: "SR-1047",
      client: "p2",
      date: addDays(today, -1),
      start: "13:00",
      end: "15:30",
      staff: "s1",
      service: "r1",
      location: "Glenelg foreshore",
      km: 8,
      status: "Returned",
      created: "15:45",
      submittedBy: jordan,
      correction:
        "Please add the actual departure and return points for the recorded travel kilometres.",
      notes: note(
        "Supported Noah to plan a route and practise crossing at marked crossings.",
        "Noah used his communication board to request a short break and rejoined after five minutes.",
        "Practised safe independent travel and communicating support preferences.",
        "Warm afternoon. Water breaks offered.",
        "Repeat the foreshore route next week."
      ),
    },
    {
      id: "SR-1046",
      client: "p3",
      date: addDays(today, -1),
      start: "09:30",
      end: "11:30",
      staff: "s4",
      service: "r2",
      location: "Participant home",
      km: 4.6,
      status: "Approved",
      created: "11:30",
      submittedBy: sam,
      notes: note(
        "Worked through a meal plan and prepared a vegetable stir-fry together.",
        "Priya followed the recipe and independently measured ingredients.",
        "Built confidence with meal preparation and sequencing.",
        "Walking stick used for kitchen transitions.",
        "Check whether the written recipe was useful."
      ),
    },
    {
      id: "SR-1045",
      client: "p4",
      date: addDays(today, -2),
      start: "10:00",
      end: "12:00",
      staff: "s1",
      service: "r2",
      location: "Participant home",
      km: 0,
      status: "Draft",
      created: "10:15",
      notes: note("", "", "", "", ""),
    },
    {
      id: "SR-1044",
      client: "p5",
      date: addDays(today, -12),
      start: "14:00",
      end: "16:00",
      staff: "s4",
      service: "r1",
      location: "Adelaide Botanic Garden",
      km: 6,
      status: "Invoiced",
      created: "16:15",
      submittedBy: sam,
      notes: note(
        "Supported Grace to attend a guided garden walk and plan transport home.",
        "Grace spoke with two other attendees and requested information about the next group.",
        "Practised confidence in a group setting.",
        "No concerns noted.",
        "Send group calendar to Grace."
      ),
    },
  ];
  const billablesById: Record<string, ReturnType<typeof computeBillables>> = {};
  for (const row of recordRows) {
    const service = services[row.service];
    const billables = computeBillables(
      { start: row.start, end: row.end, km: row.km, quantity: null },
      service,
      workspace.providerTravelRateCents
    );
    billablesById[row.id] = billables;
    const created = at(row.date, row.created);
    const submitted = row.status !== "Draft";
    const reviewed =
      row.status === "Approved" ||
      row.status === "Invoiced" ||
      row.status === "Returned";
    await ServiceRecord.create({
      _id: row.id,
      clientId: participants[row.client]._id,
      staffId: staff[row.staff],
      serviceId: service._id,
      voiceNoteId: row.voice ?? null,
      invoiceId: row.status === "Invoiced" ? invoiceId : null,
      type: service.name,
      budgetCategory: service.budgetCategory,
      unit: service.unit,
      date: row.date,
      start: row.start,
      end: row.end,
      location: row.location,
      km: row.km,
      quantity: null,
      ...row.notes,
      confirmed: submitted,
      confirmedAt: submitted ? created : null,
      billables,
      totalCents: totalCents(billables),
      billablesFrozenAt:
        submitted && row.status !== "Returned" ? created : null,
      status: row.status,
      correction: row.correction ?? "",
      submittedAt: submitted ? created : null,
      submittedBy: row.submittedBy ?? null,
      reviewedAt: reviewed ? new Date(created.getTime() + 20 * 60_000) : null,
      reviewedBy: reviewed ? mayaActor : null,
      approvedBy:
        row.status === "Approved" || row.status === "Invoiced"
          ? mayaActor
          : null,
      returnedAt:
        row.status === "Returned"
          ? new Date(created.getTime() + 17 * 60_000)
          : null,
      history: [
        { at: created, by: row.submittedBy ?? jordan, action: "created" },
        ...(submitted
          ? [
              {
                at: created,
                by: row.submittedBy ?? jordan,
                action: "submitted",
              },
            ]
          : []),
        ...(row.status === "Returned"
          ? [
              {
                at: new Date(created.getTime() + 17 * 60_000),
                by: mayaActor,
                action: "returned",
                note: row.correction,
              },
            ]
          : []),
        ...(row.status === "Approved" || row.status === "Invoiced"
          ? [
              {
                at: new Date(created.getTime() + 20 * 60_000),
                by: mayaActor,
                action: "approved",
              },
            ]
          : []),
        ...(row.status === "Invoiced"
          ? [
              {
                at: at(invoiceIssue, "09:00"),
                by: mayaActor,
                action: "invoiced",
                note: invoiceId,
              },
            ]
          : []),
      ],
      createdBy: row.submittedBy ?? jordan,
    });
    await ServiceRecord.updateOne(
      { _id: row.id },
      { $set: { createdAt: created, updatedAt: created } },
      { timestamps: false }
    );
  }

  /* Invoice for the already-invoiced record */
  const grace = participants.p5;
  const lines = billablesById["SR-1044"].map(line => ({
    ...line,
    label: `${line.label} — ${shortDate(recordRows[4].date)}`,
    recordId: "SR-1044",
  }));
  const subtotal = lines.reduce((sum, line) => sum + line.subtotalCents, 0);
  await Invoice.create({
    _id: invoiceId,
    clientId: grace._id,
    recordIds: ["SR-1044"],
    status: "Sent",
    title: "Invoice",
    recipient: grace.manager,
    recipientEmail: grace.managerEmail,
    billTo: {
      name: grace.name,
      address: grace.address,
      ndis: formatNdis(grace.ndis),
    },
    supplier: {
      name: "Noble Community Support",
      legalName: "Noble Community Support Pty Ltd",
      abn: "",
      address: "Adelaide, South Australia",
      phone: "",
      email: "accounts@noble.example",
    },
    issue: invoiceIssue,
    due: addDays(invoiceIssue, 14),
    paymentTermsDays: 14,
    lines,
    subtotalCents: subtotal,
    taxCents: 0,
    taxRatePct: 0,
    totalCents: subtotal,
    footer:
      "Noble Community Support · Adelaide, South Australia. Thank you for your continued partnership.",
    sentAt: at(invoiceIssue, "10:00"),
    history: [
      {
        at: at(invoiceIssue, "09:00"),
        by: { id: String(staff.s3), name: "Alex Rivera" },
        action: "created",
      },
      {
        at: at(invoiceIssue, "10:00"),
        by: { id: String(staff.s3), name: "Alex Rivera" },
        action: "sent",
      },
    ],
    createdBy: { id: String(staff.s3), name: "Alex Rivera" },
  });

  /* Roster */
  const shiftRows: Array<{
    id: string;
    day: number;
    start: string;
    end: string;
    ratio: ShiftRatio;
    clients: string[];
    staff: string[];
    service: string;
    location: string;
    status: ShiftStatus;
  }> = [
    {
      id: "SH-2401",
      day: 0,
      start: "09:00",
      end: "12:00",
      ratio: "1:1",
      clients: ["p1"],
      staff: ["s1"],
      service: "r1",
      location: "Marion Shopping Centre",
      status: "Confirmed",
    },
    {
      id: "SH-2402",
      day: 0,
      start: "09:30",
      end: "12:30",
      ratio: "1:M",
      clients: ["p2", "p3"],
      staff: ["s2"],
      service: "r4",
      location: "Adelaide CBD",
      status: "Planned",
    },
    {
      id: "SH-2403",
      day: 0,
      start: "13:00",
      end: "16:00",
      ratio: "M:M",
      clients: ["p4", "p5"],
      staff: ["s1", "s2"],
      service: "r4",
      location: "Botanic Gardens",
      status: "Confirmed",
    },
    {
      id: "SH-2404",
      day: 1,
      start: "10:00",
      end: "12:00",
      ratio: "1:1",
      clients: ["p3"],
      staff: ["s1"],
      service: "r2",
      location: "Participant home",
      status: "Planned",
    },
    {
      id: "SH-2405",
      day: 2,
      start: "09:00",
      end: "11:00",
      ratio: "1:1",
      clients: ["p5"],
      staff: ["s2"],
      service: "r1",
      location: "Local community",
      status: "Planned",
    },
  ];
  for (const row of shiftRows) {
    await RosterShift.create({
      _id: row.id,
      date: addDays(today, row.day),
      start: row.start,
      end: row.end,
      ratio: row.ratio,
      clientIds: row.clients.map(key => participants[key]._id),
      staffIds: row.staff.map(key => staff[key]),
      serviceId: services[row.service]._id,
      type: services[row.service].name,
      location: row.location,
      status: row.status,
      createdBy: mayaActor,
    });
  }

  /* Voice notes (demo rows have no audio file) */
  const voiceRows = [
    {
      _id: "VN-028",
      client: "p1",
      recordId: "SR-1048",
      title: "Mia — community access follow-up",
      durationSec: 102,
      created: at(today, "12:14"),
      transcript: {
        text: "We went to Marion this morning. Mia brought her shopping list and chose most of the items by herself. I gave her a prompt when she was unsure about the labels. She seemed comfortable and asked to compare two options. Next time, bring the meal planning sheet.",
        status: "Ready" as const,
        provider: "mock",
      },
      generation: { status: "Not generated" as const },
      draft: null,
      status: "Saved" as const,
    },
    {
      _id: "VN-027",
      client: "p2",
      recordId: null,
      title: "Noah travel practice",
      durationSec: 138,
      created: at(addDays(today, -1), "15:32"),
      transcript: {
        text: "Noah planned the route to the foreshore with the map. We practised crossing at the lights. He requested a short break using his board, then continued.",
        status: "Ready" as const,
        provider: "mock",
      },
      generation: {
        status: "Draft ready" as const,
        template: "Community support progress note",
        sections: [
          "support",
          "response",
          "outcome",
          "observations",
          "followUp",
        ],
        detailLevel: "Balanced",
        provider: "mock",
        generatedAt: at(addDays(today, -1), "15:40"),
      },
      draft: {
        support:
          "Supported Noah to plan a route using a map and practise crossing at marked crossings.",
        response:
          "Noah requested a short break using his communication board, then rejoined the activity.",
        outcome:
          "Practised safe independent travel and communicating support preferences.",
        observations: "A break was offered during the outing.",
        followUp: "Repeat the foreshore route at the next visit.",
      },
      status: "Draft ready" as const,
    },
    {
      _id: "VN-026",
      client: "p3",
      recordId: null,
      title: "Priya meal preparation",
      durationSec: 56,
      created: at(addDays(today, -11), "11:48"),
      transcript: {
        text: "",
        status: "Unavailable" as const,
        provider: "mock",
        error:
          "The audio could not be processed. Retry or add a transcript manually.",
      },
      generation: { status: "Not generated" as const },
      draft: null,
      status: "Saved" as const,
    },
  ];
  for (const row of voiceRows) {
    const { client, created, ...doc } = row;
    await VoiceNote.create({
      ...doc,
      clientId: participants[client]._id,
      recordedBy: jordan,
      staffId: staff.s1,
      audio: null,
    });
    await VoiceNote.updateOne(
      { _id: row._id },
      { $set: { createdAt: created, updatedAt: created } },
      { timestamps: false }
    );
  }

  /* A little history for the dashboard */
  await Activity.insertMany([
    {
      at: at(addDays(today, -1), "11:50"),
      actor: mayaActor,
      action: "record.approved",
      entityType: "service_record",
      entityId: "SR-1046",
      participantId: participants.p3._id,
      summary: "approved service record SR-1046",
    },
    {
      at: at(today, "12:08"),
      actor: jordan,
      action: "record.submitted",
      entityType: "service_record",
      entityId: "SR-1048",
      participantId: participants.p1._id,
      summary: "submitted SR-1048 for review",
    },
    {
      at: at(invoiceIssue, "09:00"),
      actor: { id: String(staff.s3), name: "Alex Rivera" },
      action: "invoice.created",
      entityType: "invoice",
      entityId: invoiceId,
      participantId: grace._id,
      summary: `prepared invoice ${invoiceId}`,
    },
  ]);

  await Promise.all([
    ensureCounterAtLeast("serviceRecord", 48),
    ensureCounterAtLeast("shift", 5),
    ensureCounterAtLeast("voiceNote", 28),
    ensureCounterAtLeast(`invoice:${invoiceIssue.slice(0, 4)}`, 91),
    ensureCounterAtLeast("participant", clientNumber),
  ]);
  await ensureTemplateSlots();
  invalidateWorkspaceCache();
  return { seeded: true, email, generatedPassword };
}
