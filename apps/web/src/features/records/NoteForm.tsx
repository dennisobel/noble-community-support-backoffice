import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";
import type { ServiceRecordDTO } from "@shared/dto";
import { HEALTH_FLAGS, INCIDENT_FLAGS, SUPPORT_PROVIDED } from "@shared/enums";
import {
  healthNeedsDetails,
  incidentNeedsDetails,
  toggleHealth,
  toggleIncident,
  type NoteContent,
} from "@shared/logic/progress-note";

/** The back office and the phone-first worker portal share the form but not the styling. */
type Variant = "office" | "portal";

function Group({
  variant,
  title,
  hint,
  children,
}: {
  variant: Variant;
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  if (variant === "portal")
    return (
      <section className="portal-card mb-3">
        <h3 className="text-[12.5px] font-bold text-[#16323a]">{title}</h3>
        {hint && (
          <p className="mt-0.5 text-[10.5px] leading-4 text-[#7a888d]">
            {hint}
          </p>
        )}
        <div className="mt-3">{children}</div>
      </section>
    );
  return (
    <section className="border-t border-[#e9eeec] pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-xs font-bold text-[#344854]">{title}</h3>
      {hint && (
        <p className="mt-0.5 text-[10.5px] leading-4 text-[#8a969b]">{hint}</p>
      )}
      <div className="mt-3">{children}</div>
    </section>
  );
}

const Problem = ({ message }: { message?: string }) =>
  message ? (
    <p className="mt-1.5 text-[11px] font-semibold text-[#b9433e]" role="alert">
      {message}
    </p>
  ) : null;

function Ticks({
  variant,
  options,
  selected,
  onToggle,
  disabled,
  columns,
}: {
  variant: Variant;
  options: readonly string[];
  selected: string[];
  onToggle: (option: string) => void;
  disabled: boolean;
  columns: string;
}) {
  return (
    <div className={`grid gap-2 ${columns}`}>
      {options.map(option => {
        const on = selected.includes(option);
        return (
          <label
            key={option}
            className={`flex items-start gap-2 rounded-md border px-2.5 ${
              variant === "portal" ? "py-2.5 text-[12px]" : "py-2 text-xs"
            } ${
              on
                ? "border-[#8cc2ba] bg-[#eef8f5] font-semibold text-[#1f5a54]"
                : "border-[#dbe4e0] bg-white text-[#41555d]"
            } ${disabled ? "opacity-75" : "cursor-pointer"}`}
          >
            <input
              type="checkbox"
              className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[#177d76]"
              checked={on}
              disabled={disabled}
              onChange={() => onToggle(option)}
            />
            <span className="min-w-0 leading-4">{option}</span>
          </label>
        );
      })}
    </div>
  );
}

function TextBox({
  variant,
  id,
  label,
  hideLabel = false,
  required = false,
  value,
  onChange,
  disabled,
  hint,
  error,
  rows = 3,
}: {
  variant: Variant;
  id: string;
  label: string;
  /** Keeps the label for screen readers only, for a box the section heading already names. */
  hideLabel?: boolean;
  required?: boolean;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  hint?: string;
  error?: string;
  rows?: number;
}) {
  if (variant === "portal")
    return (
      <label className={`portal-field !mb-0 ${hideLabel ? "" : "mt-3"}`}>
        <span className={hideLabel ? "sr-only" : ""}>
          {label}
          {required && " *"}
        </span>
        <textarea
          id={id}
          rows={rows}
          placeholder={hint}
          value={value}
          disabled={disabled}
          aria-invalid={Boolean(error) || undefined}
          onChange={event => onChange(event.target.value)}
        />
        <Problem message={error} />
      </label>
    );
  return (
    <div className={hideLabel ? "" : "mt-3"}>
      <label className={hideLabel ? "sr-only" : "label"} htmlFor={id}>
        {label} {required && <span className="text-red-600">*</span>}
      </label>
      <textarea
        id={id}
        className="textarea"
        rows={rows}
        value={value}
        disabled={disabled}
        aria-invalid={Boolean(error) || undefined}
        onChange={event => onChange(event.target.value)}
      />
      <Problem message={error} />
      {hint && <p className="field-help">{hint}</p>}
    </div>
  );
}

function Callout({ children }: { children: ReactNode }) {
  return (
    <div className="mt-3 flex gap-2 rounded-md border border-[#ecd29d] bg-[#fff7e6] p-3 text-[11px] leading-5 text-[#7a5a14]">
      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/**
 * The written part of a progress note: support provided, the shift summary, health,
 * incidents and handover. The shift details above it belong to whichever screen shows the form.
 */
export function NoteForm({
  variant,
  value,
  onChange,
  errors = {},
  disabled = false,
  incidentAction,
}: {
  variant: Variant;
  value: NoteContent;
  onChange: <K extends keyof NoteContent>(key: K, next: NoteContent[K]) => void;
  errors?: Record<string, string | undefined>;
  disabled?: boolean;
  /** How to file the formal report from here: the worker gets the forms, the office a pointer to them. */
  incidentAction?: ReactNode;
}) {
  const toggleIn = (list: string[], option: string, order: readonly string[]) =>
    order.filter(item =>
      item === option ? !list.includes(option) : list.includes(item)
    );
  const healthAlert = healthNeedsDetails(value.health);
  const incidentAlert = incidentNeedsDetails(value.incident);
  const columns =
    variant === "portal"
      ? "grid-cols-1 min-[430px]:grid-cols-2"
      : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3";

  return (
    <div className={variant === "portal" ? "" : "space-y-5"}>
      <Group
        variant={variant}
        title="Support provided"
        hint="Tick everything you helped with on this shift."
      >
        <Ticks
          variant={variant}
          options={SUPPORT_PROVIDED}
          selected={value.supportTypes}
          disabled={disabled}
          columns={columns}
          onToggle={option =>
            onChange(
              "supportTypes",
              toggleIn(value.supportTypes, option, SUPPORT_PROVIDED)
            )
          }
        />
        <Problem message={errors.supportTypes} />
      </Group>

      <Group variant={variant} title="Shift summary">
        <TextBox
          variant={variant}
          id="note-summary"
          label="What happened on the shift"
          hideLabel
          required
          value={value.summary}
          disabled={disabled}
          error={errors.summary}
          hint="Activities completed, the help you gave, the participant's choices and preferences, how engaged they were, and anything you observed. Stick to what you saw and heard."
          rows={5}
          onChange={next => onChange("summary", next)}
        />
      </Group>

      <Group variant={variant} title="Health and wellbeing">
        <Ticks
          variant={variant}
          options={HEALTH_FLAGS}
          selected={value.health}
          disabled={disabled}
          columns={
            variant === "portal" ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2"
          }
          onToggle={option =>
            onChange("health", toggleHealth(value.health, option))
          }
        />
        <Problem message={errors.health} />
        {(healthAlert || value.healthDetails) && (
          <>
            {healthAlert && !disabled && (
              <Callout>
                <b>Tell your team leader about this today.</b> If it cannot
                wait, call them now. In an emergency call 000 first.
              </Callout>
            )}
            <TextBox
              variant={variant}
              id="note-health"
              label="What is the concern, and who has been told?"
              required={healthAlert}
              value={value.healthDetails}
              disabled={disabled}
              error={errors.healthDetails}
              hint="What you noticed, what you did, who you told and what needs to happen next."
              onChange={next => onChange("healthDetails", next)}
            />
          </>
        )}
      </Group>

      <Group variant={variant} title="Incidents and behaviours of concern">
        <Ticks
          variant={variant}
          options={INCIDENT_FLAGS}
          selected={value.incident}
          disabled={disabled}
          columns={
            variant === "portal" ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-3"
          }
          onToggle={option =>
            onChange("incident", toggleIncident(value.incident, option))
          }
        />
        <Problem message={errors.incident} />
        {(incidentAlert || value.incidentDetails) && (
          <>
            {incidentAlert && (
              <Callout>
                <b>This note does not replace an incident report.</b> A separate
                report must be completed for every incident and behaviour of
                concern.
                {incidentAction && <div className="mt-2">{incidentAction}</div>}
              </Callout>
            )}
            <TextBox
              variant={variant}
              id="note-incident"
              label="Briefly, what happened?"
              required={incidentAlert}
              value={value.incidentDetails}
              disabled={disabled}
              error={errors.incidentDetails}
              hint="A short factual summary. The full account goes in the incident report."
              rows={2}
              onChange={next => onChange("incidentDetails", next)}
            />
          </>
        )}
      </Group>

      <Group variant={variant} title="Handover and follow-up">
        <TextBox
          variant={variant}
          id="note-handover"
          label="For the next support worker and the office"
          value={value.followUp}
          disabled={disabled}
          hint="Outstanding tasks, updates about the participant, follow-up appointments, and anything the next worker needs to know."
          onChange={next => onChange("followUp", next)}
        />
      </Group>
    </div>
  );
}

/** The note as label and text pairs, leaving out whatever was not filled in. For read-only views. */
export function noteLines(note: NoteContent): Array<[string, string]> {
  const withDetails = (ticked: string[], details: string) =>
    [ticked.join(", "), details].filter(Boolean).join(". ");
  return (
    [
      ["Support provided", withDetails(note.supportTypes, note.support)],
      ["Shift summary", note.summary],
      ["Goals worked on", note.goals.join("; ")],
      ["Progress towards goals", note.outcome],
      ["Achievements", note.achievements],
      ["Health and wellbeing", withDetails(note.health, note.healthDetails)],
      ["Incidents", withDetails(note.incident, note.incidentDetails)],
      ["Handover", note.followUp],
    ] as Array<[string, string]>
  ).filter(([, text]) => text.trim());
}

/** Small badges for what a note needs a reader to know before opening it. */
export function NoteFlags({
  record,
}: {
  record: Pick<
    ServiceRecordDTO,
    "amended" | "health" | "incident" | "amendmentRequests"
  >;
}) {
  const waiting = record.amendmentRequests.some(
    request => request.status === "Open"
  );
  return (
    <>
      {record.amended && <span className="badge badge-invoiced">Amended</span>}
      {healthNeedsDetails(record.health) && (
        <span className="badge badge-returned">Health</span>
      )}
      {incidentNeedsDetails(record.incident) && (
        <span className="badge badge-danger">Incident</span>
      )}
      {waiting && (
        <span className="badge badge-submitted">Amendment requested</span>
      )}
    </>
  );
}
