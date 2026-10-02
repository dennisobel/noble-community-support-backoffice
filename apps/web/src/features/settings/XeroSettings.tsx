import { Link2, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { XeroSettingsDTO } from "@shared/dto";
import { errorMessage } from "@/api/client";
import {
  useXeroCheckNow,
  useXeroConnect,
  useXeroDisconnect,
  useXeroOptions,
  useXeroSaveSettings,
  useXeroStatus,
} from "@/api/hooks";
import {
  Btn,
  ConfirmModal,
  ErrorBlock,
  FormAlert,
  LoadingBlock,
  Panel,
} from "@/components/app/ui";
import { formatDateTime } from "@/lib/format";
import { useNotify } from "@/lib/notify";

interface Option {
  value: string;
  label: string;
}

/** A select that keeps a saved value visible even when Xero no longer offers it (an archived account). */
function Choice({
  label,
  hint,
  value,
  blank,
  options,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  blank: string;
  options: Option[];
  onChange: (value: string) => void;
}) {
  const offered = options.some(option => option.value === value);
  return (
    <label className="label">
      {label}
      <select
        className="input mt-1"
        value={value}
        onChange={event => onChange(event.target.value)}
      >
        <option value="">{blank}</option>
        {value && !offered && (
          <option value={value}>{value} (not found in Xero)</option>
        )}
        {options.map(option => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint && (
        <span className="mt-1 block text-[11px] font-normal text-[#687982]">
          {hint}
        </span>
      )}
    </label>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-2 text-xs">
      <span className="text-[#687982]">{label}</span>
      <span className="font-semibold text-[#1f4350]">{children}</span>
    </div>
  );
}

/** Settings → Accounting (Xero): connect an organisation, then choose the accounts invoices post to. */
export default function XeroSettings() {
  const notify = useNotify();
  const status = useXeroStatus();
  const connect = useXeroConnect();
  const disconnect = useXeroDisconnect();
  const save = useXeroSaveSettings();
  const checkNow = useXeroCheckNow();
  const options = useXeroOptions(Boolean(status.data?.connected));
  const [draft, setDraft] = useState<XeroSettingsDTO | null>(null);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const arrival = useRef(new URLSearchParams(window.location.search));

  // Xero sends the browser back here with ?xero=connected|error. Say so once, then tidy the address.
  useEffect(() => {
    const outcome = arrival.current.get("xero");
    if (!outcome) return;
    if (outcome === "connected") notify("Connected to Xero.");
    else setError(arrival.current.get("message") || "Could not connect to Xero.");
    window.history.replaceState(null, "", window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (status.isPending) return <LoadingBlock />;
  if (status.isError)
    return <ErrorBlock error={status.error} onRetry={() => status.refetch()} />;
  const s = status.data;
  const form = draft ?? s.settings;
  const set = (key: keyof XeroSettingsDTO, value: string) =>
    setDraft({ ...form, [key]: value });

  const startConnect = async () => {
    setError("");
    try {
      const { url } = await connect.mutateAsync();
      window.location.assign(url);
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };
  const submit = async () => {
    setError("");
    try {
      await save.mutateAsync(form);
      setDraft(null);
      notify("Xero settings saved.");
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };
  const check = async () => {
    setError("");
    try {
      await checkNow.mutateAsync();
      notify("Checking Xero for payments. This takes a few seconds.");
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };
  const remove = async () => {
    try {
      await disconnect.mutateAsync();
      setConfirming(false);
      notify("Disconnected from Xero.");
    } catch (failure) {
      setConfirming(false);
      setError(errorMessage(failure));
    }
  };

  const data = options.data;
  const sales = (data?.salesAccounts ?? []).map(account => ({
    value: account.code,
    label: `${account.code} · ${account.name}`,
  }));
  const banks = (data?.bankAccounts ?? []).map(account => ({
    value: account.code,
    label: `${account.code} · ${account.name}`,
  }));
  const rates = (data?.taxRates ?? []).map(rate => ({
    value: rate.type,
    label: `${rate.name} (${rate.rate}%)`,
  }));

  return (
    <div className="space-y-5">
      <FormAlert message={error} />
      <Panel
        title="Xero"
        action={
          s.connected ? (
            <Btn variant="quiet" onClick={() => setConfirming(true)}>
              Disconnect
            </Btn>
          ) : undefined
        }
      >
        <div className="space-y-3 p-5">
          {!s.configured && (
            <>
              <p className="text-xs text-[#4f5f68]">
                Xero is not set up on this server yet. Create a free app in the
                Xero developer portal, then add its keys to the server&apos;s
                environment:
              </p>
              <ol className="list-decimal space-y-1 pl-5 text-xs text-[#4f5f68]">
                <li>
                  Go to developer.xero.com/app/manage, choose New app, and pick
                  the integration type Web app.
                </li>
                <li>
                  Add this as the redirect URI:{" "}
                  <code className="rounded bg-[#f1f5f4] px-1 py-0.5 font-mono text-[11px]">
                    {s.redirectUri}
                  </code>
                </li>
                <li>Copy the Client id and generate a Client secret.</li>
                <li>
                  Put them in .env as XERO_CLIENT_ID and XERO_CLIENT_SECRET,
                  restart the API, then come back here.
                </li>
              </ol>
            </>
          )}
          {s.configured && !s.connected && (
            <>
              <p className="text-xs text-[#4f5f68]">
                {s.needsReconnect
                  ? "Xero no longer accepts the saved sign-in, so invoices are not being sent or checked. Connect again to resume."
                  : "Connect your Xero organisation so invoices you send are posted to it, and payments you reconcile in Xero mark them paid here."}
              </p>
              {s.needsReconnect && s.lastError && (
                <p className="text-[11px] text-[#9d4942]">{s.lastError}</p>
              )}
              <Btn onClick={() => void startConnect()} loading={connect.isPending}>
                <Link2 size={14} />
                {s.needsReconnect ? "Reconnect to Xero" : "Connect to Xero"}
              </Btn>
            </>
          )}
          {s.connected && (
            <>
              <Fact label="Organisation">{s.orgName}</Fact>
              <Fact label="Connected">
                {s.connectedAt ? formatDateTime(s.connectedAt) : "—"}
                {s.connectedBy ? ` by ${s.connectedBy}` : ""}
              </Fact>
              <Fact label="Payments last checked">
                {s.lastPollAt ? formatDateTime(s.lastPollAt) : "Not yet"}
              </Fact>
              {s.lastError && (
                <p className="text-[11px] text-[#9d4942]">{s.lastError}</p>
              )}
              <Btn
                variant="secondary"
                onClick={() => void check()}
                loading={checkNow.isPending}
              >
                <RefreshCw size={14} />
                Check Xero now
              </Btn>
            </>
          )}
        </div>
      </Panel>

      {s.connected && (
        <Panel title="How invoices are posted">
          <div className="space-y-4 p-5">
            <p className="text-[11px] text-[#687982]">
              Invoices you mark as sent are created in Xero as authorised sales
              invoices. When you reconcile the payment in Xero, the invoice here
              is marked paid within about 15 minutes. Earlier invoices are not
              sent automatically; open one and choose Send to Xero.
            </p>
            {options.isError && (
              <ErrorBlock
                error={options.error}
                onRetry={() => options.refetch()}
              />
            )}
            {!s.ready && (
              <p className="text-[11px] text-[#9d4942]">
                Choose a sales account and a tax type for GST-free invoices
                before sending invoices to Xero.
              </p>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Choice
                label="Sales account"
                blank="Choose an account…"
                value={form.salesAccountCode}
                options={sales}
                onChange={value => set("salesAccountCode", value)}
                hint="Every invoice line is posted here."
              />
              <Choice
                label="Tax type for invoices without GST"
                blank="Choose a tax type…"
                value={form.taxTypeGstFree}
                options={rates}
                onChange={value => set("taxTypeGstFree", value)}
                hint="Most NDIS supports are GST-free. Confirm with your accountant."
              />
              <Choice
                label="Tax type for invoices with GST"
                blank="Not used"
                value={form.taxTypeTaxable}
                options={rates}
                onChange={value => set("taxTypeTaxable", value)}
                hint="Used only if the workspace GST rate is above 0%."
              />
              <Choice
                label="Bank account for payments marked paid here"
                blank="Don't record payments in Xero"
                value={form.paymentAccountCode}
                options={banks}
                onChange={value => set("paymentAccountCode", value)}
                hint="Leave blank to reconcile every payment in Xero instead."
              />
            </div>
            <div>
              <Btn
                onClick={() => void submit()}
                loading={save.isPending}
                disabled={!draft}
              >
                Save
              </Btn>
            </div>
          </div>
        </Panel>
      )}

      {confirming && (
        <ConfirmModal
          title="Disconnect Xero?"
          body="Invoices already in Xero stay there. New invoices will no longer be sent, and payments will no longer be checked, until you connect again."
          confirmLabel="Disconnect"
          danger
          busy={disconnect.isPending}
          onConfirm={() => void remove()}
          onClose={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
