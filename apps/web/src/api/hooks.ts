import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type {
  AbcReportDTO,
  ActivityDTO,
  AuthSessionDTO,
  BootstrapDTO,
  BudgetAdjustmentDTO,
  BudgetResponseDTO,
  DashboardDTO,
  DocumentDTO,
  IncidentReportDTO,
  InvoiceDTO,
  InvoiceSummaryDTO,
  LiveTrackingDTO,
  LogbookEntryDTO,
  MetaDTO,
  NotificationsDTO,
  Paginated,
  ParticipantDTO,
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
  StaffApplicationDTO,
  StaffChecklistItemDTO,
  StaffComplianceDTO,
  StaffDTO,
  StaffDocumentDTO,
  StaffPortalProfileDTO,
  TrackingSessionDTO,
  TreeNode,
  VoiceNoteDTO,
  VoiceSummaryDTO,
  WithWarnings,
  WorkspaceDTO,
} from "@shared/dto";
import type {
  BudgetAdjustInput,
  BudgetSetupInput,
  GenerateDraftInput,
  InvoiceCreateInput,
  ParticipantCreateInput,
  ParticipantUpdateInput,
  PreferencesPatchInput,
  RecordCreateInput,
  RecordUpdateInput,
  ServiceCreateInput,
  ServiceUpdateInput,
  ShiftCreateInput,
  ShiftUpdateInput,
  StaffCreateInput,
  StaffUpdateInput,
  WorkspacePatchInput,
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
    ["staff", "shifts"]
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
