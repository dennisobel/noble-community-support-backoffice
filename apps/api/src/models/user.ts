import { model, Schema, type Types } from "mongoose";
import {
  DETAIL_LEVELS,
  NOTE_TEMPLATES,
  USER_ROLES,
  type DetailLevel,
  type NoteTemplate,
  type UserRole,
} from "@shared/enums";
import { baseOptions } from "./common";

export interface UserDoc {
  _id: Types.ObjectId;
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  /** Set for worker accounts so the portal can resolve the team member record. */
  staffId: Types.ObjectId | null;
  /** Where an invited worker is in the "set your password" journey. */
  invitation: {
    sentAt: Date | null;
    acceptedAt: Date | null;
  };
  status: "active" | "disabled";
  failedLogins: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  passwordChangedAt: Date | null;
  tokenVersion: number;
  notificationsSeenAt: Date | null;
  preferences: {
    voice: {
      generationTemplate: NoteTemplate;
      detailLevel: DetailLevel;
      autoSaveRecordings: boolean;
      useTranscriptOnly: boolean;
      notifyDraftReady: boolean;
    };
    notifications: {
      recordReturned: boolean;
      reviewQueue: boolean;
      budgetAlerts: boolean;
      invoiceOverdue: boolean;
      voiceDraftReady: boolean;
    };
  };
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<UserDoc>(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
    },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: USER_ROLES, default: "admin" },
    staffId: { type: Schema.Types.ObjectId, ref: "Staff", default: null },
    invitation: {
      sentAt: { type: Date, default: null },
      acceptedAt: { type: Date, default: null },
    },
    status: { type: String, enum: ["active", "disabled"], default: "active" },
    failedLogins: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    passwordChangedAt: { type: Date, default: null },
    tokenVersion: { type: Number, default: 0 },
    notificationsSeenAt: { type: Date, default: null },
    preferences: {
      voice: {
        generationTemplate: {
          type: String,
          enum: NOTE_TEMPLATES,
          default: NOTE_TEMPLATES[0],
        },
        detailLevel: { type: String, enum: DETAIL_LEVELS, default: "Balanced" },
        autoSaveRecordings: { type: Boolean, default: true },
        useTranscriptOnly: { type: Boolean, default: false },
        notifyDraftReady: { type: Boolean, default: true },
      },
      notifications: {
        recordReturned: { type: Boolean, default: true },
        reviewQueue: { type: Boolean, default: true },
        budgetAlerts: { type: Boolean, default: true },
        invoiceOverdue: { type: Boolean, default: true },
        voiceDraftReady: { type: Boolean, default: true },
      },
    },
  },
  baseOptions
);

export const User = model<UserDoc>("User", userSchema, "users");
