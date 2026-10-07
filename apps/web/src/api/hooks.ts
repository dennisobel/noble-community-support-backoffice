import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type {
  AbcReportDTO,
  AccessUserDTO,
  ActivityDTO,
  AuthSessionDTO,
  AvailabilityDTO,
  BootstrapDTO,
  BudgetAdjustmentDTO,
  BudgetResponseDTO,
  ConversationDTO,
  ConversationListDTO,
  DashboardDTO,
  DocumentDTO,
  FeedbackCaseDTO,
  FeedbackFormDTO,
  FeedbackListDTO,
  FeedbackOptionsDTO,
  IncidentReportDTO,
  InvoiceDTO,
  PublicFeedbackFormDTO,
  PublicFeedbackResultDTO,
  PublicInvoiceDTO,
  PublicSigningDTO,
  PublicSigningResultDTO,
  InvoiceSummaryDTO,
  LeaveRequestDTO,
  LiveTrackingDTO,
  LogbookEntryDTO,
  MessageDTO,
  MessageOptionsDTO,
  MetaDTO,
  MyDayDTO,
  NoteDTO,
  NoteLabelDTO,
  NoteSummaryDTO,
  NotificationsDTO,
  Paginated,
  ParticipantDTO,
  PayClassificationOptionDTO,
  PayRunDTO,
  PayRunSummaryDTO,
  PaySettingsDTO,
  PortalHomeDTO,
  PortalShiftDTO,
  PreferencesDTO,
  RecordCountsDTO,
  ReportsOverviewDTO,
  RosterShiftDTO,
  SearchResultsDTO,
  ServiceDTO,
  ServiceRecordDTO,
  SessionDTO,
  ShiftValidationDTO,
  SignatureListDTO,
  SignatureReminderResultDTO,
  SignatureRequestDTO,
  SignatureSendResultDTO,
  StaffApplicationDTO,
  StaffChecklistItemDTO,
  StaffComplianceDTO,
  StaffDTO,
  StaffDocumentDTO,
  StaffPayDTO,
  StaffPortalProfileDTO,
  TimesheetDetailDTO,
  TimesheetListDTO,
  TrackingSessionDTO,
  TreeNode,
  VoiceNoteDTO,
  VoiceSummaryDTO,
  WithWarnings,
  WorkspaceDTO,
  XeroOptionsDTO,
  XeroStatusDTO,
} from "@shared/dto";
import { MESSAGE_POLL_MS } from "@shared/const";
import type { AccessModule, OfficeRole } from "@shared/enums";
import type {
  AvailabilityInput,
  BudgetAdjustInput,
  BudgetSetupInput,
  ConversationCreateInput,
  FeedbackActionInput,
  FeedbackCreateInput,
  FeedbackStatusInput,
  FeedbackUpdateInput,
  IncidentReportableInput,
  PublicFeedbackInput,
  GenerateDraftInput,
  InvoiceCreateInput,
  LeaveCreateInput,
  LeaveDecisionInput,
  OfficeLeaveCreateInput,
  ParticipantCreateInput,
  ParticipantUpdateInput,
  PayAdjustmentInput,
  PaySettingsInput,
  PreferencesPatchInput,
  RecordCreateInput,
  RecordUpdateInput,
  ServiceCreateInput,
  ServiceUpdateInput,
  ShiftCreateInput,
  ShiftUpdateInput,
  SignatureDraftInput,
  SignatureSendInput,
  SignSubmitInput,
  StaffCreateInput,
  StaffUpdateInput,
  TimesheetApproveInput,
  WorkspacePatchInput,
  XeroSettingsInput,
} from "@shared/schemas";
import { api } from "./client";

/* ───────────── Query keys & cache refresh ───────────── */

const GROUPS = {
  records: ["records", "record", "record-counts"],
  participants: ["participants", "participant"],
  staff: ["staff"],
  services: ["services"],
  shifts: ["shifts", "shift-validation"],
  budgets: ["budget", "budget-adjustments"],
  invoices: ["invoices", "invoice", "invoice-summary"],
  voice: ["voice-notes", "voice-note", "voice-summary"],
  documents: ["documents-tree"],
  settings: ["workspace", "preferences", "meta", "session"],
  sessions: ["auth-sessions"],
  xero: ["xero-status", "xero-options"],
  access: ["access-users"],
  notes: ["notes", "note-labels"],
  signatures: ["signatures", "signature"],
  leave: ["leave", "staff-availability"],
  feedback: ["feedback", "feedback-case", "feedback-options"],
  messages: ["conversations", "conversation", "messages-unread"],
  payroll: [
    "pay-settings",
    "pay-classifications",
    "staff-pay",
    "timesheets",
    "timesheet",
    "pay-runs",
    "pay-run",
  ],
  derived: ["dashboard", "notifications", "reports", "activity", "search"],
} as const;
type Group = keyof typeof GROUPS;

export async function refresh(qc: QueryClient, groups: Group[]): Promise<void> {
  const keys = new Set<string>([
    ...GROUPS.derived,
    ...groups.flatMap(group => GROUPS[group]),
  ]);
  await Promise.all(
    [...keys].map(key => qc.invalidateQueries({ queryKey: [key] }))
  );
}

function useApiMutation<TVars, TResult>(
  mutationFn: (vars: TVars) => Promise<TResult>,
  groups: Group[]
) {
  const qc = useQueryClient();
  return useMutation({ mutationFn, onSettled: () => refresh(qc, groups) });
}

const clean = <T extends object>(params: T) =>
  Object.fromEntries(
    Object.entries(params).filter(
      ([, value]) => value !== undefined && value !== "" && value !== null
    )
  ) as Partial<T>;

/* ───────────── Meta, auth, settings ───────────── */

export const useMeta = () =>
  useQuery({
    queryKey: ["meta"],
    queryFn: () => api.get<MetaDTO>("/meta"),
    staleTime: 5 * 60_000,
  });
export const useBootstrap = () =>
  useQuery({
    queryKey: ["bootstrap"],
    queryFn: () => api.get<BootstrapDTO>("/auth/bootstrap"),
    staleTime: 60_000,
  });

export const useWorkspace = () =>
  useQuery({
    queryKey: ["workspace"],
    queryFn: () => api.get<WorkspaceDTO>("/settings/workspace"),
    staleTime: 60_000,
  });
export const useUpdateWorkspace = () =>
  useApiMutation(
    (input: WorkspacePatchInput) =>
      api.patch<WorkspaceDTO>("/settings/workspace", input),
    ["settings"]
  );
export const usePreferences = () =>
  useQuery({
    queryKey: ["preferences"],
    queryFn: () => api.get<PreferencesDTO>("/settings/preferences"),
  });
export const useUpdatePreferences = () =>
  useApiMutation(
    (input: PreferencesPatchInput) =>
      api.patch<PreferencesDTO>("/settings/preferences", input),
    ["settings"]
  );
export const useUpdateMe = () =>
  useApiMutation(
    (input: { name?: string; email?: string }) =>
      api.patch<SessionDTO>("/auth/me", input),
    ["settings"]
  );
export const useChangePassword = () =>
  useApiMutation(
    (input: { currentPassword: string; newPassword: string }) =>
      api.post<void>("/auth/change-password", input),
    ["sessions"]
  );
export const useAuthSessions = () =>
  useQuery({
    queryKey: ["auth-sessions"],
    queryFn: () => api.get<AuthSessionDTO[]>("/auth/sessions"),
  });
export const useRevokeSession = () =>
  useApiMutation(
    (id: string) => api.delete(`/auth/sessions/${id}`),
    ["sessions"]
  );

