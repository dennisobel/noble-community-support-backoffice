import { model, Schema, type Types } from "mongoose";
import { baseOptions } from "./common";

/** One sign-in session (device). The refresh token rotates on every refresh; only hashes are stored. */
export interface AuthSessionDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  tokenHash: string;
  previous: Array<{ hash: string; rotatedAt: Date }>;
  userAgent: string;
  ip: string;
  lastUsedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const authSessionSchema = new Schema<AuthSessionDoc>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    tokenHash: { type: String, required: true, index: true },
    previous: [
      {
        _id: false,
        hash: { type: String, required: true },
        rotatedAt: { type: Date, required: true },
      },
    ],
    userAgent: { type: String, default: "" },
    ip: { type: String, default: "" },
    lastUsedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, default: null },
  },
  baseOptions
);
authSessionSchema.index({ "previous.hash": 1 });
authSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const AuthSession = model<AuthSessionDoc>(
  "AuthSession",
  authSessionSchema,
  "auth_sessions"
);

export interface PasswordResetDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  requestedIp: string;
  createdAt: Date;
}

const passwordResetSchema = new Schema<PasswordResetDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
    requestedIp: { type: String, default: "" },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);
passwordResetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const PasswordReset = model<PasswordResetDoc>(
  "PasswordReset",
  passwordResetSchema,
  "password_resets"
);
