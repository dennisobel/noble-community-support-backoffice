import {
  ChevronRight,
  FileAudio2,
  Info,
  Mic,
  Settings,
  Volume2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { DETAIL_LEVELS, NOTE_TEMPLATES } from "@shared/enums";
import type { PreferencesDTO } from "@shared/dto";
import { errorMessage } from "@/api/client";
import {
  useMeta,
  useParticipants,
  usePreferences,
  useUpdatePreferences,
  useVoiceNotes,
  useVoiceSummary,
} from "@/api/hooks";
import {
  Btn,
  Drawer,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  Panel,
  SectionHeading,
  Status,
} from "@/components/app/ui";
import { timeAgo } from "@/lib/format";
import { useNotify } from "@/lib/notify";

function VoiceSettingsDrawer({ onClose }: { onClose: () => void }) {
  const notify = useNotify();
  const preferences = usePreferences();
  const update = useUpdatePreferences();
  const meta = useMeta();
  const [voice, setVoice] = useState<PreferencesDTO["voice"] | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [micStatus, setMicStatus] = useState("");

  useEffect(() => {
    if (preferences.data && !voice) setVoice(preferences.data.voice);
  }, [preferences.data, voice]);
  useEffect(() => {
    navigator.mediaDevices
      ?.enumerateDevices?.()
      .then(list =>
        setDevices(list.filter(device => device.kind === "audioinput"))
      )
      .catch(() => undefined);
  }, [micStatus]);

  const testMicrophone = async () => {
    setMicStatus("Checking…");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      setMicStatus("Microphone is available and permission is granted.");
    } catch (failure) {
      const name = (failure as DOMException)?.name;
      setMicStatus(
        name === "NotAllowedError"
          ? "Microphone permission was blocked. Allow it in the browser's site settings."
          : "No microphone was found on this device."
      );
    }
  };
  const save = async () => {
    if (!voice) return;
    try {
      await update.mutateAsync({ voice });
      notify("Voice preferences saved.");
      onClose();
    } catch (failure) {
      notify(errorMessage(failure), "error");
    }
  };

  return (
    <Drawer
      onClose={onClose}
      eyebrow="Voice workspace"
      title="Voice settings"
      subtitle="Draft preferences are saved to your account; microphone checks run on this device."
      footer={
        <div className="flex justify-end gap-2">
          <Btn variant="secondary" onClick={onClose}>
            Cancel
          </Btn>
          <Btn
            onClick={() => void save()}
            loading={update.isPending}
            disabled={!voice}
          >
            Save preferences
          </Btn>
        </div>
      }
    >
      {!voice ? (
        <LoadingBlock />
      ) : (
        <div className="space-y-5">
          <Panel title="Note generation">
            <div className="space-y-4 p-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="label">
                  Default template
                  <select
                    className="select mt-1"
                    value={voice.generationTemplate}
                    onChange={event =>
                      setVoice({
                        ...voice,
                        generationTemplate: event.target
                          .value as typeof voice.generationTemplate,
                      })
                    }
                  >
                    {NOTE_TEMPLATES.map(item => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </label>
                <label className="label">
                  Detail level
                  <select
                    className="select mt-1"
                    value={voice.detailLevel}
                    onChange={event =>
                      setVoice({
                        ...voice,
                        detailLevel: event.target
                          .value as typeof voice.detailLevel,
                      })
                    }
                  >
                    {DETAIL_LEVELS.map(item => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </label>
              </div>
              {(
                [
                  [
                    "useTranscriptOnly",
                    "Use transcript only by default",
                    "Drafts use only what is in the transcript; participant goals are ignored.",
                  ],
                  [
                    "notifyDraftReady",
                    "Notify me when a draft is ready",
                    "Shows a notification in the bell when a generated draft is waiting.",
                  ],
                  [
                    "autoSaveRecordings",
                    "Keep recordings after saving",
                    "Recordings stay in the inbox until you archive or delete them.",
                  ],
                ] as const
              ).map(([key, title, description]) => (
                <label
                  key={key}
                  className="flex items-start justify-between gap-4 border-t border-[#edf0ef] pt-4"
                >
                  <span>
                    <b className="block text-xs text-[#465b65]">{title}</b>
                    <small className="mt-1 block text-[10px] text-[#839097]">
                      {description}
                    </small>
                  </span>
                  <input
                    type="checkbox"
                    checked={voice[key]}
                    onChange={event =>
                      setVoice({ ...voice, [key]: event.target.checked })
                    }
                    className="mt-1 h-4 w-4 accent-[#147f79]"
                    aria-label={title}
                  />
                </label>
              ))}
            </div>
          </Panel>
          <Panel title="This device">
            <div className="space-y-3 p-5 text-xs text-[#5c6e76]">
              <div>
                <div className="label">Microphones</div>
                {devices.length ? (
                  <ul className="space-y-1">
                    {devices.map((device, index) => (
                      <li key={device.deviceId || index}>
                        {device.label || `Microphone ${index + 1}`}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[11px] text-[#87949a]">
                    Microphone names appear after permission is granted.
                  </p>
                )}
              </div>
              <Btn variant="secondary" onClick={() => void testMicrophone()}>
                <Volume2 size={14} />
                Test microphone
              </Btn>
              {micStatus && <p className="text-[11px]">{micStatus}</p>}
            </div>
          </Panel>
          <Panel title="Providers">
            <div className="space-y-2 p-5 text-xs text-[#63757d]">
              <p>
                <b>Transcription:</b>{" "}
                {meta.data?.features.sttProvider === "mock"
                  ? "demo provider (sample text)"
                  : "speech-to-text service configured on the server"}
              </p>
              <p>
                <b>Note drafts:</b>{" "}
                {meta.data?.features.noteProvider === "mock"
                  ? "demo provider (template text)"
                  : "Claude, configured on the server"}
              </p>
              <p className="text-[11px] text-[#87949a]">
                Only the transcript and the participant's first name and goals
                are sent for drafting — never NDIS numbers, dates of birth or
                contact details.
              </p>
            </div>
          </Panel>
        </div>
      )}
    </Drawer>
  );
}

export default function VoiceInboxPage() {
  const [location, navigate] = useLocation();
  const [status, setStatus] = useState("active");
  const [clientId, setClientId] = useState("");
  const [range, setRange] = useState("any");
  const participants = useParticipants({ status: "all" });
  const voices = useVoiceNotes({
    status,
    clientId: clientId || undefined,
    range,
  });
  const summary = useVoiceSummary();
  const list = voices.data?.items ?? [];

  return (
    <>
      <SectionHeading
        title="Voice notes"
        subtitle="Capture reflections, review transcripts and prepare an editable progress note draft."
        actions={
          <>
            <Btn
              variant="secondary"
              onClick={() => navigate("/app/voice/settings")}
            >
              <Settings size={14} />
              Voice settings
            </Btn>
            <Btn onClick={() => navigate("/app/voice/record")}>
              <Mic size={14} />
              Open recorder
            </Btn>
          </>
        }
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="panel p-4">
          <div className="text-[10px] text-[#829097]">Saved recordings</div>
          <div className="mt-1 text-xl font-semibold">
            {summary.data?.saved ?? 0}
          </div>
        </div>
        <div className="panel p-4">
          <div className="text-[10px] text-[#829097]">Transcript ready</div>
          <div className="mt-1 text-xl font-semibold">
            {summary.data?.transcriptReady ?? 0}
          </div>
        </div>
        <div className="panel p-4">
          <div className="text-[10px] text-[#829097]">Drafts for review</div>
          <div className="mt-1 text-xl font-semibold">
            {summary.data?.draftsForReview ?? 0}
          </div>
        </div>
      </div>
      <Panel
        className="mt-5"
        title="Voice inbox"
        action={
          <div className="flex flex-wrap gap-2">
            <select
              className="select h-8 w-[135px] py-1 text-[10px]"
              value={clientId}
              onChange={event => setClientId(event.target.value)}
              aria-label="Filter voice notes by participant"
            >
              <option value="">All participants</option>
              {participants.data?.items.map(person => (
                <option key={person.id} value={person.id}>
                  {person.preferred}
                </option>
              ))}
            </select>
            <select
              className="select h-8 w-[115px] py-1 text-[10px]"
              value={range}
              onChange={event => setRange(event.target.value)}
              aria-label="Filter voice notes by date"
            >
              <option value="any">Any date</option>
              <option value="today">Today</option>
              <option value="recent">Last 7 days</option>
            </select>
            <select
              className="select h-8 w-[130px] py-1 text-[10px]"
              value={status}
              onChange={event => setStatus(event.target.value)}
              aria-label="Filter voice notes by status"
            >
              <option value="active">Not archived</option>
              <option value="Saved">Saved</option>
              <option value="Draft ready">Draft ready</option>
              <option value="Archived">Archived</option>
              <option value="all">All statuses</option>
            </select>
          </div>
        }
      >
        {voices.isError && (
          <div className="p-4">
            <ErrorBlock error={voices.error} onRetry={() => voices.refetch()} />
          </div>
        )}
        {voices.isPending ? (
          <LoadingBlock />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Recording</th>
                  <th>Participant</th>
                  <th>Duration</th>
                  <th>Created</th>
                  <th>Transcript</th>
                  <th>Generated note</th>
                  <th>Linked record</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map(voice => (
                  <tr key={voice.id}>
                    <td>
                      <button
                        onClick={() => navigate(`/app/voice/${voice.id}`)}
                        className="flex items-center gap-2 text-left"
                      >
                        <span className="grid h-8 w-8 place-items-center rounded-full bg-[#eaf4f2] text-[#39857c]">
                          <FileAudio2 size={15} />
                        </span>
                        <span>
                          <b className="block text-xs text-[#3c505a]">
                            {voice.title}
                          </b>
                          <small className="text-[10px] text-[#89959a]">
                            {voice.id}
                          </small>
                        </span>
                      </button>
                    </td>
                    <td>{voice.clientName}</td>
                    <td>{voice.duration}</td>
                    <td>{timeAgo(voice.createdAt)}</td>
                    <td>
                      <span
                        className={`text-[10px] ${voice.transcriptStatus === "Ready" ? "text-[#37795f]" : voice.transcriptStatus === "Unavailable" ? "text-[#a84540]" : "text-[#89959a]"}`}
                      >
                        {voice.transcriptStatus}
                      </span>
                    </td>
                    <td>
                      {voice.generationStatus === "Draft ready" ? (
                        <Status value="Draft ready" />
                      ) : (
                        <span className="text-[10px] text-[#89959a]">
                          {voice.generationStatus}
                        </span>
                      )}
                    </td>
                    <td>
                      {voice.recordId ?? (
                        <span className="text-[10px] text-[#98a2a5]">
                          Unlinked
                        </span>
                      )}
                    </td>
                    <td>
                      <button
                        className="icon-btn"
                        onClick={() => navigate(`/app/voice/${voice.id}`)}
                        aria-label={`Open ${voice.title}`}
                      >
                        <ChevronRight size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!list.length && (
              <EmptyState
                title={
                  status === "active" && !clientId && range === "any"
                    ? "Your voice inbox is empty"
                    : "No recordings match these filters"
                }
                text="Start a recording to capture notes after a shift."
                action={
                  <Btn onClick={() => navigate("/app/voice/record")}>
                    <Mic size={14} />
                    Open recorder
                  </Btn>
                }
              />
            )}
          </div>
        )}
      </Panel>
      <div className="mt-4 rounded-md border border-[#d9e9e5] bg-[#f1f8f6] p-3 text-[11px] leading-5 text-[#496663]">
        <Info size={14} className="mr-1 inline" />
        Generated text is always an editable draft. It is never submitted or
        approved automatically and must be checked against the service before
        use.
      </div>
      {location === "/app/voice/settings" && (
        <VoiceSettingsDrawer onClose={() => navigate("/app/voice")} />
      )}
    </>
  );
}
