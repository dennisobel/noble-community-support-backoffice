import { model, Schema, type Types } from "mongoose";
import {
  SERVICE_UNITS,
  TRANSPORT_UNITS,
  type ServiceUnit,
  type TransportUnit,
} from "@shared/enums";
import { actorSchema, baseOptions, type ActorRefSub } from "./common";

export interface ServiceDoc {
  _id: Types.ObjectId;
  name: string;
  nameKey: string;
  unit: ServiceUnit;
  rateCents: number;
  transportEnabled: boolean;
  transportUnit: TransportUnit | null;
  budgetCategory: string;
  supportItemNumber: string;
  active: boolean;
  rateHistory: Array<{
    rateCents: number;
    changedAt: Date;
    changedBy: ActorRefSub | null;
  }>;
  rev: number;
  createdAt: Date;
  updatedAt: Date;
}

const serviceSchema = new Schema<ServiceDoc>(
  {
    name: { type: String, required: true, trim: true },
    nameKey: { type: String, required: true, unique: true },
    unit: { type: String, enum: SERVICE_UNITS, required: true },
    rateCents: { type: Number, required: true, min: 0 },
    transportEnabled: { type: Boolean, default: false },
    transportUnit: {
      type: String,
      enum: [...TRANSPORT_UNITS, null],
      default: null,
    },
    budgetCategory: { type: String, required: true },
    supportItemNumber: { type: String, default: "" },
    active: { type: Boolean, default: true },
    rateHistory: [
      {
        _id: false,
        rateCents: { type: Number, required: true },
        changedAt: { type: Date, required: true },
        changedBy: { type: actorSchema, default: null },
      },
    ],
    rev: { type: Number, default: 0 },
  },
  baseOptions
);
serviceSchema.index({ active: 1, name: 1 });

export const Service = model<ServiceDoc>("Service", serviceSchema, "services");

export const serviceNameKey = (name: string) =>
  name.trim().toLowerCase().replace(/\s+/g, " ");
