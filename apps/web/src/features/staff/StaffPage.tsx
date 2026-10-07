import {
  Check,
  KeyRound,
  Mail,
  MessagesSquare,
  Phone,
  Plus,
  ShieldOff,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useParams } from "wouter";
import type { StaffDTO } from "@shared/dto";
import {
  EMPLOYMENT_TYPES,
  STAFF_STATUSES,
  type EmploymentType,
  type StaffStatus,
} from "@shared/enums";
import { errorMessage } from "@/api/client";
import {
  useCreateStaff,
  useInviteStaff,
  usePayClassifications,
  useRevokeStaffAccess,
  useStaff,
  useUpdateStaff,
} from "@/api/hooks";
import StaffApplications from "./StaffApplications";
import StaffAvailability from "./StaffAvailability";
import StaffCompliance from "./StaffCompliance";
import StaffLeave from "./StaffLeave";
import {
  Avatar,
  Btn,
  Drawer,
  EmptyState,
  ErrorBlock,
  FormAlert,
  LoadingBlock,
  Panel,
  SectionHeading,
  Status,
} from "@/components/app/ui";
import { formatDateTime } from "@/lib/format";
import { useNotify } from "@/lib/notify";

/** Turn portal access on or off for one worker, and re-send their invite. */
function AccessPanel({ member }: { member: StaffDTO }) {
  const invite = useInviteStaff();
  const revoke = useRevokeStaffAccess();
  const notify = useNotify();
  const [error, setError] = useState("");

  const sendInvite = async () => {
    setError("");
    try {
      const result = await invite.mutateAsync({ id: member.id });
      notify(
        result.invite.emailed
          ? `Invite emailed to ${result.invite.email}.`
          : `Email is off — send them this link: ${result.invite.link}`,
        result.invite.emailed ? "success" : "info"
      );
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  const turnOff = async () => {
    setError("");
    try {
      await revoke.mutateAsync(member.id);
      notify(`Portal access turned off for ${member.name}.`);
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  return (
    <Panel title="Portal access" className="mt-4">
      <div className="p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Status value={member.accountStatus} />
          {member.lastLoginAt && (
            <span className="text-[10px] text-[#849198]">
              Last signed in {formatDateTime(member.lastLoginAt)}
            </span>
          )}
        </div>
        <p className="mt-2 text-xs leading-5 text-[#63757d]">
          {member.accountStatus === "No access"
            ? "This worker cannot sign in. Sending an invite creates their account and emails a link to set a password."
            : member.accountStatus === "Invited"
              ? "Invited, but they have not set a password yet."
              : "They can sign in to the worker portal and see only their own shifts and records."}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Btn
            variant="secondary"
            className="!h-8 !px-2 text-[11px]"
            onClick={() => void sendInvite()}
            loading={invite.isPending}
          >
            <KeyRound size={13} />
            {member.accountStatus === "No access" ? "Invite" : "Re-send invite"}
          </Btn>
          {member.accountStatus !== "No access" && (
            <Btn
              variant="secondary"
              className="!h-8 !px-2 text-[11px]"
              onClick={() => void turnOff()}
              loading={revoke.isPending}
            >
              <ShieldOff size={13} /> Turn off access
            </Btn>
          )}
          {member.userId && member.accountStatus === "Active" && (
            <Link href={`/app/messages?to=${member.userId}`}>
              <Btn variant="secondary" className="!h-8 !px-2 text-[11px]">
                <MessagesSquare size={13} /> Message
              </Btn>
            </Link>
          )}
        </div>
        <FormAlert message={error} />
      </div>
    </Panel>
  );
}

function StaffDrawer({
  member,
  onClose,
}: {
  member?: StaffDTO;
  onClose: () => void;
}) {
  const notify = useNotify();
  const create = useCreateStaff();
  const update = useUpdateStaff();
  const classifications = usePayClassifications();
  const [form, setForm] = useState({
    name: member?.name ?? "",
    position: member?.position ?? "",
    team: member?.team ?? "",
    email: member?.email ?? "",
    phone: member?.phone ?? "",
    status: (member?.status ?? "Active") as StaffStatus,
    notes: member?.notes ?? "",
  });
  const [employment, setEmployment] = useState({
    employmentType: (member?.employment.type ?? "") as EmploymentType | "",
    classificationId: member?.employment.classificationId ?? "",
    contractedHours: member?.employment.contractedHours
      ? String(member.employment.contractedHours)
      : "",
    payrollId: member?.employment.payrollId ?? "",
  });
  const [error, setError] = useState("");
  const set = (key: keyof typeof form) => (value: string) =>
    setForm(current => ({ ...current, [key]: value }));
  const setJob = (key: keyof typeof employment) => (value: string) =>
    setEmployment(current => ({ ...current, [key]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    const job = {
      employmentType: employment.employmentType,
      classificationId: employment.classificationId,
      contractedHours: Number(employment.contractedHours) || 0,
      payrollId: employment.payrollId.trim(),
    };
    try {
      if (member) {
        const saved = await update.mutateAsync({
          id: member.id,
          rev: member.rev,
          ...form,
          ...job,
        });
        notify(
          saved.warnings.length
            ? saved.warnings.join(" ")
            : `${saved.name} updated.`,
          saved.warnings.length ? "info" : "success"
        );
      } else {
        const saved = await create.mutateAsync({ ...form, ...job });
        notify(`${saved.name} added to the team directory.`);
      }
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  return (
    <Drawer
      onClose={onClose}
      eyebrow="Team directory"
      title={member ? member.name : "Add team member"}
      subtitle={
        member
          ? `Added ${formatDateTime(member.createdAt)}`
          : "Rostered, recorded on service records, and — once invited — able to sign in to the worker portal."
      }
      footer={
        <div className="flex justify-end gap-2">
          <Btn variant="secondary" onClick={onClose}>
            Cancel
          </Btn>
          <Btn
            type="submit"
            form="staff-form"
            loading={create.isPending || update.isPending}
          >
            <Check size={14} />
            {member ? "Save changes" : "Add team member"}
          </Btn>
        </div>
      }
    >
      <form id="staff-form" className="space-y-4" onSubmit={submit}>
        <Panel title="Details">
          <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
            <label className="label sm:col-span-2">
              Full name <span className="text-red-600">*</span>
              <input
                required
                className="input mt-1"
                value={form.name}
                onChange={event => set("name")(event.target.value)}
              />
            </label>
            <label className="label">
              Position <span className="text-red-600">*</span>
              <input
                required
                className="input mt-1"
                value={form.position}
                onChange={event => set("position")(event.target.value)}
                placeholder="e.g. Support Worker"
              />
            </label>
            <label className="label">
              Team <span className="text-red-600">*</span>
              <input
                required
                className="input mt-1"
                value={form.team}
                onChange={event => set("team")(event.target.value)}
                placeholder="e.g. Community Support"
              />
            </label>
            <label className="label">
              Email <span className="text-red-600">*</span>
              <input
                required
                type="email"
                className="input mt-1"
                value={form.email}
                onChange={event => set("email")(event.target.value)}
              />
            </label>
            <label className="label">
              Phone
              <input
                type="tel"
                className="input mt-1"
                value={form.phone}
                onChange={event => set("phone")(event.target.value)}
              />
            </label>
            <label className="label">
              Status
              <select
                className="select mt-1"
                value={form.status}
                onChange={event => set("status")(event.target.value)}
              >
                {STAFF_STATUSES.map(status => (
                  <option key={status}>{status}</option>
                ))}
              </select>
              <span className="field-help block font-normal">
                Only active staff can be rostered or added to new records.
              </span>
            </label>
            <label className="label sm:col-span-2">
              Notes
              <textarea
                className="textarea mt-1 !min-h-[70px]"
                value={form.notes}
                onChange={event => set("notes")(event.target.value)}
                placeholder="Qualifications, worker screening expiry, availability…"
              />
            </label>
          </div>
        </Panel>
        <Panel title="Employment">
          <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
            <label className="label">
              Employment type
              <select
                className="select mt-1"
                value={employment.employmentType}
                onChange={event => setJob("employmentType")(event.target.value)}
              >
                <option value="">Not recorded</option>
                {EMPLOYMENT_TYPES.map(type => (
                  <option key={type}>{type}</option>
                ))}
              </select>
              <span className="field-help block font-normal">
                Decides which award rules apply: casuals get a loading, part-time
                and casual staff a minimum engagement.
              </span>
            </label>
            <label className="label">
              Award classification
              <select
                className="select mt-1"
                value={employment.classificationId}
                onChange={event =>
                  setJob("classificationId")(event.target.value)
                }
              >
                <option value="">Not recorded</option>
                {(classifications.data ?? []).map(item => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <span className="field-help block font-normal">
                {classifications.data && !classifications.data.length
                  ? "None set up yet. Add them under Timesheets & pay → Pay rules."
                  : "The pay rate comes from this, in Timesheets & pay."}
              </span>
            </label>
            <label className="label">
              Contracted hours a week
              <input
                type="number"
                min="0"
                max="80"
                step="0.5"
                className="input mt-1"
                value={employment.contractedHours}
                onChange={event =>
                  setJob("contractedHours")(event.target.value)
                }
                placeholder="e.g. 20"
              />
            </label>
            <label className="label">
              Payroll ID
              <input
                className="input mt-1"
                value={employment.payrollId}
                onChange={event => setJob("payrollId")(event.target.value)}
                placeholder="Their number in the payroll system"
              />
            </label>
          </div>
        </Panel>
        <FormAlert message={error} />
      </form>
      {member && (
        <>
          <AccessPanel member={member} />
          <div className="mt-4">
            <StaffAvailability member={member} />
          </div>
          <div className="mt-4">
            <StaffCompliance member={member} />
          </div>
        </>
      )}
    </Drawer>
  );
}

export default function StaffPage() {
  const params = useParams<{ section?: string }>();
  const tab =
    params.section === "applications" || params.section === "leave"
      ? params.section
      : "directory";
  const [filter, setFilter] = useState("all");
  const staff = useStaff({ status: filter });
  const [drawer, setDrawer] = useState<{ member?: StaffDTO } | null>(null);

  return (
    <>
      <SectionHeading
        title="Team"
        subtitle="Support workers, how they are employed, when they can work and their onboarding documents."
        actions={
          tab !== "directory" ? null : (
            <>
              <select
                className="select h-[38px] w-[150px]"
                value={filter}
                onChange={event => setFilter(event.target.value)}
                aria-label="Filter by status"
              >
                <option value="all">All statuses</option>
                {STAFF_STATUSES.map(status => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
              <Btn onClick={() => setDrawer({})}>
                <Plus size={14} />
                Add team member
              </Btn>
            </>
          )
        }
      />

      <div className="mb-5 flex flex-wrap gap-2">
        {(
          [
            ["directory", "Directory"],
            ["applications", "Access requests"],
            ["leave", "Leave"],
          ] as const
        ).map(([key, label]) => (
          <Link
            key={key}
            href={key === "directory" ? "/app/staff" : `/app/staff/${key}`}
            className={`rounded-lg px-3.5 py-2 text-xs font-semibold no-underline ${
              tab === key
                ? "bg-[#12766f] text-white"
                : "border border-[#dde5e2] bg-white text-[#52666f]"
            }`}
          >
            {label}
          </Link>
        ))}
      </div>

      {tab === "applications" ? (
        <StaffApplications />
      ) : tab === "leave" ? (
        <StaffLeave />
      ) : (
        <StaffDirectory
          staff={staff}
          onOpen={member => setDrawer({ member })}
          onAdd={() => setDrawer({})}
        />
      )}
      {drawer && (
        <StaffDrawer member={drawer.member} onClose={() => setDrawer(null)} />
      )}
    </>
  );
}

/** The team list itself. */
function StaffDirectory({
  staff,
  onOpen,
  onAdd,
}: {
  staff: ReturnType<typeof useStaff>;
  onOpen: (member: StaffDTO) => void;
  onAdd: () => void;
}) {
  const setDrawer = (value: { member?: StaffDTO }) =>
    value.member ? onOpen(value.member) : onAdd();
  return (
    <>
      {staff.isError && (
        <ErrorBlock error={staff.error} onRetry={() => staff.refetch()} />
      )}
      {staff.isPending ? (
        <LoadingBlock />
      ) : staff.data?.length ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {staff.data.map(member => (
            <div key={member.id} className="panel p-5">
              <div className="flex items-start gap-3">
                <Avatar name={member.name} />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-[#354a56]">
                    {member.name}
                  </div>
                  <div className="mt-1 text-[10px] text-[#819097]">
                    {member.team}
                  </div>
                </div>
                <Status value={member.status} />
              </div>
              <div className="mt-4 border-t border-[#edf0ef] pt-3">
                <div className="text-[10px] text-[#849198]">Position</div>
                <div className="mt-1 text-xs font-semibold text-[#495e68]">
                  {member.position}
                </div>
                {member.employment.type && (
                  <div className="mt-1 text-[10px] text-[#819097]">
                    {member.employment.type}
                    {member.employment.classificationName &&
                      ` · ${member.employment.classificationName}`}
                  </div>
                )}
                <div className="mt-3 flex items-center gap-1.5 break-all text-xs text-[#52666f]">
                  <Mail size={12} className="shrink-0 text-[#849198]" />
                  {member.email}
                </div>
                {member.phone && (
                  <div className="mt-1 flex items-center gap-1.5 text-xs text-[#52666f]">
                    <Phone size={12} className="text-[#849198]" />
                    {member.phone}
                  </div>
                )}
                <div className="mt-4">
                  <Btn
                    variant="secondary"
                    className="!h-8 !px-2 text-[11px]"
                    onClick={() => setDrawer({ member })}
                  >
                    View profile
                  </Btn>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Panel>
          <EmptyState
            title="No team members"
            text="Add the support workers who deliver services so they can be rostered."
            action={<Btn onClick={() => setDrawer({})}>Add team member</Btn>}
          />
        </Panel>
      )}
      <Panel title="Roles" className="mt-5">
        <div className="p-5 text-xs leading-5 text-[#63757d]">
          <b>Admins</b> see the whole workspace. <b>Support workers</b> sign in
          to a separate portal where they see only their own shifts, the
          participants on them, and the notes and reports they write. Open a
          team member to invite them, check their documents, or turn access off.
        </div>
      </Panel>
    </>
  );
}
