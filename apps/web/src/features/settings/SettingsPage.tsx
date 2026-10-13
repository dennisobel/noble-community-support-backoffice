import { Check, LogOut, Plus, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useParams } from "wouter";
import type { NotificationPreferences, WorkspaceDTO } from "@shared/dto";
import { MESSAGES } from "@shared/messages";
import { MIN_PASSWORD_LENGTH } from "@shared/schemas/auth";
import {
  workspacePatchSchema,
  type WorkspacePatchInput,
} from "@shared/schemas/settings";
import { ApiError, api, errorMessage } from "@/api/client";
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
  FieldError,
  FormAlert,
  LoadingBlock,
  Panel,
  SectionHeading,
} from "@/components/app/ui";
import { useAccess, useAuth } from "@/lib/auth";
import { formatDateTime, timeAgo } from "@/lib/format";
import { useNotify } from "@/lib/notify";
import UsersSettings from "./UsersSettings";
import XeroSettings from "./XeroSettings";

/** `admin` sections are the Admin's alone; everything else is for every signed-in user. */
const SECTIONS: Array<{ slug: string; label: string; admin?: boolean }> = [
  { slug: "workspace", label: "Workspace", admin: true },
  { slug: "accounting", label: "Accounting (Xero)", admin: true },
  { slug: "users", label: "Users & access", admin: true },
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

/** Workspace form fields by validation path, in page order; the label is what the page calls the field. */
const FIELD_LABELS: Record<string, string> = {
  name: "Workspace name",
  legalName: "Legal name",
  abn: "ABN",
  phone: "Phone",
  email: "Accounts email",
  timezone: "Timezone",
  address: "Address",
  "invoice.prefix": "Invoice number prefix",
  "invoice.defaultPaymentTermsDays": "Default payment terms (days)",
  "gst.ratePct": "GST charged on invoices (%)",
  providerTravelRate: "Provider travel rate",
  "bank.accountName": "Bank account name",
  "bank.bsb": "BSB",
  "bank.accountNumber": "Bank account number",
  "bank.payInstruction": "What the payer should reference",
  "invoice.paymentInstructions": "Extra payment instructions",
  "invoice.footer": "Invoice footer",
  budgetCategories: "Budget categories",
};

const fieldId = (path: string) => `workspace-${path.replace(/\./g, "-")}`;
const focusField = (path: string) => {
  const element = document.getElementById(fieldId(path));
  element?.scrollIntoView({ block: "center" });
  element?.focus({ preventScroll: true });
};

/** One message per field; a problem with a single category counts against the whole list. */
const byField = (messages: Record<string, string>) => {
  const result: Record<string, string> = {};
  for (const [path, message] of Object.entries(messages)) {
    const key = path.startsWith("budgetCategories") ? "budgetCategories" : path;
    result[key] ??= message;
  }
  return result;
};

function workspaceErrors(input: WorkspacePatchInput) {
  const parsed = workspacePatchSchema.safeParse(input);
  if (parsed.success) return {};
  const messages: Record<string, string> = {};
  for (const issue of parsed.error.issues)
    messages[issue.path.join(".")] ??= issue.message;
  return byField(messages);
}

function WorkspaceSettings() {
  const notify = useNotify();
  const workspace = useWorkspace();
  const update = useUpdateWorkspace();
  const [form, setForm] = useState<WorkspaceDTO | null>(null);
  const [newCategory, setNewCategory] = useState("");
  const [error, setError] = useState("");
  const [checked, setChecked] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (workspace.data) setForm(workspace.data);
  }, [workspace.data]);
  if (workspace.isPending || !form) return <LoadingBlock />;
  if (workspace.isError)
    return (
      <ErrorBlock error={workspace.error} onRetry={() => workspace.refetch()} />
    );
  const set = <K extends keyof WorkspaceDTO>(key: K, value: WorkspaceDTO[K]) => {
    setServerErrors({});
    setForm(current => (current ? { ...current, [key]: value } : current));
  };

  const payload: WorkspacePatchInput = {
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
  };
  // After a failed save the messages follow the form, so each one clears as its field is fixed.
  const errors: Record<string, string> = {
    ...serverErrors,
    ...(checked ? workspaceErrors(payload) : {}),
  };
  const invalidPaths = [
    ...Object.keys(FIELD_LABELS).filter(path => errors[path]),
    ...Object.keys(errors).filter(path => !FIELD_LABELS[path]),
  ];
  const fieldProps = (path: string) => ({
    id: fieldId(path),
    "aria-invalid": errors[path] ? (true as const) : undefined,
  });

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setServerErrors({});
    setChecked(true);
    const found = workspaceErrors(payload);
    const first = Object.keys(FIELD_LABELS).find(path => found[path]);
    if (first) return focusField(first);
    try {
      await update.mutateAsync(payload);
      setChecked(false);
      notify("Workspace settings saved.");
    } catch (failure) {
      const fields =
        failure instanceof ApiError ? byField(failure.fieldErrors()) : {};
      if (Object.keys(fields).length) {
        setServerErrors(fields);
        focusField(Object.keys(fields)[0]);
      } else setError(errorMessage(failure));
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
        {...fieldProps(key)}
      />
      <FieldError message={errors[key]} />
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
              {...fieldProps("timezone")}
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
            <FieldError message={errors.timezone} />
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
              {...fieldProps("invoice.prefix")}
              value={form.invoice.prefix}
              onChange={event =>
                set("invoice", {
                  ...form.invoice,
                  prefix: event.target.value.toUpperCase(),
                })
              }
            />
            <span className="field-help block font-normal">
              1–8 capital letters or digits. Numbers look like{" "}
              {form.invoice.prefix || "INV"}-2026-001.
            </span>
            <FieldError message={errors["invoice.prefix"]} />
          </label>
          <label className="label">
            Default payment terms (days)
            <input
              className="input mt-1"
              type="number"
              min="0"
              max="120"
              {...fieldProps("invoice.defaultPaymentTermsDays")}
              value={form.invoice.defaultPaymentTermsDays}
              onChange={event =>
                set("invoice", {
                  ...form.invoice,
                  defaultPaymentTermsDays: Number(event.target.value),
                })
              }
            />
            <FieldError message={errors["invoice.defaultPaymentTermsDays"]} />
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
              {...fieldProps("gst.ratePct")}
              value={form.gst.ratePct}
              onChange={event =>
                set("gst", { ...form.gst, ratePct: Number(event.target.value) })
              }
            />
            <span className="field-help block font-normal">
              Most NDIS supports are GST-free; confirm with your accountant.
            </span>
            <FieldError message={errors["gst.ratePct"]} />
          </label>
          <label className="label">
            Provider travel rate (AUD per km)
            <input
              className="input mt-1"
              type="number"
              min="0"
              step="0.01"
              {...fieldProps("providerTravelRate")}
              value={form.providerTravelRate}
              onChange={event =>
                set("providerTravelRate", Number(event.target.value))
              }
            />
            <FieldError message={errors.providerTravelRate} />
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
                  {...fieldProps("bank.accountName")}
                />
                <FieldError message={errors["bank.accountName"]} />
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
                  {...fieldProps("bank.bsb")}
                />
                <FieldError message={errors["bank.bsb"]} />
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
                  {...fieldProps("bank.accountNumber")}
                />
                <FieldError message={errors["bank.accountNumber"]} />
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
                  {...fieldProps("bank.payInstruction")}
                />
                <FieldError message={errors["bank.payInstruction"]} />
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
              {...fieldProps("invoice.paymentInstructions")}
            />
            <FieldError message={errors["invoice.paymentInstructions"]} />
          </label>
          <label className="label sm:col-span-2">
            Invoice footer
            <input
              className="input mt-1"
              value={form.invoice.footer}
              onChange={event =>
                set("invoice", { ...form.invoice, footer: event.target.value })
              }
              {...fieldProps("invoice.footer")}
            />
            <FieldError message={errors["invoice.footer"]} />
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
              {...fieldProps("budgetCategories")}
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
          <FieldError message={errors.budgetCategories} />
        </div>
      </Panel>
      {invalidPaths.length > 0 && (
        <div
          role="alert"
          className="rounded-md border border-[#f0d2d0] bg-[#fff2f0] px-3 py-2.5 text-xs text-[#9d4942]"
        >
          <b className="block">
            {invalidPaths.length === 1
              ? "One field needs fixing before these settings can be saved:"
              : `${invalidPaths.length} fields need fixing before these settings can be saved:`}
          </b>
          <ul className="mt-1.5 list-disc space-y-1 pl-4">
            {invalidPaths.map(path => (
              <li key={path}>
                <button
                  type="button"
                  className="font-semibold underline"
                  onClick={() => focusField(path)}
                >
                  {FIELD_LABELS[path] ?? path}
                </button>{" "}
                — {errors[path]}
              </li>
            ))}
          </ul>
        </div>
      )}
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

/** The workspace audit trail. Admin only: the API refuses everyone else. */
function AuditLog() {
  const activity = useActivity({ limit: 40, includeAuth: "true" });
  return (
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
  );
}

function PrivacySettings() {
  const notify = useNotify();
  const [, navigate] = useLocation();
  const sessions = useAuthSessions();
  const revoke = useRevokeSession();
  const { isAdmin } = useAccess();
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
      {isAdmin && <AuditLog />}
      <Panel title="About this workspace">
        <div className="space-y-2 p-5 text-xs text-[#63757d]">
          <p>
            <b>Version:</b> {meta.data?.version ?? "—"} ·{" "}
            {meta.data?.environment}
          </p>
          <p>
            <b>Access:</b> Admins have full access; everyone else only opens
            the modules an Admin gave them. Sessions use secure, http-only
            cookies and expire after inactivity.
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
  const { section: requested = "workspace" } = useParams<{
    section?: string;
  }>();
  const [, navigate] = useLocation();
  const { isAdmin, can } = useAccess();
  // Workspace, accounting and user access are Admin-only; voice settings need the Voice module.
  const visible = SECTIONS.filter(
    item =>
      (isAdmin || !item.admin) && (item.slug !== "voice" || can("voice"))
  );
  const section = visible.some(item => item.slug === requested)
    ? requested
    : (visible[0]?.slug ?? "profile");
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
          {visible.map(item => (
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
          {section === "users" && <UsersSettings />}
          {section === "profile" && <ProfileSettings />}
          {section === "notifications" && <NotificationSettings />}
          {section === "privacy" && <PrivacySettings />}
        </div>
      </div>
    </>
  );
}
