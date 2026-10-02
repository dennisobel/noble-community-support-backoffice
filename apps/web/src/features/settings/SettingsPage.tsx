import { Check, LogOut, Plus, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useParams } from "wouter";
import type { NotificationPreferences, WorkspaceDTO } from "@shared/dto";
import { MESSAGES } from "@shared/messages";
import { MIN_PASSWORD_LENGTH } from "@shared/schemas/auth";
import { api, errorMessage } from "@/api/client";
import {
  useActivity,
  useAuthSessions,
  useChangePassword,
  useMeta,
  usePreferences,
  useRevokeSession,
  useUpdateMe,
  useUpdatePreferences,
  useUpdateWorkspace,
  useWorkspace,
} from "@/api/hooks";
import {
  Btn,
  ErrorBlock,
  FormAlert,
  LoadingBlock,
  Panel,
  SectionHeading,
} from "@/components/app/ui";
import { useAuth } from "@/lib/auth";
import { formatDateTime, timeAgo } from "@/lib/format";
import { useNotify } from "@/lib/notify";
import XeroSettings from "./XeroSettings";

const SECTIONS = [
  { slug: "workspace", label: "Workspace" },
  { slug: "accounting", label: "Accounting (Xero)" },
  { slug: "profile", label: "My profile" },
  { slug: "notifications", label: "Notifications" },
  { slug: "privacy", label: "Privacy & access" },
  { slug: "voice", label: "Voice settings" },
];

const TIMEZONES = [
  "Australia/Adelaide",
  "Australia/Darwin",
  "Australia/Brisbane",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Australia/Hobart",
  "Australia/Perth",
];

