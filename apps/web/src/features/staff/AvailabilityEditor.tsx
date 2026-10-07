import type { AvailabilityDayDTO } from "@shared/dto";
import {
  AVAILABILITY_MODES,
  WEEKDAYS,
  type AvailabilityMode,
} from "@shared/enums";

/** "Any time", "09:00–15:00" or "Not available": one day of a weekly pattern in a few words. */
export const availabilityLabel = (day: AvailabilityDayDTO) =>
  day.mode === "Set hours" ? `${day.from}–${day.to}` : day.mode;

/**
 * The seven days of a weekly availability pattern. Used by the office in a team member's
 * profile and by the worker in their portal, so both see and set exactly the same thing.
 */
export default function AvailabilityEditor({
  days,
  onChange,
  disabled = false,
}: {
  days: AvailabilityDayDTO[];
  onChange: (days: AvailabilityDayDTO[]) => void;
  disabled?: boolean;
}) {
  const set = (day: number, patch: Partial<AvailabilityDayDTO>) =>
    onChange(days.map(row => (row.day === day ? { ...row, ...patch } : row)));

  return (
    <div className="divide-y divide-[#edf1ef]">
      {days.map(row => (
        <div
          key={row.day}
          className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5"
        >
          <span className="w-[86px] text-xs font-semibold text-[#354a56]">
            {WEEKDAYS[row.day]}
          </span>
          <select
            className="select h-9 !min-h-0 !w-[140px] !py-1 text-xs"
            value={row.mode}
            disabled={disabled}
            aria-label={`${WEEKDAYS[row.day]} availability`}
            onChange={event => {
              const mode = event.target.value as AvailabilityMode;
              set(row.day, {
                mode,
                // Starting from ordinary working hours saves typing both times.
                from: mode === "Set hours" ? row.from || "09:00" : "",
                to: mode === "Set hours" ? row.to || "17:00" : "",
              });
            }}
          >
            {AVAILABILITY_MODES.map(mode => (
              <option key={mode}>{mode}</option>
            ))}
          </select>
          {row.mode === "Set hours" && (
            <span className="flex items-center gap-2 text-xs text-[#63757d]">
              <input
                type="time"
                className="input h-9 !min-h-0 !w-[112px] !py-1 text-xs"
                value={row.from}
                disabled={disabled}
                aria-label={`${WEEKDAYS[row.day]} from`}
                onChange={event => set(row.day, { from: event.target.value })}
              />
              to
              <input
                type="time"
                className="input h-9 !min-h-0 !w-[112px] !py-1 text-xs"
                value={row.to}
                disabled={disabled}
                aria-label={`${WEEKDAYS[row.day]} until`}
                onChange={event => set(row.day, { to: event.target.value })}
              />
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
