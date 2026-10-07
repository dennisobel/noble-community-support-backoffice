import { Check, Plus, Trash2, TriangleAlert } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import type {
  AwardRulesDTO,
  PaySettingsDTO,
  StaffPayDTO,
} from "@shared/dto";
import { PAY_PERIOD_LENGTHS, type PayPeriodLength } from "@shared/enums";
import { nationalHolidays } from "@shared/logic/holidays";
import { errorMessage } from "@/api/client";
import {
  usePaySettings,
  useSetPayRate,
  useStaffPay,
  useUpdatePaySettings,
} from "@/api/hooks";
import {
  Btn,
  ErrorBlock,
  FormAlert,
  InfoNote,
  LoadingBlock,
  Panel,
  Status,
} from "@/components/app/ui";
import { money, prettyDate } from "@/lib/format";
import { useNotify } from "@/lib/notify";

/** Names only: the rates differ every July and must come from the pay guide. */
const USUAL_LEVELS = [
  "SACS Level 2 – Pay point 1",
  "SACS Level 2 – Pay point 2",
  "SACS Level 2 – Pay point 3",
  "SACS Level 2 – Pay point 4",
  "SACS Level 3 – Pay point 1",
  "SACS Level 3 – Pay point 2",
  "SACS Level 3 – Pay point 3",
  "SACS Level 3 – Pay point 4",
  "Home care (disability) Level 1",
  "Home care (disability) Level 2 – Pay point 1",
  "Home care (disability) Level 2 – Pay point 2",
  "Home care (disability) Level 3 – Pay point 1",
  "Home care (disability) Level 3 – Pay point 2",
];

type NumberRule = {
  [K in keyof AwardRulesDTO]: AwardRulesDTO[K] extends number ? K : never;
}[keyof AwardRulesDTO];

interface Field {
  key: NumberRule;
  label: string;
  unit: "%" | "h" | "min";
  help?: string;
}

/** The award's percentages and thresholds, grouped the way the award talks about them. */
const GROUPS: Array<{ title: string; fields: Field[] }> = [
  {
    title: "Loadings and penalty rates",
    fields: [
      { key: "casualLoadingPct", label: "Casual loading", unit: "%" },
      { key: "saturdayPct", label: "Saturday", unit: "%" },
      { key: "sundayPct", label: "Sunday", unit: "%" },
      { key: "publicHolidayPct", label: "Public holiday", unit: "%" },
      {
        key: "afternoonLoadingPct",
        label: "Afternoon shift loading",
        unit: "%",
        help: "Whole shift, when it finishes after the span of hours and by midnight.",
      },
      {
        key: "nightLoadingPct",
        label: "Night shift loading",
        unit: "%",
        help: "Whole shift, when it finishes after midnight or starts before the span.",
      },
    ],
  },
  {
    title: "Overtime",
    fields: [
      { key: "overtimeDailyHours", label: "Hours in a day before overtime", unit: "h" },
      {
        key: "overtimeWeeklyHours",
        label: "Hours in a week before overtime",
        unit: "h",
        help: "Doubled when the pay period is a fortnight.",
      },
      { key: "overtimeFirstPct", label: "First overtime rate", unit: "%" },
      {
        key: "overtimeFirstHours",
        label: "Hours at the first rate",
        unit: "h",
        help: "2 for disability and home care work; 3 for other social and community services work.",
      },
      { key: "overtimeAfterPct", label: "Rate after that", unit: "%" },
      { key: "overtimeSundayPct", label: "Overtime on a Sunday", unit: "%" },
      {
        key: "overtimePublicHolidayPct",
        label: "Overtime on a public holiday",
        unit: "%",
      },
    ],
  },
  {
    title: "Short and broken shifts",
    fields: [
      {
        key: "minimumEngagementHours",
        label: "Minimum engagement",
        unit: "h",
        help: "Part-time and casual staff are paid at least this for each period of work.",
      },
      {
        key: "brokenShiftGapMinutes",
        label: "Longest gap that is not a broken shift",
        unit: "min",
        help: "A shorter gap between two visits is treated as a meal break.",
      },
      { key: "brokenShiftSpanHours", label: "Span of a broken shift", unit: "h" },
      {
        key: "brokenShiftBeyondSpanPct",
        label: "Rate beyond the span",
        unit: "%",
      },
      {
        key: "brokenShiftOneBreakPct",
        label: "Allowance, one break",
        unit: "%",
        help: "Percentage of the weekly standard rate.",
      },
      {
        key: "brokenShiftTwoBreaksPct",
        label: "Allowance, two breaks",
        unit: "%",
        help: "Percentage of the weekly standard rate.",
      },
    ],
  },
  {
    title: "Sleepovers, rest and leave",
    fields: [
      {
        key: "sleepoverAllowancePct",
        label: "Sleepover allowance",
        unit: "%",
        help: "Percentage of the weekly standard rate, per night.",
      },
      {
        key: "sleepoverMinimumMinutes",
        label: "Least paid for work during a sleepover",
        unit: "min",
      },
      {
        key: "restBetweenShiftsHours",
        label: "Break between shifts",
        unit: "h",
        help: "A shorter break is flagged on the roster and the timesheet.",
      },
      { key: "annualLeaveLoadingPct", label: "Annual leave loading", unit: "%" },
    ],
  },
];

