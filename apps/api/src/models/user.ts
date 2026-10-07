import { model, Schema, type Types } from "mongoose";
import {
  ACCESS_MODULES,
  DETAIL_LEVELS,
  NOTE_TEMPLATES,
  USER_ROLES,
  USER_STATUSES,
  type AccessModule,
  type DetailLevel,
  type NoteTemplate,
  type UserRole,
  type UserStatus,
} from "@shared/enums";
import { actorSchema, baseOptions, type ActorRefSub } from "./common";

export interface UserDoc {
  _id: Types.ObjectId;
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  /** The parts of the back office an office user may open. Admins ignore this: they can open all of it. */
  modules: AccessModule[];
  /** Set for worker accounts so the portal can resolve the team member record. */
  staffId: Types.ObjectId | null;
  /** Where an invited worker is in the "set your password" journey. */
  invitation: {
    sentAt: Date | null;
    acceptedAt: Date | null;
  };
  status: UserStatus;
  /** A self-service sign-up waits for an Admin: what they said, and how the Admin answered. */
  request: {
    message: string;
    reviewedAt: Date | null;
    reviewedBy: ActorRefSub | null;
    note: string;
  };
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
    modules: { type: [{ type: String, enum: ACCESS_MODULES }], default: [] },
    staffId: { type: Schema.Types.ObjectId, ref: "Staff", default: null },
    invitation: {
      sentAt: { type: Date, default: null },
      acceptedAt: { type: Date, default: null },
    },
    status: { type: String, enum: USER_STATUSES, default: "active" },
    request: {
      message: { type: String, default: "" },
      reviewedAt: { type: Date, default: null },
      reviewedBy: { type: actorSchema, default: null },
      note: { type: String, default: "" },
    },
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
