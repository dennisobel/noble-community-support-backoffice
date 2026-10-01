import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Check,
  FileText,
  Info,
  Pencil,
  Play,
  Sparkles,
  Trash2,
  Volume2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import type { VoiceDraftDTO } from "@shared/dto";
import {
  DETAIL_LEVELS,
  NOTE_SECTIONS,
  NOTE_SECTION_LABELS,
  NOTE_TEMPLATES,
  type DetailLevel,
  type NoteSection,
  type NoteTemplate,
} from "@shared/enums";
import { MESSAGES } from "@shared/messages";
import { errorMessage, fetchBlob } from "@/api/client";
import {
  useArchiveVoice,
  useAttachVoice,
  useDeleteVoice,
  useGenerateDraft,
  usePreferences,
  useRecords,
  useTranscribe,
  useUpdateTranscript,
  useUpdateVoice,
  useUpdateVoiceDraft,
  useVoiceNote,
} from "@/api/hooks";
import {
  Btn,
  ConfirmModal,
  ErrorBlock,
  FormAlert,
  LoadingBlock,
  Modal,
  Panel,
  SectionHeading,
  Spinner,
  Status,
} from "@/components/app/ui";
import { formatDateTime } from "@/lib/format";
import { useNotify } from "@/lib/notify";

const SHORT_LABELS: Record<NoteSection, string> = {
  support: "Support provided",
  response: "Participant response",
  outcome: "Goal / outcome",
  observations: "Observations",
  followUp: "Follow-up",
};

