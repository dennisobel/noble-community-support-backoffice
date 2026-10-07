import { Check, Siren } from "lucide-react";
import { useState } from "react";
import type { IncidentReportDTO } from "@shared/dto";
import {
  REPORTABLE_INCIDENT_TYPES,
  type ReportableIncidentType,
} from "@shared/enums";
import { errorMessage } from "@/api/client";
import { useIncidentReportable } from "@/api/hooks";
import { Btn, FormAlert, Panel } from "@/components/app/ui";
import { formatDateTime } from "@/lib/format";
import { useNotify } from "@/lib/notify";

const RESTRICTIVE_PRACTICE: ReportableIncidentType =
  "Unauthorised use of a restrictive practice";

/** An instant as the value of a datetime-local input, in the browser's own clock. */
function toLocalInput(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** "in 5 h 12 min", "in 3 days" or "3 h overdue". */
function untilText(due: string): string {
  const minutes = Math.round((new Date(due).getTime() - Date.now()) / 60_000);
  const size = Math.abs(minutes);
  const amount =
    size >= 48 * 60
      ? `${Math.round(size / 1440)} days`
      : size >= 60
        ? `${Math.floor(size / 60)} h ${size % 60} min`
        : `${size} min`;
  return minutes < 0 ? `${amount} overdue` : `in ${amount}`;
}

function Deadline({
  label,
  due,
  doneAt,
  onLodge,
  busy,
  children,
}: {
  label: string;
  due: string | null;
  doneAt: string | null;
  onLodge: (done: boolean) => void;
  busy: boolean;
  children?: React.ReactNode;
}) {
  if (!due) return null;
  const late = !doneAt && new Date(due).getTime() < Date.now();
  return (
    <div
      className={`rounded-md border p-3 ${
        doneAt
          ? "border-[#cfe6dc] bg-[#f1f8f4]"
          : late
            ? "border-[#f0d2d0] bg-[#fff2f0]"
            : "border-[#f3e2bd] bg-[#fff8e8]"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs font-bold text-[#344854]">{label}</div>
          <div
            className={`mt-0.5 text-[11px] ${
              doneAt
                ? "text-[#1d6f57]"
                : late
                  ? "font-semibold text-[#a84540]"
                  : "text-[#8a6224]"
            }`}
          >
            {doneAt
              ? `Lodged ${formatDateTime(doneAt)}`
              : `Due ${formatDateTime(due)} (${untilText(due)})`}
          </div>
        </div>
        <Btn
          variant={doneAt ? "quiet" : "secondary"}
          className="!h-8 !px-2 text-[11px]"
          onClick={() => onLodge(!doneAt)}
          loading={busy}
        >
          {doneAt ? (
            "Undo"
          ) : (
            <>
              <Check size={13} /> Mark as lodged
            </>
          )}
        </Btn>
      </div>
      {children}
    </div>
  );
}

/**
 * The NDIS Commission side of an incident. The office decides whether it is reportable; the
 * two deadlines are then counted from when key personnel became aware of it.
 */
export default function ReportablePanel({
  incident,
}: {
  incident: IncidentReportDTO;
}) {
  const save = useIncidentReportable();
  const notify = useNotify();
  const { reportable } = incident;
  const [type, setType] = useState<ReportableIncidentType | "">(
    reportable.type ?? ""
  );
  const [awareAt, setAwareAt] = useState(
    toLocalInput(reportable.awareAt ?? incident.created)
  );
  const [reference, setReference] = useState(reportable.notifiedReference);
  const [error, setError] = useState("");

  const send = async (
    input: Parameters<typeof save.mutateAsync>[0] extends infer T
      ? Omit<T, "id" | "rev">
      : never,
    done: string
  ) => {
    setError("");
    try {
      await save.mutateAsync({ id: incident.id, rev: incident.rev, ...input });
      notify(done);
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  if (!reportable.flagged)
    return (
      <Panel title="NDIS Commission" className="mt-4">
        <div className="p-5">
          <p className="text-xs leading-5 text-[#63757d]">
            If this is a reportable incident, mark it here and the two
            deadlines are counted for you: 24 hours for the notification and
            five business days for the detailed report.
          </p>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="label">
              Kind of reportable incident
              <select
                className="select mt-1"
                value={type}
                onChange={event =>
                  setType(event.target.value as ReportableIncidentType | "")
                }
              >
                <option value="">Choose…</option>
                {REPORTABLE_INCIDENT_TYPES.map(value => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label className="label">
              When the office became aware
              <input
                type="datetime-local"
                className="input mt-1"
                value={awareAt}
                onChange={event => setAwareAt(event.target.value)}
              />
              <span className="field-help block font-normal">
                Both deadlines count from this moment.
              </span>
            </label>
          </div>
          <FormAlert message={error} />
          <div className="mt-3 flex justify-end">
            <Btn
              variant="secondary"
              disabled={!type || !awareAt}
              loading={save.isPending}
              onClick={() =>
                void send(
                  {
                    flagged: true,
                    type: type || undefined,
                    awareAt: new Date(awareAt).toISOString(),
                  },
                  "Marked as reportable. The deadlines are running."
                )
              }
            >
              <Siren size={14} />
              Mark as reportable
            </Btn>
          </div>
        </div>
      </Panel>
    );

  return (
    <Panel
      title="NDIS Commission"
      className="mt-4"
      action={<span className="badge badge-danger">Reportable incident</span>}
    >
      <div className="space-y-3 p-5">
        <p className="text-xs leading-5 text-[#52666f]">
          <b className="text-[#344854]">{reportable.type}</b>
          <span className="block text-[11px] text-[#7b8990]">
            The office became aware {formatDateTime(reportable.awareAt)}.
          </span>
        </p>
        {reportable.type === RESTRICTIVE_PRACTICE && (
          <label className="flex items-start gap-2 text-xs text-[#52666f]">
            <input
              type="checkbox"
              className="mt-0.5 accent-[#147f79]"
              checked={reportable.harm}
              onChange={event =>
                void send(
                  { flagged: true, harm: event.target.checked },
                  "Deadlines updated."
                )
              }
            />
            <span>
              It caused harm to the participant
              <span className="field-help block">
                With harm, the 24-hour notification applies as well as the
                five-day report.
              </span>
            </span>
          </label>
        )}

        <Deadline
          label="Immediate notification (24 hours)"
          due={reportable.notifyBy}
          doneAt={reportable.notifiedAt}
          busy={save.isPending}
          onLodge={done =>
            void send(
              { flagged: true, notified: done, notifiedReference: reference },
              done ? "Notification recorded." : "Notification cleared."
            )
          }
        >
          <label className="label !mt-3 !mb-0">
            Commission reference
            <input
              className="input mt-1"
              value={reference}
              onChange={event => setReference(event.target.value)}
              onBlur={() => {
                if (reference !== reportable.notifiedReference)
                  void send(
                    { flagged: true, notifiedReference: reference },
                    "Reference saved."
                  );
              }}
              placeholder="The number on the notification, once you have it"
            />
          </label>
        </Deadline>
        <Deadline
          label="Five-day report (5 business days)"
          due={reportable.fiveDayBy}
          doneAt={reportable.fiveDayAt}
          busy={save.isPending}
          onLodge={done =>
            void send(
              { flagged: true, fiveDaySubmitted: done },
              done ? "Five-day report recorded." : "Five-day report cleared."
            )
          }
        />
        {!reportable.next && (
          <p className="text-[11px] font-semibold text-[#1d6f57]">
            Everything has been lodged.
          </p>
        )}
        <FormAlert message={error} />
        <div className="flex justify-end border-t border-[#edf0ef] pt-3">
          <Btn
            variant="quiet"
            className="!h-8 !px-2 text-[11px]"
            loading={save.isPending}
            onClick={() =>
              void send({ flagged: false }, "Marked as not reportable.")
            }
          >
            Not reportable after all
          </Btn>
        </div>
        <p className="text-[10px] leading-4 text-[#9aa5a8]">
          This records what you lodged; it does not send anything to the
          Commission. Lodge the notification through the NDIS Commission portal.
        </p>
      </div>
    </Panel>
  );
}
