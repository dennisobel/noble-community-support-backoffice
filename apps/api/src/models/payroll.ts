import { model, Schema, type Types } from "mongoose";
import {
  PAY_PERIOD_LENGTHS,
  PAY_RUN_STATUSES,
  type EmploymentType,
  type PayCode,
  type PayPeriodLength,
  type PayRunStatus,
} from "@shared/enums";
import { DEFAULT_AWARD_RULES, type AwardRules } from "@shared/logic/award";
import {
  actorSchema,
  baseOptions,
  historySchema,
  type ActorRefSub,
  type HistorySub,
} from "./common";

/* Pay rules: the award settings, the classification rate table and the public holidays. One document. */

export const PAY_SETTINGS_ID = "pay";
/** A Monday, so a new workspace's pay periods start on a Monday until it says otherwise. */
export const DEFAULT_PAY_ANCHOR = "2024-01-01";

export interface PayClassificationSub {
  id: string;
  name: string;
  /** Each rate applies from its date until the next one starts. */
  rates: Array<{ effectiveFrom: string; hourlyCents: number }>;
}

export interface PaySettingsDoc {
  _id: string;
  /** Stored whole; anything missing falls back to the award default when it is read. */
  rules: Partial<AwardRules>;
  classifications: PayClassificationSub[];
  publicHolidays: Array<{ date: string; name: string }>;
  payPeriod: { length: PayPeriodLength; anchor: string };
  /** Sign-on or sign-off this close to the roster is paid as rostered. */
  toleranceMinutes: number;
  updatedBy: ActorRefSub | null;
  rev: number;
  createdAt: Date;
  updatedAt: Date;
}

const paySettingsSchema = new Schema<PaySettingsDoc>(
  {
    _id: { type: String, default: PAY_SETTINGS_ID },
    rules: { type: Schema.Types.Mixed, default: () => ({ ...DEFAULT_AWARD_RULES }) },
    classifications: [
      {
        _id: false,
        id: { type: String, required: true },
        name: { type: String, required: true, trim: true },
        rates: [
          {
            _id: false,
            effectiveFrom: { type: String, required: true },
            hourlyCents: { type: Number, required: true, min: 0 },
          },
        ],
      },
    ],
    publicHolidays: [
      {
        _id: false,
        date: { type: String, required: true },
        name: { type: String, required: true, trim: true },
      },
    ],
    payPeriod: {
      length: {
        type: String,
        enum: PAY_PERIOD_LENGTHS,
        default: "Fortnightly",
      },
      anchor: { type: String, default: DEFAULT_PAY_ANCHOR },
    },
    toleranceMinutes: { type: Number, default: 10, min: 0 },
    updatedBy: { type: actorSchema, default: null },
    rev: { type: Number, default: 0 },
  },
  { ...baseOptions, minimize: false }
);

export const PaySettings = model<PaySettingsDoc>(
  "PaySettings",
  paySettingsSchema,
  "pay_settings"
);

/* Pay runs: the gross pay for one pay period, kept as it was worked out. */

export interface PayLineSub {
  /** The shift the line came from; empty for leave. */
  key: string;
  date: string;
  code: PayCode;
  label: string;
  minutes: number;
  units: number | null;
  pct: number;
  rateCents: number;
  amountCents: number;
  why: string;
}

export interface PayRunItemSub {
  staffId: Types.ObjectId;
  staffName: string;
  payrollId: string;
  employmentType: EmploymentType | null;
  classificationName: string;
  baseRateCents: number;
  workedMinutes: number;
  paidMinutes: number;
  ordinaryMinutes: number;
  overtimeMinutes: number;
  allowanceCents: number;
  /** Lines only; adjustments are added on top when the run is read. */
  grossCents: number;
  lines: PayLineSub[];
  flags: string[];
  /** The timesheets and leave requests this item pays, so finalising can lock them. */
  shiftIds: string[];
  leaveIds: Types.ObjectId[];
}

export interface PayAdjustmentSub {
  _id: Types.ObjectId;
  staffId: Types.ObjectId;
  label: string;
  amountCents: number;
  by: ActorRefSub | null;
  at: Date;
}

export interface PayRunDoc {
  _id: string;
  from: string;
  to: string;
  length: PayPeriodLength;
  status: PayRunStatus;
  items: PayRunItemSub[];
  /** Kept apart from the items so recalculating a draft never loses them. */
  adjustments: PayAdjustmentSub[];
  warnings: string[];
  createdBy: ActorRefSub | null;
  finalisedBy: ActorRefSub | null;
  finalisedAt: Date | null;
  history: HistorySub[];
  rev: number;
  createdAt: Date;
  updatedAt: Date;
}

const payLineSchema = new Schema<PayLineSub>(
  {
    key: { type: String, default: "" },
    date: { type: String, required: true },
    code: { type: String, required: true },
    label: { type: String, required: true },
    minutes: { type: Number, default: 0 },
    units: { type: Number, default: null },
    pct: { type: Number, default: 0 },
    rateCents: { type: Number, default: 0 },
    amountCents: { type: Number, default: 0 },
    why: { type: String, default: "" },
  },
  { _id: false }
);

const payRunItemSchema = new Schema<PayRunItemSub>(
  {
    staffId: { type: Schema.Types.ObjectId, ref: "Staff", required: true },
    staffName: { type: String, required: true },
    payrollId: { type: String, default: "" },
    employmentType: { type: String, default: null },
    classificationName: { type: String, default: "" },
    baseRateCents: { type: Number, default: 0 },
    workedMinutes: { type: Number, default: 0 },
    paidMinutes: { type: Number, default: 0 },
    ordinaryMinutes: { type: Number, default: 0 },
    overtimeMinutes: { type: Number, default: 0 },
    allowanceCents: { type: Number, default: 0 },
    grossCents: { type: Number, default: 0 },
    lines: { type: [payLineSchema], default: [] },
    flags: { type: [String], default: [] },
    shiftIds: { type: [String], default: [] },
    leaveIds: [{ type: Schema.Types.ObjectId, ref: "LeaveRequest" }],
  },
  { _id: false }
);

const payRunSchema = new Schema<PayRunDoc>(
  {
    _id: { type: String, required: true },
    from: { type: String, required: true },
    to: { type: String, required: true },
    length: { type: String, enum: PAY_PERIOD_LENGTHS, required: true },
    status: { type: String, enum: PAY_RUN_STATUSES, default: "Draft" },
    items: { type: [payRunItemSchema], default: [] },
    adjustments: [
      {
        staffId: { type: Schema.Types.ObjectId, ref: "Staff", required: true },
        label: { type: String, required: true },
        amountCents: { type: Number, required: true },
        by: { type: actorSchema, default: null },
        at: { type: Date, required: true },
      },
    ],
    warnings: { type: [String], default: [] },
    createdBy: { type: actorSchema, default: null },
    finalisedBy: { type: actorSchema, default: null },
    finalisedAt: { type: Date, default: null },
    history: { type: [historySchema], default: [] },
    rev: { type: Number, default: 0 },
  },
  baseOptions
);
payRunSchema.index({ from: -1 });
payRunSchema.index({ status: 1, from: -1 });

export const PayRun = model<PayRunDoc>("PayRun", payRunSchema, "pay_runs");
