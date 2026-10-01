import type { Express } from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  BudgetOverviewItemDTO,
  Paginated,
  ParticipantDTO,
  ReportsOverviewDTO,
  RosterShiftDTO,
  ServiceDTO,
  ServiceRecordDTO,
  StaffDTO,
} from "@shared/dto";
import { addDays, startOfWeek, todayIn } from "@shared/logic/time";
import { checkIntegrity } from "../src/db/integrity";
import { seedSampleData, type SampleSeedResult } from "../src/db/seed-sample";
import { invalidateWorkspaceCache } from "../src/lib/workspace";
import {
  Activity,
  Counter,
  Invoice,
  ServiceRecord,
  Service,
  Staff,
  User,
  Workspace,
  WORKSPACE_ID,
} from "../src/models";
import {
  ADMIN,
  API,
  signedInAgent,
  startTestApp,
  stopTestApp,
} from "./helpers";

let app: Express;
let agent: Awaited<ReturnType<typeof signedInAgent>>;

beforeAll(async () => {
  app = await startTestApp();
  agent = await signedInAgent(app);
});
afterAll(stopTestApp);

const get = async <T>(path: string): Promise<T> => {
  const response = await agent.get(`${API}${path}`);
  expect(response.status, `${path}: ${JSON.stringify(response.body)}`).toBe(
    200
  );
  return response.body as T;
};

