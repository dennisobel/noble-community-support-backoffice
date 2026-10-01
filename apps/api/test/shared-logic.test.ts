import { describe, expect, it } from "vitest";
import { computeBillables, totalCents } from "@shared/logic/billing";
import { computeBudgetMetrics } from "@shared/logic/budget";
import { toCents } from "@shared/logic/money";
import { formatNdis, normalizeNdis } from "@shared/logic/ndis";
import { findOverlaps, ratioError } from "@shared/logic/roster";
import {
  addDays,
  durationHours,
  planLabel,
  startOfWeek,
  zonedStartOfDay,
} from "@shared/logic/time";

describe("time", () => {
  it("rounds durations to the nearest 0.1 hour", () => {
    expect(durationHours("09:00", "12:00")).toBe(3);
    expect(durationHours("13:00", "15:30")).toBe(2.5);
    expect(durationHours("09:00", "09:04")).toBe(0.1);
    expect(durationHours("12:00", "09:00")).toBe(0);
  });
  it("does calendar arithmetic on business dates", () => {
    expect(addDays("2026-02-27", 2)).toBe("2026-03-01");
    expect(startOfWeek("2026-09-27")).toBe("2026-09-21");
    expect(planLabel("2026-02-01", "2027-01-31")).toMatch(
      /^01 Feb 2026 – 31 Jan 2027$/
    );
    expect(planLabel(null, "2027-01-31")).toBe("Plan dates to confirm");
  });
  it("finds the UTC start of a day in Adelaide across daylight saving", () => {
    expect(
      zonedStartOfDay("2026-07-01", "Australia/Adelaide").toISOString()
    ).toBe("2026-06-30T14:30:00.000Z");
    expect(
      zonedStartOfDay("2026-01-01", "Australia/Adelaide").toISOString()
    ).toBe("2025-12-31T13:30:00.000Z");
  });
});

describe("billing", () => {
  const service = {
    name: "Community participation",
    unit: "Hour" as const,
    rateCents: 6830,
    transportEnabled: true,
  };
  it("bills hours plus provider travel", () => {
    const lines = computeBillables(
      { start: "09:00", end: "12:00", km: 12.4 },
      service,
      100
    );
    expect(lines).toEqual([
      {
        label: "Community participation",
        unit: "Hour",
        quantity: 3,
        rateCents: 6830,
        subtotalCents: 20490,
      },
      {
        label: "Provider travel",
        unit: "Kilometre",
        quantity: 12.4,
        rateCents: 100,
        subtotalCents: 1240,
      },
    ]);
    expect(totalCents(lines)).toBe(21730);
  });
  it("skips travel when the service does not allow transport and uses quantities for other units", () => {
    const session = {
      name: "Assessment",
      unit: "Session" as const,
      rateCents: 15000,
      transportEnabled: false,
    };
    expect(
      computeBillables(
        { start: "09:00", end: "10:00", km: 20, quantity: 2 },
        session,
        100
      )
    ).toEqual([
      {
        label: "Assessment",
        unit: "Session",
        quantity: 2,
        rateCents: 15000,
        subtotalCents: 30000,
      },
    ]);
  });
  it("converts dollars to cents without float drift", () => {
    expect(toCents(68.3)).toBe(6830);
    expect(toCents(100.14)).toBe(10014);
  });
});

