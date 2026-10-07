import { Clock, Scale, WalletCards } from "lucide-react";
import { lazy, Suspense } from "react";
import { Link, useParams } from "wouter";
import { LoadingBlock, SectionHeading } from "@/components/app/ui";

const TimesheetsTab = lazy(() => import("./TimesheetsTab"));
const PayRunsTab = lazy(() => import("./PayRunsTab"));
const PayRulesTab = lazy(() => import("./PayRulesTab"));

const TABS = [
  { key: "timesheets", label: "Timesheets", icon: Clock },
  { key: "runs", label: "Pay runs", icon: WalletCards },
  { key: "rules", label: "Pay rules", icon: Scale },
] as const;
type Tab = (typeof TABS)[number]["key"];

/**
 * From hours to gross pay, left to right: approve what was worked, run the pay period, and
 * the award rules both of those are worked out from.
 */
export default function PayrollPage() {
  const params = useParams<{ section?: string; id?: string }>();
  const tab: Tab =
    TABS.find(item => item.key === params.section)?.key ?? "timesheets";

  return (
    <>
      <SectionHeading
        title="Timesheets & pay"
        subtitle="Approve the hours each worker did, then work out gross pay for the period under the SCHADS Award."
      />
      <div className="mb-5 flex flex-wrap gap-2">
        {TABS.map(({ key, label, icon: Icon }) => (
          <Link
            key={key}
            href={key === "timesheets" ? "/app/payroll" : `/app/payroll/${key}`}
            className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold no-underline ${
              tab === key
                ? "bg-[#12766f] text-white"
                : "border border-[#dde5e2] bg-white text-[#52666f]"
            }`}
          >
            <Icon size={14} />
            {label}
          </Link>
        ))}
      </div>
      <Suspense fallback={<LoadingBlock />}>
        {tab === "timesheets" && <TimesheetsTab />}
        {tab === "runs" && <PayRunsTab id={params.id} />}
        {tab === "rules" && <PayRulesTab />}
      </Suspense>
    </>
  );
}
