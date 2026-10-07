import { model, Schema } from "mongoose";
import { DEFAULT_TIMEZONE, DEFAULT_TRAVEL_RATE_CENTS } from "@shared/const";
import { DEFAULT_BUDGET_CATEGORIES } from "@shared/enums";
import { baseOptions } from "./common";

export const WORKSPACE_ID = "workspace";

export interface WorkspaceDoc {
  _id: string;
  name: string;
  legalName: string;
  abn: string;
  address: string;
  phone: string;
  email: string;
  timezone: string;
  currency: string;
  gst: { registered: boolean; ratePct: number };
  invoice: {
    prefix: string;
    defaultPaymentTermsDays: number;
    footer: string;
    paymentInstructions: string;
  };
  bank: {
    accountName: string;
    bsb: string;
    accountNumber: string;
    payInstruction: string;
  };
  providerTravelRateCents: number;
  budgetCategories: string[];
  /** The no-login feedback form: whether it is open, and the token in its link. */
  feedbackForm?: { enabled: boolean; token: string | null };
  setupCompletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export const workspaceDefaults = (timezone = DEFAULT_TIMEZONE) => ({
  name: "Noble Community Support",
  legalName: "",
  abn: "",
  address: "Adelaide, South Australia",
  phone: "",
  email: "",
  timezone,
  currency: "AUD",
  gst: { registered: false, ratePct: 0 },
  invoice: {
    prefix: "INV",
    defaultPaymentTermsDays: 14,
    footer: "Thank you for your continued partnership.",
    paymentInstructions: "",
  },
  bank: {
    accountName: "",
    bsb: "",
    accountNumber: "",
    payInstruction: "Invoice number or participant name",
  },
  providerTravelRateCents: DEFAULT_TRAVEL_RATE_CENTS,
  budgetCategories: [...DEFAULT_BUDGET_CATEGORIES],
});

const workspaceSchema = new Schema<WorkspaceDoc>(
  {
    _id: { type: String, default: WORKSPACE_ID },
    name: { type: String, default: "Noble Community Support" },
    legalName: { type: String, default: "" },
    abn: { type: String, default: "" },
    address: { type: String, default: "" },
    phone: { type: String, default: "" },
    email: { type: String, default: "" },
    timezone: { type: String, default: DEFAULT_TIMEZONE },
    currency: { type: String, default: "AUD" },
    gst: {
      registered: { type: Boolean, default: false },
      ratePct: { type: Number, default: 0 },
    },
    invoice: {
      prefix: { type: String, default: "INV" },
      defaultPaymentTermsDays: { type: Number, default: 14 },
      footer: { type: String, default: "" },
      paymentInstructions: { type: String, default: "" },
    },
    bank: {
      accountName: { type: String, default: "" },
      bsb: { type: String, default: "" },
      accountNumber: { type: String, default: "" },
      payInstruction: {
        type: String,
        default: "Invoice number or participant name",
      },
    },
    providerTravelRateCents: {
      type: Number,
      default: DEFAULT_TRAVEL_RATE_CENTS,
    },
    budgetCategories: {
      type: [String],
      default: () => [...DEFAULT_BUDGET_CATEGORIES],
    },
    feedbackForm: {
      enabled: { type: Boolean, default: false },
      token: { type: String, default: null },
    },
    setupCompletedAt: { type: Date, default: null },
  },
  baseOptions
);

export const Workspace = model<WorkspaceDoc>(
  "Workspace",
  workspaceSchema,
  "workspace"
);