/* ───────────── Staff & services ───────────── */

export const useStaff = (
  params: { status?: string; team?: string; q?: string } = {}
) =>
  useQuery({
    queryKey: ["staff", params],
    queryFn: () => api.get<StaffDTO[]>("/staff", clean(params)),
  });
export const useCreateStaff = () =>
  useApiMutation(
    (input: StaffCreateInput) => api.post<StaffDTO>("/staff", input),
    ["staff"]
  );
export const useUpdateStaff = () =>
  useApiMutation(
    ({ id, ...input }: StaffUpdateInput & { id: string }) =>
      api.patch<WithWarnings<StaffDTO>>(`/staff/${id}`, input),
    ["staff", "shifts", "payroll"]
  );

export const useServices = (
  params: { active?: "true" | "false" | "all" } = {}
) =>
  useQuery({
    queryKey: ["services", params],
    queryFn: () => api.get<ServiceDTO[]>("/services", clean(params)),
  });
export const useCreateService = () =>
  useApiMutation(
    (input: ServiceCreateInput) => api.post<ServiceDTO>("/services", input),
    ["services"]
  );
export const useUpdateService = () =>
  useApiMutation(
    ({ id, ...input }: ServiceUpdateInput & { id: string }) =>
      api.patch<ServiceDTO>(`/services/${id}`, input),
    ["services"]
  );
export const useDeleteService = () =>
  useApiMutation((id: string) => api.delete(`/services/${id}`), ["services"]);

/* ───────────── Participants ───────────── */

export const useParticipants = (
  params: { status?: string; q?: string; limit?: number } = {}
) =>
  useQuery({
    queryKey: ["participants", params],
    queryFn: () =>
      api.get<Paginated<ParticipantDTO>>(
        "/participants",
        clean({ limit: 200, ...params })
      ),
    placeholderData: keepPreviousData,
  });
export const useParticipant = (id: string | undefined) =>
  useQuery({
    queryKey: ["participant", id],
    queryFn: () => api.get<ParticipantDTO>(`/participants/${id}`),
    enabled: Boolean(id),
  });
export const useCreateParticipant = () =>
  useApiMutation(
    (input: ParticipantCreateInput) =>
      api.post<ParticipantDTO>("/participants", input),
    ["participants", "documents"]
  );
export const useUpdateParticipant = () =>
  useApiMutation(
    ({ id, ...input }: ParticipantUpdateInput & { id: string }) =>
      api.patch<ParticipantDTO>(`/participants/${id}`, input),
    ["participants", "budgets", "documents"]
  );
export const useUpdateKyc = () =>
  useApiMutation(
    ({
      id,
      ...input
    }: Record<string, boolean | number | string | undefined> & {
      id: string;
    }) => api.patch<ParticipantDTO>(`/participants/${id}/kyc`, input),
    ["participants", "documents"]
  );
export const useArchiveParticipant = () =>
  useApiMutation(
    ({ id, reason }: { id: string; reason?: string }) =>
      api.post<WithWarnings<ParticipantDTO>>(`/participants/${id}/archive`, {
        reason,
      }),
    ["participants"]
  );
export const useRestoreParticipant = () =>
  useApiMutation(
    (id: string) => api.post<ParticipantDTO>(`/participants/${id}/restore`),
    ["participants"]
  );

/* ───────────── Service records ───────────── */

