import { Check, Plus, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "wouter";
import type { FeedbackCaseDTO } from "@shared/dto";
import {
  FEEDBACK_AREAS,
  FEEDBACK_PRIORITIES,
  FEEDBACK_SATISFACTION,
  FEEDBACK_STATUSES,
  type FeedbackArea,
  type FeedbackPriority,
  type FeedbackSatisfaction,
  type FeedbackStatus,
} from "@shared/enums";
import { errorMessage } from "@/api/client";
import {
  useAddFeedbackAction,
  useFeedbackCase,
  useFeedbackNote,
  useFeedbackOptions,
  useFeedbackStatus,
  useRemoveFeedbackAction,
  useUpdateFeedback,
  useUpdateFeedbackAction,
} from "@/api/hooks";
import {
  Btn,
  Drawer,
  ErrorBlock,
  FormAlert,
  LoadingBlock,
  Panel,
  Status,
} from "@/components/app/ui";
import { formatDateTime, prettyDate } from "@/lib/format";
import { useNotify } from "@/lib/notify";

/** The step a case is asked to take next, by where it stands now. */
const NEXT: Record<
  FeedbackStatus,
  Array<{ to: FeedbackStatus; label: string; primary?: boolean }>
> = {
  New: [{ to: "Acknowledged", label: "Acknowledge", primary: true }],
  Acknowledged: [
    { to: "Investigating", label: "Start looking into it" },
    { to: "Resolved", label: "Resolve", primary: true },
  ],
  Investigating: [{ to: "Resolved", label: "Resolve", primary: true }],
  Resolved: [
    { to: "Investigating", label: "Reopen" },
    { to: "Closed", label: "Close", primary: true },
  ],
  Closed: [{ to: "Investigating", label: "Reopen" }],
};

const HISTORY_LABEL: Record<string, string> = {
  logged: "Logged",
  "received from the public form": "Received from the public form",
  acknowledged: "Acknowledged",
  investigating: "Being looked into",
  resolved: "Resolved",
  closed: "Closed",
  reopened: "Reopened",
  note: "Note",
  "owner changed": "Owner changed",
  "action added": "Action added",
  "action done": "Action done",
  "action reopened": "Action reopened",
};

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-[.06em] text-[#849198]">
        {label}
      </dt>
      <dd className="mt-0.5 whitespace-pre-line text-xs leading-5 text-[#4f6169]">
        {children}
      </dd>
    </div>
  );
}

