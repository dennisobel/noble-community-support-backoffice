import { CalendarOff, Pencil } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import type { AvailabilityDayDTO, StaffDTO } from "@shared/dto";
import { WEEKDAYS } from "@shared/enums";
import { errorMessage } from "@/api/client";
import {
  useLeave,
  useSetStaffAvailability,
  useStaffAvailability,
} from "@/api/hooks";
import {
  Btn,
  ErrorBlock,
  FormAlert,
  LoadingBlock,
  Panel,
  Status,
} from "@/components/app/ui";
import { formatDateTime, prettyDate } from "@/lib/format";
import { useNotify } from "@/lib/notify";
import AvailabilityEditor, { availabilityLabel } from "./AvailabilityEditor";

/** When one team member can work, and the time off they have coming up. */
export default function StaffAvailability({ member }: { member: StaffDTO }) {
  const availability = useStaffAvailability(member.id);
  const leave = useLeave({ staffId: member.id });
  const save = useSetStaffAvailability();
  const notify = useNotify();
  const [draft, setDraft] = useState<AvailabilityDayDTO[] | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const submit = async () => {
    if (!draft) return;
    setError("");
    try {
      await save.mutateAsync({ staffId: member.id, days: draft, note });
      notify(`${member.name}'s availability saved.`);
      setDraft(null);
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  const upcoming = (leave.data ?? []).filter(
    request => request.status === "Pending" || request.status === "Approved"
  );
  const data = availability.data;

  return (
    <Panel
      title="Availability & time off"
      action={
        data && !draft ? (
          <Btn
            variant="secondary"
            className="!h-8 !px-2 text-[11px]"
            onClick={() => {
              setDraft(data.days);
              setNote(data.note);
            }}
          >
            <Pencil size={12} />
            {data.set ? "Edit" : "Set availability"}
          </Btn>
        ) : undefined
      }
    >
      {availability.isError ? (
        <div className="p-5">
          <ErrorBlock
            error={availability.error}
            onRetry={() => availability.refetch()}
          />
        </div>
      ) : !data ? (
        <LoadingBlock />
      ) : draft ? (
        <div className="p-5">
          <AvailabilityEditor
            days={draft}
            onChange={setDraft}
            disabled={save.isPending}
          />
          <label className="label !mt-4">
            Note
            <input
              className="input mt-1"
              value={note}
              onChange={event => setNote(event.target.value)}
              placeholder="e.g. School pick-up on Thursdays"
            />
          </label>
          <FormAlert message={error} />
          <div className="mt-4 flex justify-end gap-2">
            <Btn
              variant="secondary"
              onClick={() => setDraft(null)}
              disabled={save.isPending}
            >
              Cancel
            </Btn>
            <Btn onClick={() => void submit()} loading={save.isPending}>
              Save availability
            </Btn>
          </div>
        </div>
      ) : (
        <div className="p-5">
          {data.set ? (
            <>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                {data.days.map(day => (
                  <div key={day.day}>
                    <dt className="text-[10px] uppercase tracking-[.06em] text-[#849198]">
                      {WEEKDAYS[day.day].slice(0, 3)}
                    </dt>
                    <dd
                      className={`mt-0.5 text-xs font-semibold ${
                        day.mode === "Not available"
                          ? "text-[#a84540]"
                          : "text-[#3d525c]"
                      }`}
                    >
                      {availabilityLabel(day)}
                    </dd>
                  </div>
                ))}
              </dl>
              {data.note && (
                <p className="mt-3 text-xs leading-5 text-[#63757d]">
                  {data.note}
                </p>
              )}
              <p className="mt-3 text-[10px] text-[#849198]">
                Last changed {formatDateTime(data.updatedAt)}
                {data.updatedBy ? ` by ${data.updatedBy.name}` : ""}
              </p>
            </>
          ) : (
            <p className="text-xs leading-5 text-[#63757d]">
              No pattern has been set, so the roster treats {member.name} as
              available at any time. They can set it themselves in the worker
              portal, under Schedule.
            </p>
          )}

          <div className="mt-4 border-t border-[#edf0ef] pt-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-[10px] font-bold uppercase tracking-[.06em] text-[#849198]">
                Time off
              </span>
              <Link
                href="/app/staff/leave"
                className="text-[11px] font-semibold text-[#12766f]"
              >
                All requests
              </Link>
            </div>
            {upcoming.length ? (
              <ul className="space-y-2">
                {upcoming.slice(0, 4).map(request => (
                  <li
                    key={request.id}
                    className="flex flex-wrap items-center gap-2 text-xs text-[#52666f]"
                  >
                    <CalendarOff size={13} className="text-[#849198]" />
                    <span className="font-semibold text-[#3d525c]">
                      {request.type}
                    </span>
                    {prettyDate(request.from)}
                    {request.to !== request.from &&
                      ` – ${prettyDate(request.to)}`}
                    <Status value={request.status} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-[#7b8990]">Nothing coming up.</p>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}
