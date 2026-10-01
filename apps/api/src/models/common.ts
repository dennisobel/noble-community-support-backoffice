import { Schema } from "mongoose";

export interface ActorRefSub {
  id: string;
  name: string;
}

export interface HistorySub {
  at: Date;
  by: ActorRefSub | null;
  action: string;
  note?: string;
}

export interface BillableSub {
  label: string;
  unit: string;
  quantity: number;
  rateCents: number;
  subtotalCents: number;
}

export const actorSchema = new Schema<ActorRefSub>(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
  },
  { _id: false }
);

export const historySchema = new Schema<HistorySub>(
  {
    at: { type: Date, required: true },
    by: { type: actorSchema, default: null },
    action: { type: String, required: true },
    note: { type: String },
  },
  { _id: false }
);

export const billableSchema = new Schema<BillableSub>(
  {
    label: { type: String, required: true },
    unit: { type: String, required: true },
    quantity: { type: Number, required: true },
    rateCents: { type: Number, required: true },
    subtotalCents: { type: Number, required: true },
  },
  { _id: false }
);

export const baseOptions = { timestamps: true, versionKey: false } as const;
