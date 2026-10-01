import { z } from "zod";
import {
  ABC_BEHAVIOURS,
  CHECKLIST_ITEM_STATUSES,
  INCIDENT_CATEGORIES,
  INCIDENT_SEVERITIES,
  LOGBOOK_ENTRY_TYPES,
  REPORT_STATUSES,
  STAFF_CHECKLIST_KEYS,
} from "../enums";
import {
  email,
  hm,
  objectId,
  optionalYmd,
  requiredText,
  rev,
  searchText,
  text,
  ymd,
} from "./common";
import { recordCreateSchema, recordUpdateSchema } from "./records";

/* ───────────── Applications & invitations ───────────── */

export const staffApplicationSchema = z.object({
  name: requiredText(120, "Enter your full name."),
  email,
  phone: text(40).optional(),
  position: text(120).optional(),
  team: text(120).optional(),
  suburb: text(120).optional(),
  experience: text(2000).optional(),
  message: text(2000).optional(),
});
export type StaffApplicationInput = z.input<typeof staffApplicationSchema>;

export const applicationReviewSchema = z.object({
  decision: z.enum(["Approved", "Rejected"]),
  note: text(1000).optional(),
  position: text(120).optional(),
  team: text(120).optional(),
  /** Create the portal account immediately (default true when approving). */
  grantAccess: z.boolean().optional(),
});
export type ApplicationReviewInput = z.input<typeof applicationReviewSchema>;

export const staffInviteSchema = z.object({
  /** Re-send the invite and issue a fresh password link. */
  resend: z.boolean().optional(),
});

/* ───────────── Worker profile, KYC & documents ───────────── */

const nextOfKinSchema = z.object({
  name: text(120).optional(),
  relationship: text(80).optional(),
  phone: text(40).optional(),
  email: text(254).optional(),
  address: text(240).optional(),
});

const emergencyContactSchema = z.object({
  name: requiredText(120, "Enter the contact's name."),
  relationship: text(80).optional(),
  phone: requiredText(40, "Enter a phone number."),
  email: text(254).optional(),
  primary: z.boolean().optional(),
});

export const staffDetailsSchema = z.object({
  phone: text(40).optional(),
  dateOfBirth: optionalYmd,
  address: text(240).optional(),
  startDate: optionalYmd,
  about: text(2000).optional(),
  medicalNotes: text(2000).optional(),
  nextOfKin: nextOfKinSchema.optional(),
  emergencyContacts: z.array(emergencyContactSchema).max(6).optional(),
  transport: z
    .object({
      hasVehicle: z.boolean().optional(),
      licenceNumber: text(40).optional(),
      vehicle: text(120).optional(),
      registration: text(40).optional(),
    })
    .optional(),
});
export type StaffDetailsInput = z.input<typeof staffDetailsSchema>;

export const staffDocumentFields = z.object({
  title: requiredText(160, "Give the document a title."),
  checklistKey: z
    .union([
      z.enum(STAFF_CHECKLIST_KEYS as [string, ...string[]]),
      z.literal(""),
    ])
    .optional(),
  notes: text(1000).optional(),
  issued: optionalYmd,
  /** Required for checklist items that carry an expiry (enforced by the API). */
  expiry: optionalYmd,
});
export type StaffDocumentFieldsInput = z.input<typeof staffDocumentFields>;

export const staffDocumentPatchSchema = z.object({
  title: text(160).optional(),
  notes: text(1000).optional(),
  issued: optionalYmd,
  expiry: optionalYmd,
  rev,
});

export const checklistReviewSchema = z.object({
  status: z.enum(CHECKLIST_ITEM_STATUSES),
  note: text(500).optional(),
});

/* ───────────── Reports & logbook ───────────── */

const incidentShape = {
  participantId: z.union([objectId, z.literal("")]).optional(),
  shiftId: text(20).optional(),
  date: ymd,
  time: hm,
  location: text(200).optional(),
  category: z.enum(INCIDENT_CATEGORIES),
  severity: z.enum(INCIDENT_SEVERITIES),
  description: requiredText(4000, "Describe what happened."),
  injuries: text(2000).optional(),
  medicalAttention: z.boolean().optional(),
  medicalDetails: text(2000).optional(),
  witness: text(200).optional(),
  immediateActions: text(2000).optional(),
  notified: z.array(text(120)).max(10).optional(),
  followUp: text(2000).optional(),
};

export const incidentCreateSchema = z.object(incidentShape);
export type IncidentCreateInput = z.input<typeof incidentCreateSchema>;
export const incidentUpdateSchema = z
  .object(incidentShape)
  .partial()
  .extend({ rev });
export type IncidentUpdateInput = z.input<typeof incidentUpdateSchema>;