export interface RecordQuery {
  status?: string;
  clientId?: string;
  staffId?: string;
  q?: string;
  from?: string;
  to?: string;
  sort?: string;
  page?: number;
  limit?: number;
}
export const useRecords = (
  params: RecordQuery,
  options: { enabled?: boolean } = {}
) =>
  useQuery({
    queryKey: ["records", params],
    queryFn: () =>
      api.get<Paginated<ServiceRecordDTO>>("/service-records", clean(params)),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
export const useRecord = (id: string | undefined) =>
  useQuery({
    queryKey: ["record", id],
    queryFn: () => api.get<ServiceRecordDTO>(`/service-records/${id}`),
    enabled: Boolean(id),
  });
export const useRecordCounts = (clientId?: string) =>
  useQuery({
    queryKey: ["record-counts", clientId ?? "all"],
    queryFn: () =>
      api.get<RecordCountsDTO>("/service-records/counts", clean({ clientId })),
  });

const RECORD_GROUPS: Group[] = [
  "records",
  "budgets",
  "documents",
  "voice",
  "shifts",
  "invoices",
];
export const useCreateRecord = () =>
  useApiMutation(
    (input: RecordCreateInput) =>
      api.post<ServiceRecordDTO>("/service-records", input),
    RECORD_GROUPS
  );
export const useUpdateRecord = () =>
  useApiMutation(
    ({ id, ...input }: RecordUpdateInput & { id: string }) =>
      api.patch<ServiceRecordDTO>(`/service-records/${id}`, input),
    RECORD_GROUPS
  );
export const useRecordAction = () =>
  useApiMutation(
    ({
      id,
      action,
      ...body
    }: {
      id: string;
      action: "submit" | "approve" | "return";
      rev?: number;
      reason?: string;
    }) => api.post<ServiceRecordDTO>(`/service-records/${id}/${action}`, body),
    RECORD_GROUPS
  );
export const useAdjustBillables = () =>
  useApiMutation(
    ({
      id,
      ...body
    }: {
      id: string;
      rev?: number;
      lines: Array<{ index: number; quantity?: number; rate?: number }>;
    }) => api.patch<ServiceRecordDTO>(`/service-records/${id}/billables`, body),
    RECORD_GROUPS
  );
export const useDeleteRecord = () =>
  useApiMutation(
    (id: string) => api.delete(`/service-records/${id}`),
    RECORD_GROUPS
  );

/* ───────────── Roster ───────────── */

export const useShifts = (params: {
  from: string;
  to: string;
  ratio?: string;
  clientId?: string;
}) =>
  useQuery({
    queryKey: ["shifts", params],
    queryFn: () => api.get<RosterShiftDTO[]>("/roster/shifts", clean(params)),
    placeholderData: keepPreviousData,
  });
export const useShiftValidation = (
  draft: (ShiftCreateInput & { id?: string }) | null
) =>
  useQuery({
    queryKey: ["shift-validation", draft],
    queryFn: () =>
      api.post<ShiftValidationDTO>("/roster/shifts/validate", draft),
    enabled: Boolean(draft),
    staleTime: 10_000,
    placeholderData: keepPreviousData,
  });
const SHIFT_GROUPS: Group[] = ["shifts", "budgets"];
export const useCreateShift = () =>
  useApiMutation(
    (input: ShiftCreateInput) =>
      api.post<WithWarnings<RosterShiftDTO>>("/roster/shifts", input),
    SHIFT_GROUPS
  );
export const useUpdateShift = () =>
  useApiMutation(
    ({ id, ...input }: ShiftUpdateInput & { id: string }) =>
      api.patch<WithWarnings<RosterShiftDTO>>(`/roster/shifts/${id}`, input),
    SHIFT_GROUPS
  );
export const useShiftStatus = () =>
  useApiMutation(
    ({ id, status, rev }: { id: string; status: string; rev?: number }) =>
      api.post<RosterShiftDTO>(`/roster/shifts/${id}/status`, { status, rev }),
    SHIFT_GROUPS
  );
export const useDeleteShift = () =>
  useApiMutation(
    (id: string) => api.delete(`/roster/shifts/${id}`),
    SHIFT_GROUPS
  );
export const useRecordsFromShift = () =>
  useApiMutation(
    (id: string) =>
      api.post<ServiceRecordDTO[]>(`/roster/shifts/${id}/create-records`),
    ["shifts", "records", "documents"]
  );

/* ───────────── Budgets ───────────── */

export const useBudget = (clientId: string | undefined) =>
  useQuery({
    queryKey: ["budget", clientId],
    queryFn: () =>
      api.get<BudgetResponseDTO>(`/participants/${clientId}/budget`),
    enabled: Boolean(clientId),
  });
export const useBudgetAdjustments = (clientId: string | undefined) =>
  useQuery({
    queryKey: ["budget-adjustments", clientId],
    queryFn: () =>
      api.get<BudgetAdjustmentDTO[]>(
        `/participants/${clientId}/budget/adjustments`
      ),
    enabled: Boolean(clientId),
  });
export const useSetupBudget = () =>
  useApiMutation(
    ({
      clientId,
      renew,
      ...input
    }: BudgetSetupInput & { clientId: string; renew?: boolean }) =>
      renew
        ? api.post<BudgetResponseDTO>(
            `/participants/${clientId}/budget/renew`,
            input
          )
        : api.put<BudgetResponseDTO>(`/participants/${clientId}/budget`, input),
    ["budgets", "participants"]
  );
export const useAdjustBudget = () =>
  useApiMutation(
    ({ clientId, ...input }: BudgetAdjustInput & { clientId: string }) =>
      api.post<BudgetResponseDTO>(
        `/participants/${clientId}/budget/adjustments`,
        input
      ),
    ["budgets"]
  );
export const useUpdatePlanWindow = () =>
  useApiMutation(
    ({
      clientId,
      ...input
    }: {
      clientId: string;
      planStart: string;
      planEnd: string;
      rev?: number;
    }) =>
      api.patch<BudgetResponseDTO>(
        `/participants/${clientId}/budget/plan`,
        input
      ),
    ["budgets", "participants"]
  );

/* ───────────── Invoices ───────────── */

export const useInvoices = (
  params: { status?: string; clientId?: string; q?: string } = {}
) =>
  useQuery({
    queryKey: ["invoices", params],
    queryFn: () =>
      api.get<Paginated<InvoiceDTO>>(
        "/invoices",
        clean({ limit: 200, ...params })
      ),
    placeholderData: keepPreviousData,
  });
export const useInvoice = (id: string | undefined) =>
  useQuery({
    queryKey: ["invoice", id],
    queryFn: () => api.get<InvoiceDTO>(`/invoices/${id}`),
    enabled: Boolean(id),
    // While Xero is still picking the invoice up, look again every few seconds so the badge settles by itself.
    refetchInterval: query =>
      query.state.data?.xero?.state === "queued" ? 3000 : false,
  });
export const useInvoiceSummary = () =>
  useQuery({
    queryKey: ["invoice-summary"],
    queryFn: () => api.get<InvoiceSummaryDTO>("/invoices/summary"),
  });
export const useCreateInvoice = () =>
  useApiMutation(
    (input: InvoiceCreateInput) => api.post<InvoiceDTO>("/invoices", input),
    ["invoices", "records", "budgets"]
  );
export const useInvoiceAction = () =>
  useApiMutation(
    ({
      id,
      action,
      ...body
    }: {
      id: string;
      action: "mark-ready" | "mark-sent" | "mark-paid" | "void";
      rev?: number;
      sendEmail?: boolean;
      paidOn?: string;
      reference?: string;
      reason?: string;
    }) => api.post<InvoiceDTO>(`/invoices/${id}/${action}`, body),
    ["invoices", "records", "budgets"]
  );
export const useDeleteInvoice = () =>
  useApiMutation(
    (id: string) => api.delete(`/invoices/${id}`),
    ["invoices", "records", "budgets"]
  );

/* ───────────── Voice ───────────── */

export const useVoiceNotes = (
  params: {
    clientId?: string;
    status?: string;
    range?: string;
    q?: string;
  } = {}
) =>
  useQuery({
    queryKey: ["voice-notes", params],
    queryFn: () =>
      api.get<Paginated<VoiceNoteDTO>>(
        "/voice-notes",
        clean({ limit: 100, ...params })
      ),
    placeholderData: keepPreviousData,
  });
export const useVoiceSummary = () =>
  useQuery({
    queryKey: ["voice-summary"],
    queryFn: () => api.get<VoiceSummaryDTO>("/voice-notes/summary"),
  });
export const useVoiceNote = (id: string | undefined) =>
  useQuery({
    queryKey: ["voice-note", id],
    queryFn: () => api.get<VoiceNoteDTO>(`/voice-notes/${id}`),
    enabled: Boolean(id),
    // Poll while a transcription or draft is being prepared in the background.
    refetchInterval: query => {
      const voice = query.state.data;
      return voice &&
        (voice.transcriptStatus === "Processing" ||
          voice.generationStatus === "Processing")
        ? 2000
        : false;
    },
  });
const VOICE_GROUPS: Group[] = ["voice", "records"];
export const useUploadVoice = () =>
  useApiMutation(
    ({
      form,
      onProgress,
    }: {
      form: FormData;
      onProgress?: (percent: number) => void;
    }) => api.upload<VoiceNoteDTO>("/voice-notes", form, onProgress),
    VOICE_GROUPS
  );
export const useUpdateVoice = () =>
  useApiMutation(
    ({
      id,
      ...input
    }: {
      id: string;
      title?: string;
      recordId?: string | null;
      rev?: number;
    }) => api.patch<VoiceNoteDTO>(`/voice-notes/${id}`, input),
    VOICE_GROUPS
  );
export const useDeleteVoice = () =>
  useApiMutation(
    (id: string) => api.delete(`/voice-notes/${id}`),
    VOICE_GROUPS
  );
export const useArchiveVoice = () =>
  useApiMutation(
    ({ id, archived }: { id: string; archived: boolean }) =>
      api.post<VoiceNoteDTO>(
        `/voice-notes/${id}/${archived ? "archive" : "unarchive"}`
      ),
    VOICE_GROUPS
  );
export const useTranscribe = () =>
  useApiMutation(
    (id: string) => api.post<VoiceNoteDTO>(`/voice-notes/${id}/transcribe`),
    VOICE_GROUPS
  );
export const useUpdateTranscript = () =>
  useApiMutation(
    ({ id, text, rev }: { id: string; text: string; rev?: number }) =>
      api.patch<VoiceNoteDTO>(`/voice-notes/${id}/transcript`, { text, rev }),
    VOICE_GROUPS
  );
export const useGenerateDraft = () =>
  useApiMutation(
    ({ id, ...input }: GenerateDraftInput & { id: string }) =>
      api.post<VoiceNoteDTO>(`/voice-notes/${id}/generate-draft`, input),
    VOICE_GROUPS
  );
export const useUpdateVoiceDraft = () =>
  useApiMutation(
    ({
      id,
      ...input
    }: { id: string; rev?: number } & Record<
      string,
      string | number | undefined
    >) => api.patch<VoiceNoteDTO>(`/voice-notes/${id}/draft`, input),
    VOICE_GROUPS
  );
export const useAttachVoice = () =>
  useApiMutation(
    ({
      id,
      ...input
    }: {
      id: string;
      recordId: string;
      applyDraft: boolean;
      rev?: number;
    }) =>
      api.post<{ voice: VoiceNoteDTO; record: ServiceRecordDTO | null }>(
        `/voice-notes/${id}/attach`,
        input
      ),
    VOICE_GROUPS
  );

/* ───────────── Documents ───────────── */

export const useParticipantTree = (participantId: string | undefined) =>
  useQuery({
    queryKey: ["documents-tree", "participant", participantId],
    queryFn: () =>
      api.get<TreeNode>(`/participants/${participantId}/documents/tree`),
    enabled: Boolean(participantId),
  });
export const useOrganisationTree = (enabled = true) =>
  useQuery({
    queryKey: ["documents-tree", "organisation"],
    queryFn: () =>
      api.get<TreeNode>("/documents/tree", { scope: "organisation" }),
    enabled,
  });
export const useUploadDocuments = () =>
  useApiMutation(
    ({
      form,
      onProgress,
    }: {
      form: FormData;
      onProgress?: (percent: number) => void;
    }) => api.upload<DocumentDTO[]>("/documents", form, onProgress),
    ["documents"]
  );
export const useReplaceDocumentFile = () =>
  useApiMutation(
    ({
      id,
      form,
      onProgress,
    }: {
      id: string;
      form: FormData;
      onProgress?: (percent: number) => void;
    }) =>
      api.upload<DocumentDTO>(`/documents/${id}/file`, form, onProgress, "put"),
    ["documents"]
  );
export const useUpdateDocument = () =>
  useApiMutation(
    ({
      id,
      ...input
    }: {
      id: string;
      title?: string;
      notes?: string;
      folderKey?: string;
      docDate?: string | null;
    }) => api.patch<DocumentDTO>(`/documents/${id}`, input),
    ["documents"]
  );
export const useDeleteDocument = () =>
  useApiMutation((id: string) => api.delete(`/documents/${id}`), ["documents"]);

/* ───────────── Dashboard, reports, notifications, activity, search ───────────── */

export const useDashboard = () =>
  useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.get<DashboardDTO>("/dashboard"),
  });
