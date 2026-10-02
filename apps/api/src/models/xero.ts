import { model, Schema } from "mongoose";
import { actorSchema, baseOptions, type ActorRefSub } from "./common";

export const XERO_CONNECTION_ID = "xero";

export const XERO_CONNECTION_STATUSES = [
  "connected",
  "needs-reconnect",
  "disconnected",
] as const;
export type XeroConnectionStatus = (typeof XERO_CONNECTION_STATUSES)[number];

export interface XeroSettingsSub {
  salesAccountCode: string;
  taxTypeGstFree: string;
  taxTypeTaxable: string;
  paymentAccountCode: string;
}

/** The one Xero organisation this workspace is connected to (single document, `_id: "xero"`). */
export interface XeroConnectionDoc {
  _id: string;
  status: XeroConnectionStatus;
  /** The Xero organisation the sign-in was granted for. Kept after a disconnect to spot a switch of organisation. */
  tenantId: string;
  /** Xero's id for the connection; needed to disconnect it. */
  connectionId: string;
  orgName: string;
  /** Xero's short code for the organisation, used to build "open in Xero" links. */
  shortCode: string;
  /** AES-256-GCM sealed with a key from the environment; never sent to the browser. */
  accessTokenSealed: string;
  refreshTokenSealed: string;
  accessTokenExpiresAt: Date | null;
  connectedAt: Date | null;
  connectedBy: string;
  lastPollAt: Date | null;
  lastError: string;
  settings: XeroSettingsSub;
  /** The sign-in in progress: SHA-256 of the `state` sent to Xero. Cleared the moment it is used. */
  pending: { stateHash: string; expiresAt: Date; by: ActorRefSub } | null;
  createdAt: Date;
  updatedAt: Date;
}

const xeroConnectionSchema = new Schema<XeroConnectionDoc>(
  {
    _id: { type: String, default: XERO_CONNECTION_ID },
    status: {
      type: String,
      enum: XERO_CONNECTION_STATUSES,
      default: "disconnected",
    },
    tenantId: { type: String, default: "" },
    connectionId: { type: String, default: "" },
    orgName: { type: String, default: "" },
    shortCode: { type: String, default: "" },
    accessTokenSealed: { type: String, default: "" },
    refreshTokenSealed: { type: String, default: "" },
    accessTokenExpiresAt: { type: Date, default: null },
    connectedAt: { type: Date, default: null },
    connectedBy: { type: String, default: "" },
    lastPollAt: { type: Date, default: null },
    lastError: { type: String, default: "" },
    settings: {
      salesAccountCode: { type: String, default: "" },
      taxTypeGstFree: { type: String, default: "" },
      taxTypeTaxable: { type: String, default: "" },
      paymentAccountCode: { type: String, default: "" },
    },
    pending: {
      type: new Schema(
        {
          stateHash: { type: String, required: true },
          expiresAt: { type: Date, required: true },
          by: { type: actorSchema, required: true },
        },
        { _id: false }
      ),
      default: null,
    },
  },
  baseOptions
);

export const XeroConnection = model<XeroConnectionDoc>(
  "XeroConnection",
  xeroConnectionSchema,
  "integrations"
);
