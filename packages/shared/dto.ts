/** Response shapes of the REST API (/api/v1). Money is in dollars, dates are YYYY-MM-DD, timestamps are ISO-8601. */
import type {
  AbcBehaviour,
  ChecklistItemStatus,
  DetailLevel,
  DocumentScope,
  ErrorCode,
  ExpiryState,
  GenerationStatus,
  IncidentCategory,
  IncidentSeverity,
  InvoiceStatus,
  XeroSyncState,
  Kyc,
  LogbookEntryType,
  NoteTemplate,
  ParticipantStatus,
  RecordStatus,
  ReportStatus,
  ServiceUnit,
  ShiftRatio,
  ShiftStatus,
  StaffAccountStatus,
  StaffApplicationStatus,
  StaffChecklistGroup,
  StaffStatus,
  TrackingStatus,
  TranscriptStatus,
  TransportUnit,
  UserRole,
  VoiceStatus,
} from "./enums";
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
  /** Set when the account belongs to a team member with portal access. */
  staffId: string | null;
  lastLoginAt: string | null;
  createdAt: string;
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
  createdAt: string;
  updatedAt: string;
  rev: number;
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
    | "staff_document_expiring";
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
  created: string;
  updated: string;
  rev: number;
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