export const useReports = (params: {
  period: string;
  from?: string;
  to?: string;
  team?: string;
}) =>
  useQuery({
    queryKey: ["reports", params],
    queryFn: () =>
      api.get<ReportsOverviewDTO>("/reports/overview", clean(params)),
    placeholderData: keepPreviousData,
  });
export const useNotifications = () =>
  useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.get<NotificationsDTO>("/notifications"),
    refetchInterval: 60_000,
  });
export const useMarkNotificationsRead = () =>
  useApiMutation(() => api.post<void>("/notifications/read"), []);
export const useActivity = (
  params: {
    limit?: number;
    participantId?: string;
    entityId?: string;
    includeAuth?: "true" | "false";
  } = {}
) =>
  useQuery({
    queryKey: ["activity", params],
    queryFn: () => api.get<Paginated<ActivityDTO>>("/activity", clean(params)),
  });
export const useSearch = (q: string) =>
  useQuery({
    queryKey: ["search", q],
    queryFn: () => api.get<SearchResultsDTO>("/search", { q }),
    enabled: q.trim().length >= 2,
    staleTime: 15_000,
  });

/* ───────────── Staff portal ───────────── */

export const usePortalHome = () =>
  useQuery({
    queryKey: ["portal-home"],
    queryFn: () => api.get<PortalHomeDTO>("/portal/home"),
    refetchInterval: 60_000,
  });

export const usePortalShifts = (params: { from?: string; to?: string } = {}) =>
  useQuery({
    queryKey: ["portal-shifts", params],
    queryFn: () => api.get<PortalShiftDTO[]>("/portal/shifts", clean(params)),
  });

export const usePortalShift = (id: string | undefined) =>
  useQuery({
    queryKey: ["portal-shift", id],
    queryFn: () => api.get<PortalShiftDTO>(`/portal/shifts/${id}`),
    enabled: Boolean(id),
  });

export const useTimesheet = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      shiftId,
      input,
    }: {
      shiftId: string;
      input: {
        action: "start" | "stop" | "save";
        breakMinutes?: number;
        kilometres?: number;
        notes?: string;
      };
    }) =>
      api.post<PortalShiftDTO>(`/portal/shifts/${shiftId}/timesheet`, input),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["portal-shift"] });
      void qc.invalidateQueries({ queryKey: ["portal-shifts"] });
      void qc.invalidateQueries({ queryKey: ["portal-home"] });
      void qc.invalidateQueries({ queryKey: ["tracking"] });
    },
  });
};

export const usePortalProfile = () =>
  useQuery({
    queryKey: ["portal-profile"],
    queryFn: () => api.get<StaffPortalProfileDTO>("/portal/profile"),
  });

export const useUpdateProfile = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      api.patch<StaffPortalProfileDTO>("/portal/profile", input),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["portal-profile"] });
      void qc.invalidateQueries({ queryKey: ["staff"] });
    },
  });
};

export const useUploadStaffDocument = () => {
  const qc = useQueryClient();
  return useMutation({
    // Workers upload their own documents; the office reviews and downloads them.
    mutationFn: ({ form }: { form: FormData }) =>
      api.upload<StaffDocumentDTO | StaffPortalProfileDTO>(
        "/portal/documents",
        form
      ),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["portal-profile"] });
      void qc.invalidateQueries({ queryKey: ["staff-compliance"] });
      void qc.invalidateQueries({ queryKey: ["staff"] });
      void qc.invalidateQueries({ queryKey: ["documents"] });
    },
  });
};

