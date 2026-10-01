import { model, Schema, type Types } from "mongoose";
import { LOGBOOK_ENTRY_TYPES, type LogbookEntryType } from "@shared/enums";
import { baseOptions } from "./common";

/** Kilometres and vehicle notes a worker claims for a shift (the KM logbook). */
export interface LogbookEntryDoc {
  _id: Types.ObjectId;
  staffId: Types.ObjectId;
  participantId: Types.ObjectId | null;
  shiftId: string | null;
  trackingId: Types.ObjectId | null;
  date: string;
  type: LogbookEntryType;
  fromLocation: string;
  toLocation: string;
  purpose: string;
  kilometres: number;
  odometerStart: number | null;
  odometerEnd: number | null;
  notes: string;
  rev: number;
  createdAt: Date;
  updatedAt: Date;
}

const logbookEntrySchema = new Schema<LogbookEntryDoc>(
  {
    staffId: {
      type: Schema.Types.ObjectId,
      ref: "Staff",
      required: true,
      index: true,
    },
    participantId: {
      type: Schema.Types.ObjectId,
      ref: "Participant",
      default: null,
    },
    shiftId: { type: String, default: null },
    trackingId: {
      type: Schema.Types.ObjectId,
      ref: "TrackingSession",
      default: null,
    },
    date: { type: String, required: true },
    type: { type: String, enum: LOGBOOK_ENTRY_TYPES, default: "Kilometres" },
    fromLocation: { type: String, default: "" },
    toLocation: { type: String, default: "" },
    purpose: { type: String, default: "" },
    kilometres: { type: Number, default: 0, min: 0 },
    odometerStart: { type: Number, default: null },
    odometerEnd: { type: Number, default: null },
    notes: { type: String, default: "" },
    rev: { type: Number, default: 0 },
  },
  baseOptions
);
logbookEntrySchema.index({ staffId: 1, date: -1 });
logbookEntrySchema.index({ shiftId: 1 });

export const LogbookEntry = model<LogbookEntryDoc>(
  "LogbookEntry",
  logbookEntrySchema,
  "logbook_entries"
);