describe("budget metrics", () => {
  it("counts only activity inside the plan window", () => {
    const metrics = computeBudgetMetrics({
      planStart: "2026-02-01",
      planEnd: "2027-01-31",
      today: "2026-09-29",
      categories: [
        { name: "Community participation", allocationCents: 100000 },
      ],
      records: [
        {
          date: "2026-09-28",
          status: "Approved",
          category: "Community participation",
          totalCents: 20000,
        },
        {
          date: "2026-09-28",
          status: "Submitted",
          category: "Community participation",
          totalCents: 10000,
        },
        {
          date: "2026-01-15",
          status: "Invoiced",
          category: "Community participation",
          totalCents: 99999,
        },
        {
          date: "2026-09-28",
          status: "Draft",
          category: "Community participation",
          totalCents: 5000,
        },
      ],
      shifts: [
        {
          date: "2026-10-01",
          status: "Planned",
          category: "Community participation",
          costCents: 13660,
        },
        {
          date: "2026-09-01",
          status: "Planned",
          category: "Community participation",
          costCents: 50000,
        },
        {
          date: "2026-10-02",
          status: "Cancelled",
          category: "Community participation",
          costCents: 50000,
        },
        {
          date: "2026-10-03",
          status: "Confirmed",
          category: "Daily living skills",
          costCents: 5000,
        },
      ],
    });
    expect(metrics.categories[0]).toMatchObject({
      usedCents: 20000,
      pendingCents: 10000,
      committedCents: 13660,
      remainingCents: 56340,
    });
    // Spend in an unfunded category is shown rather than ignored.
    expect(metrics.categories[1]).toMatchObject({
      name: "Daily living skills",
      allocationCents: 0,
      remainingCents: -5000,
    });
    expect(metrics.status).toBe("Within plan");
  });
  it("reports expired, over and low plans", () => {
    const base = {
      categories: [{ name: "A", allocationCents: 1000 }],
      records: [],
      shifts: [],
    };
    expect(
      computeBudgetMetrics({
        ...base,
        planStart: "2025-01-01",
        planEnd: "2025-12-31",
        today: "2026-01-02",
      }).status
    ).toBe("Plan expired");
    expect(
      computeBudgetMetrics({
        ...base,
        planStart: "2026-01-01",
        planEnd: "2026-12-31",
        today: "2026-06-01",
        records: [
          {
            date: "2026-05-01",
            status: "Approved",
            category: "A",
            totalCents: 900,
          },
        ],
      }).status
    ).toBe("Low balance");
  });
});

describe("roster rules", () => {
  it("validates ratios", () => {
    expect(ratioError("1:1", 1, 1)).toBeNull();
    expect(ratioError("1:1", 2, 1)).toMatch(/exactly one participant/);
    expect(ratioError("1:M", 2, 1)).toBeNull();
    expect(ratioError("M:M", 2, 1)).toMatch(/at least two staff/);
  });
  it("detects double bookings but ignores cancelled shifts and touching times", () => {
    const existing = [
      {
        id: "SH-1",
        date: "2026-10-01",
        start: "09:00",
        end: "12:00",
        clientIds: ["a"],
        staffIds: ["x"],
        status: "Planned",
      },
      {
        id: "SH-2",
        date: "2026-10-01",
        start: "13:00",
        end: "15:00",
        clientIds: ["b"],
        staffIds: ["y"],
        status: "Cancelled",
      },
    ];
    expect(
      findOverlaps(
        {
          date: "2026-10-01",
          start: "11:00",
          end: "13:00",
          clientIds: ["a"],
          staffIds: ["z"],
        },
        existing
      ).participantConflict?.id
    ).toBe("SH-1");
    expect(
      findOverlaps(
        {
          date: "2026-10-01",
          start: "12:00",
          end: "13:00",
          clientIds: ["a"],
          staffIds: ["x"],
        },
        existing
      )
    ).toEqual({ participantConflict: undefined, staffConflict: undefined });
    expect(
      findOverlaps(
        {
          date: "2026-10-01",
          start: "13:00",
          end: "14:00",
          clientIds: ["b"],
          staffIds: ["y"],
        },
        existing
      ).participantConflict
    ).toBeUndefined();
  });
});

describe("NDIS numbers", () => {
  it("normalises and formats", () => {
    expect(normalizeNdis("431 208 775")).toBe("431208775");
    expect(formatNdis("431208775")).toBe("431 208 775");
  });
});
