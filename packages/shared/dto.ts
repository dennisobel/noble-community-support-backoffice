/** Response shapes of the REST API (/api/v1). Money is in dollars, dates are YYYY-MM-DD, timestamps are ISO-8601. */
import type {
  AbcBehaviour,
  AccessModule,
  AnnouncementAudience,
  AvailabilityMode,
  ChecklistItemStatus,
  ConversationKind,
  DetailLevel,
  DocumentScope,
  EmploymentType,
  ErrorCode,
  ExpiryState,
  FeedbackArea,
  FeedbackChannel,
  FeedbackKind,
  FeedbackPriority,
  FeedbackRelationship,
  FeedbackSatisfaction,
  FeedbackStatus,
  GenerationStatus,
  IncidentCategory,
  IncidentSeverity,
  InvoiceStatus,
  XeroSyncState,
  Kyc,
  LeaveStatus,
  LeaveType,
  LogbookEntryType,
  MessageContextType,
  NoteTemplate,
  ParticipantStatus,
  PayCode,
  PayPeriodLength,
  PayRunStatus,
  RecordStatus,
  ReportableIncidentType,
  ReportStatus,
  ServicePayType,
  ServiceUnit,
  ShiftRatio,
  ShiftStatus,
  SignatureDisplayStatus,
  SignatureEventType,
  SignatureFieldType,
  SignerStatus,
  SigningState,
  StaffAccountStatus,
  StaffApplicationStatus,
  StaffChecklistGroup,
  StaffStatus,
  TimesheetStatus,
  TrackingStatus,
  TranscriptStatus,
  TransportUnit,
  UserRole,
  UserStatus,
  VoiceStatus,
} from "./enums";
import type { AwardRules } from "./logic/award";
import type { BudgetStatus } from "./logic/budget";

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}

export type WithWarnings<T> = T & { warnings: string[] };

export interface ActorRef {
  id: string;
  name: string;
}

export interface HistoryEntryDTO {
  at: string;
  by: ActorRef | null;
  action: string;
  note?: string;
}

/* ───────────── Auth, workspace, settings ───────────── */