const abcShape = {
  participantId: z.union([objectId, z.literal("")]).optional(),
  shiftId: text(20).optional(),
  date: ymd,
  time: hm,
  location: text(200).optional(),
  behaviour: z.enum(ABC_BEHAVIOURS),
  intensity: z.coerce.number().int().min(1).max(5).default(3),
  durationMinutes: z.coerce.number().int().min(0).max(1440).default(0),
  antecedent: requiredText(2000, "Describe what happened before."),
  behaviourDescription: requiredText(2000, "Describe the behaviour."),
  consequence: requiredText(2000, "Describe what followed."),
  staffResponse: text(2000).optional(),
  outcome: text(2000).optional(),
  preventionPlan: text(2000).optional(),
};

export const abcCreateSchema = z.object(abcShape);
export type AbcCreateInput = z.input<typeof abcCreateSchema>;
export const abcUpdateSchema = z.object(abcShape).partial().extend({ rev });
export type AbcUpdateInput = z.input<typeof abcUpdateSchema>;

const logbookShape = {
  participantId: z.union([objectId, z.literal("")]).optional(),
  shiftId: text(20).optional(),
  trackingId: z.union([objectId, z.literal("")]).optional(),
  date: ymd,
  type: z.enum(LOGBOOK_ENTRY_TYPES).default("Kilometres"),
  fromLocation: text(200).optional(),
  toLocation: text(200).optional(),
  purpose: text(200).optional(),
  kilometres: z.coerce.number().min(0).max(10_000).default(0),
  odometerStart: z.coerce.number().min(0).max(10_000_000).nullable().optional(),
  odometerEnd: z.coerce.number().min(0).max(10_000_000).nullable().optional(),
  notes: text(2000).optional(),
};

export const logbookCreateSchema = z.object(logbookShape);
export type LogbookCreateInput = z.input<typeof logbookCreateSchema>;
export const logbookUpdateSchema = z
  .object(logbookShape)
  .partial()
  .extend({ rev });
export type LogbookUpdateInput = z.input<typeof logbookUpdateSchema>;

export const reportStatusSchema = z.object({
  status: z.enum(REPORT_STATUSES),
  note: text(1000).optional(),
  rev,
});

/* ───────────── Live tracking ───────────── */

const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);

export const trackingStartSchema = z.object({
  shiftId: text(20).optional(),
  location: z.object({ lat, lng }).optional(),
  accuracy: z.number().min(0).max(10_000).nullable().optional(),
});
export type TrackingStartInput = z.input<typeof trackingStartSchema>;

export const trackingPingSchema = z.object({
  pings: z
    .array(
      z.object({
        lat,
        lng,
        accuracy: z.number().min(0).max(10_000).nullable().optional(),
        speedKph: z.number().min(0).max(300).nullable().optional(),
        at: z.iso.datetime({ offset: true }).optional(),
      })
    )
    .min(1)
    .max(60),
});
export type TrackingPingInput = z.input<typeof trackingPingSchema>;

export const trackingStopSchema = z.object({
  location: z.object({ lat, lng }).optional(),
  notes: text(500).optional(),
});

/* ───────────── Listing ───────────── */

export const portalRangeQuery = z.object({
  from: ymd.optional(),
  to: ymd.optional(),
});

export const portalReportQuery = z.object({
  status: z.enum(REPORT_STATUSES).optional(),
  participantId: objectId.optional(),
  from: ymd.optional(),
  to: ymd.optional(),
  q: searchText,
});

export const portalShiftQuery = z.object({
  from: ymd.optional(),
  to: ymd.optional(),
  includeCancelled: z.coerce.boolean().optional(),
});

export const liveTrackingQuery = z.object({
  /** Also return sessions that ended in the last N hours (default 6). */
  historyHours: z.coerce.number().int().min(0).max(72).default(6),
});

/* ───────────── Worker progress notes ───────────── */

/** The worker writes progress notes; the staff and status fields are set by the API. */
export const portalNoteCreateSchema = recordCreateSchema.omit({
  staffId: true,
  confirmed: true,
});
export type PortalNoteCreateInput = z.input<typeof portalNoteCreateSchema>;

export const portalNoteUpdateSchema = recordUpdateSchema;
export type PortalNoteUpdateInput = z.input<typeof portalNoteUpdateSchema>;

export const timesheetSchema = z.object({
  action: z.enum(["start", "stop", "save"]),
  breakMinutes: z.coerce.number().int().min(0).max(1440).optional(),
  kilometres: z.coerce.number().min(0).max(5000).optional(),
  notes: text(1000).optional(),
});
export type TimesheetInputPayload = z.input<typeof timesheetSchema>;