function WorkspaceSettings() {
  const notify = useNotify();
  const workspace = useWorkspace();
  const update = useUpdateWorkspace();
  const [form, setForm] = useState<WorkspaceDTO | null>(null);
  const [newCategory, setNewCategory] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (workspace.data) setForm(workspace.data);
  }, [workspace.data]);
  if (workspace.isPending || !form) return <LoadingBlock />;
  if (workspace.isError)
    return (
      <ErrorBlock error={workspace.error} onRetry={() => workspace.refetch()} />
    );
  const set = <K extends keyof WorkspaceDTO>(key: K, value: WorkspaceDTO[K]) =>
    setForm(current => (current ? { ...current, [key]: value } : current));

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      await update.mutateAsync({
        name: form.name,
        legalName: form.legalName,
        abn: form.abn,
        address: form.address,
        phone: form.phone,
        email: form.email,
        timezone: form.timezone,
        gst: form.gst,
        invoice: form.invoice,
        bank: form.bank,
        providerTravelRate: Number(form.providerTravelRate),
        budgetCategories: form.budgetCategories,
      });
      notify("Workspace settings saved.");
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };
  const field = (
    key: "name" | "legalName" | "abn" | "address" | "phone" | "email",
    label: string,
    placeholder = ""
  ) => (
    <label className="label">
      {label}
      <input
        className="input mt-1"
        value={form[key]}
        placeholder={placeholder}
        onChange={event => set(key, event.target.value)}
      />
    </label>
  );

  return (
    <form className="space-y-5" onSubmit={save}>
      <Panel title="Organisation">
        <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
          {field("name", "Workspace name")}
          {field(
            "legalName",
            "Legal name",
            "e.g. Noble Community Support Pty Ltd"
          )}
          {field("abn", "ABN", "11 digits")}
          {field("phone", "Phone")}
          {field("email", "Accounts email")}
          <label className="label">
            Timezone
            <select
              className="select mt-1"
              value={form.timezone}
              onChange={event => set("timezone", event.target.value)}
            >
              {[...new Set([form.timezone, ...TIMEZONES])].map(zone => (
                <option key={zone}>{zone}</option>
              ))}
            </select>
            <span className="field-help block font-normal">
              Defines “today” for rosters, budgets and due dates.
            </span>
          </label>
          <div className="sm:col-span-2">{field("address", "Address")}</div>
        </div>
      </Panel>
      <Panel title="Invoicing">
        <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
          <label className="label">
            Invoice number prefix
            <input
              className="input mt-1"
              value={form.invoice.prefix}
              onChange={event =>
                set("invoice", {
                  ...form.invoice,
                  prefix: event.target.value.toUpperCase(),
                })
              }
            />
            <span className="field-help block font-normal">
              Numbers look like {form.invoice.prefix || "INV"}-2026-001.
            </span>
          </label>
          <label className="label">
            Default payment terms (days)
            <input
              className="input mt-1"
              type="number"
              min="0"
              max="120"
              value={form.invoice.defaultPaymentTermsDays}
              onChange={event =>
                set("invoice", {
                  ...form.invoice,
                  defaultPaymentTermsDays: Number(event.target.value),
                })
              }
            />
          </label>
          <label className="flex items-start gap-2 rounded-md bg-[#f5f8f7] p-3 text-xs text-[#586c74]">
            <input
              type="checkbox"
              className="mt-0.5 accent-[#147f79]"
              checked={form.gst.registered}
              onChange={event =>
                set("gst", { ...form.gst, registered: event.target.checked })
              }
            />
            <span>
              <b className="block">Registered for GST</b>
              <small className="mt-1 block text-[10px] text-[#839097]">
                Invoices are titled “Tax invoice” when registered.
              </small>
            </span>
          </label>
          <label className="label">
            GST charged on invoices (%)
            <input
              className="input mt-1"
              type="number"
              min="0"
              max="20"
              step="0.5"
              value={form.gst.ratePct}
              onChange={event =>
                set("gst", { ...form.gst, ratePct: Number(event.target.value) })
              }
            />
            <span className="field-help block font-normal">
              Most NDIS supports are GST-free; confirm with your accountant.
            </span>
          </label>
          <label className="label">
            Provider travel rate (AUD per km)
            <input
              className="input mt-1"
              type="number"
              min="0"
              step="0.01"
              value={form.providerTravelRate}
              onChange={event =>
                set("providerTravelRate", Number(event.target.value))
              }
            />
          </label>
          <div className="sm:col-span-2">
            <h3 className="text-[11px] font-bold uppercase tracking-[.06em] text-[#687982]">
              Bank details
            </h3>
            <p className="mt-1 text-[11px] leading-4 text-[#687982]">
              Printed on every invoice so a plan manager can pay it. An invoice
              keeps a copy of these as it was issued, so changing them here
              never alters an invoice already sent.
            </p>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="label sm:col-span-2">
                Account name
                <input
                  className="input mt-1"
                  value={form.bank.accountName}
                  onChange={event =>
                    set("bank", {
                      ...form.bank,
                      accountName: event.target.value,
                    })
                  }
                  placeholder="NOBLE COMMUNITY SUPPORT PTY LTD"
                />
              </label>
              <label className="label">
                BSB
                <input
                  className="input mt-1"
                  inputMode="numeric"
                  value={form.bank.bsb}
                  onChange={event =>
                    set("bank", { ...form.bank, bsb: event.target.value })
                  }
                  placeholder="067873"
                />
              </label>
              <label className="label">
                Account number
                <input
                  className="input mt-1"
                  inputMode="numeric"
                  value={form.bank.accountNumber}
                  onChange={event =>
                    set("bank", {
                      ...form.bank,
                      accountNumber: event.target.value,
                    })
                  }
                  placeholder="26209068"
                />
              </label>
              <label className="label sm:col-span-2">
                What the payer should reference
                <input
                  className="input mt-1"
                  value={form.bank.payInstruction}
                  onChange={event =>
                    set("bank", {
                      ...form.bank,
                      payInstruction: event.target.value,
                    })
                  }
                  placeholder="Invoice number or participant name"
                />
              </label>
            </div>
          </div>
          <label className="label sm:col-span-2">
            Extra payment instructions
            <textarea
              className="textarea mt-1 !min-h-[60px]"
              value={form.invoice.paymentInstructions}
              onChange={event =>
                set("invoice", {
                  ...form.invoice,
                  paymentInstructions: event.target.value,
                })
              }
              placeholder="Anything beyond the bank details above."
            />
          </label>
          <label className="label sm:col-span-2">
            Invoice footer
            <input
              className="input mt-1"
              value={form.invoice.footer}
              onChange={event =>
                set("invoice", { ...form.invoice, footer: event.target.value })
              }
            />
          </label>
        </div>
      </Panel>
      <Panel title="Budget categories">
        <div className="space-y-3 p-5">
          <p className="text-[11px] text-[#687982]">
            Plan budgets are set per category, and each service draws from one
            category. A category in use cannot be removed.
          </p>
          <div className="flex flex-wrap gap-2">
            {form.budgetCategories.map(category => (
              <span
                key={category}
                className="inline-flex items-center gap-1 rounded-md border border-[#dce4e1] bg-white px-2.5 py-1.5 text-xs"
              >
                {category}
                <button
                  type="button"
                  className="text-[#8a969b] hover:text-[#b9433e]"
                  aria-label={`Remove ${category}`}
                  onClick={() =>
                    set(
                      "budgetCategories",
                      form.budgetCategories.filter(item => item !== category)
                    )
                  }
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              className="input max-w-[280px]"
              value={newCategory}
              onChange={event => setNewCategory(event.target.value)}
              placeholder="New category, e.g. Capacity building"
            />
            <Btn
              variant="secondary"
              onClick={() => {
                const name = newCategory.trim();
                if (
                  name &&
                  !form.budgetCategories.some(
                    item => item.toLowerCase() === name.toLowerCase()
                  )
                )
                  set("budgetCategories", [...form.budgetCategories, name]);
                setNewCategory("");
              }}
            >
              <Plus size={14} />
              Add
            </Btn>
          </div>
        </div>
      </Panel>
      <FormAlert message={error} />
      <div className="flex justify-end">
        <Btn type="submit" loading={update.isPending}>
          <Check size={14} />
          Save workspace settings
        </Btn>
      </div>
    </form>
  );
}

function ProfileSettings() {
  const notify = useNotify();
  const { session, signedIn } = useAuth();
  const updateMe = useUpdateMe();
  const changePassword = useChangePassword();
  const [name, setName] = useState(session?.user.name ?? "");
  const [email, setEmail] = useState(session?.user.email ?? "");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [profileError, setProfileError] = useState("");
  const [passwordError, setPasswordError] = useState("");

  return (
    <div className="space-y-5">
      <Panel title="My profile">
        <form
          className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2"
          onSubmit={async event => {
            event.preventDefault();
            setProfileError("");
            try {
              signedIn(await updateMe.mutateAsync({ name, email }));
              notify("Profile updated.");
            } catch (failure) {
              setProfileError(errorMessage(failure));
            }
          }}
        >
          <label className="label">
            Full name
            <input
              className="input mt-1"
              required
              value={name}
              onChange={event => setName(event.target.value)}
            />
          </label>
          <label className="label">
            Email
            <input
              className="input mt-1"
              type="email"
              required
              value={email}
              onChange={event => setEmail(event.target.value)}
            />
          </label>
          <div className="text-[11px] text-[#87949a] sm:col-span-2">
            Role: Admin · Last sign-in{" "}
            {session?.user.lastLoginAt
              ? formatDateTime(session.user.lastLoginAt)
              : "—"}
          </div>
          <div className="sm:col-span-2">
            <FormAlert message={profileError} />
          </div>
          <div className="sm:col-span-2">
            <Btn type="submit" loading={updateMe.isPending}>
              Save profile
            </Btn>
          </div>
        </form>
      </Panel>
      <Panel title="Change password">
        <form
          className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-3"
          onSubmit={async event => {
            event.preventDefault();
            setPasswordError("");
            if (next.length < MIN_PASSWORD_LENGTH)
              return setPasswordError(MESSAGES.password(MIN_PASSWORD_LENGTH));
            if (next !== confirm)
              return setPasswordError(MESSAGES.passwordMismatch);
            try {
              await changePassword.mutateAsync({
                currentPassword: current,
                newPassword: next,
              });
              setCurrent("");
              setNext("");
              setConfirm("");
              notify("Password changed. Other devices were signed out.");
            } catch (failure) {
              setPasswordError(errorMessage(failure));
            }
          }}
        >
          <label className="label">
            Current password
            <input
              className="input mt-1"
              type="password"
              autoComplete="current-password"
              required
              value={current}
              onChange={event => setCurrent(event.target.value)}
            />
          </label>
          <label className="label">
            New password
            <input
              className="input mt-1"
              type="password"
              autoComplete="new-password"
              required
              value={next}
              onChange={event => setNext(event.target.value)}
            />
          </label>
          <label className="label">
            Confirm new password
            <input
              className="input mt-1"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={event => setConfirm(event.target.value)}
            />
          </label>
          <div className="sm:col-span-3">
            <FormAlert message={passwordError} />
          </div>
          <div className="sm:col-span-3">
            <Btn type="submit" loading={changePassword.isPending}>
              Change password
            </Btn>
          </div>
        </form>
      </Panel>
    </div>
  );
}

function NotificationSettings() {
  const notify = useNotify();
  const preferences = usePreferences();
  const update = useUpdatePreferences();
  const items: Array<[keyof NotificationPreferences, string, string]> = [
    ["recordReturned", "Returned records", "Records sent back for correction."],
    [
      "reviewQueue",
      "Review queue",
      "Records awaiting review and drafts left unfinished.",
    ],
    [
      "budgetAlerts",
      "Plan budgets",
      "Low, over-allocated or expired plans, and plans ending within 30 days.",
    ],
    [
      "invoiceOverdue",
      "Overdue invoices",
      "Sent invoices past their due date.",
    ],
    ["voiceDraftReady", "Voice drafts", "Generated drafts waiting for review."],
  ];
  if (preferences.isPending) return <LoadingBlock />;
  if (preferences.isError)
    return (
      <ErrorBlock
        error={preferences.error}
        onRetry={() => preferences.refetch()}
      />
    );
  return (
    <Panel title="Notifications">
      <div className="space-y-4 p-5">
        <p className="text-[11px] text-[#687982]">
          Choose what appears in the notification bell.
        </p>
        {items.map(([key, title, description]) => (
          <label
            key={key}
            className="flex items-start justify-between gap-4 border-t border-[#edf0ef] pt-4"
          >
            <span>
              <b className="block text-xs text-[#465b65]">{title}</b>
              <small className="mt-1 block text-[10px] text-[#839097]">
                {description}
              </small>
            </span>
            <input
              type="checkbox"
              checked={preferences.data.notifications[key]}
              onChange={event =>
                update.mutate(
                  { notifications: { [key]: event.target.checked } },
                  {
                    onSuccess: () => notify("Notification preference saved."),
                    onError: failure => notify(errorMessage(failure), "error"),
                  }
                )
              }
              className="mt-1 h-4 w-4 accent-[#147f79]"
              aria-label={title}
            />
          </label>
        ))}
      </div>
    </Panel>
  );
}

function PrivacySettings() {
  const notify = useNotify();
  const [, navigate] = useLocation();
  const sessions = useAuthSessions();
  const revoke = useRevokeSession();
  const activity = useActivity({ limit: 40, includeAuth: "true" });
  const meta = useMeta();
  const [signingOut, setSigningOut] = useState(false);
  return (
    <div className="space-y-5">
      <Panel
        title="Signed-in devices"
        action={
          <Btn
            variant="secondary"
            loading={signingOut}
            onClick={async () => {
              setSigningOut(true);
              try {
                await api.post("/auth/logout-all");
                navigate("/login");
              } catch (failure) {
                notify(errorMessage(failure), "error");
              } finally {
                setSigningOut(false);
              }
            }}
          >
            <LogOut size={14} />
            Sign out everywhere
          </Btn>
        }
      >
        <div className="divide-y divide-[#edf0ef]">
          {sessions.isPending && <LoadingBlock />}
          {sessions.data?.map(session => (
            <div
              key={session.id}
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-xs"
            >
              <div className="min-w-0">
                <b className="block truncate text-[#40535e]">
                  {session.userAgent || "Unknown device"}{" "}
                  {session.current && (
                    <span className="badge badge-approved ml-1">
                      This device
                    </span>
                  )}
                </b>
                <span className="text-[10px] text-[#87949a]">
                  {session.ip || "Unknown IP"} · signed in{" "}
                  {formatDateTime(session.createdAt)} · last active{" "}
                  {timeAgo(session.lastUsedAt)}
                </span>
              </div>
              {!session.current && (
                <Btn
                  variant="quiet"
                  className="!h-8"
                  loading={revoke.isPending}
                  onClick={() =>
                    revoke.mutate(session.id, {
                      onSuccess: () => notify("Session signed out."),
                      onError: failure =>
                        notify(errorMessage(failure), "error"),
                    })
                  }
                >
                  Sign out
                </Btn>
              )}
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Audit log">
        <div className="max-h-[420px] divide-y divide-[#edf0ef] overflow-y-auto">
          {activity.data?.items.map(entry => (
            <div
              key={entry.id}
              className="flex flex-wrap justify-between gap-2 px-5 py-2.5 text-[11px]"
            >
              <span className="text-[#4f626b]">
                <b>{entry.actor?.name ?? "System"}</b> {entry.summary}
              </span>
              <span className="text-[10px] text-[#8a969b]">
                {formatDateTime(entry.at)}
              </span>
            </div>
          ))}
          {activity.data && !activity.data.items.length && (
            <p className="px-5 py-4 text-xs text-[#87949a]">No activity yet.</p>
          )}
        </div>
      </Panel>
      <Panel title="About this workspace">
        <div className="space-y-2 p-5 text-xs text-[#63757d]">
          <p>
            <b>Version:</b> {meta.data?.version ?? "—"} ·{" "}
            {meta.data?.environment}
          </p>
          <p>
            <b>Access:</b> one Admin account with full access. Sessions use
            secure, http-only cookies and expire after inactivity.
          </p>
          <p>
            <b>Data:</b> stored in this workspace's MongoDB database; uploaded
            files are kept on the server's storage volume and are only served to
            signed-in users.
          </p>
          <p>
            <b>Email:</b>{" "}
            {meta.data?.features.email
              ? "configured"
              : "not configured — password reset emails and invoice emails are disabled"}
            .
          </p>
        </div>
      </Panel>
    </div>
  );
}

export default function SettingsPage() {
  const { section = "workspace" } = useParams<{ section?: string }>();
  const [, navigate] = useLocation();
  useEffect(() => {
    if (section === "voice") navigate("/app/voice/settings", { replace: true });
  }, [section, navigate]);
  return (
    <>
      <SectionHeading
        title="Settings"
        subtitle="Workspace preferences, your account and access."
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[220px_1fr]">
        <nav className="panel h-fit p-2" aria-label="Settings sections">
          {SECTIONS.map(item => (
            <Link
              key={item.slug}
              href={`/app/settings/${item.slug}`}
              className={`block w-full rounded-md px-3 py-2.5 text-left text-xs ${section === item.slug ? "bg-[#eef5f3] font-semibold text-[#286d67]" : "text-[#657780] hover:bg-[#f6f8f7]"}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div>
          {section === "workspace" && <WorkspaceSettings />}
          {section === "accounting" && <XeroSettings />}
          {section === "profile" && <ProfileSettings />}
          {section === "notifications" && <NotificationSettings />}
          {section === "privacy" && <PrivacySettings />}
        </div>
      </div>
    </>
  );
}