export const useDeleteStaffDocument = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/portal/documents/${id}`),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["portal-profile"] });
      void qc.invalidateQueries({ queryKey: ["staff"] });
    },
  });
};

/* Progress notes written by the worker. */
export const usePortalNotes = (
  params: Record<string, string | undefined> = {}
) =>
  useQuery({
    queryKey: ["portal-notes", params],
    queryFn: () => api.get<ServiceRecordDTO[]>("/portal/notes", clean(params)),
  });

export const useCreatePortalNote = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      api.post<ServiceRecordDTO>("/portal/notes", input),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["portal-notes"] });
      void qc.invalidateQueries({ queryKey: ["portal-home"] });
      void qc.invalidateQueries({ queryKey: ["records"] });
    },
  });
};

export const useUpdatePortalNote = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string } & Record<string, unknown>) =>
      api.patch<ServiceRecordDTO>(`/portal/notes/${id}`, input),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["portal-notes"] }),
  });
};

export const useSubmitPortalNote = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, rev }: { id: string; rev?: number }) =>
      api.post<ServiceRecordDTO>(`/portal/notes/${id}/submit`, { rev }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["portal-notes"] });
      void qc.invalidateQueries({ queryKey: ["portal-home"] });
    },
  });
};

/* Incident reports, ABC reports and the KM logbook. */
function usePortalReports<T>(kind: string, params: object = {}) {
  return useQuery({
    queryKey: ["portal-reports", kind, params],
    queryFn: () => api.get<T[]>(`/portal/${kind}`, clean(params)),
  });
}

export const usePortalIncidents = (params: { status?: string } = {}) =>
  usePortalReports<IncidentReportDTO>("incidents", params);

export const usePortalAbc = (params: { status?: string } = {}) =>
  usePortalReports<AbcReportDTO>("abc", params);

export const usePortalLogbook = (params: { from?: string; to?: string } = {}) =>
  usePortalReports<LogbookEntryDTO>("logbook", params);

function usePortalReportMutations(kind: string) {
  const qc = useQueryClient();
  const settle = () => {
    void qc.invalidateQueries({ queryKey: ["portal-reports", kind] });
    void qc.invalidateQueries({ queryKey: ["portal-home"] });
  };
  return {
    create: useMutation({
      mutationFn: (input: Record<string, unknown>) =>
        api.post(`/portal/${kind}`, input),
      onSettled: settle,
    }),
    update: useMutation({
      mutationFn: ({
        id,
        ...input
      }: { id: string } & Record<string, unknown>) =>
        api.patch(`/portal/${kind}/${id}`, input),
      onSettled: settle,
    }),
    status: useMutation({
      mutationFn: ({
        id,
        ...input
      }: {
        id: string;
        status: string;
        note?: string;
        rev?: number;
      }) => api.post(`/portal/${kind}/${id}/status`, input),
      onSettled: settle,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.delete(`/portal/${kind}/${id}`),
      onSettled: settle,
    }),
  };
}

export const useIncidentMutations = () => usePortalReportMutations("incidents");
export const useAbcMutations = () => usePortalReportMutations("abc");
export const useLogbookMutations = () => usePortalReportMutations("logbook");

/* ───────────── Live job tracking ───────────── */

export const useActiveTracking = () =>
  useQuery({
    queryKey: ["tracking", "active"],
    queryFn: () =>
      api.get<{ active: TrackingSessionDTO | null }>("/portal/tracking/active"),
    refetchInterval: 30_000,
  });

export const useStartTracking = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      shiftId?: string;
      location?: { lat: number; lng: number };
      accuracy?: number | null;
    }) => api.post<TrackingSessionDTO>("/portal/tracking/start", input),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["tracking"] }),
  });
};

export const useStopTracking = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...input
    }: {
      id: string;
      location?: { lat: number; lng: number };
      notes?: string;
    }) => api.post<TrackingSessionDTO>(`/portal/tracking/${id}/stop`, input),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["tracking"] });
      void qc.invalidateQueries({ queryKey: ["portal-shift"] });
      void qc.invalidateQueries({ queryKey: ["portal-home"] });
      void qc.invalidateQueries({ queryKey: ["portal-reports", "logbook"] });
    },
  });
};

/** Sends a batch of fixes; returns the server's accepted state and the next interval. */
export const sendTrackingPings = (
  id: string,
  pings: Array<{
    lat: number;
    lng: number;
    accuracy?: number | null;
    speedKph?: number | null;
    at?: string;
  }>
) =>
  api.post<TrackingSessionDTO & { nextIntervalSec: number }>(
    `/portal/tracking/${id}/pings`,
    { pings }
  );

/** The back-office dashboard: what is happening right now. */
export const useLiveTracking = (enabled = true) =>
  useQuery({
    queryKey: ["tracking", "live"],
    queryFn: () => api.get<LiveTrackingDTO>("/tracking/live"),
    refetchInterval: 10_000,
    staleTime: 5_000,
    enabled,
  });

/* ───────────── Staff directory: access & applications ───────────── */

export const useStaffApplications = (status = "all") =>
  useQuery({
    queryKey: ["staff-applications", status],
    queryFn: () =>
      api.get<StaffApplicationDTO[]>("/staff/applications", { status }),
    refetchInterval: 60_000,
  });

export const useReviewApplication = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...input
    }: {
      id: string;
      decision: "Approved" | "Rejected";
      note?: string;
      position?: string;
      team?: string;
      grantAccess?: boolean;
    }) =>
      api.post<{
        application: StaffApplicationDTO;
        staff: StaffDTO | null;
        invite: { email: string; link: string; emailed: boolean } | null;
      }>(`/staff/applications/${id}/review`, input),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["staff-applications"] });
      void qc.invalidateQueries({ queryKey: ["staff"] });
      void qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
};

export const useInviteStaff = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, resend = true }: { id: string; resend?: boolean }) =>
      api.post<{
        invite: { email: string; link: string; emailed: boolean };
      }>(`/staff/${id}/invite`, { resend }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["staff"] });
      void qc.invalidateQueries({ queryKey: ["staff-compliance"] });
    },
  });
};

export const useRevokeStaffAccess = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<StaffDTO>(`/staff/${id}/revoke-access`),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["staff"] });
      void qc.invalidateQueries({ queryKey: ["staff-compliance"] });
    },
  });
};

export const useStaffCompliance = (id: string | undefined) =>
  useQuery({
    queryKey: ["staff-compliance", id],
    queryFn: () => api.get<StaffComplianceDTO>(`/staff/${id}/compliance`),
    enabled: Boolean(id),
  });

export const useReviewChecklistItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      key,
      ...input
    }: {
      id: string;
      key: string;
      status: string;
      note?: string;
    }) =>
      api.patch<StaffChecklistItemDTO[]>(
        `/staff/${id}/checklist/${encodeURIComponent(key)}`,
        input
      ),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["staff-compliance"] });
      void qc.invalidateQueries({ queryKey: ["staff"] });
    },
  });
};

/* ───────────── Back office: worker reports awaiting review ───────────── */

/** Incidents, ABC reports and logbook entries submitted by workers, across the team. */
export const useAdminIncidents = () =>
  useQuery({
    queryKey: ["admin-reports", "incidents"],
    queryFn: () => api.get<IncidentReportDTO[]>("/incidents"),
  });

export const useAdminAbc = () =>
  useQuery({
    queryKey: ["admin-reports", "abc"],
    queryFn: () => api.get<AbcReportDTO[]>("/abc-reports"),
  });

export const useAdminLogbook = () =>
  useQuery({
    queryKey: ["admin-reports", "logbook"],
    queryFn: () => api.get<LogbookEntryDTO[]>("/logbook"),
  });

/** Moves a worker's report along: Submitted → Reviewed → Closed. */
export const useReviewReport = (kind: "incidents" | "abc-reports") => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...input
    }: {
      id: string;
      status: string;
      note?: string;
      rev?: number;
    }) => api.post(`/${kind}/${id}/status`, input),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["admin-reports"] });
      void qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
};

/* ───────────── Invoice share links ───────────── */

/** Turns the public link on or off. Off revokes every copy already sent. */
export const useInvoiceShare = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.post<InvoiceDTO>(`/invoices/${id}/share`, { enabled }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["invoice"] });
      void qc.invalidateQueries({ queryKey: ["invoices"] });
    },
  });
};

/** The invoice behind a share link. No session: the token in the URL is the credential. */
export const usePublicInvoice = (token: string | undefined) =>
  useQuery({
    queryKey: ["public-invoice", token],
    queryFn: () => api.get<PublicInvoiceDTO>(`/public/invoices/${token}`),
    enabled: Boolean(token),
    retry: false,
  });

/* ───────────── Xero ───────────── */

export const useXeroStatus = () =>
  useQuery({
    queryKey: ["xero-status"],
    queryFn: () => api.get<XeroStatusDTO>("/integrations/xero/status"),
  });
/** The organisation's own accounts and tax rates, for the mapping choices. Only asked for once connected. */
export const useXeroOptions = (enabled: boolean) =>
  useQuery({
    queryKey: ["xero-options"],
    queryFn: () => api.get<XeroOptionsDTO>("/integrations/xero/options"),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
/** Returns the Xero sign-in address; the page then sends the browser there. */
export const useXeroConnect = () =>
  useMutation({
    mutationFn: () =>
      api.post<{ url: string }>("/integrations/xero/connect", {}),
  });
export const useXeroDisconnect = () =>
  useApiMutation(
    (_: void) => api.post<XeroStatusDTO>("/integrations/xero/disconnect", {}),
    ["xero", "settings", "invoices"]
  );
export const useXeroSaveSettings = () =>
  useApiMutation(
    (input: XeroSettingsInput) =>
      api.put<XeroStatusDTO>("/integrations/xero/settings", input),
    ["xero"]
  );
/** Runs the payment check now instead of waiting for the 15-minute timer. */
export const useXeroCheckNow = () =>
  useApiMutation(
    (_: void) => api.post<XeroStatusDTO>("/integrations/xero/sync", {}),
    ["xero", "invoices"]
  );
/** "Send to Xero" and Retry on an invoice. */
export const useXeroSyncInvoice = () =>
  useApiMutation(
    (id: string) =>
      api.post<{ queued: boolean }>(
        `/integrations/xero/invoices/${id}/sync`,
        {}
      ),
    ["invoices"]
  );

/* ───────────── Users & access ───────────── */

/** Everyone with a back-office account, requests first. Admin only. */
export const useAccessUsers = () =>
  useQuery({
    queryKey: ["access-users"],
    queryFn: () => api.get<AccessUserDTO[]>("/users"),
  });
export const useApproveUser = () =>
  useApiMutation(
    ({
      id,
      ...body
    }: {
      id: string;
      role: OfficeRole;
      modules: AccessModule[];
    }) => api.post<AccessUserDTO>(`/users/${id}/approve`, body),
    ["access"]
  );
export const useDeclineUser = () =>
  useApiMutation(
    ({ id, note }: { id: string; note?: string }) =>
      api.post<AccessUserDTO>(`/users/${id}/decline`, { note }),
    ["access"]
  );
export const useUpdateUserAccess = () =>
  useApiMutation(
    ({
      id,
      ...body
    }: {
      id: string;
      role?: OfficeRole;
      modules?: AccessModule[];
      status?: "active" | "disabled";
    }) => api.patch<AccessUserDTO>(`/users/${id}`, body),
    ["access"]
  );

/* ───────────── Notes & my day ───────────── */

export const useNotes = (params: {
  q?: string;
  label?: string;
  archived?: boolean;
}) =>
  useQuery({
    queryKey: ["notes", params],
    queryFn: () =>
      api.get<NoteSummaryDTO[]>(
        "/notes",
        clean({
          q: params.q,
          label: params.label,
          archived: params.archived ? "true" : undefined,
        })
      ),
    placeholderData: keepPreviousData,
  });
export const useNoteLabels = () =>
  useQuery({
    queryKey: ["note-labels"],
    queryFn: () => api.get<NoteLabelDTO[]>("/notes/labels"),
  });
/** One note for the editor. The editor owns the text while it is open, so it is not refetched under it. */
export const useNote = (id: string | undefined) =>
  useQuery({
    queryKey: ["note", id],
    queryFn: () => api.get<NoteDTO>(`/notes/${id}`),
    enabled: Boolean(id),
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
export const useCreateNote = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<NoteDTO>("/notes", {}),
    onSuccess: note => qc.setQueryData(["note", note.id], note),
  });
};
export interface NotePatch {
  id: string;
  title?: string;
  content?: Record<string, unknown>;
  labels?: string[];
  pinned?: boolean;
  archived?: boolean;
  rev?: number;
}
/**
 * Autosave and the pin / archive buttons. Plain edits patch the cached list in place (no refetch per
 * keystroke); anything that changes which list a note belongs to refetches the lists and labels.
 */
export const useUpdateNote = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: NotePatch) =>
      api.patch<NoteDTO>(`/notes/${id}`, body),
    onSuccess: (saved, vars) => {
      qc.setQueryData(["note", saved.id], saved);
      const lists = qc.getQueriesData<NoteSummaryDTO[]>({ queryKey: ["notes"] });
      const unseen = lists.some(
        ([key, data]) =>
          !(key[1] as { q?: string; label?: string; archived?: boolean }).q &&
          !(key[1] as { label?: string }).label &&
          !(key[1] as { archived?: boolean }).archived &&
          data &&
          !data.some(note => note.id === saved.id)
      );
      const moved =
        vars.pinned !== undefined ||
        vars.archived !== undefined ||
        vars.labels !== undefined;
      if (moved || unseen) {
        void qc.invalidateQueries({ queryKey: ["notes"] });
        void qc.invalidateQueries({ queryKey: ["note-labels"] });
        return;
      }
      qc.setQueriesData<NoteSummaryDTO[]>({ queryKey: ["notes"] }, old =>
        old?.map(note =>
          note.id === saved.id
            ? {
                ...note,
                title: saved.title,
                snippet: saved.snippet,
                imageCount: saved.imageCount,
                updatedAt: saved.updatedAt,
              }
            : note
        )
      );
    },
  });
};
export const useDeleteNote = () =>
  useApiMutation((id: string) => api.delete(`/notes/${id}`), ["notes"]);

/** The signed-in person's own roster for a day (YYYY-MM-DD). */
export const useMyDay = (date: string | undefined) =>
  useQuery({
    queryKey: ["my-day", date],
    queryFn: () => api.get<MyDayDTO>("/me/day", clean({ date })),
    enabled: Boolean(date),
  });

/* ───────────── E-signatures ───────────── */

export const useSignatures = (params: { status?: string; q?: string } = {}) =>
  useQuery({
    queryKey: ["signatures", params],
    queryFn: () => api.get<SignatureListDTO>("/signatures", clean(params)),
    placeholderData: keepPreviousData,
  });
export const useSignature = (id: string | undefined) =>
  useQuery({
    queryKey: ["signature", id],
    queryFn: () => api.get<SignatureRequestDTO>(`/signatures/${id}`),
    enabled: Boolean(id),
    // While it is out for signature, look again now and then so progress shows up by itself.
    refetchInterval: query =>
      query.state.data?.status === "sent" ? 15_000 : false,
  });
export const useCreateSignature = () =>
  useApiMutation(
    ({
      form,
      onProgress,
    }: {
      form: FormData;
      onProgress?: (percent: number) => void;
    }) => api.upload<SignatureRequestDTO>("/signatures", form, onProgress),
    ["signatures"]
  );
export const useSaveSignatureDraft = () =>
  useApiMutation(
    ({ id, ...input }: { id: string } & SignatureDraftInput) =>
      api.patch<SignatureRequestDTO>(`/signatures/${id}`, input),
    ["signatures"]
  );
export const useSendSignature = () =>
  useApiMutation(
    ({ id, ...input }: { id: string } & SignatureSendInput) =>
      api.post<SignatureSendResultDTO>(`/signatures/${id}/send`, input),
    ["signatures"]
  );
export const useRemindSigner = () =>
  useApiMutation(
    ({ id, signerId }: { id: string; signerId: string }) =>
      api.post<SignatureReminderResultDTO>(
        `/signatures/${id}/signers/${signerId}/remind`
      ),
    ["signatures"]
  );
export const useResetSignerLink = () =>
  useApiMutation(
    ({ id, signerId }: { id: string; signerId: string }) =>
      api.post<SignatureRequestDTO>(
        `/signatures/${id}/signers/${signerId}/new-link`
      ),
    ["signatures"]
  );
export const useExtendSignature = () =>
  useApiMutation(
    ({ id, days }: { id: string; days: number }) =>
      api.post<SignatureRequestDTO>(`/signatures/${id}/extend`, { days }),
    ["signatures"]
  );
export const useCancelSignature = () =>
  useApiMutation(
    ({ id, reason }: { id: string; reason?: string }) =>
      api.post<SignatureRequestDTO>(`/signatures/${id}/cancel`, { reason }),
    ["signatures"]
  );
export const useSealSignature = () =>
  useApiMutation(
    ({ id }: { id: string }) =>
      api.post<SignatureRequestDTO>(`/signatures/${id}/seal`),
    ["signatures", "documents"]
  );
export const useDeleteSignature = () =>
  useApiMutation(
    ({ id }: { id: string }) => api.delete(`/signatures/${id}`),
    ["signatures"]
  );

/** The document behind a signing link. No session: the token in the URL is the credential. */
export const usePublicSigning = (token: string | undefined) =>
  useQuery({
    queryKey: ["public-signing", token],
    queryFn: () => api.get<PublicSigningDTO>(`/public/sign/${token}`),
    enabled: Boolean(token),
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
export const useSubmitSigning = (token: string | undefined) =>
  useMutation({
    mutationFn: (input: SignSubmitInput) =>
      api.post<PublicSigningResultDTO>(`/public/sign/${token}/submit`, input),
  });
export const useDeclineSigning = (token: string | undefined) =>
  useMutation({
    mutationFn: (input: { reason?: string }) =>
      api.post<PublicSigningResultDTO>(`/public/sign/${token}/decline`, input),
  });

/* ───────────── Availability & leave ───────────── */

export const useStaffAvailability = (staffId: string | undefined) =>
  useQuery({
    queryKey: ["staff-availability", staffId],
    queryFn: () => api.get<AvailabilityDTO>(`/staff/${staffId}/availability`),
    enabled: Boolean(staffId),
  });
export const useSetStaffAvailability = () =>
  useApiMutation(
    ({ staffId, ...input }: AvailabilityInput & { staffId: string }) =>
      api.put<AvailabilityDTO>(`/staff/${staffId}/availability`, input),
    ["leave", "shifts"]
  );
/** Time-off requests across the team, the ones waiting for a decision first. */
export const useLeave = (params: { status?: string; staffId?: string } = {}) =>
  useQuery({
    queryKey: ["leave", params],
    queryFn: () => api.get<LeaveRequestDTO[]>("/staff/leave", clean(params)),
    placeholderData: keepPreviousData,
  });
export const useRecordLeave = () =>
  useApiMutation(
    (input: OfficeLeaveCreateInput) =>
      api.post<LeaveRequestDTO>("/staff/leave", input),
    ["leave", "shifts"]
  );
export const useDecideLeave = () =>
  useApiMutation(
    ({ id, ...input }: LeaveDecisionInput & { id: string }) =>
      api.post<LeaveRequestDTO>(`/staff/leave/${id}/decision`, input),
    ["leave", "shifts"]
  );
export const useCancelLeave = () =>
  useApiMutation(
    (id: string) => api.post<LeaveRequestDTO>(`/staff/leave/${id}/cancel`),
    ["leave", "shifts"]
  );

/* The same things from the worker's side of the portal. */
const usePortalMutation = <TVars, TResult>(
  mutationFn: (vars: TVars) => Promise<TResult>,
  keys: string[]
) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () => {
      for (const key of keys)
        void qc.invalidateQueries({ queryKey: [key] });
    },
  });
};
export const usePortalAvailability = () =>
  useQuery({
    queryKey: ["portal-availability"],
    queryFn: () => api.get<AvailabilityDTO>("/portal/availability"),
  });
export const useSetPortalAvailability = () =>
  usePortalMutation(
    (input: AvailabilityInput) =>
      api.put<AvailabilityDTO>("/portal/availability", input),
    ["portal-availability"]
  );
export const usePortalLeave = () =>
  useQuery({
    queryKey: ["portal-leave"],
    queryFn: () => api.get<LeaveRequestDTO[]>("/portal/leave"),
  });
export const useRequestLeave = () =>
  usePortalMutation(
    (input: LeaveCreateInput) =>
      api.post<LeaveRequestDTO>("/portal/leave", input),
    ["portal-leave"]
  );
export const useWithdrawLeave = () =>
  usePortalMutation(
    (id: string) => api.post<LeaveRequestDTO>(`/portal/leave/${id}/cancel`),
    ["portal-leave"]
  );
/** The worker's own hours for a pay period, and where each timesheet stands. */
export const usePortalTimesheets = (date?: string) =>
  useQuery({
    queryKey: ["portal-timesheets", date ?? "current"],
    queryFn: () =>
      api.get<TimesheetListDTO>("/portal/timesheets", clean({ date })),
    placeholderData: keepPreviousData,
  });

/* ───────────── Timesheets & pay ───────────── */

export const usePaySettings = () =>
  useQuery({
    queryKey: ["pay-settings"],
    queryFn: () => api.get<PaySettingsDTO>("/payroll/settings"),
  });
export const useUpdatePaySettings = () =>
  useApiMutation(
    (input: PaySettingsInput) =>
      api.put<PaySettingsDTO>("/payroll/settings", input),
    ["payroll", "staff", "shifts"]
  );
/** Classification names without rates: all the Staff page is allowed to know. */
export const usePayClassifications = () =>
  useQuery({
    queryKey: ["pay-classifications"],
    queryFn: () =>
      api.get<PayClassificationOptionDTO[]>("/payroll/classifications"),
    staleTime: 60_000,
  });
export const useStaffPay = () =>
  useQuery({
    queryKey: ["staff-pay"],
    queryFn: () => api.get<StaffPayDTO[]>("/payroll/staff"),
  });
export const useSetPayRate = () =>
  useApiMutation(
    ({
      staffId,
      payRateOverride,
    }: {
      staffId: string;
      payRateOverride: number | null;
    }) =>
      api.put<StaffPayDTO>(`/payroll/staff/${staffId}/rate`, {
        payRateOverride,
      }),
    ["payroll"]
  );

export const useTimesheets = (params: {
  date?: string;
  staffId?: string;
  cancelled?: boolean;
}) =>
  useQuery({
    queryKey: ["timesheets", params],
    queryFn: () =>
      api.get<TimesheetListDTO>(
        "/payroll/timesheets",
        clean({
          date: params.date,
          staffId: params.staffId,
          cancelled: params.cancelled ? "true" : undefined,
        })
      ),
    placeholderData: keepPreviousData,
  });
export const useTimesheetDetail = (
  key: { shiftId: string; staffId: string } | null
) =>
  useQuery({
    queryKey: ["timesheet", key?.shiftId, key?.staffId],
    queryFn: () =>
      api.get<TimesheetDetailDTO>(
        `/payroll/timesheets/${key!.shiftId}/${key!.staffId}`
      ),
    enabled: Boolean(key),
  });
export const useApproveTimesheet = () =>
  useApiMutation(
    ({
      shiftId,
      staffId,
      ...input
    }: TimesheetApproveInput & { shiftId: string; staffId: string }) =>
      api.post<TimesheetDetailDTO>(
        `/payroll/timesheets/${shiftId}/${staffId}/approve`,
        input
      ),
    ["payroll", "shifts"]
  );
export const useUnapproveTimesheet = () =>
  useApiMutation(
    ({ shiftId, staffId }: { shiftId: string; staffId: string }) =>
      api.post<TimesheetDetailDTO>(
        `/payroll/timesheets/${shiftId}/${staffId}/unapprove`
      ),
    ["payroll"]
  );
/** Approves every signed-off timesheet in the period that matches the roster. */
export const useApproveCleanTimesheets = () =>
  useApiMutation(
    (input: { date?: string; staffId?: string }) =>
      api.post<{ approved: number; left: number }>(
        "/payroll/timesheets/approve-clean",
        clean(input)
      ),
    ["payroll", "shifts"]
  );

export const usePayRuns = () =>
  useQuery({
    queryKey: ["pay-runs"],
    queryFn: () => api.get<PayRunSummaryDTO[]>("/payroll/pay-runs"),
  });
export const usePayRun = (id: string | undefined) =>
  useQuery({
    queryKey: ["pay-run", id],
    queryFn: () => api.get<PayRunDTO>(`/payroll/pay-runs/${id}`),
    enabled: Boolean(id),
  });
export const useCreatePayRun = () =>
  useApiMutation(
    (input: { date?: string }) =>
      api.post<PayRunDTO>("/payroll/pay-runs", clean(input)),
    ["payroll"]
  );
export const usePayRunAction = () =>
  useApiMutation(
    ({
      id,
      action,
      rev,
    }: {
      id: string;
      action: "finalise" | "reopen";
      rev?: number;
    }) => api.post<PayRunDTO>(`/payroll/pay-runs/${id}/${action}`, { rev }),
    ["payroll", "leave"]
  );
export const useDeletePayRun = () =>
  useApiMutation(
    (id: string) => api.delete(`/payroll/pay-runs/${id}`),
    ["payroll"]
  );
export const useAddPayAdjustment = () =>
  useApiMutation(
    ({ id, ...input }: PayAdjustmentInput & { id: string }) =>
      api.post<PayRunDTO>(`/payroll/pay-runs/${id}/adjustments`, input),
    ["payroll"]
  );
export const useRemovePayAdjustment = () =>
  useApiMutation(
    ({ id, adjustmentId }: { id: string; adjustmentId: string }) =>
      api.delete<PayRunDTO>(
        `/payroll/pay-runs/${id}/adjustments/${adjustmentId}`
      ),
    ["payroll"]
  );

/* ───────────── Complaints & feedback ───────────── */

export const useFeedback = (
  params: { status?: string; kind?: string; q?: string } = {}
) =>
  useQuery({
    queryKey: ["feedback", params],
    queryFn: () => api.get<FeedbackListDTO>("/feedback", clean(params)),
    placeholderData: keepPreviousData,
  });
export const useFeedbackCase = (id: string | undefined) =>
  useQuery({
    queryKey: ["feedback-case", id],
    queryFn: () => api.get<FeedbackCaseDTO>(`/feedback/${id}`),
    enabled: Boolean(id),
  });
/** The people, clients and incidents a case can be linked to. */
export const useFeedbackOptions = (enabled = true) =>
  useQuery({
    queryKey: ["feedback-options"],
    queryFn: () => api.get<FeedbackOptionsDTO>("/feedback/options"),
    enabled,
    staleTime: 60_000,
  });
export const useCreateFeedback = () =>
  useApiMutation(
    (input: FeedbackCreateInput) =>
      api.post<FeedbackCaseDTO>("/feedback", input),
    ["feedback"]
  );
export const useUpdateFeedback = () =>
  useApiMutation(
    ({ id, ...input }: FeedbackUpdateInput & { id: string }) =>
      api.patch<FeedbackCaseDTO>(`/feedback/${id}`, input),
    ["feedback"]
  );
export const useFeedbackStatus = () =>
  useApiMutation(
    ({ id, ...input }: FeedbackStatusInput & { id: string }) =>
      api.post<FeedbackCaseDTO>(`/feedback/${id}/status`, input),
    ["feedback"]
  );
export const useFeedbackNote = () =>
  useApiMutation(
    ({ id, note }: { id: string; note: string }) =>
      api.post<FeedbackCaseDTO>(`/feedback/${id}/notes`, { note }),
    ["feedback"]
  );
export const useAddFeedbackAction = () =>
  useApiMutation(
    ({ id, ...input }: FeedbackActionInput & { id: string }) =>
      api.post<FeedbackCaseDTO>(`/feedback/${id}/actions`, input),
    ["feedback"]
  );
export const useUpdateFeedbackAction = () =>
  useApiMutation(
    ({
      id,
      actionId,
      ...input
    }: {
      id: string;
      actionId: string;
      done?: boolean;
    }) =>
      api.patch<FeedbackCaseDTO>(
        `/feedback/${id}/actions/${actionId}`,
        input
      ),
    ["feedback"]
  );
export const useRemoveFeedbackAction = () =>
  useApiMutation(
    ({ id, actionId }: { id: string; actionId: string }) =>
      api.delete<FeedbackCaseDTO>(`/feedback/${id}/actions/${actionId}`),
    ["feedback"]
  );
/** Turns the public feedback form on or off, or issues a new link. */
export const useFeedbackForm = () =>
  useApiMutation(
    (input: { enabled: boolean; regenerate?: boolean }) =>
      api.put<FeedbackFormDTO>("/feedback/form", input),
    ["feedback"]
  );

/** The public feedback form behind a link. No session. */
export const usePublicFeedbackForm = (token: string | undefined) =>
  useQuery({
    queryKey: ["public-feedback", token],
    queryFn: () =>
      api.get<PublicFeedbackFormDTO>(`/public/feedback/${token}`),
    enabled: Boolean(token),
    retry: false,
    refetchOnWindowFocus: false,
  });
export const useSubmitPublicFeedback = (token: string | undefined) =>
  useMutation({
    mutationFn: (input: PublicFeedbackInput) =>
      api.post<PublicFeedbackResultDTO>(`/public/feedback/${token}`, input),
  });

/** Marks an incident as reportable to the NDIS Commission and records what has been lodged. */
export const useIncidentReportable = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: IncidentReportableInput & { id: string }) =>
      api.post<IncidentReportDTO>(`/incidents/${id}/reportable`, input),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["admin-reports"] });
      void qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
};

/* ───────────── Messages ───────────── */

/*
 * Messages are polled: a short interval while a conversation is open, a longer one for the
 * list and the unread badge. Nothing is refetched in a background tab.
 */
export const useConversations = (enabled = true) =>
  useQuery({
    queryKey: ["conversations"],
    queryFn: () => api.get<ConversationListDTO>("/messages"),
    enabled,
    refetchInterval: MESSAGE_POLL_MS.list,
  });
/** How many conversations have something new, for the badge beside "Messages". */
export const useUnreadMessages = () =>
  useQuery({
    queryKey: ["messages-unread"],
    queryFn: () => api.get<{ unread: number }>("/messages/unread"),
    refetchInterval: MESSAGE_POLL_MS.list,
    staleTime: 10_000,
  });
export const useMessageOptions = (enabled = true) =>
  useQuery({
    queryKey: ["message-options"],
    queryFn: () => api.get<MessageOptionsDTO>("/messages/options"),
    enabled,
    staleTime: 60_000,
  });
export const useConversation = (id: string | undefined) =>
  useQuery({
    queryKey: ["conversation", id],
    queryFn: () => api.get<ConversationDTO>(`/messages/${id}`),
    enabled: Boolean(id),
    refetchInterval: MESSAGE_POLL_MS.thread,
    retry: false,
  });
const refreshMessages = (qc: QueryClient) => {
  void qc.invalidateQueries({ queryKey: ["conversations"] });
  void qc.invalidateQueries({ queryKey: ["messages-unread"] });
  void qc.invalidateQueries({ queryKey: ["notifications"] });
};
export const useStartConversation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ConversationCreateInput) =>
      api.post<ConversationDTO>("/messages", input),
    onSuccess: conversation =>
      qc.setQueryData(["conversation", conversation.id], conversation),
    onSettled: () => refreshMessages(qc),
  });
};
export const useSendMessage = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) =>
      api.post<MessageDTO>(`/messages/${id}/messages`, { body }),
    // Show it straight away; the next poll brings the settled thread.
    onSuccess: message =>
      qc.setQueryData<ConversationDTO>(
        ["conversation", message.conversationId],
        old =>
          old && !old.messages.some(item => item.id === message.id)
            ? { ...old, messages: [...old.messages, message] }
            : old
      ),
    onSettled: (_data, _error, vars) => {
      void qc.invalidateQueries({ queryKey: ["conversation", vars.id] });
      refreshMessages(qc);
    },
  });
};
export const useMarkConversationRead = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<void>(`/messages/${id}/read`),
    onSettled: () => refreshMessages(qc),
  });
};
