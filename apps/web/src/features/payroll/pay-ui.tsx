import { ChevronLeft, ChevronRight } from "lucide-react";
import type { PayLineDTO, PayPeriodDTO } from "@shared/dto";
import { addDays } from "@shared/logic/time";
import { money, prettyDate } from "@/lib/format";

/** "3 h 15 min" from 195 minutes; "−10 min" for a negative difference. */
export function minutesText(minutes: number): string {
  const sign = minutes < 0 ? "−" : "";
  const total = Math.abs(Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (!hours) return `${sign}${rest} min`;
  return rest ? `${sign}${hours} h ${rest} min` : `${sign}${hours} h`;
}

export const hoursText = (hours: number) =>
  `${Math.round(hours * 100) / 100} h`;

/** Steps through pay periods. The parent keeps any date inside the period it wants to show. */
export function PeriodNav({
  period,
  onChange,
}: {
  period: PayPeriodDTO;
  onChange: (date: string | undefined) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="icon-btn border !border-[#dce4e1] !bg-white"
        aria-label="Previous pay period"
        onClick={() => onChange(addDays(period.from, -1))}
      >
        <ChevronLeft size={16} />
      </button>
      <div className="min-w-[210px] text-center">
        <div className="text-sm font-semibold text-[#2c4250]">
          {period.label}
        </div>
        <div className="text-[10px] text-[#849198]">
          {period.length} pay period{period.current ? " · this one" : ""}
        </div>
      </div>
      <button
        type="button"
        className="icon-btn border !border-[#dce4e1] !bg-white"
        aria-label="Next pay period"
        onClick={() => onChange(addDays(period.to, 1))}
      >
        <ChevronRight size={16} />
      </button>
      {!period.current && (
        <button
          type="button"
          className="!text-[11px] !font-semibold text-[#12766f]"
          onClick={() => onChange(undefined)}
        >
          This period
        </button>
      )}
    </div>
  );
}

/** Pay lines with the rule behind each one, so nobody has to take an amount on trust. */
export function PayLines({
  lines,
  showDate = false,
}: {
  lines: PayLineDTO[];
  showDate?: boolean;
}) {
  if (!lines.length)
    return <p className="text-xs text-[#7b8990]">Nothing to pay.</p>;
  return (
    <div className="table-wrap">
      <table className="data-table !min-w-[520px]">
        <thead>
          <tr>
            {showDate && <th>Date</th>}
            <th>Pay item</th>
            <th className="text-right">Hours</th>
            <th className="text-right">Rate</th>
            <th className="text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => (
            <tr key={`${line.shiftId}-${line.code}-${line.date}-${index}`}>
              {showDate && (
                <td className="whitespace-nowrap text-xs">
                  {prettyDate(line.date)}
                  {line.shiftId && (
                    <span className="block text-[10px] text-[#9aa5a8]">
                      {line.shiftId}
                    </span>
                  )}
                </td>
              )}
              <td>
                <span className="text-xs font-semibold text-[#3d525c]">
                  {line.label}
                </span>
                <span className="mt-0.5 block text-[10px] leading-4 text-[#849198]">
                  {line.why}
                </span>
              </td>
              <td className="text-right text-xs">
                {line.hours ? hoursText(line.hours) : "—"}
              </td>
              <td className="text-right text-xs">
                {line.hours || line.units ? money(line.rate) : "—"}
              </td>
              <td className="text-right text-xs font-semibold text-[#2c4250]">
                {money(line.amount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A figure with its label, for the row of totals above a table. */
export function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "warn";
}) {
  return (
    <div className="panel px-4 py-3">
      <div className="text-[10px] uppercase tracking-[.07em] text-[#849198]">
        {label}
      </div>
      <div
        className={`mt-1 text-xl font-semibold tracking-[-.02em] ${
          tone === "warn" ? "text-[#9a6419]" : "text-[#223644]"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