function GenerateModal({
  voiceId,
  onClose,
}: {
  voiceId: string;
  onClose: () => void;
}) {
  const notify = useNotify();
  const preferences = usePreferences();
  const generate = useGenerateDraft();
  const [template, setTemplate] = useState<NoteTemplate>(
    preferences.data?.voice.generationTemplate ?? NOTE_TEMPLATES[0]
  );
  const [detail, setDetail] = useState<DetailLevel>(
    preferences.data?.voice.detailLevel ?? "Balanced"
  );
  const [transcriptOnly, setTranscriptOnly] = useState(
    preferences.data?.voice.useTranscriptOnly ?? false
  );
  const [sections, setSections] = useState<NoteSection[]>([...NOTE_SECTIONS]);
  const [error, setError] = useState("");

  const submit = async () => {
    setError("");
    if (!sections.length) return setError(MESSAGES.generationSections);
    try {
      await generate.mutateAsync({
        id: voiceId,
        template,
        sections,
        detailLevel: detail,
        transcriptOnly,
      });
      notify("Generating a draft. It appears below when ready.", "info");
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  return (
    <Modal
      title="Generate progress note draft"
      subtitle="AI-assisted · review before submission"
      onClose={onClose}
      busy={generate.isPending}
    >
      <div className="space-y-4">
        <label className="label">
          Note template
          <select
            className="select mt-1"
            value={template}
            onChange={event => setTemplate(event.target.value as NoteTemplate)}
          >
            {NOTE_TEMPLATES.map(item => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <div>
          <div className="label">Sections to generate</div>
          <div className="grid grid-cols-2 gap-2">
            {NOTE_SECTIONS.map(section => (
              <label
                key={section}
                className="flex items-center gap-2 text-[11px] text-[#5d6f77]"
              >
                <input
                  type="checkbox"
                  checked={sections.includes(section)}
                  onChange={event =>
                    setSections(current =>
                      event.target.checked
                        ? [...current, section]
                        : current.filter(item => item !== section)
                    )
                  }
                  className="accent-[#147f79]"
                />
                {SHORT_LABELS[section]}
              </label>
            ))}
          </div>
        </div>
        <label className="label">
          Detail level
          <select
            className="select mt-1"
            value={detail}
            onChange={event => setDetail(event.target.value as DetailLevel)}
          >
            {DETAIL_LEVELS.map(item => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label className="flex items-start gap-2 rounded-md bg-[#f5f8f7] p-3 text-[11px] text-[#586c74]">
          <input
            type="checkbox"
            checked={transcriptOnly}
            onChange={event => setTranscriptOnly(event.target.checked)}
            className="mt-0.5 accent-[#147f79]"
          />
          <span>
            <b>Use only the transcript</b>
            <small className="mt-1 block text-[10px] text-[#859198]">
              Ignore participant goals; sections the transcript does not support
              are left empty.
            </small>
          </span>
        </label>
        <div className="rounded-md border border-[#e7ecea] p-3 text-[10px] leading-4 text-[#879399]">
          The draft is generated from the transcript only. Check it against the
          recording and the participant's plan before using it.
        </div>
        <FormAlert message={error} />
        <div className="flex justify-end gap-2">
          <Btn
            variant="secondary"
            disabled={generate.isPending}
            onClick={onClose}
          >
            Cancel
          </Btn>
          <Btn loading={generate.isPending} onClick={() => void submit()}>
            <Sparkles size={14} />
            Generate draft
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

export default function VoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const notify = useNotify();
  const voiceQuery = useVoiceNote(id);
  const voice = voiceQuery.data;
  const records = useRecords(
    { clientId: voice?.clientId, limit: 100 },
    { enabled: Boolean(voice) }
  );
  const transcribe = useTranscribe();
  const updateTranscript = useUpdateTranscript();
  const updateDraft = useUpdateVoiceDraft();
  const updateVoice = useUpdateVoice();
  const archive = useArchiveVoice();
  const remove = useDeleteVoice();
  const attach = useAttachVoice();
  const [modal, setModal] = useState<
    "generate" | "rename" | "delete" | "apply" | null
  >(null);
  const [title, setTitle] = useState("");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [editingTranscript, setEditingTranscript] = useState(false);
  const [transcriptText, setTranscriptText] = useState("");
  const [draft, setDraft] = useState<VoiceDraftDTO | null>(null);
  const [draftDirty, setDraftDirty] = useState(false);

  useEffect(() => {
    if (voice?.draft && !draftDirty) setDraft(voice.draft);
  }, [voice?.draft, draftDirty]);
  useEffect(
    () => () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    },
    [audioUrl]
  );

  if (voiceQuery.isPending) return <LoadingBlock label="Loading recording…" />;
  if (voiceQuery.isError || !voice)
    return (
      <ErrorBlock
        error={voiceQuery.error}
        onRetry={() => voiceQuery.refetch()}
      />
    );

  const linkedRecord = records.data?.items.find(
    record => record.id === voice.recordId
  );
  const linkedEditable =
    linkedRecord &&
    (linkedRecord.status === "Draft" || linkedRecord.status === "Returned");
  const fail = (failure: unknown) => notify(errorMessage(failure), "error");

  const loadAudio = async () => {
    setAudioLoading(true);
    try {
      const { blob } = await fetchBlob(`/voice-notes/${voice.id}/audio`);
      setAudioUrl(URL.createObjectURL(blob));
    } catch (failure) {
      fail(failure);
    } finally {
      setAudioLoading(false);
    }
  };
  const saveDraft = async () => {
    if (!draft) return;
    try {
      await updateDraft.mutateAsync({ id: voice.id, rev: voice.rev, ...draft });
      setDraftDirty(false);
      notify("Draft changes saved.");
    } catch (failure) {
      fail(failure);
    }
  };

  return (
    <>
      <Link
        href="/app/voice"
        className="mb-4 inline-flex items-center gap-1 text-xs font-semibold text-[#277c76]"
      >
        <ArrowLeft size={14} />
        Back to voice inbox
      </Link>
      <SectionHeading
        title={voice.title}
        subtitle={`${voice.id} · ${formatDateTime(voice.createdAt)} · ${voice.duration}`}
        actions={
          <>
            <Btn variant="secondary" onClick={() => setModal("delete")}>
              <Trash2 size={14} />
              Delete
            </Btn>
            <Btn
              variant="secondary"
              onClick={() => {
                setTitle(voice.title);
                setModal("rename");
              }}
            >
              <Pencil size={14} />
              Rename
            </Btn>
            <Btn
              variant="secondary"
              loading={archive.isPending}
              onClick={() =>
                archive.mutate(
                  { id: voice.id, archived: voice.status !== "Archived" },
                  {
                    onSuccess: () =>
                      notify(
                        voice.status === "Archived"
                          ? "Recording restored to the inbox."
                          : "Recording archived."
                      ),
                    onError: fail,
                  }
                )
              }
            >
              {voice.status === "Archived" ? (
                <ArchiveRestore size={14} />
              ) : (
                <Archive size={14} />
              )}
              {voice.status === "Archived" ? "Restore" : "Archive"}
            </Btn>
          </>
        }
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_310px]">
        <div className="space-y-5">
          <Panel title="Recording">
            <div className="p-5">
              {!voice.hasAudio ? (
                <p className="text-xs text-[#87949a]">
                  No audio file is stored for this recording (sample data).
                </p>
              ) : audioUrl ? (
                <audio controls autoPlay src={audioUrl} className="w-full" />
              ) : (
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => void loadAudio()}
                    disabled={audioLoading}
                    className="grid h-11 w-11 place-items-center rounded-full bg-[#177f78] text-white"
                    aria-label="Play audio"
                  >
                    {audioLoading ? (
                      <Spinner light size={14} />
                    ) : (
                      <Play size={17} fill="currentColor" />
                    )}
                  </button>
                  <div className="flex-1">
                    <div className="h-1.5 rounded-full bg-[#e8eeeb]" />
                    <div className="mt-2 flex justify-between text-[10px] text-[#88969b]">
                      <span>00:00</span>
                      <span>{voice.duration}</span>
                    </div>
                  </div>
                  <Volume2 size={16} className="text-[#859298]" />
                </div>
              )}
            </div>
          </Panel>
          <Panel
            title="Transcript"
            action={
              voice.transcriptStatus === "Ready" && !editingTranscript ? (
                <div className="flex items-center gap-2">
                  <span className="badge badge-approved">
                    {voice.transcriptProvider === "mock"
                      ? "Demo transcript"
                      : voice.transcriptProvider === "manual"
                        ? "Edited"
                        : "Ready"}
                  </span>
                  <button
                    className="text-[11px] font-semibold text-[#277c76]"
                    onClick={() => {
                      setTranscriptText(voice.transcript);
                      setEditingTranscript(true);
                    }}
                  >
                    Edit
                  </button>
                </div>
              ) : voice.transcriptStatus === "Processing" ? (
                <span className="badge badge-submitted">Transcribing…</span>
              ) : !editingTranscript ? (
                <Btn
                  variant="secondary"
                  loading={transcribe.isPending}
                  onClick={() => transcribe.mutate(voice.id, { onError: fail })}
                >
                  <Sparkles size={13} />
                  {voice.transcriptStatus === "Unavailable"
                    ? "Retry transcription"
                    : "Transcribe"}
                </Btn>
              ) : null
            }
          >
            <div className="p-5">
              {editingTranscript ? (
                <div className="space-y-3">
                  <textarea
                    className="textarea !min-h-[140px]"
                    value={transcriptText}
                    onChange={event => setTranscriptText(event.target.value)}
                    aria-label="Transcript"
                  />
                  <div className="flex gap-2">
                    <Btn
                      loading={updateTranscript.isPending}
                      onClick={() =>
                        updateTranscript.mutate(
                          {
                            id: voice.id,
                            text: transcriptText,
                            rev: voice.rev,
                          },
                          {
                            onSuccess: () => {
                              setEditingTranscript(false);
                              notify("Transcript saved.");
                            },
                            onError: fail,
                          }
                        )
                      }
                    >
                      <Check size={14} />
                      Save transcript
                    </Btn>
                    <Btn
                      variant="secondary"
                      onClick={() => setEditingTranscript(false)}
                    >
                      Cancel
                    </Btn>
                  </div>
                </div>
              ) : voice.transcriptStatus === "Processing" ? (
                <div className="flex items-center gap-2 text-xs text-[#72818a]">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-[#4b9c92]" />
                  Preparing transcript…
                </div>
              ) : voice.transcriptStatus === "Unavailable" ? (
                <div className="space-y-2">
                  <div className="rounded-md bg-[#fff4e2] p-3 text-xs text-[#8c6729]">
                    {voice.transcriptError ?? "Transcription unavailable."} You
                    can retry or type the transcript yourself.
                  </div>
                  <button
                    className="text-[11px] font-semibold text-[#277c76]"
                    onClick={() => {
                      setTranscriptText("");
                      setEditingTranscript(true);
                    }}
                  >
                    Write the transcript manually
                  </button>
                </div>
              ) : voice.transcript ? (
                <p className="whitespace-pre-line text-xs leading-6 text-[#52666f]">
                  {voice.transcript}
                </p>
              ) : (
                <div className="py-5 text-center text-xs text-[#8b979b]">
                  No transcript yet. Select Transcribe, or{" "}
                  <button
                    className="font-semibold text-[#277c76]"
                    onClick={() => {
                      setTranscriptText("");
                      setEditingTranscript(true);
                    }}
                  >
                    type it yourself
                  </button>
                  .
                </div>
              )}
            </div>
          </Panel>
          {voice.generationStatus === "Processing" && (
            <Panel title="Progress note draft">
              <div className="flex items-center gap-2 p-5 text-xs text-[#72818a]">
                <Spinner size={13} />
                Generating the draft…
              </div>
            </Panel>
          )}
          {voice.generationStatus === "Failed" && (
            <div className="rounded-md border border-[#f0d2d0] bg-[#fff2f0] p-3 text-xs text-[#9d4942]">
              {voice.generation.error ?? "The draft could not be generated."}
            </div>
          )}
          {draft && voice.generationStatus !== "Processing" && (
            <Panel
              title="Progress note draft"
              action={
                <span className="badge badge-returned">
                  <Sparkles size={11} />
                  AI-assisted draft · review before submission
                </span>
              }
            >
              <div className="space-y-4 p-5">
                {NOTE_SECTIONS.map(section => (
                  <div key={section}>
                    <label className="label" htmlFor={`draft-${section}`}>
                      {NOTE_SECTION_LABELS[section]}
                    </label>
                    <textarea
                      id={`draft-${section}`}
                      className="textarea !min-h-[75px]"
                      value={draft[section]}
                      onChange={event => {
                        setDraft({ ...draft, [section]: event.target.value });
                        setDraftDirty(true);
                      }}
                    />
                  </div>
                ))}
                <div className="rounded-md bg-[#fff7e6] p-3 text-[10px] leading-4 text-[#826326]">
                  <Info size={13} className="mr-1 inline" />
                  This is an editable draft, not an approved record. Review
                  every detail against the original service and follow the usual
                  submission and review workflow.
                  {voice.generation.provider === "mock" &&
                    " (Generated by the demo provider.)"}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Btn
                    variant="secondary"
                    disabled={!draftDirty}
                    loading={updateDraft.isPending}
                    onClick={() => void saveDraft()}
                  >
                    <Check size={14} />
                    Save draft
                  </Btn>
                  <Btn
                    onClick={async () => {
                      if (draftDirty) await saveDraft();
                      navigate(`/app/records/new?voiceId=${voice.id}`);
                    }}
                  >
                    <FileText size={14} />
                    Create service record
                  </Btn>
                </div>
              </div>
            </Panel>
          )}
        </div>
        <div className="space-y-5">
          <Panel title="Recording details">
            <div className="space-y-3 p-5 text-xs">
              <div className="flex justify-between">
                <span className="text-[#849198]">Participant</span>
                <Link
                  href={`/app/clients/${voice.clientId}`}
                  className="font-semibold text-[#277c76]"
                >
                  {voice.clientName}
                </Link>
              </div>
              <div className="flex justify-between">
                <span className="text-[#849198]">Recorded by</span>
                <span>{voice.recordedBy?.name ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#849198]">Created</span>
                <span>{formatDateTime(voice.createdAt)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#849198]">Duration</span>
                <span>{voice.duration}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#849198]">Status</span>
                <Status value={voice.status} />
              </div>
              <div className="divider" />
              <label className="label" htmlFor="voice-record">
                Linked service record
              </label>
              <select
                id="voice-record"
                className="select"
                value={voice.recordId ?? ""}
                disabled={updateVoice.isPending}
                onChange={event =>
                  updateVoice.mutate(
                    {
                      id: voice.id,
                      rev: voice.rev,
                      recordId: event.target.value || null,
                    },
                    {
                      onSuccess: () =>
                        notify(
                          event.target.value
                            ? `Recording linked to ${event.target.value}.`
                            : "Recording detached from the service record."
                        ),
                      onError: fail,
                    }
                  )
                }
              >
                <option value="">Not attached</option>
                {records.data?.items.map(record => (
                  <option key={record.id} value={record.id}>
                    {record.id} · {record.status}
                  </option>
                ))}
              </select>
              <p className="field-help">
                Linking does not submit or approve the service record.
              </p>
              {voice.recordId && (
                <Link
                  href={`/app/records/${voice.recordId}`}
                  className="block text-[11px] font-semibold text-[#277c76]"
                >
                  Open {voice.recordId}
                </Link>
              )}
              {voice.draft && linkedEditable && (
                <Btn
                  variant="secondary"
                  className="w-full"
                  onClick={() => setModal("apply")}
                >
                  <Sparkles size={13} />
                  Apply draft to {voice.recordId}
                </Btn>
              )}
            </div>
          </Panel>
          <Panel title="Next step">
            <div className="space-y-3 p-5">
              <p className="text-[11px] leading-5 text-[#6c7c83]">
                Create an editable note draft from the transcript and review it
                before adding it to a service record.
              </p>
              <Btn
                className="w-full"
                disabled={
                  voice.transcriptStatus !== "Ready" ||
                  voice.generationStatus === "Processing"
                }
                onClick={() => setModal("generate")}
              >
                <Sparkles size={15} />
                {voice.draft
                  ? "Regenerate draft"
                  : "Generate progress note draft"}
              </Btn>
              {voice.transcriptStatus !== "Ready" && (
                <p className="text-[10px] text-[#87949a]">
                  {MESSAGES.transcriptRequired}
                </p>
              )}
            </div>
          </Panel>
          <div className="rounded-md border border-[#e7ecea] bg-white p-4 text-[10px] leading-4 text-[#859197]">
            Generated text is never submitted or approved automatically. You
            remain responsible for checking accuracy and completing the normal
            review workflow.
          </div>
        </div>
      </div>

      {modal === "generate" && (
        <GenerateModal voiceId={voice.id} onClose={() => setModal(null)} />
      )}
      {modal === "rename" && (
        <Modal
          title="Rename recording"
          onClose={() => setModal(null)}
          busy={updateVoice.isPending}
        >
          <label className="label" htmlFor="voice-title">
            Recording title
          </label>
          <input
            id="voice-title"
            className="input"
            value={title}
            onChange={event => setTitle(event.target.value)}
            autoFocus
          />
          <div className="mt-5 flex justify-end gap-2">
            <Btn variant="secondary" onClick={() => setModal(null)}>
              Cancel
            </Btn>
            <Btn
              disabled={!title.trim()}
              loading={updateVoice.isPending}
              onClick={() =>
                updateVoice.mutate(
                  { id: voice.id, rev: voice.rev, title: title.trim() },
                  {
                    onSuccess: () => {
                      setModal(null);
                      notify("Recording title updated.");
                    },
                    onError: fail,
                  }
                )
              }
            >
              Save title
            </Btn>
          </div>
        </Modal>
      )}
      {modal === "delete" && (
        <ConfirmModal
          title="Delete recording?"
          body="The audio, transcript and draft are permanently removed. Recordings linked to a submitted or approved record can only be archived."
          confirmLabel="Delete recording"
          danger
          busy={remove.isPending}
          onClose={() => setModal(null)}
          onConfirm={() =>
            remove.mutate(voice.id, {
              onSuccess: () => {
                notify("Recording deleted.");
                navigate("/app/voice");
              },
              onError: failure => {
                setModal(null);
                fail(failure);
              },
            })
          }
        />
      )}
      {modal === "apply" && voice.recordId && (
        <ConfirmModal
          title={`Apply the draft to ${voice.recordId}?`}
          body="Non-empty draft sections replace the matching sections of the service record. The record's history notes that an AI-assisted draft was applied. The record is not submitted."
          confirmLabel="Apply draft"
          busy={attach.isPending}
          onClose={() => setModal(null)}
          onConfirm={() =>
            attach.mutate(
              { id: voice.id, recordId: voice.recordId!, applyDraft: true },
              {
                onSuccess: () => {
                  setModal(null);
                  notify(
                    `Draft applied to ${voice.recordId}. Review it before submitting.`
                  );
                },
                onError: failure => {
                  setModal(null);
                  fail(failure);
                },
              }
            )
          }
        />
      )}
    </>
  );
}
