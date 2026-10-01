export const RECORD_STATUSES = [
  "Draft",
  "Submitted",
  "Returned",
  "Approved",
  "Invoiced",
] as const;
export type RecordStatus = (typeof RECORD_STATUSES)[number];

export const INVOICE_STATUSES = [
  "Draft",
  "Ready to send",
  "Sent",
  "Paid",
  "Void",
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const SHIFT_RATIOS = ["1:1", "1:M", "M:M"] as const;
export type ShiftRatio = (typeof SHIFT_RATIOS)[number];

export const SHIFT_STATUSES = [
  "Planned",
  "Confirmed",
  "Completed",
  "Cancelled",
] as const;
export type ShiftStatus = (typeof SHIFT_STATUSES)[number];

export const STAFF_STATUSES = ["Active", "On leave", "Inactive"] as const;
export type StaffStatus = (typeof STAFF_STATUSES)[number];

/* ───────────── Accounts & portal access ───────────── */

export const USER_ROLES = ["admin", "staff"] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** Where a staff member is in the sign-up → approval → sign-in journey. */
export const STAFF_ACCOUNT_STATUSES = [
  "No access",
  "Invited",
  "Pending approval",
  "Active",
  "Rejected",
  "Disabled",
] as const;
export type StaffAccountStatus = (typeof STAFF_ACCOUNT_STATUSES)[number];

export const STAFF_APPLICATION_STATUSES = [
  "Pending",
  "Approved",
  "Rejected",
] as const;
export type StaffApplicationStatus =
  (typeof STAFF_APPLICATION_STATUSES)[number];

export const PARTICIPANT_STATUSES = ["Active", "Archived"] as const;
export type ParticipantStatus = (typeof PARTICIPANT_STATUSES)[number];

export const SERVICE_UNITS = ["Hour", "Session", "Item", "Kilometre"] as const;
export type ServiceUnit = (typeof SERVICE_UNITS)[number];

/** Provider travel is always billed per kilometre at the workspace travel rate. */
export const TRANSPORT_UNITS = ["Kilometre"] as const;
export type TransportUnit = (typeof TRANSPORT_UNITS)[number];

export const VOICE_STATUSES = ["Saved", "Draft ready", "Archived"] as const;
export type VoiceStatus = (typeof VOICE_STATUSES)[number];

export const TRANSCRIPT_STATUSES = [
  "Not transcribed",
  "Processing",
  "Ready",
  "Unavailable",
] as const;
export type TranscriptStatus = (typeof TRANSCRIPT_STATUSES)[number];

export const GENERATION_STATUSES = [
  "Not generated",
  "Processing",
  "Draft ready",
  "Failed",
] as const;
export type GenerationStatus = (typeof GENERATION_STATUSES)[number];

export const NOTE_SECTIONS = [
  "support",
  "response",
  "outcome",
  "observations",
  "followUp",
] as const;
export type NoteSection = (typeof NOTE_SECTIONS)[number];

export const NOTE_SECTION_LABELS: Record<NoteSection, string> = {
  support: "Support provided",
  response: "Participant response & engagement",
  outcome: "Goal / outcome",
  observations: "Observations",
  followUp: "Follow-up / action required",
};

export const NOTE_TEMPLATES = [
  "Community support progress note",
  "Daily living skills note",
] as const;
export type NoteTemplate = (typeof NOTE_TEMPLATES)[number];

export const DETAIL_LEVELS = ["Balanced", "Concise", "Detailed"] as const;
export type DetailLevel = (typeof DETAIL_LEVELS)[number];

export const KYC_ITEMS = [
  {
    key: "serviceAgreement",
    label: "Service agreement",
    detail: "Agreement received or signed",
  },
  {
    key: "consentForms",
    label: "Consent forms",
    detail: "Consent and nominee permissions recorded",
  },
  {
    key: "supportPlan",
    label: "Support plan & goals",
    detail: "Current plan and participant goals reviewed",
  },
  {
    key: "riskInformationReviewed",
    label: "Incidents, hazards & risks",
    detail: "Known risks and safety information checked",
  },
  {
    key: "transportRequirementsConfirmed",
    label: "Transport requirements",
    detail: "Travel and access requirements confirmed",
  },
] as const;
export type KycKey = (typeof KYC_ITEMS)[number]["key"];
export type Kyc = Record<KycKey, boolean>;
export const EMPTY_KYC: Kyc = {
  serviceAgreement: false,
  consentForms: false,
  supportPlan: false,
  riskInformationReviewed: false,
  transportRequirementsConfirmed: false,
};

export const DEFAULT_BUDGET_CATEGORIES = [
  "Community participation",
  "Daily living skills",
  "Support coordination",
];

export const DOCUMENT_SCOPES = ["participant", "organisation"] as const;
export type DocumentScope = (typeof DOCUMENT_SCOPES)[number];

/** Participant folders that hold uploaded files (01, 04 and 06 are virtual views). */
export const PARTICIPANT_FOLDERS = [
  { key: "agreement", title: "02 Service Agreement & Consent" },
  { key: "plans", title: "03 Support Plans & Goals" },
  { key: "incidents", title: "05 Incidents & Hazards" },
  { key: "correspondence", title: "07 Correspondence" },
] as const;
export type ParticipantFolderKey = (typeof PARTICIPANT_FOLDERS)[number]["key"];

export const ORGANISATION_FOLDERS = [
  { key: "policies", title: "Policies & Procedures", group: "business" },
  { key: "insurance", title: "Insurance", group: "business" },
  { key: "worker-checks", title: "Worker Checks", group: "business" },
  { key: "ndis", title: "NDIS Documents", group: "business" },
  { key: "finance", title: "Finance documents", group: "finance" },
  { key: "templates", title: "Templates", group: "templates" },
] as const;
export type OrganisationFolderKey =
  (typeof ORGANISATION_FOLDERS)[number]["key"];

export const TEMPLATE_SLOTS = [
  { key: "progress-note", title: "Progress Note Template" },
  { key: "incident-report", title: "Incident Report" },
  { key: "service-agreement", title: "Service Agreement" },
  { key: "consent-forms", title: "Consent Forms" },
] as const;

/* ───────────── DSW employee profile checklist ───────────── */

/**
 * The document checklist a Disability Support Worker must hold. `expiry` marks the
 * items that carry an expiry date (and therefore feed the reminder cron), and
 * `transportOnly` items are only required when the worker transports participants.
 */
export const STAFF_CHECKLIST_GROUPS = [
  "Documents",
  "Screening & checks",
  "Qualifications & training",
  "Company compliance",
  "Transporting participants",
] as const;
export type StaffChecklistGroup = (typeof STAFF_CHECKLIST_GROUPS)[number];

export interface StaffChecklistItemDef {
  key: string;
  label: string;
  group: StaffChecklistGroup;
  /** The worker must record an expiry date; the reminder job watches these. */
  expiry: boolean;
  /** Only required when the worker transports participants. */
  transportOnly?: boolean;
}

export const STAFF_CHECKLIST: readonly StaffChecklistItemDef[] = [
  // Documents
  {
    key: "employeeDetailsForm",
    label: "Employee details form",
    group: "Documents",
    expiry: false,
  },
  {
    key: "passportPhotoId",
    label: "Passport / photo ID",
    group: "Documents",
    expiry: true,
  },
  {
    key: "proofOfAddress",
    label: "Proof of address",
    group: "Documents",
    expiry: false,
  },
  {
    key: "workingRightsVevo",
    label: "Australian working rights / VEVO check",
    group: "Documents",
    expiry: true,
  },
  {
    key: "employmentContract",
    label: "Employment contract",
    group: "Documents",
    expiry: false,
  },
  {
    key: "positionDescription",
    label: "Position description",
    group: "Documents",
    expiry: false,
  },
  {
    key: "taxFileNumberDeclaration",
    label: "Tax file number declaration",
    group: "Documents",
    expiry: false,
  },
  {
    key: "superannuationDetails",
    label: "Superannuation details",
    group: "Documents",
    expiry: false,
  },
  {
    key: "bankDetails",
    label: "Bank details",
    group: "Documents",
    expiry: false,
  },
  {
    key: "emergencyContactForm",
    label: "Emergency contact",
    group: "Documents",
    expiry: false,
  },
  // Screening & checks
  {
    key: "ndisWorkerScreeningCheck",
    label: "NDIS worker screening check",
    group: "Screening & checks",
    expiry: true,
  },
  {
    key: "workingWithChildrenCheck",
    label: "Working with children check (if applicable)",
    group: "Screening & checks",
    expiry: true,
  },
  {
    key: "nationalPoliceCheck",
    label: "National police check",
    group: "Screening & checks",
    expiry: true,
  },
  {
    key: "driversLicence",
    label: "Driver's licence",
    group: "Screening & checks",
    expiry: true,
  },
  {
    key: "drivingHistoryCheck",
    label: "Driving history check (if required)",
    group: "Screening & checks",
    expiry: true,
  },
  // Qualifications & training
  {
    key: "certificateIIIIV",
    label: "Certificate III/IV or relevant qualification",
    group: "Qualifications & training",
    expiry: false,
  },
  {
    key: "firstAidCertificate",
    label: "First aid certificate",
    group: "Qualifications & training",
    expiry: true,
  },
  {
    key: "cprCertificate",
    label: "CPR certificate",
    group: "Qualifications & training",
    expiry: true,
  },
  {
    key: "manualHandlingCertificate",
    label: "Manual handling certificate",
    group: "Qualifications & training",
    expiry: true,
  },
  {
    key: "medicationTraining",
    label: "Medication training (if applicable)",
    group: "Qualifications & training",
    expiry: true,
  },
  {
    key: "infectionControlTraining",
    label: "Infection control training",
    group: "Qualifications & training",
    expiry: true,
  },
  {
    key: "ndisWorkerOrientationModule",
    label: "NDIS worker orientation module certificate",
    group: "Qualifications & training",
    expiry: false,
  },
  {
    key: "behaviourSupportTraining",
    label: "Behaviour support training (if applicable)",
    group: "Qualifications & training",
    expiry: true,
  },
  // Company compliance
  {
    key: "ndisCodeOfConduct",
    label: "NDIS code of conduct acknowledgement",
    group: "Company compliance",
    expiry: false,
  },
  {
    key: "confidentialityPrivacyAgreement",
    label: "Confidentiality & privacy agreement",
    group: "Company compliance",
    expiry: false,
  },
  {
    key: "employeeInductionChecklist",
    label: "Employee induction checklist",
    group: "Company compliance",
    expiry: false,
  },
  {
    key: "policiesProceduresAcknowledgement",
    label: "Policies & procedures acknowledgement",
    group: "Company compliance",
    expiry: false,
  },
  {
    key: "incidentManagementTraining",
    label: "Incident management training",
    group: "Company compliance",
    expiry: false,
  },
  {
    key: "complaintsManagementTraining",
    label: "Complaints management training",
    group: "Company compliance",
    expiry: false,
  },
  {
    key: "whsInduction",
    label: "WHS induction",
    group: "Company compliance",
    expiry: false,
  },
  {
    key: "professionalBoundariesAcknowledgement",
    label: "Professional boundaries acknowledgement",
    group: "Company compliance",
    expiry: false,
  },
  {
    key: "conflictOfInterestDeclaration",
    label: "Conflict of interest declaration",
    group: "Company compliance",
    expiry: false,
  },
  // Transporting participants
  {
    key: "vehicleRegistration",
    label: "Vehicle registration",
    group: "Transporting participants",
    expiry: true,
    transportOnly: true,
  },
  {
    key: "vehicleInsurance",
    label: "Vehicle insurance",
    group: "Transporting participants",
    expiry: true,
    transportOnly: true,
  },
  {
    key: "vehicleDetails",
    label: "Vehicle details",
    group: "Transporting participants",
    expiry: false,
    transportOnly: true,
  },
  {
    key: "transportPolicyAcknowledgement",
    label: "Transport policy acknowledgement",
    group: "Transporting participants",
    expiry: false,
    transportOnly: true,
  },
] as const;

export const STAFF_CHECKLIST_KEYS = STAFF_CHECKLIST.map(
  item => item.key
) as readonly string[];
export type StaffChecklistKey = (typeof STAFF_CHECKLIST)[number]["key"];

export const CHECKLIST_ITEM_STATUSES = [
  "Not started",
  "Awaiting review",
  "Approved",
  "Needs attention",
] as const;
export type ChecklistItemStatus = (typeof CHECKLIST_ITEM_STATUSES)[number];

/** How urgent an expiring document is; drives colours in both portals. */
export const EXPIRY_STATES = ["ok", "soon", "urgent", "expired"] as const;
export type ExpiryState = (typeof EXPIRY_STATES)[number];

/** Reminder thresholds (days before expiry) watched by the expiry job. */
export const EXPIRY_REMINDER_DAYS = [30, 14, 7, 1] as const;

/* ───────────── Worker notes, reports & logbook ───────────── */

export const INCIDENT_CATEGORIES = [
  "Participant injury",
  "Staff injury",
  "Near miss",
  "Property damage",
  "Medication",
  "Behaviour of concern",
  "Abuse or neglect concern",
  "Unauthorised absence",
  "Vehicle or transport",
  "Other",
] as const;
export type IncidentCategory = (typeof INCIDENT_CATEGORIES)[number];

export const INCIDENT_SEVERITIES = [
  "Minor",
  "Moderate",
  "Major",
  "Critical",
] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

export const REPORT_STATUSES = [
  "Draft",
  "Submitted",
  "Reviewed",
  "Closed",
] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORTER_ROLES = [
  "Staff",
  "Participant",
  "Family",
  "Other",
] as const;

/** ABC = Antecedent, Behaviour, Consequence. */
export const ABC_BEHAVIOURS = [
  "Physical aggression",
  "Verbal aggression",
  "Self-injury",
  "Property damage",
  "Absconding",
  "Refusal",
  "Other",
] as const;
export type AbcBehaviour = (typeof ABC_BEHAVIOURS)[number];

export const LOGBOOK_ENTRY_TYPES = [
  "Kilometres",
  "General",
  "Vehicle",
] as const;
export type LogbookEntryType = (typeof LOGBOOK_ENTRY_TYPES)[number];

/* ───────────── Live job tracking (Mapbox) ───────────── */

export const TRACKING_STATUSES = ["Active", "Paused", "Ended"] as const;
export type TrackingStatus = (typeof TRACKING_STATUSES)[number];

/** Seconds between location writes: 5 s while travelling, 30 s when stationary. */
export const TRACKING_INTERVALS = { movingSec: 5, idleSec: 30 } as const;
export const TRACKING_STATIONARY_KPH = 3;
/** A running session with no ping for this long is shown as "signal lost". */
export const TRACKING_STALE_SEC = 120;
/** Pings closer than this to the previous point are dropped (GPS jitter). */
export const TRACKING_MIN_MOVE_M = 10;

export const REPORT_PERIODS = ["last30", "month", "quarter", "custom"] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

export const REPORT_EXPORTS = [
  "service-records",
  "billing",
  "transport",
  "documentation",
] as const;
export type ReportExport = (typeof REPORT_EXPORTS)[number];

export const ERROR_CODES = [
  "BAD_REQUEST",
  "VALIDATION_ERROR",
  "UNAUTHENTICATED",
  "TOKEN_EXPIRED",
  "INVALID_CREDENTIALS",
  "ACCOUNT_LOCKED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "SETUP_ALREADY_COMPLETED",
  "NDIS_DUPLICATE",
  "EMAIL_DUPLICATE",
  "SERVICE_NAME_EXISTS",
  "SHIFT_OVERLAP",
  "BUDGET_EXISTS",
  "RECORD_NOT_APPROVED",
  "STALE_VERSION",
  "INVALID_STATE",
  "TRANSCRIPT_REQUIRED",
  "PAYLOAD_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
  "RATE_LIMITED",
  "PROVIDER_UNAVAILABLE",
  "STAFF_APPLICATION_EXISTS",
  "APPLICATION_ALREADY_REVIEWED",
  "STAFF_ACCOUNT_EXISTS",
  "TRACKING_ALREADY_RUNNING",
  "TRACKING_NOT_RUNNING",
  "INTERNAL",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
