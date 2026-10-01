import { model, Schema, type Types } from "mongoose";
import { actorSchema, baseOptions, type ActorRefSub } from "./common";

export interface BudgetDoc {
  _id: Types.ObjectId;
  clientId: Types.ObjectId;
  planStart: string;
  planEnd: string;
  categories: Array<{ name: string; allocationCents: number }>;
  isCurrent: boolean;
  confirmedAgainstPlanAt: Date | null;
  createdBy: ActorRefSub | null;
  rev: number;
  createdAt: Date;
  updatedAt: Date;
}

const budgetSchema = new Schema<BudgetDoc>(
  {
    clientId: {
      type: Schema.Types.ObjectId,
      ref: "Participant",
      required: true,
    },
    planStart: { type: String, required: true },
    planEnd: { type: String, required: true },
    categories: [
      {
        _id: false,
        name: { type: String, required: true },
        allocationCents: { type: Number, required: true, min: 0 },
      },
    ],
    isCurrent: { type: Boolean, default: true },
    confirmedAgainstPlanAt: { type: Date, default: null },
    createdBy: { type: actorSchema, default: null },
    rev: { type: Number, default: 0 },
  },
  baseOptions
);
budgetSchema.index(
  { clientId: 1 },
  { unique: true, partialFilterExpression: { isCurrent: true } }
);
budgetSchema.index({ clientId: 1, planStart: -1 });

export const Budget = model<BudgetDoc>("Budget", budgetSchema, "budgets");

export interface BudgetAdjustmentDoc {
  _id: Types.ObjectId;
  budgetId: Types.ObjectId;
  clientId: Types.ObjectId;
  category: string;
  oldAllocationCents: number;
  newAllocationCents: number;
  reason: string;
  by: ActorRefSub | null;
  at: Date;
}

const budgetAdjustmentSchema = new Schema<BudgetAdjustmentDoc>(
  {
    budgetId: { type: Schema.Types.ObjectId, ref: "Budget", required: true },
    clientId: {
      type: Schema.Types.ObjectId,
      ref: "Participant",
      required: true,
    },
    category: { type: String, required: true },
    oldAllocationCents: { type: Number, required: true },
    newAllocationCents: { type: Number, required: true },
    reason: { type: String, required: true },
    by: { type: actorSchema, default: null },
    at: { type: Date, required: true },
  },
  { versionKey: false }
);
budgetAdjustmentSchema.index({ clientId: 1, at: -1 });

export const BudgetAdjustment = model<BudgetAdjustmentDoc>(
  "BudgetAdjustment",
  budgetAdjustmentSchema,
  "budget_adjustments"
);