interface Draft {
  rules: Record<string, string | boolean>;
  classifications: Array<{
    id?: string;
    name: string;
    rates: Array<{ effectiveFrom: string; hourly: string }>;
  }>;
  publicHolidays: Array<{ date: string; name: string }>;
  length: PayPeriodLength;
  anchor: string;
  tolerance: string;
}

function toDraft(settings: PaySettingsDTO): Draft {
  return {
    rules: Object.fromEntries(
      Object.entries(settings.rules).map(([key, value]) => [
        key,
        typeof value === "number" ? String(value) : value,
      ])
    ),
    classifications: settings.classifications.map(item => ({
      id: item.id,
      name: item.name,
      rates: item.rates.map(rate => ({
        effectiveFrom: rate.effectiveFrom,
        hourly: String(rate.hourly),
      })),
    })),
    publicHolidays: settings.publicHolidays,
    length: settings.payPeriod.length,
    anchor: settings.payPeriod.anchor,
    tolerance: String(settings.toleranceMinutes),
  };
}

/** Who is ready to be paid, and a rate agreed with one person in place of their classification's. */
function PeopleRates() {
  const people = useStaffPay();
  const setRate = useSetPayRate();
  const notify = useNotify();
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(
    null
  );

  const save = async (person: StaffPayDTO) => {
    if (!editing) return;
    const value = editing.value.trim();
    try {
      await setRate.mutateAsync({
        staffId: person.staffId,
        payRateOverride: value ? Number(value) : null,
      });
      notify(
        value
          ? `${person.name} is paid ${money(Number(value))} an hour.`
          : `${person.name} is back on their classification's rate.`
      );
      setEditing(null);
    } catch (failure) {
      notify(errorMessage(failure), "error");
    }
  };

  return (
    <Panel title="People and their rates">
      {people.isPending ? (
        <LoadingBlock />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Team member</th>
                <th>Employment</th>
                <th>Classification</th>
                <th className="text-right">Ordinary rate today</th>
                <th>Agreed rate</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(people.data ?? [])
                .filter(person => person.status !== "Inactive")
                .map(person => (
                  <tr key={person.staffId}>
                    <td className="font-semibold text-[#40535e]">
                      {person.name}
                      {person.payrollId && (
                        <span className="block text-[10px] font-normal text-[#849198]">
                          {person.payrollId}
                        </span>
                      )}
                    </td>
                    <td>{person.employmentType ?? "—"}</td>
                    <td>{person.classificationName || "—"}</td>
                    <td className="text-right font-semibold">
                      {person.baseRate === null ? "—" : money(person.baseRate)}
                    </td>
                    <td>
                      {editing?.id === person.staffId ? (
                        <span className="flex items-center gap-1.5">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            autoFocus
                            className="input h-8 !min-h-0 !w-[96px] !py-1 text-xs"
                            value={editing.value}
                            onChange={event =>
                              setEditing({
                                id: person.staffId,
                                value: event.target.value,
                              })
                            }
                            placeholder="None"
                            aria-label={`Agreed hourly rate for ${person.name}`}
                          />
                          <Btn
                            className="!h-8 !px-2 text-[11px]"
                            onClick={() => void save(person)}
                            loading={setRate.isPending}
                          >
                            Save
                          </Btn>
                          <Btn
                            variant="quiet"
                            className="!h-8 !px-2 text-[11px]"
                            onClick={() => setEditing(null)}
                          >
                            Cancel
                          </Btn>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="!text-xs !font-semibold text-[#12766f]"
                          onClick={() =>
                            setEditing({
                              id: person.staffId,
                              value: person.payRateOverride
                                ? String(person.payRateOverride)
                                : "",
                            })
                          }
                        >
                          {person.payRateOverride
                            ? `${money(person.payRateOverride)} · change`
                            : "Set a rate"}
                        </button>
                      )}
                    </td>
                    <td>
                      {person.missing ? (
                        <span className="badge badge-returned">
                          {person.missing}
                        </span>
                      ) : (
                        <Status value="Ready" />
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="border-t border-[#edf0ef] px-5 py-3 text-[11px] leading-5 text-[#7b8990]">
        Employment type and classification are set in each person's Staff
        profile. An agreed rate replaces the classification's rate for that
        person only: use it for anyone paid above the award.
      </p>
    </Panel>
  );
}

/** The award settings behind every timesheet and pay run. */
export default function PayRulesTab() {
  const settings = usePaySettings();
  const update = useUpdatePaySettings();
  const notify = useNotify();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [holiday, setHoliday] = useState({ date: "", name: "" });
  const thisYear = new Date().getFullYear();

  const rev = settings.data?.rev;
  useEffect(() => {
    if (settings.data) setDraft(toDraft(settings.data));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rev]);

  if (settings.isError)
    return (
      <ErrorBlock error={settings.error} onRetry={() => settings.refetch()} />
    );
  if (!settings.data || !draft) return <LoadingBlock />;

  const change = (patch: Partial<Draft>) =>
    setDraft(current => (current ? { ...current, ...patch } : current));
  const setRule = (key: string, value: string | boolean) =>
    change({ rules: { ...draft.rules, [key]: value } });
  const setClass = (index: number, patch: Partial<Draft["classifications"][0]>) =>
    change({
      classifications: draft.classifications.map((item, at) =>
        at === index ? { ...item, ...patch } : item
      ),
    });

  const addHolidays = (list: Array<{ date: string; name: string }>) => {
    const byDate = new Map(draft.publicHolidays.map(day => [day.date, day]));
    for (const day of list) if (!byDate.has(day.date)) byDate.set(day.date, day);
    change({
      publicHolidays: [...byDate.values()].sort((a, b) =>
        a.date.localeCompare(b.date)
      ),
    });
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    const rules: Record<string, number | string | boolean> = {};
    for (const [key, value] of Object.entries(draft.rules)) {
      if (typeof value === "boolean" || key === "spanStart" || key === "spanEnd")
        rules[key] = value;
      else {
        const number = Number(value);
        if (value.trim() === "" || !Number.isFinite(number))
          return setError("Every rule needs a number. Check the fields below.");
        rules[key] = number;
      }
    }
    try {
      await update.mutateAsync({
        rev: settings.data.rev,
        rules,
        classifications: draft.classifications.map(item => ({
          id: item.id,
          name: item.name.trim(),
          rates: item.rates
            .filter(rate => rate.effectiveFrom && rate.hourly.trim() !== "")
            .map(rate => ({
              effectiveFrom: rate.effectiveFrom,
              hourly: Number(rate.hourly),
            })),
        })),
        publicHolidays: draft.publicHolidays,
        payPeriod: { length: draft.length, anchor: draft.anchor },
        toleranceMinutes: Number(draft.tolerance) || 0,
      });
      notify("Pay rules saved.");
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  const numberInput = (field: Field) => (
    <label key={field.key} className="label">
      {field.label}
      <span className="mt-1 flex items-center gap-1.5">
        <input
          type="number"
          min="0"
          step="any"
          className="input !w-[110px]"
          value={String(draft.rules[field.key] ?? "")}
          onChange={event => setRule(field.key, event.target.value)}
        />
        <span className="text-xs font-normal text-[#849198]">{field.unit}</span>
      </span>
      {field.help && (
        <span className="field-help block font-normal">{field.help}</span>
      )}
    </label>
  );

  return (
    <div className="space-y-5">
      {settings.data.missing.length > 0 && (
        <div className="rounded-lg border border-[#f3e2bd] bg-[#fff8e8] p-4">
          <div className="flex items-center gap-2 text-xs font-bold text-[#8a6224]">
            <TriangleAlert size={14} />
            Still to set up before the amounts can be relied on
          </div>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-[#8a6224]">
            {settings.data.missing.map(item => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
      <InfoNote>
        The percentages below are the SCHADS Award's for disability support
        work. The dollar amounts (hourly rates, the standard rate and the
        per-kilometre allowance) change each July and are left for you to enter
        from the Fair Work pay guide. Check every value against the current pay
        guide before paying anyone from these figures.
      </InfoNote>

      <form className="space-y-5" onSubmit={save}>
        <Panel title="Pay period and timesheets">
          <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-3">
            <label className="label">
              Pay period
              <select
                className="select mt-1"
                value={draft.length}
                onChange={event =>
                  change({ length: event.target.value as PayPeriodLength })
                }
              >
                {PAY_PERIOD_LENGTHS.map(length => (
                  <option key={length}>{length}</option>
                ))}
              </select>
            </label>
            <label className="label">
              A day a pay period starts on
              <input
                required
                type="date"
                className="input mt-1"
                value={draft.anchor}
                onChange={event => change({ anchor: event.target.value })}
              />
              <span className="field-help block font-normal">
                Every other period is counted from this one.
              </span>
            </label>
            <label className="label">
              Pay as rostered when within
              <span className="mt-1 flex items-center gap-1.5">
                <input
                  type="number"
                  min="0"
                  max="60"
                  className="input !w-[110px]"
                  value={draft.tolerance}
                  onChange={event => change({ tolerance: event.target.value })}
                />
                <span className="text-xs font-normal text-[#849198]">min</span>
              </span>
              <span className="field-help block font-normal">
                A sign-on or sign-off this close to the roster is paid as
                rostered.
              </span>
            </label>
          </div>
        </Panel>

        <Panel
          title="Classifications and hourly rates"
          action={
            <span className="flex flex-wrap gap-2">
              <Btn
                variant="quiet"
                className="!h-8 !px-2 text-[11px]"
                onClick={() => {
                  const have = new Set(
                    draft.classifications.map(item => item.name.toLowerCase())
                  );
                  change({
                    classifications: [
                      ...draft.classifications,
                      ...USUAL_LEVELS.filter(
                        name => !have.has(name.toLowerCase())
                      ).map(name => ({ name, rates: [] })),
                    ],
                  });
                }}
              >
                Add the usual SCHADS levels
              </Btn>
              <Btn
                variant="secondary"
                className="!h-8 !px-2 text-[11px]"
                onClick={() =>
                  change({
                    classifications: [
                      ...draft.classifications,
                      { name: "", rates: [{ effectiveFrom: "", hourly: "" }] },
                    ],
                  })
                }
              >
                <Plus size={13} />
                Add classification
              </Btn>
            </span>
          }
        >
          {draft.classifications.length ? (
            <div className="divide-y divide-[#edf0ef]">
              {draft.classifications.map((item, index) => (
                <div key={item.id ?? `new-${index}`} className="p-5">
                  <div className="flex items-end gap-2">
                    <label className="label !mb-0 flex-1">
                      Classification
                      <input
                        required
                        className="input mt-1"
                        value={item.name}
                        onChange={event =>
                          setClass(index, { name: event.target.value })
                        }
                        placeholder="e.g. SACS Level 2 – Pay point 1"
                      />
                    </label>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Remove ${item.name || "classification"}`}
                      onClick={() =>
                        change({
                          classifications: draft.classifications.filter(
                            (_, at) => at !== index
                          ),
                        })
                      }
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <div className="mt-3 space-y-2">
                    {item.rates.map((rate, rateIndex) => (
                      <div
                        key={rateIndex}
                        className="flex flex-wrap items-center gap-2 text-xs text-[#63757d]"
                      >
                        <span className="w-[42px]">From</span>
                        <input
                          type="date"
                          className="input h-9 !min-h-0 !w-[150px] !py-1 text-xs"
                          value={rate.effectiveFrom}
                          aria-label={`${item.name} rate starts`}
                          onChange={event =>
                            setClass(index, {
                              rates: item.rates.map((row, at) =>
                                at === rateIndex
                                  ? { ...row, effectiveFrom: event.target.value }
                                  : row
                              ),
                            })
                          }
                        />
                        <span>$</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          className="input h-9 !min-h-0 !w-[100px] !py-1 text-xs"
                          value={rate.hourly}
                          placeholder="0.00"
                          aria-label={`${item.name} hourly rate`}
                          onChange={event =>
                            setClass(index, {
                              rates: item.rates.map((row, at) =>
                                at === rateIndex
                                  ? { ...row, hourly: event.target.value }
                                  : row
                              ),
                            })
                          }
                        />
                        <span>an hour</span>
                        <button
                          type="button"
                          className="icon-btn !h-8 !w-8"
                          aria-label="Remove this rate"
                          onClick={() =>
                            setClass(index, {
                              rates: item.rates.filter(
                                (_, at) => at !== rateIndex
                              ),
                            })
                          }
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="!text-[11px] !font-semibold text-[#12766f]"
                      onClick={() =>
                        setClass(index, {
                          rates: [
                            ...item.rates,
                            { effectiveFrom: "", hourly: "" },
                          ],
                        })
                      }
                    >
                      + Add a rate{item.rates.length ? " from a later date" : ""}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="p-5 text-xs leading-5 text-[#63757d]">
              No classifications yet. Add the levels your team is employed at,
              each with the ordinary hourly rate from the pay guide. When the
              rates change, add the new rate with its start date and keep the
              old one: past pay periods keep using the rate that applied then.
            </p>
          )}
        </Panel>

        <Panel title="Amounts from the pay guide">
          <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
            <label className="label">
              Weekly standard rate
              <span className="mt-1 flex items-center gap-1.5">
                <span className="text-xs font-normal text-[#849198]">$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="input !w-[140px]"
                  value={String(draft.rules.standardRateWeekly ?? "")}
                  onChange={event =>
                    setRule("standardRateWeekly", event.target.value)
                  }
                />
              </span>
              <span className="field-help block font-normal">
                The award's "standard rate". Sleepover and broken shift
                allowances are a percentage of it.
              </span>
            </label>
            <label className="label">
              Vehicle allowance per kilometre
              <span className="mt-1 flex items-center gap-1.5">
                <span className="text-xs font-normal text-[#849198]">$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="input !w-[140px]"
                  value={String(draft.rules.vehicleAllowancePerKm ?? "")}
                  onChange={event =>
                    setRule("vehicleAllowancePerKm", event.target.value)
                  }
                />
              </span>
              <span className="field-help block font-normal">
                Paid to the worker for kilometres in their own vehicle. This is
                separate from the travel rate billed to clients.
              </span>
            </label>
          </div>
        </Panel>

        {GROUPS.map(group => (
          <Panel key={group.title} title={group.title}>
            <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
              {group.fields.map(numberInput)}
              {group.title === "Loadings and penalty rates" && (
                <label className="label">
                  Span of ordinary hours
                  <span className="mt-1 flex items-center gap-1.5 text-xs font-normal text-[#63757d]">
                    <input
                      type="time"
                      className="input !w-[112px]"
                      value={String(draft.rules.spanStart ?? "")}
                      aria-label="Span starts"
                      onChange={event => setRule("spanStart", event.target.value)}
                    />
                    to
                    <input
                      type="time"
                      className="input !w-[112px]"
                      value={String(draft.rules.spanEnd ?? "")}
                      aria-label="Span ends"
                      onChange={event => setRule("spanEnd", event.target.value)}
                    />
                  </span>
                </label>
              )}
              {group.title === "Overtime" && (
                <label className="flex items-start gap-2 text-xs text-[#52666f]">
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-[#147f79]"
                    checked={Boolean(draft.rules.casualLoadingOnOvertime)}
                    onChange={event =>
                      setRule("casualLoadingOnOvertime", event.target.checked)
                    }
                  />
                  <span>
                    <b className="block text-[#405761]">
                      Casual loading on overtime
                    </b>
                    <span className="field-help block">
                      Off means casual overtime is paid on the ordinary rate.
                      Check the casual overtime column of the pay guide.
                    </span>
                  </span>
                </label>
              )}
            </div>
          </Panel>
        ))}

        <Panel
          title="Public holidays"
          action={
            <span className="flex flex-wrap gap-2">
              {[thisYear, thisYear + 1].map(year => (
                <Btn
                  key={year}
                  variant="quiet"
                  className="!h-8 !px-2 text-[11px]"
                  onClick={() => addHolidays(nationalHolidays(year))}
                >
                  Add national days for {year}
                </Btn>
              ))}
            </span>
          }
        >
          <div className="p-5">
            <p className="mb-3 text-xs leading-5 text-[#63757d]">
              Shifts on these dates are paid at the public holiday rate, and
              they do not count as business days for incident deadlines. The
              national days are a start: add your state's own days and any
              substitute day when a holiday falls on a weekend.
            </p>
            {draft.publicHolidays.length > 0 && (
              <ul className="mb-3 grid grid-cols-1 gap-x-6 sm:grid-cols-2">
                {draft.publicHolidays.map(day => (
                  <li
                    key={day.date}
                    className="flex items-center justify-between gap-2 border-b border-[#edf0ef] py-1.5 text-xs text-[#52666f]"
                  >
                    <span>
                      <b className="text-[#3d525c]">{prettyDate(day.date)}</b>{" "}
                      {day.name}
                    </span>
                    <button
                      type="button"
                      className="icon-btn !h-7 !w-7"
                      aria-label={`Remove ${day.name}`}
                      onClick={() =>
                        change({
                          publicHolidays: draft.publicHolidays.filter(
                            row => row.date !== day.date
                          ),
                        })
                      }
                    >
                      <Trash2 size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-end gap-2">
              <label className="label !mb-0">
                Date
                <input
                  type="date"
                  className="input mt-1 !w-[160px] block"
                  value={holiday.date}
                  onChange={event =>
                    setHoliday(current => ({
                      ...current,
                      date: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="label !mb-0 flex-1">
                Name
                <input
                  className="input mt-1"
                  value={holiday.name}
                  onChange={event =>
                    setHoliday(current => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="e.g. Adelaide Cup Day"
                />
              </label>
              <Btn
                variant="secondary"
                disabled={!holiday.date || !holiday.name.trim()}
                onClick={() => {
                  addHolidays([{ ...holiday, name: holiday.name.trim() }]);
                  setHoliday({ date: "", name: "" });
                }}
              >
                <Plus size={14} />
                Add day
              </Btn>
            </div>
          </div>
        </Panel>

        <FormAlert message={error} />
        <div className="flex justify-end">
          <Btn type="submit" loading={update.isPending}>
            <Check size={14} />
            Save pay rules
          </Btn>
        </div>
      </form>

      <PeopleRates />
    </div>
  );
}