export interface UserDTO {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  /** What this user can open in the back office. Admins get every module; support workers none. */
  modules: AccessModule[];
  /** Set when the account belongs to a team member with portal access. */
  staffId: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

/** A back-office account as an Admin sees it: a request waiting for approval, or someone with access. */
export interface AccessUserDTO {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  modules: AccessModule[];
  status: UserStatus;
  /** What they said they need Noble for when they asked for access. */
  message: string;
  requestedAt: string;
  reviewedAt: string | null;
  reviewedBy: string;
  /** The Admin's note when a request was declined. */
  note: string;
  lastLoginAt: string | null;
}

/** A note as it appears in the list: no body, just enough to recognise it. */
export interface NoteSummaryDTO {
  id: string;
  title: string;
  /** The first few words of the note. */
  snippet: string;
  labels: string[];
  pinned: boolean;
  archived: boolean;
  imageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface NoteDTO extends NoteSummaryDTO {
  /** The editor's JSON document. */
  content: Record<string, unknown>;
  rev: number;
}

export interface NoteLabelDTO {
  label: string;
  count: number;
}

export interface NoteImageDTO {
  id: string;
  url: string;
}

/** A person's own roster for one day, found by matching their sign-in email to the staff directory. */
export interface MyDayDTO {
  date: string;
  email: string;
  staff: { id: string; name: string } | null;
  shifts: RosterShiftDTO[];
  hours: number;
}

export interface VoicePreferences {
  generationTemplate: NoteTemplate;
  detailLevel: DetailLevel;
  autoSaveRecordings: boolean;
  useTranscriptOnly: boolean;
  notifyDraftReady: boolean;
}

export interface NotificationPreferences {
  recordReturned: boolean;
  reviewQueue: boolean;
  budgetAlerts: boolean;
  invoiceOverdue: boolean;
  voiceDraftReady: boolean;
}

export interface PreferencesDTO {
  voice: VoicePreferences;
  notifications: NotificationPreferences;
}

export interface WorkspaceDTO {
  name: string;
  legalName: string;
  abn: string;
  address: string;
  phone: string;
  email: string;
  timezone: string;
  currency: string;
  gst: { registered: boolean; ratePct: number };
  invoice: {
    prefix: string;
    defaultPaymentTermsDays: number;
    footer: string;
    paymentInstructions: string;
  };
  /** Printed on every invoice so a plan manager can pay it. */
  bank: BankDetailsDTO;
  providerTravelRate: number;
  budgetCategories: string[];
  setupCompletedAt: string | null;
}

export interface SessionDTO {
  user: UserDTO;
  workspace: { name: string; timezone: string; today: string };
  preferences: PreferencesDTO;
}

export interface AuthSessionDTO {
  id: string;
  userAgent: string;
  ip: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  current: boolean;
}

export interface BootstrapDTO {
  setupRequired: boolean;
  setupCodeRequired: boolean;
}

export interface MetaDTO {
  version: string;
  environment: string;
  today: string;
  timezone: string;
  demoEnabled: boolean;
  features: {
    email: boolean;
    sttProvider: string;
    noteProvider: string;
    xero: boolean;
  };
}

/* ───────────── Reference data ───────────── */

export interface StaffDTO {
  id: string;
  name: string;
  initials: string;
  position: string;
  team: string;
  email: string;
  phone: string;
  status: StaffStatus;
  notes: string;
  /** Portal access: whether the member can sign in and what state the account is in. */
  accountStatus: StaffAccountStatus;
  userId: string | null;
  lastLoginAt: string | null;
  /** DSW checklist progress, so the directory can be scanned at a glance. */
  checklist: {
    approved: number;
    total: number;
    completePct: number;
    expiring: number;
    expired: number;
    nextExpiry: string | null;
  };
  /** How they are employed. Pay rates are never part of this: those sit behind Timesheets & pay. */
  employment: StaffEmploymentDTO;
  createdAt: string;
  updatedAt: string;
  rev: number;
}

export interface StaffEmploymentDTO {
  type: EmploymentType | null;
  classificationId: string | null;
  classificationName: string;
  /** Hours a week they are engaged for. */
  contractedHours: number;
  /** Their employee number in the payroll system. */
  payrollId: string;
}

export interface ServiceDTO {
  id: string;
  name: string;
  unit: ServiceUnit;
  rate: number;
  transport: boolean;
  transportUnit: TransportUnit | null;
  budgetCategory: string;
  supportItemNumber: string;
  /** How a shift of this service is paid to the worker. */
  payAs: ServicePayType;
  active: boolean;
  rateHistory: Array<{
    rate: number;
    changedAt: string;
    changedBy: ActorRef | null;
  }>;
  createdAt: string;
  updatedAt: string;
  rev: number;
}

/* ───────────── Participants ───────────── */

export interface ParticipantDTO {
  id: string;
  clientNumber: number;
  name: string;
  preferred: string;
  ndis: string;
  dob: string | null;
  phone: string;
  email: string;
  address: string;
  plan: string;
  planStart: string | null;
  planEnd: string | null;
  manager: string;
  managerEmail: string;
  nominee: string;
  coordinatorName: string;
  coordinatorOrg: string;
  coordinatorPhone: string;
  coordinatorEmail: string;
  emergency: string;
  emergencyName: string;
  emergencyPhone: string;
  alerts: string[];
  goals: string[];
  communication: string;
  mobility: string;
  transport: string;
  support: string;
  risks: string;
  allergies: string;
  preferences: string;
  kyc: Kyc;
  status: ParticipantStatus;
  archivedAt: string | null;
  archivedReason: string;
  createdAt: string;
  updatedAt: string;
  rev: number;
}

/* ───────────── Service records ───────────── */

export interface BillableDTO {
  label: string;
  unit: string;
  quantity: number;
  rate: number;
  subtotal: number;
}

export interface ServiceRecordDTO {
  id: string;
  clientId: string;
  clientName: string;
  clientFullName: string;
  staffId: string;
  staffName: string;
  serviceId: string;
  type: string;
  budgetCategory: string;
  unit: ServiceUnit;
  date: string;
  start: string;
  end: string;
  hours: number;
  location: string;
  support: string;
  response: string;
  outcome: string;
  observations: string;
  followUp: string;
  km: number;
  quantity: number | null;
  confirmed: boolean;
  status: RecordStatus;
  correction: string;
  billables: BillableDTO[];
  total: number;
  billablesFrozen: boolean;
  approvedBy: ActorRef | null;
  submittedAt: string | null;
  submittedBy: ActorRef | null;
  reviewedAt: string | null;
  invoiceId: string | null;
  voiceId: string | null;
  shiftId: string | null;
  history: HistoryEntryDTO[];
  created: string;
  updated: string;
  rev: number;
}

export type RecordCountsDTO = Record<RecordStatus, number>;

/* ───────────── Invoices ───────────── */

export interface BankDetailsDTO {
  accountName: string;
  bsb: string;
  accountNumber: string;
  /** What the payer should put in the payment reference. */
  payInstruction: string;
}

export interface InvoiceLineDTO extends BillableDTO {
  recordId: string;
  /** NDIS support item number of the service billed on this line; empty for travel and older invoices. */
  itemCode: string;
}

/** Where one invoice stands in Xero. `state` is "none" until it has been sent there. */
export interface InvoiceXeroDTO {
  state: XeroSyncState;
  /** Why it needs attention, or a note such as "Paid here, not in Xero". Empty when all is well. */
  message: string;
  syncedAt: string | null;
  /** Opens the invoice in Xero. */
  url: string | null;
}

/** The ledger choices an invoice needs, picked from the Xero organisation's own lists. */
export interface XeroSettingsDTO {
  salesAccountCode: string;
  taxTypeGstFree: string;
  taxTypeTaxable: string;
  paymentAccountCode: string;
}

export interface XeroStatusDTO {
  /** The server has a Xero app (client id and secret) to sign in with. */
  configured: boolean;
  connected: boolean;
  /** Xero no longer accepts the saved sign-in; someone must connect again. */
  needsReconnect: boolean;
  orgName: string;
  connectedAt: string | null;
  connectedBy: string;
  lastPollAt: string | null;
  lastError: string;
  settings: XeroSettingsDTO;
  /** The exact address to register as the redirect URI on the Xero app. */
  redirectUri: string;
  /** Connected and mapped well enough to send invoices. */
  ready: boolean;
}

export interface XeroOptionsDTO {
  salesAccounts: Array<{ code: string; name: string }>;
  bankAccounts: Array<{ code: string; name: string }>;
  taxRates: Array<{ type: string; name: string; rate: number }>;
}

export interface InvoiceDTO {
  id: string;
  title: string;
  clientId: string;
  clientName: string;
  recipient: string;
  recipientEmail: string;
  billTo: { name: string; address: string; ndis: string };
  supplier: {
    name: string;
    legalName: string;
    abn: string;
    address: string;
    phone: string;
    email: string;
  };
  issue: string;
  due: string;
  paymentTermsDays: number;
  status: InvoiceStatus;
  overdue: boolean;
  lines: InvoiceLineDTO[];
  subtotal: number;
  tax: number;
  taxRatePct: number;
  total: number;
  recordIds: string[];
  /** Shown under "Reference" — the participant and their NDIS number by default. */
  reference: string;
  bank: BankDetailsDTO;
  /** The read-only link a plan manager can open without signing in. */
  share: { enabled: boolean; url: string | null; createdAt: string | null };
  xero: InvoiceXeroDTO;
  notes: string;
  footer: string;
  paymentInstructions: string;
  sentAt: string | null;
  emailedAt: string | null;
  paidAt: string | null;
  paidOn: string | null;
  paidReference: string;
  voidedAt: string | null;
  voidReason: string;
  history: HistoryEntryDTO[];
  createdAt: string;
  updatedAt: string;
  rev: number;
}

/** What someone holding the share link is shown. No workspace or participant data beyond the invoice. */
export interface PublicInvoiceDTO {
  id: string;
  title: string;
  status: InvoiceStatus;
  overdue: boolean;
  reference: string;
  recipient: string;
  billTo: { name: string; address: string; ndis: string };
  supplier: {
    name: string;
    legalName: string;
    abn: string;
    address: string;
    phone: string;
    email: string;
  };
  issue: string;
  due: string;
  paymentTermsDays: number;
  lines: InvoiceLineDTO[];
  subtotal: number;
  tax: number;
  taxRatePct: number;
  total: number;
  notes: string;
  footer: string;
  paymentInstructions: string;
  bank: BankDetailsDTO;
  paidOn: string | null;
}

export interface InvoiceSummaryDTO {
  outstanding: number;
  overdue: number;
  drafts: number;
  paidThisPeriod: number;
  awaitingInvoice: number;
}

/* ───────────── Rostering ───────────── */

export interface RosterShiftDTO {
  id: string;
  date: string;
  start: string;
  end: string;
  hours: number;
  ratio: ShiftRatio;
  clientIds: string[];
  staffIds: string[];
  clients: Array<{ id: string; name: string; preferred: string }>;
  staff: Array<{ id: string; name: string; initials: string }>;
  serviceId: string;
  type: string;
  location: string;
  notes: string;
  status: ShiftStatus;
  recordIds: string[];
  createdAt: string;
  updatedAt: string;
  rev: number;
}

export interface ShiftValidationDTO {
  errors: string[];
  warnings: string[];
}

/* ───────────── Budgets ───────────── */

export interface BudgetDTO {
  id: string;
  clientId: string;
  planStart: string;
  planEnd: string;
  categories: Array<{ name: string; allocation: number }>;
  isCurrent: boolean;
  confirmedAgainstPlanAt: string | null;
  createdAt: string;
  updatedAt: string;
  rev: number;
}

export interface BudgetCategoryMetricsDTO {
  name: string;
  allocation: number;
  used: number;
  pending: number;
  committed: number;
  remaining: number;
}

export interface BudgetMetricsDTO {
  categories: BudgetCategoryMetricsDTO[];
  allocation: number;
  used: number;
  pending: number;
  committed: number;
  remaining: number;
  status: BudgetStatus;
  asOf: string;
}

export interface BudgetResponseDTO {
  budget: BudgetDTO | null;
  metrics: BudgetMetricsDTO | null;
}

export interface BudgetAdjustmentDTO {
  id: string;
  category: string;
  oldAllocation: number;
  newAllocation: number;
  reason: string;
  by: ActorRef | null;
  at: string;
}

export interface BudgetOverviewItemDTO {
  clientId: string;
  clientName: string;
  planEnd: string;
  status: BudgetStatus;
  allocation: number;
  remaining: number;
}

/* ───────────── Voice ───────────── */

export interface VoiceDraftDTO {
  support: string;
  response: string;
  outcome: string;
  observations: string;
  followUp: string;
}

export interface VoiceNoteDTO {
  id: string;
  title: string;
  clientId: string;
  clientName: string;
  recordId: string | null;
  recordStatus: RecordStatus | null;
  recordedBy: ActorRef | null;
  durationSec: number;
  duration: string;
  createdAt: string;
  hasAudio: boolean;
  audioMimeType: string | null;
  transcript: string;
  transcriptStatus: TranscriptStatus;
  transcriptProvider: string | null;
  transcriptError: string | null;
  generationStatus: GenerationStatus;
  generation: {
    template: string | null;
    sections: string[];
    detailLevel: string | null;
    transcriptOnly: boolean;
    provider: string | null;
    model: string | null;
    error: string | null;
    generatedAt: string | null;
  };
  draft: VoiceDraftDTO | null;
  status: VoiceStatus;
  archivedAt: string | null;
  updatedAt: string;
  rev: number;
}

export interface VoiceSummaryDTO {
  saved: number;
  transcriptReady: number;
  draftsForReview: number;
}

/* ───────────── Documents ───────────── */

export interface DocumentFileDTO {
  originalName: string;
  mimeType: string;
  size: number;
}

export interface DocumentDTO {
  id: string;
  scope: DocumentScope;
  participantId: string | null;
  folderKey: string;
  title: string;
  notes: string;
  docDate: string | null;
  kind: "file" | "template-slot";
  slotKey: string | null;
  file: DocumentFileDTO | null;
  uploadedBy: ActorRef | null;
  createdAt: string;
  updatedAt: string;
}

export type TreeNodeKind =
  | "folder"
  | "record"
  | "reference"
  | "template"
  | "external"
  | "file";

export interface TreeNode {
  id: string;
  title: string;
  description?: string;
  kind: TreeNodeKind;
  badge?: string;
  badgeTone?: "ok" | "pending" | "external";
  count?: number;
  children?: TreeNode[];
  recordId?: string;
  clientId?: string;
  documentId?: string;
  folderKey?: string;
  uploadable?: boolean;
  file?: DocumentFileDTO | null;
  updatedAt?: string;
}

/* ───────────── Activity, dashboard, reports, notifications, search ───────────── */

export interface ActivityDTO {
  id: string;
  at: string;
  actor: ActorRef | null;
  action: string;
  entityType: string;
  entityId: string;
  participantId: string | null;
  summary: string;
}

export interface DashboardDTO {
  today: string;
  kpis: {
    awaitingReview: number;
    needsCompletion: number;
    readyToInvoice: number;
    activeParticipants: number;
  };
  actionQueue: Array<{
    recordId: string;
    status: RecordStatus;
    clientName: string;
    date: string;
    correction: string;
  }>;
  todayShifts: Array<{
    id: string;
    kind: "shift" | "record";
    start: string;
    end: string;
    title: string;
    location: string;
    recordId: string | null;
  }>;
  documentationHealth: { completePct: number; complete: number; total: number };
  billing: {
    awaitingInvoice: number;
    draftInvoices: number;
    outstanding: number;
  };
  recentActivity: ActivityDTO[];
}

export interface ReportsOverviewDTO {
  range: { from: string; to: string; label: string };
  serviceActivity: Array<{ weekStart: string; label: string; count: number }>;
  documentationStatus: {
    approvedOrInvoiced: number;
    submitted: number;
    draftOrReturned: number;
    returned: number;
    total: number;
  };
  billingReadiness: {
    approvedNotInvoiced: number;
    value: number;
    rows: Array<{
      participantId: string;
      name: string;
      readyRecords: number;
      value: number;
    }>;
  };
  transport: {
    totalKm: number;
    recent: Array<{
      recordId: string;
      clientName: string;
      date: string;
      km: number;
    }>;
  };
  teams: string[];
}

export interface NotificationDTO {
  key: string;
  type:
    | "record_returned"
    | "review_pending"
    | "drafts_stale"
    | "plan_ending"
    | "budget_alert"
    | "invoice_overdue"
    | "voice_draft_ready"
    | "staff_application"
    | "incident_submitted"
    | "staff_document_expiring"
    | "access_request"
    | "leave_request"
    | "timesheets_pending"
    | "feedback_open"
    | "incident_reportable"
    | "message_unread";
  severity: "info" | "warning" | "danger";
  title: string;
  message: string;
  link: string;
  at: string;
}

export interface NotificationsDTO {
  items: NotificationDTO[];
  unread: number;
  seenAt: string | null;
}

export interface SearchResultsDTO {
  participants: Array<{
    id: string;
    name: string;
    preferred: string;
    ndis: string;
    status: ParticipantStatus;
  }>;
  records: Array<{
    id: string;
    clientName: string;
    type: string;
    date: string;
    status: RecordStatus;
  }>;
  invoices: Array<{
    id: string;
    clientName: string;
    total: number;
    status: InvoiceStatus;
  }>;
  voiceNotes: Array<{ id: string; title: string; clientName: string }>;
  documents: Array<{
    id: string;
    title: string;
    scope: DocumentScope;
    participantId: string | null;
    folderKey: string;
  }>;
}

/* ───────────── Staff portal ───────────── */

export interface StaffApplicationDTO {
  id: string;
  name: string;
  email: string;
  phone: string;
  position: string;
  team: string;
  suburb: string;
  experience: string;
  message: string;
  status: StaffApplicationStatus;
  reviewedAt: string | null;
  reviewedBy: ActorRef | null;
  reviewNote: string;
  staffId: string | null;
  createdAt: string;
}

export interface StaffPortalDetailsDTO {
  id: string;
  name: string;
  initials: string;
  position: string;
  team: string;
  email: string;
  phone: string;
  status: StaffStatus;
  startDate: string | null;
  dateOfBirth: string | null;
  address: string;
  about: string;
  nextOfKin: {
    name: string;
    relationship: string;
    phone: string;
    email: string;
    address: string;
  };
  emergencyContacts: Array<{
    id: string;
    name: string;
    relationship: string;
    phone: string;
    email: string;
    primary: boolean;
  }>;
  /** Medical or allergy information the worker asked to keep on file. */
  medicalNotes: string;
  transport: {
    hasVehicle: boolean;
    licenceNumber: string;
    vehicle: string;
    registration: string;
  };
}

export interface StaffChecklistItemDTO {
  key: string;
  label: string;
  group: StaffChecklistGroup;
  requiresExpiry: boolean;
  transportOnly: boolean;
  status: ChecklistItemStatus;
  expiry: string | null;
  daysLeft: number | null;
  expiryState: ExpiryState | null;
  documentId: string | null;
  reviewedAt: string | null;
  reviewNote: string;
}

export interface StaffDocumentDTO {
  id: string;
  staffId: string;
  checklistKey: string | null;
  title: string;
  notes: string;
  issued: string | null;
  expiry: string | null;
  daysLeft: number | null;
  expiryState: ExpiryState | null;
  file: { originalName: string; mimeType: string; size: number } | null;
  uploadedBy: ActorRef | null;
  createdAt: string;
}

export interface StaffPortalProfileDTO {
  staff: StaffDTO;
  details: StaffPortalDetailsDTO;
  checklist: StaffChecklistItemDTO[];
  documents: StaffDocumentDTO[];
  progress: {
    approved: number;
    total: number;
    completePct: number;
    expiring: number;
    expired: number;
  };
}

export interface StaffComplianceDTO {
  staffId: string;
  staff: StaffDTO;
  today: string;
  progress: {
    approved: number;
    total: number;
    completePct: number;
    expiring: number;
    expired: number;
  };
  checklist: StaffChecklistItemDTO[];
  documents: StaffDocumentDTO[];
  account: {
    hasAccess: boolean;
    accepted: boolean;
    lastLoginAt: string | null;
  };
}

export interface PortalShiftDTO {
  id: string;
  date: string;
  start: string;
  end: string;
  hours: number;
  ratio: ShiftRatio;
  status: ShiftStatus;
  type: string;
  location: string;
  notes: string;
  serviceId: string;
  serviceName: string;
  participants: Array<{
    id: string;
    name: string;
    preferred: string;
    alerts: string[];
    goals: string[];
    communication: string;
    mobility: string;
    risks: string;
    allergies: string;
    address: string;
  }>;
  /** Set once the worker has written a progress note against the shift. */
  recordId: string | null;
  /** Timesheet: the actual sign-on/off the worker recorded. */
  timesheet: {
    startedAt: string | null;
    endedAt: string | null;
    breakMinutes: number;
    workedMinutes: number | null;
    kilometres: number;
    notes: string;
  };
  tracking: TrackingSessionDTO | null;
}

export interface PortalHomeDTO {
  today: string;
  greetingName: string;
  nextShift: PortalShiftDTO | null;
  todayShifts: PortalShiftDTO[];
  weekShifts: PortalShiftDTO[];
  weekHours: number;
  hoursThisMonth: number;
  kmThisMonth: number;
  openNotes: number;
  drafts: { reports: number; notes: number };
  alerts: Array<{
    key: string;
    severity: "info" | "warning" | "danger";
    title: string;
    message: string;
    link: string;
  }>;
}

export interface IncidentReportDTO {
  id: string;
  staffId: string;
  staffName: string;
  participantId: string | null;
  participantName: string;
  shiftId: string | null;
  date: string;
  time: string;
  location: string;
  category: IncidentCategory;
  severity: IncidentSeverity;
  description: string;
  injuries: string;
  medicalAttention: boolean;
  medicalDetails: string;
  witness: string;
  immediateActions: string;
  notified: string[];
  followUp: string;
  status: ReportStatus;
  reviewNote: string;
  reviewedBy: ActorRef | null;
  reviewedAt: string | null;
  /** The NDIS Commission side of the incident. */
  reportable: IncidentReportableDTO;
  created: string;
  updated: string;
  rev: number;
}

/** Whether an incident must be reported to the NDIS Commission, and how the deadlines stand. */
export interface IncidentReportableDTO {
  flagged: boolean;
  type: ReportableIncidentType | null;
  /** When key personnel became aware. The deadlines count from here. */
  awareAt: string | null;
  /** For an unauthorised restrictive practice: whether it caused harm. */
  harm: boolean;
  /** When the immediate notification is due, and when it was lodged. */
  notifyBy: string | null;
  notifiedAt: string | null;
  notifiedReference: string;
  /** When the five-day report is due, and when it was lodged. */
  fiveDayBy: string | null;
  fiveDayAt: string | null;
  note: string;
  /** The next thing still to lodge; null when nothing is outstanding. */
  next: { label: string; due: string; overdue: boolean } | null;
}

export interface AbcReportDTO {
  id: string;
  staffId: string;
  staffName: string;
  participantId: string | null;
  participantName: string;
  shiftId: string | null;
  date: string;
  time: string;
  location: string;
  behaviour: AbcBehaviour;
  intensity: number;
  durationMinutes: number;
  antecedent: string;
  behaviourDescription: string;
  consequence: string;
  staffResponse: string;
  outcome: string;
  preventionPlan: string;
  status: ReportStatus;
  reviewNote: string;
  reviewedBy: ActorRef | null;
  reviewedAt: string | null;
  created: string;
  updated: string;
  rev: number;
}

export interface LogbookEntryDTO {
  id: string;
  staffId: string;
  staffName: string;
  participantId: string | null;
  participantName: string;
  shiftId: string | null;
  trackingId: string | null;
  date: string;
  type: LogbookEntryType;
  fromLocation: string;
  toLocation: string;
  purpose: string;
  kilometres: number;
  odometerStart: number | null;
  odometerEnd: number | null;
  /** Kilometres measured by live tracking for the linked shift, when available. */
  trackedKilometres: number | null;
  notes: string;
  created: string;
  updated: string;
  rev: number;
}

export interface TrackingPointDTO {
  at: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  speedKph: number | null;
}

export interface TrackingSessionDTO {
  id: string;
  shiftId: string | null;
  staffId: string;
  staffName: string;
  staffInitials: string;
  participantNames: string[];
  status: TrackingStatus;
  startedAt: string;
  endedAt: string | null;
  lastPingAt: string | null;
  durationMinutes: number;
  distanceMetres: number;
  kilometres: number;
  currentSpeedKph: number | null;
  stationary: boolean;
  signalLost: boolean;
  startLocation: { lat: number; lng: number } | null;
  lastLocation: { lat: number; lng: number } | null;
  trail: TrackingPointDTO[];
  notes: string;
}

export interface LiveTrackingDTO {
  generatedAt: string;
  active: TrackingSessionDTO[];
  recent: TrackingSessionDTO[];
  totals: {
    activeCount: number;
    kilometresToday: number;
    sessionsToday: number;
  };
}

/* ───────────── E-signatures ───────────── */

export interface SignatureFieldDTO {
  id: string;
  signerId: string;
  type: SignatureFieldType;
  /** 1-based page number. */
  page: number;
  /** Position and size as fractions (0–1) of the page as it is displayed, measured from the top-left corner. */
  x: number;
  y: number;
  w: number;
  h: number;
  required: boolean;
  /** The hint shown on the box, such as "Sign here". */
  label: string;
  /** What the signer entered (text, a date or "true" for a tick). Empty until they sign. */
  value: string;
}

export interface SignerDTO {
  id: string;
  name: string;
  email: string;
  /** What this person is to the document, such as "Participant" or "Support worker". */
  roleLabel: string;
  status: SignerStatus;
  viewedAt: string | null;
  signedAt: string | null;
  declinedAt: string | null;
  declineReason: string;
  emailedAt: string | null;
  /** The private signing link. Only present while the request is out for signature. */
  url: string | null;
}

export interface SignatureEventDTO {
  at: string;
  type: SignatureEventType;
  signerId: string | null;
  /** Who did it: a team member's name, or the signer's. */
  by: string;
  detail: string;
}

export interface SignatureSummaryDTO {
  id: string;
  title: string;
  status: SignatureDisplayStatus;
  participantId: string | null;
  participantName: string;
  signerNames: string[];
  signerCount: number;
  signedCount: number;
  pageCount: number;
  createdBy: ActorRef | null;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
  completedAt: string | null;
  expiresAt: string | null;
}

export interface SignatureRequestDTO extends SignatureSummaryDTO {
  message: string;
  /** The client folder the signed copy is filed in once everyone has signed. */
  folderKey: string;
  document: { originalName: string; size: number; sha256: string };
  pages: Array<{ width: number; height: number }>;
  signers: SignerDTO[];
  fields: SignatureFieldDTO[];
  events: SignatureEventDTO[];
  signedFile: { size: number; sha256: string } | null;
  filedDocumentId: string | null;
  /** Everyone has signed but the finished copy has not been built yet. */
  sealPending: boolean;
  rev: number;
}

export interface SignatureSendResultDTO {
  request: SignatureRequestDTO;
  /** Ids of the signers an email was sent to. */
  emailed: string[];
  emailConfigured: boolean;
}

export interface SignatureReminderResultDTO {
  request: SignatureRequestDTO;
  emailed: boolean;
  emailConfigured: boolean;
}

export interface SignatureSummaryTotalsDTO {
  awaiting: number;
  completed: number;
  drafts: number;
  needsAttention: number;
}

export interface PublicSigningFieldDTO {
  id: string;
  type: SignatureFieldType;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  required: boolean;
  label: string;
}

/** What someone holding a signing link is shown: this document and their own boxes, nothing else. */
export interface PublicSigningDTO {
  state: SigningState;
  title: string;
  message: string;
  /** The organisation that sent it. */
  senderName: string;
  signer: {
    name: string;
    roleLabel: string;
    status: SignerStatus;
    signedAt: string | null;
  };
  /** Who else has to sign, by name and progress only. */
  others: Array<{ name: string; roleLabel: string; status: SignerStatus }>;
  pages: Array<{ width: number; height: number }>;
  /** This signer's boxes. Empty unless the link is open. */
  fields: PublicSigningFieldDTO[];
  /** What a date box will show: today in the organisation's time zone. */
  today: string;
  expiresAt: string | null;
  /** The finished copy can be downloaded. */
  canDownload: boolean;
}

export interface PublicSigningResultDTO {
  state: SigningState;
}

export interface SignatureListDTO {
  items: SignatureSummaryDTO[];
  totals: SignatureSummaryTotalsDTO;
}

/* ───────────── Workforce: availability & leave ───────────── */

export interface AvailabilityDayDTO {
  /** 0 = Monday … 6 = Sunday. */
  day: number;
  mode: AvailabilityMode;
  /** Only meaningful for "Set hours". */
  from: string;
  to: string;
}

export interface AvailabilityDTO {
  staffId: string;
  /** False until someone has set a pattern. An unset pattern never raises a roster warning. */
  set: boolean;
  days: AvailabilityDayDTO[];
  note: string;
  updatedAt: string | null;
  updatedBy: ActorRef | null;
}

export interface LeaveClashDTO {
  shiftId: string;
  date: string;
  start: string;
  end: string;
  clients: string;
}

export interface LeaveRequestDTO {
  id: string;
  staffId: string;
  staffName: string;
  type: LeaveType;
  from: string;
  to: string;
  /** Set when the time off is only part of one day. */
  startTime: string | null;
  endTime: string | null;
  /** Calendar days covered. */
  days: number;
  /** Paid hours asked for; 0 for unpaid time off. */
  hours: number;
  reason: string;
  status: LeaveStatus;
  requestedBy: ActorRef | null;
  requestedAt: string;
  decidedBy: ActorRef | null;
  decidedAt: string | null;
  decisionNote: string;
  /** Rostered shifts inside these dates that still have this worker on them. */
  clashes: LeaveClashDTO[];
  /** Set once the paid hours have gone into a finalised pay run. */
  payRunId: string | null;
  rev: number;
}

/* ───────────── Timesheets & pay ───────────── */

/** The award rules as the Pay rules form shows them: dollars, not cents. */
export type AwardRulesDTO = Omit<
  AwardRules,
  "standardRateWeeklyCents" | "vehicleAllowanceCentsPerKm"
> & {
  standardRateWeekly: number;
  vehicleAllowancePerKm: number;
};

export interface PayClassificationDTO {
  id: string;
  name: string;
  /** Newest first. Each rate applies from its date until the next one starts. */
  rates: Array<{ effectiveFrom: string; hourly: number }>;
  /** The rate in force today; null when none has started yet. */
  currentRate: number | null;
  /** How many team members are on this classification. */
  staffCount: number;
}

/** A classification without its rates, for the Staff page. */
export interface PayClassificationOptionDTO {
  id: string;
  name: string;
}

export interface PublicHolidayDTO {
  date: string;
  name: string;
}

export interface PayPeriodDTO {
  from: string;
  to: string;
  length: PayPeriodLength;
  label: string;
  /** Today falls inside this period. */
  current: boolean;
}

export interface PaySettingsDTO {
  rules: AwardRulesDTO;
  classifications: PayClassificationDTO[];
  publicHolidays: PublicHolidayDTO[];
  payPeriod: { length: PayPeriodLength; anchor: string };
  toleranceMinutes: number;
  /** What still has to be entered before the amounts can be relied on. */
  missing: string[];
  updatedAt: string | null;
  updatedBy: ActorRef | null;
  rev: number;
}

export interface PayLineDTO {
  /** The shift the line came from; empty for leave and adjustments. */
  shiftId: string;
  date: string;
  code: PayCode;
  label: string;
  hours: number;
  /** A count that is not time, such as kilometres. */
  units: number | null;
  /** Percentage of the ordinary rate; 0 for allowances. */
  pct: number;
  rate: number;
  amount: number;
  /** The rule that produced the line, in plain words. */
  why: string;
}

export interface PayFlagDTO {
  shiftId: string;
  level: "info" | "warning";
  message: string;
}

export interface TimesheetTimesDTO {
  start: string;
  end: string;
  /** The finish is on the day after the shift's date. */
  overnight: boolean;
  breakMinutes: number;
  /** Time between start and finish, less the break. */
  minutes: number;
}

/** One worker on one rostered shift: what was planned, what they recorded and what gets paid. */
export interface TimesheetDTO {
  /** The shift id and the worker's id joined with a colon. */
  id: string;
  shiftId: string;
  staffId: string;
  staffName: string;
  date: string;
  clients: string;
  serviceName: string;
  payAs: ServicePayType;
  location: string;
  status: TimesheetStatus;
  shiftStatus: ShiftStatus;
  rostered: TimesheetTimesDTO;
  /** What the worker recorded from the portal; null until they sign on. */
  actual: {
    startedAt: string;
    endedAt: string | null;
    start: string;
    end: string | null;
    overnight: boolean;
    breakMinutes: number;
    minutes: number | null;
  } | null;
  /** The approved hours, or the hours approving now would pay. */
  paid: TimesheetTimesDTO;
  /** Paid minutes less rostered minutes. */
  varianceMinutes: number;
  kilometres: number;
  sleepoverActiveMinutes: number;
  /** A cancelled shift the office chose to pay. */
  payCancelled: boolean;
  workerNote: string;
  approval: { by: ActorRef | null; at: string | null; note: string } | null;
  payRunId: string | null;
  /** Signed off and within the tolerance of the roster, so it can be approved in bulk. */
  clean: boolean;
}

export interface TimesheetListDTO {
  period: PayPeriodDTO;
  rows: TimesheetDTO[];
  totals: {
    awaiting: number;
    approved: number;
    missing: number;
    inProgress: number;
    approvedHours: number;
    rosteredHours: number;
  };
}

export interface TimesheetDetailDTO extends TimesheetDTO {
  /** How these hours turn into pay under the current rules. */
  lines: PayLineDTO[];
  flags: PayFlagDTO[];
  gross: number;
  /** False while the worker has no employment type or pay rate, so the amounts are $0. */
  costed: boolean;
  costNote: string;
}

/** One team member as payroll sees them: how they are employed and what they are paid an hour. */
export interface StaffPayDTO {
  staffId: string;
  name: string;
  status: StaffStatus;
  employmentType: EmploymentType | null;
  classificationId: string | null;
  classificationName: string;
  contractedHours: number;
  payrollId: string;
  /** A rate agreed with this person that replaces the classification's. */
  payRateOverride: number | null;
  /** Their ordinary hourly rate today; null when it cannot be worked out. */
  baseRate: number | null;
  /** What is stopping their pay from being worked out; empty when nothing is. */
  missing: string;
}

export interface PayAdjustmentDTO {
  id: string;
  label: string;
  amount: number;
  by: ActorRef | null;
  at: string;
}

export interface PayRunItemDTO {
  staffId: string;
  staffName: string;
  payrollId: string;
  employmentType: EmploymentType | null;
  classificationName: string;
  /** Their ordinary hourly rate at the end of the period. */
  baseRate: number;
  hours: number;
  ordinaryHours: number;
  overtimeHours: number;
  allowances: number;
  adjustmentsTotal: number;
  gross: number;
  lines: PayLineDTO[];
  adjustments: PayAdjustmentDTO[];
  flags: string[];
}

export interface PayRunSummaryDTO {
  id: string;
  from: string;
  to: string;
  label: string;
  status: PayRunStatus;
  staffCount: number;
  hours: number;
  gross: number;
  createdAt: string;
  createdBy: ActorRef | null;
  finalisedAt: string | null;
  finalisedBy: ActorRef | null;
}

export interface PayRunDTO extends PayRunSummaryDTO {
  items: PayRunItemDTO[];
  /** Things worth looking at before the run is finalised. */
  warnings: string[];
  rev: number;
}

/* ───────────── Complaints & feedback ───────────── */

export interface FeedbackActionDTO {
  id: string;
  description: string;
  owner: string;
  due: string | null;
  doneAt: string | null;
  doneBy: ActorRef | null;
  overdue: boolean;
}

/** A case as the register lists it. */
export interface FeedbackSummaryDTO {
  /** FB-0001 */
  id: string;
  kind: FeedbackKind;
  status: FeedbackStatus;
  priority: FeedbackPriority;
  area: FeedbackArea;
  channel: FeedbackChannel;
  summary: string;
  receivedOn: string;
  /** "Anonymous" when they asked not to be named. */
  raisedByName: string;
  relationship: FeedbackRelationship;
  participantId: string | null;
  participantName: string;
  staffId: string | null;
  staffName: string;
  owner: ActorRef | null;
  acknowledgeBy: string;
  resolveBy: string;
  /** The next step and the date it is due by; null once the case is resolved or closed. */
  due: { label: string; date: string; overdue: boolean } | null;
  openActions: number;
  viaPublicForm: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FeedbackCaseDTO extends FeedbackSummaryDTO {
  details: string;
  desiredOutcome: string;
  /** What the public form's "who or what is this about" said, when it could not be matched. */
  aboutText: string;
  raisedBy: {
    name: string;
    relationship: FeedbackRelationship;
    phone: string;
    email: string;
    anonymous: boolean;
    wantsContact: boolean;
  };
  incidentId: string | null;
  incidentLabel: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  outcome: string;
  satisfaction: FeedbackSatisfaction;
  /** Something has to change so this does not happen again, and what. */
  improvementNeeded: boolean;
  improvement: string;
  actions: FeedbackActionDTO[];
  history: HistoryEntryDTO[];
  rev: number;
}

/** The public form's link. `url` is null while it is switched off. */
export interface FeedbackFormDTO {
  enabled: boolean;
  url: string | null;
}

export interface FeedbackListDTO {
  items: FeedbackSummaryDTO[];
  totals: {
    open: number;
    overdue: number;
    unacknowledged: number;
    /** Closed or resolved in the last 30 days. */
    closedRecently: number;
  };
  form: FeedbackFormDTO;
}

/** What the "log feedback" form chooses from, so the register needs no other module's lists. */
export interface FeedbackOptionsDTO {
  owners: Array<{ id: string; name: string }>;
  participants: Array<{ id: string; name: string }>;
  staff: Array<{ id: string; name: string }>;
  incidents: Array<{ id: string; label: string }>;
}

/** What someone holding the public feedback link is shown: who they are writing to, nothing else. */
export interface PublicFeedbackFormDTO {
  organisation: string;
  open: boolean;
}

export interface PublicFeedbackResultDTO {
  /** The reference to quote if they get in touch again. */
  reference: string;
}

/* ───────────── Messages ───────────── */

export interface MessageDTO {
  id: string;
  conversationId: string;
  sender: ActorRef;
  /** Sent by the person reading. */
  mine: boolean;
  body: string;
  /** The shift or client this message was written about, when it was sent from one. */
  context: { type: MessageContextType; id: string; label: string } | null;
  sentAt: string;
}

export interface ConversationMemberDTO {
  id: string;
  name: string;
  /** "Support worker" or their office role. */
  roleLabel: string;
  /** When they last opened the conversation; null if never. */
  lastReadAt: string | null;
}

export interface ConversationSummaryDTO {
  id: string;
  kind: ConversationKind;
  /** The other person's name, the group's name, or the announcement's subject. */
  title: string;
  /** Who an announcement went to; null for conversations. */
  audience: AnnouncementAudience | null;
  context: { type: MessageContextType; id: string; label: string } | null;
  memberCount: number;
  lastMessage: { body: string; senderName: string; sentAt: string } | null;
  unread: number;
  /** False for an announcement someone else sent: it can be read, not answered. */
  canReply: boolean;
  createdBy: ActorRef | null;
  updatedAt: string;
}

export interface ConversationDTO extends ConversationSummaryDTO {
  members: ConversationMemberDTO[];
  /** Oldest first. */
  messages: MessageDTO[];
  /** There are older messages than the ones returned. */
  hasMore: boolean;
  /** For an announcement, as its sender sees it: how many people have opened it. */
  readBy: number | null;
}

export interface ConversationListDTO {
  items: ConversationSummaryDTO[];
  unread: number;
}

/** Someone a message can be sent to. */
export interface MessageRecipientDTO {
  id: string;
  name: string;
  roleLabel: string;
  worker: boolean;
}

export interface MessageOptionsDTO {
  recipients: MessageRecipientDTO[];
  /** This person may send an announcement. */
  canAnnounce: boolean;
}
