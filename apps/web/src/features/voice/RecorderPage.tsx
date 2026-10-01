import {
  ArrowLeft,
  Check,
  Headphones,
  Mic,
  Pause,
  Play,
  ShieldAlert,
  StopCircle,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { AUDIO_UPLOAD } from "@shared/const";
import { errorMessage } from "@/api/client";
import { useParticipants, useRecords, useUploadVoice } from "@/api/hooks";
import {
  Btn,
  EmptyState,
  FormAlert,
  LoadingBlock,
  SectionHeading,
} from "@/components/app/ui";
import { formatDuration } from "@/lib/format";
import { useNotify } from "@/lib/notify";

const MIME_CHOICES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  return MIME_CHOICES.find(type => MediaRecorder.isTypeSupported?.(type)) ?? "";
}

function extensionFor(mime: string): string {
  if (mime.includes("mp4")) return "m4a";
  if (mime.includes("ogg")) return "ogg";
  return "webm";
}

type Phase = "idle" | "recording" | "paused" | "stopped";

export default function RecorderPage() {
  const [, navigate] = useLocation();
  const notify = useNotify();
  const preset = new URLSearchParams(useSearch()).get("clientId") ?? "";
  const participants = useParticipants({ status: "Active" });
  const upload = useUploadVoice();
  const clients = participants.data?.items ?? [];
  const [clientId, setClientId] = useState(preset);
  const client = clients.find(person => person.id === clientId) ?? clients[0];
  const records = useRecords(
    { clientId: client?.id, limit: 50 },
    { enabled: Boolean(client) }
  );
  const [recordId, setRecordId] = useState("");
  const [title, setTitle] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [micError, setMicError] = useState("");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [levels, setLevels] = useState<number[]>(() =>
    Array.from({ length: 46 }, () => 0.15)
  );
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const audioContext = useRef<AudioContext | null>(null);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (client && !title) setTitle(`${client.preferred} — voice note`);
  }, [client, title]);
  useEffect(() => {
    if (phase !== "recording") return;
    const timer = window.setInterval(
      () => setSeconds(value => value + 1),
      1000
    );
    return () => window.clearInterval(timer);
  }, [phase]);
  useEffect(() => {
    if (seconds >= AUDIO_UPLOAD.maxDurationSec && phase === "recording") stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seconds, phase]);
  useEffect(() => () => cleanup(), []);
  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl]
  );

  function cleanup() {
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = null;
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
    void audioContext.current?.close().catch(() => undefined);
    audioContext.current = null;
  }

  function watchLevels(media: MediaStream) {
    try {
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 128;
      context.createMediaStreamSource(media).connect(analyser);
      audioContext.current = context;
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(data);
        setLevels(
          Array.from({ length: 46 }, (_, index) =>
            Math.max(0.12, data[index % data.length] / 255)
          )
        );
        frame.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      /* the level meter is decorative */
    }
  }

  async function start() {
    setMicError("");
    setError("");
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setMicError(
        "This browser cannot record audio. Use a recent version of Chrome, Edge, Firefox or Safari."
      );
      return;
    }
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      stream.current = media;
      const mimeType = pickMimeType();
      const instance = new MediaRecorder(media, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: 32_000,
      });
      chunks.current = [];
      instance.ondataavailable = event => {
        if (event.data.size) chunks.current.push(event.data);
      };
      instance.onstop = () => {
        const recorded = new Blob(chunks.current, {
          type: instance.mimeType || mimeType || "audio/webm",
        });
        setBlob(recorded);
        setPreviewUrl(URL.createObjectURL(recorded));
        cleanup();
      };
      recorder.current = instance;
      instance.start(1000);
      watchLevels(media);
      setSeconds(0);
      setBlob(null);
      setPreviewUrl(null);
      setPhase("recording");
    } catch (failure) {
      const name = (failure as DOMException)?.name;
      setMicError(
        name === "NotAllowedError"
          ? "Microphone permission was blocked. Allow microphone access for this site, then retry."
          : name === "NotFoundError"
            ? "No microphone was found. Connect one and retry."
            : "The microphone could not be started. Check the input device and retry."
      );
    }
  }

  function togglePause() {
    const instance = recorder.current;
    if (!instance) return;
    if (phase === "recording") {
      instance.pause();
      setPhase("paused");
    } else {
      instance.resume();
      setPhase("recording");
    }
  }

  function stop() {
    if (recorder.current && recorder.current.state !== "inactive")
      recorder.current.stop();
    setPhase("stopped");
    notify(
      seconds > 0
        ? "Recording stopped. Review the clip, rename it or link it before saving."
        : "Recording stopped before any audio was captured.",
      "info"
    );
  }

  function discard() {
    cleanup();
    setBlob(null);
    setPreviewUrl(null);
    setSeconds(0);
    setPhase("idle");
    notify("Unsaved recording discarded.", "info");
  }

  async function save() {
    if (!blob || !client) return setError("Record a short clip before saving.");
    setError("");
    const form = new FormData();
    form.append("clientId", client.id);
    form.append("title", title.trim() || `${client.preferred} — voice note`);
    if (recordId) form.append("recordId", recordId);
    form.append("durationSec", String(Math.max(1, seconds)));
    form.append("audio", blob, `recording.${extensionFor(blob.type)}`);
    try {
      const voice = await upload.mutateAsync({ form, onProgress: setProgress });
      notify("Recording saved. Transcribe it or create an editable draft.");
      navigate(`/app/voice/${voice.id}`);
    } catch (failure) {
      setError(errorMessage(failure));
      setProgress(0);
    }
  }

  if (participants.isPending) return <LoadingBlock />;
  if (!clients.length)
    return (
      <EmptyState
        title="No active participants"
        text="Voice notes belong to an active participant."
        action={
          <Btn onClick={() => navigate("/app/clients")}>Go to clients</Btn>
        }
      />
    );

  const recordingActive = phase === "recording" || phase === "paused";

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
        title="Voice recorder"
        subtitle="Mobile-friendly capture. Audio is uploaded securely when you save."
      />
      <div className="mx-auto max-w-[720px]">
        <div className="panel overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e9eeec] p-5">
            <div>
              <label className="label" htmlFor="recorder-client">
                Participant
              </label>
              <select
                id="recorder-client"
                className="select w-[230px]"
                disabled={recordingActive}
                value={client?.id ?? ""}
                onChange={event => {
                  setClientId(event.target.value);
                  setRecordId("");
                  const next = clients.find(
                    person => person.id === event.target.value
                  );
                  if (next) setTitle(`${next.preferred} — voice note`);
                }}
              >
                {clients.map(person => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="recorder-record">
                Attach to record (optional)
              </label>
              <select
                id="recorder-record"
                className="select w-[200px]"
                value={recordId}
                onChange={event => setRecordId(event.target.value)}
              >
                <option value="">No linked record</option>
                {records.data?.items.map(record => (
                  <option value={record.id} key={record.id}>
                    {record.id} · {record.status}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {client && !client.kyc.consentForms && (
            <div className="border-b border-[#f2dfba] bg-[#fff8e9] px-5 py-3 text-[11px] text-[#865e1e]">
              <ShieldAlert size={14} className="mr-1 inline" />
              Consent forms for {client.preferred} are not marked as received.
              Check consent before recording.
            </div>
          )}
          <div className="px-5 py-10 text-center sm:px-12">
            {micError && (
              <div
                role="alert"
                className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#f0d2d0] bg-[#fff2f0] p-3 text-left text-xs text-[#9d4942]"
              >
                <span>
                  <ShieldAlert size={15} className="mr-1 inline" />
                  {micError}
                </span>
                <Btn variant="secondary" onClick={() => void start()}>
                  Retry microphone
                </Btn>
              </div>
            )}
            <div className="mx-auto grid h-20 w-20 place-items-center rounded-full border border-[#d9e9e5] bg-[#f2f8f6] text-[#278078]">
              {phase === "recording" ? (
                <span className="h-4 w-4 animate-pulse rounded-full bg-[#d45d59]" />
              ) : (
                <Mic size={31} />
              )}
            </div>
            <div
              className="mt-4 font-mono text-3xl font-medium tracking-[.08em] text-[#263e49]"
              aria-live="polite"
            >
              {formatDuration(seconds)}
            </div>
            <div className="mt-1 text-xs text-[#89969b]">
              {phase === "recording"
                ? "Recording in progress"
                : phase === "paused"
                  ? "Recording paused"
                  : phase === "stopped"
                    ? "Recording stopped · ready to review"
                    : "Tap to begin a new voice note"}
            </div>
            <div
              className="my-8 flex h-12 items-center justify-center gap-[3px]"
              aria-hidden="true"
            >
              {levels.map((level, index) => (
                <span
                  key={index}
                  className="w-[3px] rounded-[3px] bg-[#4a9f95] transition-[height] duration-75"
                  style={{
                    height: `${phase === "recording" ? 6 + level * 42 : 8 + ((index * 17) % 20)}px`,
                    opacity: phase === "recording" ? 0.5 + level / 2 : 0.35,
                  }}
                />
              ))}
            </div>
            {phase === "stopped" && blob && (
              <div className="mx-auto mb-5 max-w-md space-y-3 text-left">
                <label className="label">
                  Recording title
                  <input
                    className="input mt-1"
                    value={title}
                    onChange={event => setTitle(event.target.value)}
                    aria-label="Recording title"
                  />
                </label>
                {previewUrl && (
                  <audio controls src={previewUrl} className="w-full" />
                )}
              </div>
            )}
            {upload.isPending && (
              <div className="mx-auto mb-4 h-1.5 max-w-md overflow-hidden rounded-full bg-[#eaf0ee]">
                <div
                  className="h-full rounded-full bg-[#49a295] transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}
            <div className="mx-auto mb-4 max-w-md">
              <FormAlert message={error} />
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3">
              {phase === "idle" && (
                <Btn onClick={() => void start()}>
                  <Mic size={17} />
                  Start recording
                </Btn>
              )}
              {recordingActive && (
                <>
                  <Btn variant="secondary" onClick={togglePause}>
                    {phase === "paused" ? (
                      <Play size={16} />
                    ) : (
                      <Pause size={16} />
                    )}{" "}
                    {phase === "paused" ? "Resume" : "Pause"}
                  </Btn>
                  <Btn variant="danger" onClick={stop}>
                    <StopCircle size={16} />
                    Stop recording
                  </Btn>
                </>
              )}
              {phase === "stopped" && (
                <>
                  <Btn
                    variant="secondary"
                    onClick={discard}
                    disabled={upload.isPending}
                  >
                    <Trash2 size={14} />
                    Discard
                  </Btn>
                  <Btn
                    onClick={() => void save()}
                    loading={upload.isPending}
                    disabled={!blob}
                  >
                    <Check size={15} />
                    Save recording
                  </Btn>
                </>
              )}
            </div>
            <p className="mx-auto mt-6 max-w-md text-[10px] leading-4 text-[#8a969b]">
              Audio stays on this device until you save. Saved recordings are
              stored in the workspace and are only available to signed-in staff.
              Recordings stop automatically after 60 minutes.
            </p>
          </div>
        </div>
        <div className="mt-4 flex items-start gap-3 rounded-md border border-[#e7ecea] bg-white p-4 text-[11px] text-[#697b83]">
          <Headphones size={16} className="mt-0.5 text-[#548c84]" />
          <span>
            <b className="text-[#405761]">A useful reminder</b>
            <br />
            Record factual observations and participant preferences. Avoid
            recording sensitive information that is not relevant to the support
            provided.
          </span>
        </div>
      </div>
    </>
  );
}
