import { useState, type ReactNode } from "react";
import {
  MODULE_LABELS,
  ROLE_DEFAULT_MODULES,
  ROLE_LABELS,
} from "@shared/access";
import type { AccessUserDTO } from "@shared/dto";
import {
  ACCESS_MODULES,
  OFFICE_ROLES,
  type AccessModule,
  type OfficeRole,
} from "@shared/enums";
import { errorMessage } from "@/api/client";
import {
  useAccessUsers,
  useApproveUser,
  useDeclineUser,
  useUpdateUserAccess,
} from "@/api/hooks";
import {
  Btn,
  ConfirmModal,
  ErrorBlock,
  FormAlert,
  LoadingBlock,
  Modal,
  Panel,
} from "@/components/app/ui";
import { useAuth } from "@/lib/auth";
import { formatDateTime, timeAgo } from "@/lib/format";
import { useNotify } from "@/lib/notify";

const ROLE_HINTS: Record<OfficeRole, string> = {
  admin: "Everything, including Settings, Users & access and Xero.",
  manager: "Every module. Cannot change workspace settings or who has access.",
  coordinator: "Clients, rostering, services, files and voice notes.",
  finance: "Clients, invoices and reports.",
};

function Pill({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "ok" | "warn";
  children: ReactNode;
}) {
  const tones = {
    neutral: "bg-[#eef1f0] text-[#55676f]",
    ok: "bg-[#e6f4ef] text-[#1d6b57]",
    warn: "bg-[#fdf1e3] text-[#9a5b12]",
  };
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/** Approving a request, or changing someone's access later: pick a role, then tick the modules. */
function AccessDialog({
  user,
  mode,
  onClose,
}: {
  user: AccessUserDTO;
  mode: "approve" | "edit";
  onClose: () => void;
}) {
  const notify = useNotify();
  const approve = useApproveUser();
  const update = useUpdateUserAccess();
  const startRole: OfficeRole =
    mode === "approve" ? "coordinator" : (user.role as OfficeRole);
  const [role, setRole] = useState<OfficeRole>(startRole);
  const [modules, setModules] = useState<AccessModule[]>(
    mode === "edit" ? user.modules : [...ROLE_DEFAULT_MODULES[startRole]]
  );
  const [error, setError] = useState("");
  const busy = approve.isPending || update.isPending;

  // A role is a starting point: choosing one ticks its usual modules, and each can still be changed.
  const chooseRole = (next: OfficeRole) => {
    setRole(next);
    setModules([...ROLE_DEFAULT_MODULES[next]]);
  };
  const toggle = (module: AccessModule) =>
    setModules(current =>
      current.includes(module)
        ? current.filter(entry => entry !== module)
        : [...current, module]
    );
  const save = async () => {
    setError("");
    try {
      if (mode === "approve")
        await approve.mutateAsync({ id: user.id, role, modules });
      else await update.mutateAsync({ id: user.id, role, modules });
      notify(
        mode === "approve" ? `${user.name} can now sign in.` : "Access updated."
      );
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  return (
    <Modal
      title={
        mode === "approve" ? `Approve ${user.name}` : `Access for ${user.name}`
      }
      subtitle={user.email}
      onClose={onClose}
      busy={busy}
    >
      <div className="space-y-4 p-5">
        {mode === "approve" && user.message && (
          <p className="rounded-md bg-[#f6f8f7] p-3 text-xs text-[#4f626b]">
            <b>They wrote:</b> {user.message}
          </p>
        )}
        <label className="label">
          Role
          <select
            className="input mt-1"
            value={role}
            onChange={event => chooseRole(event.target.value as OfficeRole)}
          >
            {OFFICE_ROLES.map(entry => (
              <option key={entry} value={entry}>
                {ROLE_LABELS[entry]}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[11px] font-normal text-[#687982]">
            {ROLE_HINTS[role]}
          </span>
        </label>
        <fieldset>
          <legend className="label">Modules they can open</legend>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {ACCESS_MODULES.map(module => (
              <label
                key={module}
                className="flex items-center gap-2 rounded-md border border-[#e0e6e3] px-3 py-2 text-xs text-[#40535e]"
              >
                <input
                  type="checkbox"
                  checked={role === "admin" || modules.includes(module)}
                  disabled={role === "admin"}
                  onChange={() => toggle(module)}
                />
                {MODULE_LABELS[module]}
              </label>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-[#687982]">
            Everyone also gets My day (their own shifts) and Notes automatically,
            so those are not listed. Changing the role ticks that role&apos;s
            usual modules. Screens that
            only need names from another module (Invoices listing the clients to
            bill, for example) get a read-only lookup automatically.
          </p>
        </fieldset>
        <FormAlert message={error} />
        <div className="flex justify-end gap-2">
          <Btn variant="secondary" onClick={onClose}>
            Cancel
          </Btn>
          <Btn onClick={() => void save()} loading={busy}>
            {mode === "approve" ? "Approve and give access" : "Save access"}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

function DeclineDialog({
  user,
  onClose,
}: {
  user: AccessUserDTO;
  onClose: () => void;
}) {
  const notify = useNotify();
  const decline = useDeclineUser();
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const submit = async () => {
    setError("");
    try {
      await decline.mutateAsync({ id: user.id, note: note.trim() || undefined });
      notify("Request declined.");
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };
  return (
    <Modal
      title={`Decline ${user.name}?`}
      subtitle="They will see that their request was declined when they try to sign in."
      onClose={onClose}
      busy={decline.isPending}
    >
      <div className="space-y-4 p-5">
        <label className="label">
          Note for your records (optional)
          <textarea
            className="input mt-1"
            rows={2}
            maxLength={300}
            value={note}
            onChange={event => setNote(event.target.value)}
          />
        </label>
        <FormAlert message={error} />
        <div className="flex justify-end gap-2">
          <Btn variant="secondary" onClick={onClose}>
            Cancel
          </Btn>
          <Btn onClick={() => void submit()} loading={decline.isPending}>
            Decline request
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

/** Settings → Users & access (Admin only): approve requests with a role and modules, then manage who has what. */
export default function UsersSettings() {
  const notify = useNotify();
  const { session } = useAuth();
  const users = useAccessUsers();
  const update = useUpdateUserAccess();
  const [dialog, setDialog] = useState<{
    user: AccessUserDTO;
    mode: "approve" | "edit";
  } | null>(null);
  const [declining, setDeclining] = useState<AccessUserDTO | null>(null);
  const [switchingOff, setSwitchingOff] = useState<AccessUserDTO | null>(null);

  if (users.isPending) return <LoadingBlock />;
  if (users.isError)
    return <ErrorBlock error={users.error} onRetry={() => users.refetch()} />;
  const items = users.data;
  const pending = items.filter(user => user.status === "pending");
  const declined = items.filter(user => user.status === "rejected");
  const people = items.filter(
    user => user.status === "active" || user.status === "disabled"
  );
  const me = session?.user.id;

  const setStatus = async (user: AccessUserDTO, status: "active" | "disabled") => {
    try {
      await update.mutateAsync({ id: user.id, status });
      notify(status === "active" ? `${user.name} is active again.` : `${user.name} was switched off.`);
    } catch (failure) {
      notify(errorMessage(failure), "error");
    } finally {
      setSwitchingOff(null);
    }
  };

  const who = (user: AccessUserDTO) => (
    <div className="min-w-0">
      <b className="block truncate text-xs text-[#40535e]">
        {user.name}
        {user.id === me && <span className="ml-1 font-normal">(you)</span>}
      </b>
      <span className="block truncate text-[11px] text-[#87949a]">
        {user.email}
      </span>
    </div>
  );

  return (
    <div className="space-y-5">
      <Panel title="Access requests">
        {pending.length === 0 ? (
          <p className="px-5 py-4 text-xs text-[#87949a]">
            No one is waiting. People who ask for access from the sign-in page
            appear here, and you choose their role and modules when you approve
            them.
          </p>
        ) : (
          <div className="divide-y divide-[#edf0ef]">
            {pending.map(user => (
              <div
                key={user.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
              >
                <div className="min-w-0 space-y-0.5">
                  {who(user)}
                  {user.message && (
                    <p className="text-[11px] text-[#4f626b]">
                      “{user.message}”
                    </p>
                  )}
                  <p className="text-[10px] text-[#87949a]">
                    Asked {timeAgo(user.requestedAt)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Btn variant="quiet" onClick={() => setDeclining(user)}>
                    Decline
                  </Btn>
                  <Btn onClick={() => setDialog({ user, mode: "approve" })}>
                    Approve…
                  </Btn>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="People with access">
        <div className="divide-y divide-[#edf0ef]">
          {people.map(user => (
            <div
              key={user.id}
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
            >
              <div className="min-w-0 space-y-1">
                {who(user)}
                <p className="text-[10px] text-[#87949a]">
                  {user.role === "admin"
                    ? "All modules"
                    : user.modules.map(module => MODULE_LABELS[module]).join(", ")}
                  {" · "}
                  {user.lastLoginAt
                    ? `last signed in ${timeAgo(user.lastLoginAt)}`
                    : "never signed in"}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone={user.role === "admin" ? "ok" : "neutral"}>
                  {ROLE_LABELS[user.role]}
                </Pill>
                {user.status === "disabled" && <Pill tone="warn">Switched off</Pill>}
                {user.id !== me && (
                  <>
                    <Btn
                      variant="secondary"
                      onClick={() => setDialog({ user, mode: "edit" })}
                    >
                      Edit access
                    </Btn>
                    {user.status === "active" ? (
                      <Btn variant="quiet" onClick={() => setSwitchingOff(user)}>
                        Switch off
                      </Btn>
                    ) : (
                      <Btn
                        variant="quiet"
                        onClick={() => void setStatus(user, "active")}
                      >
                        Switch on
                      </Btn>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </Panel>

      {declined.length > 0 && (
        <Panel title="Declined requests">
          <div className="divide-y divide-[#edf0ef]">
            {declined.map(user => (
              <div
                key={user.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
              >
                <div className="min-w-0 space-y-0.5">
                  {who(user)}
                  <p className="text-[10px] text-[#87949a]">
                    Declined {user.reviewedAt ? formatDateTime(user.reviewedAt) : ""}
                    {user.reviewedBy ? ` by ${user.reviewedBy}` : ""}
                    {user.note ? ` · ${user.note}` : ""}
                  </p>
                </div>
                <Btn
                  variant="secondary"
                  onClick={() => setDialog({ user, mode: "approve" })}
                >
                  Approve instead…
                </Btn>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {dialog && (
        <AccessDialog
          key={dialog.user.id}
          user={dialog.user}
          mode={dialog.mode}
          onClose={() => setDialog(null)}
        />
      )}
      {declining && (
        <DeclineDialog user={declining} onClose={() => setDeclining(null)} />
      )}
      {switchingOff && (
        <ConfirmModal
          title={`Switch off ${switchingOff.name}?`}
          body="They are signed out straight away and cannot sign in again until you switch them back on."
          confirmLabel="Switch off"
          danger
          busy={update.isPending}
          onConfirm={() => void setStatus(switchingOff, "disabled")}
          onClose={() => setSwitchingOff(null)}
        />
      )}
    </div>
  );
}
