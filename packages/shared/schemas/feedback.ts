import { z } from "zod";
import {
  FEEDBACK_AREAS,
  FEEDBACK_CHANNELS,
  FEEDBACK_KINDS,
  FEEDBACK_PRIORITIES,
  FEEDBACK_RELATIONSHIPS,
  FEEDBACK_SATISFACTION,
  FEEDBACK_STATUSES,
  REPORTABLE_INCIDENT_TYPES,
} from "../enums";
import {
  objectId,
  optionalEmail,
  optionalYmd,
  requiredText,
  rev,
  searchText,
  text,
  ymd,
} from "./common";

/** "" and null both mean "nobody / nothing chosen". */
const optionalRef = z.union([objectId, z.literal(""), z.null()]).optional();

const raisedBy = z.object({
  name: text(120).optional(),
  relationship: z.enum(FEEDBACK_RELATIONSHIPS).optional(),
  phone: text(40).optional(),
  email: optionalEmail,
  /** They asked not to be named. Their details are still kept if they gave any. */
  anonymous: z.boolean().optional(),
  wantsContact: z.boolean().optional(),
});

const caseShape = {
  kind: z.enum(FEEDBACK_KINDS),
  channel: z.enum(FEEDBACK_CHANNELS).optional(),
  receivedOn: ymd.optional(),
  summary: requiredText(160, "Say briefly what this is about."),
  details: requiredText(6000, "Describe what was said."),
  desiredOutcome: text(2000).optional(),
  area: z.enum(FEEDBACK_AREAS).optional(),
  priority: z.enum(FEEDBACK_PRIORITIES).optional(),
  raisedBy: raisedBy.optional(),
  participantId: optionalRef,
  staffId: optionalRef,
  incidentId: optionalRef,
  /** The office user responsible for seeing it through. */
  ownerId: optionalRef,
  /** The date it should be resolved by; worked out from the received date unless set. */
  resolveBy: optionalYmd,
};

export const feedbackCreateSchema = z.object(caseShape);
export type FeedbackCreateInput = z.input<typeof feedbackCreateSchema>;

export const feedbackUpdateSchema = z
  .object(caseShape)
  .partial()
  .extend({
    /** What will change so it does not happen again. */
    improvementNeeded: z.boolean().optional(),
    improvement: text(2000).optional(),
    rev,
  });
export type FeedbackUpdateInput = z.input<typeof feedbackUpdateSchema>;

export const feedbackStatusSchema = z.object({
  status: z.enum(FEEDBACK_STATUSES),
  /** Goes on the timeline: what was done at this step. */
  note: text(2000).optional(),
  /** What was found and decided. Needed to resolve or close a complaint. */
  outcome: text(4000).optional(),
  satisfaction: z.enum(FEEDBACK_SATISFACTION).optional(),
  rev,
});
export type FeedbackStatusInput = z.input<typeof feedbackStatusSchema>;

export const feedbackNoteSchema = z.object({
  note: requiredText(2000, "Write a note."),
});

export const feedbackActionSchema = z.object({
  description: requiredText(500, "Say what needs to be done."),
  owner: text(120).optional(),
  due: optionalYmd,
});
export type FeedbackActionInput = z.input<typeof feedbackActionSchema>;

export const feedbackActionPatchSchema = z.object({
  description: text(500).optional(),
  owner: text(120).optional(),
  due: optionalYmd,
  done: z.boolean().optional(),
});

export const feedbackListQuery = z.object({
  /** "open" is everything not yet closed. */
  status: z.enum([...FEEDBACK_STATUSES, "open", "all"]).default("open"),
  kind: z.enum(FEEDBACK_KINDS).optional(),
  q: searchText,
});

export const feedbackFormSchema = z.object({
  enabled: z.boolean(),
  /** Issue a new link, which stops the old one working. */
  regenerate: z.boolean().optional(),
});

export const feedbackTokenParam = z
  .string()
  .regex(/^[A-Za-z0-9_-]{24,64}$/, { error: "Invalid feedback link." });

/** What someone fills in on the public form. Only the message itself is required. */
export const publicFeedbackSchema = z.object({
  kind: z.enum(FEEDBACK_KINDS),
  details: requiredText(6000, "Tell us what happened."),
  desiredOutcome: text(2000).optional(),
  /** Who or what it is about, in their own words. */
  about: text(160).optional(),
  name: text(120).optional(),
  relationship: z.enum(FEEDBACK_RELATIONSHIPS).optional(),
  phone: text(40).optional(),
  email: optionalEmail,
  wantsContact: z.boolean().optional(),
  /** A field real people never see. Anything in it marks the submission as automated. */
  website: z.string().max(200).optional(),
});
export type PublicFeedbackInput = z.input<typeof publicFeedbackSchema>;

/** The NDIS Commission side of an incident: whether it is reportable and what has been lodged. */
export const incidentReportableSchema = z.object({
  flagged: z.boolean(),
  type: z.enum(REPORTABLE_INCIDENT_TYPES).optional(),
  /** When key personnel became aware of it. */
  awareAt: z.iso.datetime({ offset: true }).optional(),
  /** For an unauthorised restrictive practice: harm brings the deadline forward to 24 hours. */
  harm: z.boolean().optional(),
  /** The immediate notification has been lodged. */
  notified: z.boolean().optional(),
  notifiedReference: text(80).optional(),
  /** The five-day report has been lodged. */
  fiveDaySubmitted: z.boolean().optional(),
  note: text(1000).optional(),
  rev,
});
export type IncidentReportableInput = z.input<typeof incidentReportableSchema>;