describe("sample workspace", () => {
  it("rolls back completely when it cannot finish", async () => {
    // A workspace without the "Support coordination" category cannot hold the sample services.
    await Workspace.updateOne(
      { _id: WORKSPACE_ID },
      { $pull: { budgetCategories: "Support coordination" } }
    );
    invalidateWorkspaceCache();
    await expect(seedSampleData()).rejects.toThrow(/budget category/i);
    expect(await Staff.countDocuments()).toBe(0);
    expect(await Service.countDocuments()).toBe(0);
    expect(await Counter.countDocuments()).toBe(0);
    expect(await Activity.countDocuments({ ip: "sample-seed" })).toBe(0);
    expect(await User.countDocuments()).toBe(1);
    await Workspace.updateOne(
      { _id: WORKSPACE_ID },
      { $addToSet: { budgetCategories: "Support coordination" } }
    );
    invalidateWorkspaceCache();
  });

  describe("once loaded", () => {
    let seeded: SampleSeedResult;
    let today: string;

    beforeAll(async () => {
      seeded = await seedSampleData();
      today = todayIn("Australia/Adelaide");
    }, 300_000);

    it("passes the consistency check and leaves the Admin account alone", async () => {
      expect(seeded.report.problems).toEqual([]);
      expect((await checkIntegrity()).problems).toEqual([]);
      const users = await User.find().lean();
      expect(users).toHaveLength(1);
      expect(users[0].email).toBe(ADMIN.email);
      expect(seeded.adminEmail).toBe(ADMIN.email);
    });

    it("refuses to add a second copy and changes nothing", async () => {
      const before = await ServiceRecord.countDocuments();
      await expect(seedSampleData()).rejects.toThrow(/already has/);
      expect(await ServiceRecord.countDocuments()).toBe(before);
    });

    it("marks every audit entry it wrote and dates them in the past", async () => {
      const entries = await Activity.find({ ip: "sample-seed" }).lean();
      expect(entries.length).toBeGreaterThan(500);
      expect(entries.every(entry => entry.at <= new Date())).toBe(true);
      const oldest = Math.min(...entries.map(entry => entry.at.getTime()));
      expect(Date.now() - oldest).toBeGreaterThan(90 * 86_400_000);
    });

    it("serves the clients, team and services", async () => {
      const participants = await get<Paginated<ParticipantDTO>>(
        "/participants?status=all&limit=100"
      );
      expect(participants.total).toBe(8);
      expect(
        participants.items.filter(p => p.status === "Archived")
      ).toHaveLength(1);

      const staff = await get<StaffDTO[]>("/staff");
      expect(staff.map(member => member.status).sort()).toEqual([
        "Active",
        "Active",
        "Active",
        "Active",
        "Active",
        "On leave",
      ]);
      expect(new Set(staff.map(member => member.team))).toEqual(
        new Set(["Community Support", "Support Coordination", "Administration"])
      );

      const services = await get<ServiceDTO[]>("/services");
      expect(services).toHaveLength(7);
      expect(services.filter(service => !service.active)).toHaveLength(1);
    });

    it("rosters real clients and staff, with a record for everyone who attended", async () => {
      const monday = startOfWeek(today);
      const week = await get<RosterShiftDTO[]>(
        `/roster/shifts?from=${monday}&to=${addDays(monday, 6)}`
      );
      expect(week.length).toBeGreaterThan(8);
      for (const shift of week) {
        expect(shift.clients).toHaveLength(shift.clientIds.length);
        expect(shift.staff).toHaveLength(shift.staffIds.length);
        expect(
          shift.clients.every(client => client.name && client.preferred)
        ).toBe(true);
      }

      const past = await get<RosterShiftDTO[]>(
        `/roster/shifts?from=${addDays(monday, -91)}&to=${addDays(monday, -1)}`
      );
      const completed = past.filter(shift => shift.status === "Completed");
      expect(completed.length).toBeGreaterThan(100);
      expect(
        completed.every(
          shift => shift.recordIds.length === shift.clientIds.length
        )
      ).toBe(true);
      expect(past.some(shift => shift.status === "Cancelled")).toBe(true);

      const ahead = await get<RosterShiftDTO[]>(
        `/roster/shifts?from=${addDays(monday, 7)}&to=${addDays(monday, 20)}`
      );
      expect(ahead.length).toBeGreaterThan(15);
      expect(
        ahead.every(shift => ["Planned", "Confirmed"].includes(shift.status))
      ).toBe(true);
    });

    it("carries service records through review, invoicing and payment", async () => {
      const list = await get<Paginated<ServiceRecordDTO>>(
        "/service-records?limit=200&sort=date"
      );
      expect(list.total).toBeGreaterThan(100);
      const invoices = await Invoice.find().lean();
      expect(invoices.length).toBeGreaterThan(10);
      const statuses = new Set(invoices.map(invoice => invoice.status));
      expect(statuses.has("Paid")).toBe(true);
      expect(statuses.size).toBeGreaterThanOrEqual(3);
      const counts = await get<Record<string, number>>(
        "/service-records/counts"
      );
      expect(counts.Invoiced).toBeGreaterThan(50);
    });

    it("gives every current plan a budget that funds what was delivered", async () => {
      const overview = await get<BudgetOverviewItemDTO[]>("/budgets/overview");
      expect(overview).toHaveLength(7);
      expect(overview.every(item => item.remaining >= 0)).toBe(true);
      const statuses = overview.map(item => item.status);
      expect(statuses).not.toContain("Over allocation");
      expect(statuses).not.toContain("Plan expired");
      expect(overview.find(item => item.clientName === "Sofia")?.status).toBe(
        "Low balance"
      );
    });

    it("feeds the reports from the same records", async () => {
      // A fixed window over the seeded history. "This quarter" is nearly empty on 1 January,
      // 1 April, 1 July and 1 October, which would make these counts depend on the date.
      const from = addDays(today, -89);
      const overview = await get<ReportsOverviewDTO>(
        `/reports/overview?period=custom&from=${from}&to=${today}`
      );
      const inRange = await ServiceRecord.countDocuments({
        date: { $gte: from, $lte: today },
      });
      const { documentationStatus: docs } = overview;
      expect(docs.total).toBe(inRange);
      expect(inRange).toBeGreaterThan(50);
      expect(
        docs.approvedOrInvoiced + docs.submitted + docs.draftOrReturned
      ).toBe(docs.total);
      expect(
        overview.serviceActivity.reduce((sum, week) => sum + week.count, 0)
      ).toBe(docs.approvedOrInvoiced + docs.submitted);

      const approved = await ServiceRecord.find({ status: "Approved" }).lean();
      expect(overview.billingReadiness.approvedNotInvoiced).toBe(
        approved.length
      );
      expect(overview.billingReadiness.value).toBeCloseTo(
        approved.reduce((sum, record) => sum + record.totalCents, 0) / 100,
        2
      );
      expect(overview.transport.totalKm).toBeGreaterThan(50);
      expect(overview.teams).toEqual([
        "Administration",
        "Community Support",
        "Support Coordination",
      ]);

      const byTeam = await get<ReportsOverviewDTO>(
        `/reports/overview?period=custom&from=${from}&to=${today}&team=Support%20Coordination`
      );
      expect(byTeam.documentationStatus.total).toBeGreaterThan(0);
      expect(byTeam.documentationStatus.total).toBeLessThan(docs.total);

      for (const report of [
        "service-records",
        "billing",
        "transport",
        "documentation",
      ]) {
        const response = await agent.get(
          `${API}/reports/export?report=${report}&period=custom&from=${from}&to=${today}`
        );
        expect(response.status).toBe(200);
        expect(response.text.split("\n").length).toBeGreaterThan(5);
      }
    });

    it("lights up the dashboard, search and notifications", async () => {
      const dashboard = await get<{ kpis: { activeParticipants: number } }>(
        "/dashboard"
      );
      expect(dashboard.kpis.activeParticipants).toBe(7);
      await get("/notifications");
      expect(JSON.stringify(await get<unknown>("/search?q=Mia"))).toContain(
        "Mia"
      );
    });
  });
});
