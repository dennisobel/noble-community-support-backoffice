import {
  Check,
  Copy,
  Link2,
  MessageSquareHeart,
  Plus,
  Search,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { useLocation, useParams } from "wouter";
import type { FeedbackFormDTO } from "@shared/dto";
import {
  FEEDBACK_AREAS,
  FEEDBACK_CHANNELS,
  FEEDBACK_KINDS,
  FEEDBACK_PRIORITIES,
  FEEDBACK_RELATIONSHIPS,
  type FeedbackArea,
  type FeedbackChannel,
  type FeedbackKind,
  type FeedbackPriority,
  type FeedbackRelationship,
} from "@shared/enums";
import { errorMessage } from "@/api/client";
import {
  useCreateFeedback,
  useFeedback,
  useFeedbackForm,
  useFeedbackOptions,
} from "@/api/hooks";
import {
  Btn,
  Drawer,
  EmptyState,
  ErrorBlock,
  FormAlert,
  LoadingBlock,
  Modal,
  Panel,
  SectionHeading,
  Status,
  useDebounced,
} from "@/components/app/ui";
import { Kpi } from "@/features/payroll/pay-ui";
import { prettyDate } from "@/lib/format";
import { useNotify } from "@/lib/notify";
import FeedbackCaseDrawer from "./FeedbackCaseDrawer";

const KIND_BADGE: Record<FeedbackKind, string> = {
  Complaint: "badge-returned",
  Compliment: "badge-approved",
  Suggestion: "badge-submitted",
};

/** Log something that came in by phone, email or in person. */
function LogFeedbackDrawer({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const options = useFeedbackOptions();
  const create = useCreateFeedback();
  const notify = useNotify();
  const [form, setForm] = useState({
    kind: "Complaint" as FeedbackKind,
    channel: "Phone" as FeedbackChannel,
    receivedOn: "",
    summary: "",
    details: "",
    desiredOutcome: "",
    area: "Service delivery" as FeedbackArea,
    priority: "Medium" as FeedbackPriority,
    name: "",
    relationship: "Participant" as FeedbackRelationship,
    phone: "",
    email: "",
    anonymous: false,
    wantsContact: true,
    participantId: "",
    staffId: "",
    incidentId: "",
    ownerId: "",
  });
  const [error, setError] = useState("");
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm(current => ({ ...current, [key]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      const saved = await create.mutateAsync({
        kind: form.kind,
        channel: form.channel,
        receivedOn: form.receivedOn || undefined,
        summary: form.summary,
        details: form.details,
        desiredOutcome: form.desiredOutcome,
        area: form.area,
        priority: form.priority,
        raisedBy: {
          name: form.name,
          relationship: form.relationship,
          phone: form.phone,
          email: form.email,
          anonymous: form.anonymous,
          wantsContact: form.wantsContact,
        },
        participantId: form.participantId,
        staffId: form.staffId,
        incidentId: form.incidentId,
        ownerId: form.ownerId,
      });
      notify(`${saved.id} logged. Acknowledge it by ${prettyDate(saved.acknowledgeBy)}.`);
      onSaved(saved.id);
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  return (
    <Drawer
      onClose={onClose}
      eyebrow="Complaints & feedback"
      title="Log feedback"
      subtitle="Anything a client, family member, worker or member of the public has told you."
      footer={
        <div className="flex justify-end gap-2">
          <Btn variant="secondary" onClick={onClose}>
            Cancel
          </Btn>
          <Btn type="submit" form="feedback-form" loading={create.isPending}>
            <Check size={14} />
            Log it
          </Btn>
        </div>
      }
    >
      <form id="feedback-form" className="space-y-4" onSubmit={submit}>
        <Panel title="What it is">
          <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <span className="label">Kind</span>
              <div className="flex flex-wrap gap-2">
                {FEEDBACK_KINDS.map(kind => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => set("kind", kind)}
                    aria-pressed={form.kind === kind}
                    className={`rounded-lg px-3.5 py-2 !text-xs !font-semibold ${
                      form.kind === kind
                        ? "bg-[#12766f] text-white"
                        : "border border-[#dde5e2] bg-white text-[#52666f]"
                    }`}
                  >
                    {kind}
                  </button>
                ))}
              </div>
            </div>
            <label className="label sm:col-span-2">
              In a few words <span className="text-red-600">*</span>
              <input
                required
                className="input mt-1"
                value={form.summary}
                onChange={event => set("summary", event.target.value)}
                placeholder="e.g. Worker arrived late twice this week"
              />
            </label>
            <label className="label sm:col-span-2">
              What was said <span className="text-red-600">*</span>
              <textarea
                required
                className="textarea mt-1"
                value={form.details}
                onChange={event => set("details", event.target.value)}
                placeholder="As close to their own words as you can."
              />
            </label>
            <label className="label sm:col-span-2">
              What they would like to happen
              <textarea
                className="textarea mt-1 !min-h-[60px]"
                value={form.desiredOutcome}
                onChange={event => set("desiredOutcome", event.target.value)}
              />
            </label>
            <label className="label">
              How it arrived
              <select
                className="select mt-1"
                value={form.channel}
                onChange={event =>
                  set("channel", event.target.value as FeedbackChannel)
                }
              >
                {FEEDBACK_CHANNELS.map(value => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label className="label">
              Received on
              <input
                type="date"
                className="input mt-1"
                value={form.receivedOn}
                onChange={event => set("receivedOn", event.target.value)}
              />
              <span className="field-help block font-normal">
                Blank means today. The due dates count from this day.
              </span>
            </label>
            <label className="label">
              What it concerns
              <select
                className="select mt-1"
                value={form.area}
                onChange={event => set("area", event.target.value as FeedbackArea)}
              >
                {FEEDBACK_AREAS.map(value => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label className="label">
              Priority
              <select
                className="select mt-1"
                value={form.priority}
                onChange={event =>
                  set("priority", event.target.value as FeedbackPriority)
                }
              >
                {FEEDBACK_PRIORITIES.map(value => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
          </div>
        </Panel>

        <Panel title="Who raised it">
          <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
            <label className="label">
              Name
              <input
                className="input mt-1"
                value={form.name}
                onChange={event => set("name", event.target.value)}
              />
            </label>
            <label className="label">
              They are
              <select
                className="select mt-1"
                value={form.relationship}
                onChange={event =>
                  set("relationship", event.target.value as FeedbackRelationship)
                }
              >
                {FEEDBACK_RELATIONSHIPS.map(value => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label className="label">
              Phone
              <input
                type="tel"
                className="input mt-1"
                value={form.phone}
                onChange={event => set("phone", event.target.value)}
              />
            </label>
            <label className="label">
              Email
              <input
                type="email"
                className="input mt-1"
                value={form.email}
                onChange={event => set("email", event.target.value)}
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-[#52666f]">
              <input
                type="checkbox"
                className="accent-[#147f79]"
                checked={form.anonymous}
                onChange={event => set("anonymous", event.target.checked)}
              />
              They asked not to be named
            </label>
            <label className="flex items-center gap-2 text-xs text-[#52666f]">
              <input
                type="checkbox"
                className="accent-[#147f79]"
                checked={form.wantsContact}
                onChange={event => set("wantsContact", event.target.checked)}
              />
              They want to hear back
            </label>
          </div>
        </Panel>

        <Panel title="What it is about, and who looks after it">
          <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
            <label className="label">
              Client
              <select
                className="select mt-1"
                value={form.participantId}
                onChange={event => set("participantId", event.target.value)}
              >
                <option value="">Nobody in particular</option>
                {(options.data?.participants ?? []).map(item => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="label">
              Team member
              <select
                className="select mt-1"
                value={form.staffId}
                onChange={event => set("staffId", event.target.value)}
              >
                <option value="">Nobody in particular</option>
                {(options.data?.staff ?? []).map(item => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="label">
              Linked incident
              <select
                className="select mt-1"
                value={form.incidentId}
                onChange={event => set("incidentId", event.target.value)}
              >
                <option value="">None</option>
                {(options.data?.incidents ?? []).map(item => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="label">
              Owner
              <select
                className="select mt-1"
                value={form.ownerId}
                onChange={event => set("ownerId", event.target.value)}
              >
                <option value="">Decide later</option>
                {(options.data?.owners ?? []).map(item => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </Panel>
        <FormAlert message={error} />
      </form>
    </Drawer>
  );
}

/** The no-login feedback form: turn it on, copy its link, or replace the link. */
function PublicFormModal({
  form,
  onClose,
}: {
  form: FeedbackFormDTO;
  onClose: () => void;
}) {
  const change = useFeedbackForm();
  const notify = useNotify();
  const [current, setCurrent] = useState(form);
  const [error, setError] = useState("");

  const apply = async (input: { enabled: boolean; regenerate?: boolean }) => {
    setError("");
    try {
      setCurrent(await change.mutateAsync(input));
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };
  const copy = async () => {
    if (!current.url) return;
    try {
      await navigator.clipboard.writeText(current.url);
      notify("Link copied.");
    } catch {
      notify("Select the link and copy it by hand.", "info");
    }
  };

  return (
    <Modal
      title="Public feedback form"
      subtitle="A page anyone can open without signing in"
      onClose={onClose}
      busy={change.isPending}
    >
      <p className="text-xs leading-5 text-[#63757d]">
        Put the link on your website, in your service agreement or in an email
        signature. Clients and families can send a complaint, a compliment or
        a suggestion, with or without their name, and it lands here as a new
        item. Nothing in the register can be read through the link.
      </p>
      {current.enabled && current.url ? (
        <>
          <div className="mt-4 flex items-center gap-2">
            <input
              readOnly
              className="input font-mono text-[11px]"
              value={current.url}
              aria-label="Public feedback link"
              onFocus={event => event.target.select()}
            />
            <Btn variant="secondary" onClick={() => void copy()}>
              <Copy size={14} />
              Copy
            </Btn>
          </div>
          <div className="mt-4 flex flex-wrap justify-between gap-2">
            <Btn
              variant="quiet"
              onClick={() => void apply({ enabled: true, regenerate: true })}
              disabled={change.isPending}
              title="The old link stops working straight away"
            >
              Replace the link
            </Btn>
            <Btn
              variant="danger"
              onClick={() => void apply({ enabled: false })}
              loading={change.isPending}
            >
              Turn the form off
            </Btn>
          </div>
        </>
      ) : (
        <div className="mt-4 flex justify-end">
          <Btn
            onClick={() => void apply({ enabled: true })}
            loading={change.isPending}
          >
            <Link2 size={14} />
            Turn the form on
          </Btn>
        </div>
      )}
      <FormAlert message={error} />
    </Modal>
  );
}

/** The complaints and feedback register. */
export default function FeedbackPage() {
  const params = useParams<{ id?: string }>();
  const [, navigate] = useLocation();
  const [status, setStatus] = useState<"open" | "all">("open");
  const [kind, setKind] = useState("");
  const [text, setText] = useState("");
  const q = useDebounced(text.trim(), 300);
  const list = useFeedback({ status, kind, q });
  const [logging, setLogging] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const totals = list.data?.totals;
  const open = (id?: string) =>
    navigate(id ? `/app/feedback/${id}` : "/app/feedback");

  return (
    <>
      <SectionHeading
        title="Complaints & feedback"
        subtitle="Every complaint, compliment and suggestion, who is looking after it and when it is due."
        actions={
          <>
            <Btn variant="secondary" onClick={() => setShowForm(true)}>
              <Link2 size={14} />
              Public form
              {list.data && (
                <span
                  className={`badge ${list.data.form.enabled ? "badge-approved" : "badge-draft"}`}
                >
                  {list.data.form.enabled ? "On" : "Off"}
                </span>
              )}
            </Btn>
            <Btn onClick={() => setLogging(true)}>
              <Plus size={14} />
              Log feedback
            </Btn>
          </>
        }
      />

      {totals && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi label="Open" value={totals.open} />
          <Kpi
            label="Past the due date"
            value={totals.overdue}
            tone={totals.overdue ? "warn" : undefined}
          />
          <Kpi
            label="Not acknowledged yet"
            value={totals.unacknowledged}
            tone={totals.unacknowledged ? "warn" : undefined}
          />
          <Kpi label="Resolved in 30 days" value={totals.closedRecently} />
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(
          [
            ["open", "Open"],
            ["all", "Everything"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setStatus(key)}
            className={`rounded-full px-3 py-1.5 !text-[11px] !font-semibold ${
              status === key
                ? "bg-[#e3f1ee] text-[#12766f]"
                : "border border-[#dde5e2] bg-white text-[#63757d]"
            }`}
          >
            {label}
          </button>
        ))}
        <select
          className="select h-[34px] !min-h-0 !w-[150px] !py-1 text-xs"
          value={kind}
          onChange={event => setKind(event.target.value)}
          aria-label="Filter by kind"
        >
          <option value="">All kinds</option>
          {FEEDBACK_KINDS.map(value => (
            <option key={value} value={value}>
              {value}s
            </option>
          ))}
        </select>
        <div className="relative ml-auto">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a979d]"
          />
          <input
            className="input h-[34px] !min-h-0 !w-[220px] !py-1 !pl-8 text-xs"
            value={text}
            onChange={event => setText(event.target.value)}
            placeholder="Search the register…"
            aria-label="Search the register"
          />
        </div>
      </div>

      {list.isError && (
        <ErrorBlock error={list.error} onRetry={() => list.refetch()} />
      )}
      <Panel>
        {list.isPending ? (
          <LoadingBlock />
        ) : list.data?.items.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Ref</th>
                  <th>Received</th>
                  <th>Kind</th>
                  <th>About</th>
                  <th>Raised by</th>
                  <th>Owner</th>
                  <th>Next step</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map(item => (
                  <tr
                    key={item.id}
                    className="cursor-pointer"
                    onClick={() => open(item.id)}
                  >
                    <td className="whitespace-nowrap font-semibold text-[#40535e]">
                      <button
                        type="button"
                        className="!font-semibold text-[#12766f]"
                        onClick={event => {
                          event.stopPropagation();
                          open(item.id);
                        }}
                      >
                        {item.id}
                      </button>
                    </td>
                    <td className="whitespace-nowrap text-xs">
                      {prettyDate(item.receivedOn)}
                    </td>
                    <td>
                      <span className={`badge ${KIND_BADGE[item.kind]}`}>
                        {item.kind}
                      </span>
                    </td>
                    <td className="max-w-[320px]">
                      <span className="block truncate text-xs font-semibold text-[#3d525c]">
                        {item.summary}
                      </span>
                      <span className="block truncate text-[10px] text-[#849198]">
                        {[item.area, item.participantName, item.staffName]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </td>
                    <td className="text-xs">
                      {item.raisedByName}
                      <span className="block text-[10px] text-[#849198]">
                        {item.relationship}
                        {item.viaPublicForm && " · public form"}
                      </span>
                    </td>
                    <td className="text-xs">{item.owner?.name ?? "—"}</td>
                    <td className="whitespace-nowrap text-xs">
                      {item.due ? (
                        <span
                          className={
                            item.due.overdue
                              ? "font-semibold text-[#a84540]"
                              : "text-[#52666f]"
                          }
                        >
                          {item.due.label} by {prettyDate(item.due.date)}
                          {item.due.overdue && " (overdue)"}
                        </span>
                      ) : (
                        "—"
                      )}
                      {item.openActions > 0 && (
                        <span className="block text-[10px] text-[#849198]">
                          {item.openActions} action
                          {item.openActions === 1 ? "" : "s"} open
                        </span>
                      )}
                    </td>
                    <td>
                      <Status value={item.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={<MessageSquareHeart size={19} />}
            title={
              q || kind
                ? "Nothing matches"
                : status === "open"
                  ? "Nothing open"
                  : "The register is empty"
            }
            text="Log what people tell you here, or turn on the public form so they can send it themselves."
            action={<Btn onClick={() => setLogging(true)}>Log feedback</Btn>}
          />
        )}
      </Panel>

      {logging && (
        <LogFeedbackDrawer
          onClose={() => setLogging(false)}
          onSaved={id => {
            setLogging(false);
            open(id);
          }}
        />
      )}
      {showForm && list.data && (
        <PublicFormModal
          form={list.data.form}
          onClose={() => setShowForm(false)}
        />
      )}
      {params.id && <FeedbackCaseDrawer id={params.id} onClose={() => open()} />}
    </>
  );
}