/** Where the case stands, the button for its next step, and what that step needs written down. */
function Progress({ data }: { data: FeedbackCaseDTO }) {
  const move = useFeedbackStatus();
  const notify = useNotify();
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState(data.outcome);
  const [satisfaction, setSatisfaction] = useState<FeedbackSatisfaction>(
    data.satisfaction
  );
  const [error, setError] = useState("");
  useEffect(() => {
    setOutcome(data.outcome);
    setSatisfaction(data.satisfaction);
  }, [data.outcome, data.satisfaction]);

  const reached = FEEDBACK_STATUSES.indexOf(data.status);
  const steps: Array<[FeedbackStatus, string | null]> = [
    ["New", data.createdAt],
    ["Acknowledged", data.acknowledgedAt],
    ["Investigating", null],
    ["Resolved", data.resolvedAt],
    ["Closed", data.closedAt],
  ];
  const canFinish = data.status !== "Resolved" && data.status !== "Closed";

  const go = async (to: FeedbackStatus) => {
    setError("");
    try {
      await move.mutateAsync({
        id: data.id,
        status: to,
        note: note.trim() || undefined,
        outcome:
          to === "Resolved" || to === "Closed" ? outcome.trim() : undefined,
        satisfaction: to === "Resolved" ? satisfaction : undefined,
        rev: data.rev,
      });
      notify(`${data.id} marked ${to.toLowerCase()}.`);
      setNote("");
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  return (
    <Panel title="Progress">
      <div className="p-5">
        <ol className="flex flex-wrap gap-x-1 gap-y-2">
          {steps.map(([step, at], index) => (
            <li key={step} className="flex min-w-[92px] flex-1 flex-col">
              <span
                className={`h-1.5 rounded-full ${
                  index <= reached ? "bg-[#2d8f86]" : "bg-[#e3e9e6]"
                }`}
              />
              <span
                className={`mt-1.5 text-[11px] font-semibold ${
                  index === reached
                    ? "text-[#12766f]"
                    : index < reached
                      ? "text-[#52666f]"
                      : "text-[#a3aeb1]"
                }`}
              >
                {step === "Investigating" ? "Looking into it" : step}
              </span>
              {at && index <= reached && (
                <span className="text-[10px] text-[#9aa5a8]">
                  {formatDateTime(at)}
                </span>
              )}
            </li>
          ))}
        </ol>

        {data.due && (
          <p
            className={`mt-4 rounded-md px-3 py-2 text-xs ${
              data.due.overdue
                ? "bg-[#fcebe9] text-[#a84540]"
                : "bg-[#f1f8f6] text-[#496663]"
            }`}
          >
            <b>{data.due.label}</b> by {prettyDate(data.due.date)}
            {data.due.overdue && " (overdue)"}
          </p>
        )}

        <div className="mt-4 space-y-3">
          {canFinish && (
            <>
              <label className="label">
                Outcome
                <textarea
                  className="textarea mt-1 !min-h-[70px]"
                  value={outcome}
                  onChange={event => setOutcome(event.target.value)}
                  placeholder="What was found, what was decided and what the person was told."
                />
                <span className="field-help block font-normal">
                  {data.kind === "Complaint"
                    ? "Needed before a complaint can be resolved."
                    : "Optional for a compliment or a suggestion."}
                </span>
              </label>
              <label className="label">
                Were they satisfied with the outcome?
                <select
                  className="select mt-1 !w-[180px] block"
                  value={satisfaction}
                  onChange={event =>
                    setSatisfaction(event.target.value as FeedbackSatisfaction)
                  }
                >
                  {FEEDBACK_SATISFACTION.map(value => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
            </>
          )}
          {!canFinish && data.outcome && (
            <Fact label="Outcome">
              {data.outcome}
              {data.satisfaction !== "Not asked" &&
                `\nSatisfied with the outcome: ${data.satisfaction}`}
            </Fact>
          )}
          <label className="label">
            Note for this step
            <input
              className="input mt-1"
              value={note}
              onChange={event => setNote(event.target.value)}
              placeholder="e.g. Rang back and apologised"
            />
          </label>
          <FormAlert message={error} />
          <div className="flex flex-wrap justify-end gap-2">
            {NEXT[data.status].map(step => (
              <Btn
                key={step.to}
                variant={step.primary ? "primary" : "secondary"}
                onClick={() => void go(step.to)}
                loading={move.isPending}
              >
                {step.primary && <Check size={14} />}
                {step.label}
              </Btn>
            ))}
          </div>
        </div>
      </div>
    </Panel>
  );
}

/** Who is seeing it through, when it is due, and what has to change so it does not happen again. */
function Handling({ data }: { data: FeedbackCaseDTO }) {
  const options = useFeedbackOptions();
  const update = useUpdateFeedback();
  const notify = useNotify();
  const [form, setForm] = useState({
    ownerId: data.owner?.id ?? "",
    resolveBy: data.resolveBy,
    priority: data.priority,
    area: data.area,
    improvementNeeded: data.improvementNeeded,
    improvement: data.improvement,
  });
  const [error, setError] = useState("");
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm(current => ({ ...current, [key]: value }));

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      await update.mutateAsync({ id: data.id, rev: data.rev, ...form });
      notify("Saved.");
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  return (
    <Panel title="Handling">
      <form className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2" onSubmit={save}>
        <label className="label">
          Owner
          <select
            className="select mt-1"
            value={form.ownerId}
            onChange={event => set("ownerId", event.target.value)}
          >
            <option value="">Nobody yet</option>
            {(options.data?.owners ?? []).map(owner => (
              <option key={owner.id} value={owner.id}>
                {owner.name}
              </option>
            ))}
          </select>
        </label>
        <label className="label">
          Resolve by
          <input
            type="date"
            className="input mt-1"
            value={form.resolveBy}
            onChange={event => set("resolveBy", event.target.value)}
          />
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
        <div className="sm:col-span-2">
          <label className="flex items-center gap-2 text-xs font-semibold text-[#344854]">
            <input
              type="checkbox"
              className="accent-[#147f79]"
              checked={form.improvementNeeded}
              onChange={event => set("improvementNeeded", event.target.checked)}
            />
            Something needs to change so this does not happen again
          </label>
          {form.improvementNeeded && (
            <textarea
              className="textarea mt-2 !min-h-[70px]"
              value={form.improvement}
              onChange={event => set("improvement", event.target.value)}
              placeholder="What will change, in the roster, a procedure, training…"
              aria-label="What will change"
            />
          )}
        </div>
        <div className="flex items-center justify-between gap-3 sm:col-span-2">
          <FormAlert message={error} />
          <Btn
            type="submit"
            variant="secondary"
            className="ml-auto"
            loading={update.isPending}
          >
            Save
          </Btn>
        </div>
      </form>
    </Panel>
  );
}

/** What has to be done as a result of the case, each with someone to do it and a date. */
function Actions({ data }: { data: FeedbackCaseDTO }) {
  const add = useAddFeedbackAction();
  const update = useUpdateFeedbackAction();
  const remove = useRemoveFeedbackAction();
  const [form, setForm] = useState({ description: "", owner: "", due: "" });
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      await add.mutateAsync({ id: data.id, ...form });
      setForm({ description: "", owner: "", due: "" });
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  return (
    <Panel title="Actions">
      <div className="p-5">
        {data.actions.length ? (
          <ul className="mb-4 divide-y divide-[#edf0ef]">
            {data.actions.map(action => (
              <li key={action.id} className="flex items-start gap-3 py-2.5">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-[#147f79]"
                  checked={Boolean(action.doneAt)}
                  aria-label={`${action.description} is done`}
                  onChange={event =>
                    update.mutate({
                      id: data.id,
                      actionId: action.id,
                      done: event.target.checked,
                    })
                  }
                />
                <span className="min-w-0 flex-1">
                  <span
                    className={`block text-xs ${
                      action.doneAt
                        ? "text-[#8a979d] line-through"
                        : "font-semibold text-[#3d525c]"
                    }`}
                  >
                    {action.description}
                  </span>
                  <span
                    className={`block text-[10px] ${
                      action.overdue ? "text-[#a84540]" : "text-[#849198]"
                    }`}
                  >
                    {[
                      action.owner,
                      action.doneAt
                        ? `Done ${formatDateTime(action.doneAt)}`
                        : action.due
                          ? `Due ${prettyDate(action.due)}${action.overdue ? " (overdue)" : ""}`
                          : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <button
                  type="button"
                  className="icon-btn !h-7 !w-7"
                  aria-label={`Remove ${action.description}`}
                  onClick={() =>
                    remove.mutate({ id: data.id, actionId: action.id })
                  }
                >
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-4 text-xs text-[#7b8990]">
            Nothing to do yet. Add anything that has to happen as a result.
          </p>
        )}
        <form className="flex flex-wrap items-end gap-2" onSubmit={submit}>
          <label className="label !mb-0 min-w-[200px] flex-1">
            What needs to be done
            <input
              required
              className="input mt-1"
              value={form.description}
              onChange={event =>
                setForm(current => ({
                  ...current,
                  description: event.target.value,
                }))
              }
            />
          </label>
          <label className="label !mb-0">
            Who
            <input
              className="input mt-1 !w-[130px] block"
              value={form.owner}
              onChange={event =>
                setForm(current => ({ ...current, owner: event.target.value }))
              }
            />
          </label>
          <label className="label !mb-0">
            By
            <input
              type="date"
              className="input mt-1 !w-[150px] block"
              value={form.due}
              onChange={event =>
                setForm(current => ({ ...current, due: event.target.value }))
              }
            />
          </label>
          <Btn type="submit" variant="secondary" loading={add.isPending}>
            <Plus size={14} />
            Add
          </Btn>
        </form>
        <FormAlert message={error} />
      </div>
    </Panel>
  );
}

function Timeline({ data }: { data: FeedbackCaseDTO }) {
  const addNote = useFeedbackNote();
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      await addNote.mutateAsync({ id: data.id, note: note.trim() });
      setNote("");
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  return (
    <Panel title="Timeline">
      <div className="p-5">
        <ol className="space-y-3">
          {[...data.history].reverse().map((entry, index) => (
            <li key={`${entry.at}-${index}`} className="flex gap-3">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#7cbdb5]" />
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-[#3d525c]">
                  {HISTORY_LABEL[entry.action] ?? entry.action}
                </span>
                {entry.note && (
                  <span className="block whitespace-pre-line text-xs leading-5 text-[#63757d]">
                    {entry.note}
                  </span>
                )}
                <span className="block text-[10px] text-[#9aa5a8]">
                  {entry.by?.name ?? "Public form"} · {formatDateTime(entry.at)}
                </span>
              </span>
            </li>
          ))}
        </ol>
        <form className="mt-4 flex items-end gap-2" onSubmit={submit}>
          <label className="label !mb-0 flex-1">
            Add a note
            <input
              required
              className="input mt-1"
              value={note}
              onChange={event => setNote(event.target.value)}
              placeholder="A call, an email, something you found out"
            />
          </label>
          <Btn type="submit" variant="secondary" loading={addNote.isPending}>
            Add
          </Btn>
        </form>
        <FormAlert message={error} />
      </div>
    </Panel>
  );
}

/** One complaint, compliment or suggestion: what was said, and everything done about it. */
export default function FeedbackCaseDrawer({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const detail = useFeedbackCase(id);
  const data = detail.data;

  return (
    <Drawer
      onClose={onClose}
      wide
      eyebrow={
        data
          ? `${data.id} · ${data.kind} · received ${prettyDate(data.receivedOn)}`
          : id
      }
      title={data ? data.summary : "Loading…"}
      subtitle={
        data ? `From ${data.raisedByName} (${data.relationship})` : undefined
      }
      footer={
        <div className="flex justify-end">
          <Btn variant="secondary" onClick={onClose}>
            Close
          </Btn>
        </div>
      }
    >
      {detail.isError ? (
        <ErrorBlock error={detail.error} onRetry={() => detail.refetch()} />
      ) : !data ? (
        <LoadingBlock />
      ) : (
        <div className="space-y-4">
          <Panel
            title="What was said"
            action={
              <span className="flex flex-wrap gap-2">
                <Status value={data.status} />
                <span className="badge badge-draft">{data.priority}</span>
              </span>
            }
          >
            <dl className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Fact label="In their words">{data.details}</Fact>
              </div>
              {data.desiredOutcome && (
                <div className="sm:col-span-2">
                  <Fact label="What they would like to happen">
                    {data.desiredOutcome}
                  </Fact>
                </div>
              )}
              <Fact label="Raised by">
                {data.raisedBy.anonymous && data.raisedBy.name
                  ? `${data.raisedBy.name} (asked not to be named)`
                  : data.raisedByName}
                {"\n"}
                {[data.raisedBy.phone, data.raisedBy.email]
                  .filter(Boolean)
                  .join(" · ") || "No contact details"}
                {"\n"}
                {data.raisedBy.wantsContact
                  ? "Would like to be contacted"
                  : "Did not ask to be contacted"}
              </Fact>
              <Fact label="How it arrived">
                {data.channel}
                {data.viaPublicForm && " (public form)"}
              </Fact>
              {(data.participantName || data.staffName || data.aboutText) && (
                <Fact label="About">
                  {data.participantId && (
                    <Link
                      href={`/app/clients/${data.participantId}`}
                      className="font-semibold text-[#12766f]"
                    >
                      {data.participantName}
                    </Link>
                  )}
                  {data.participantName && data.staffName && " · "}
                  {data.staffName}
                  {data.aboutText &&
                    `${data.participantName || data.staffName ? "\n" : ""}They wrote: ${data.aboutText}`}
                </Fact>
              )}
              {data.incidentId && (
                <Fact label="Linked incident">
                  <Link
                    href={`/app/worker-reports/incidents?open=${data.incidentId}`}
                    className="font-semibold text-[#12766f]"
                  >
                    {data.incidentLabel || "Open the incident"}
                  </Link>
                </Fact>
              )}
            </dl>
          </Panel>
          <Progress data={data} />
          <Handling data={data} />
          <Actions data={data} />
          <Timeline data={data} />
        </div>
      )}
    </Drawer>
  );
}
