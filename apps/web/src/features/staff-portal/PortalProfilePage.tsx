import {
  CheckCircle2,
  CircleDashed,
  FileUp,
  Plus,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { StaffChecklistItemDTO, StaffDocumentDTO } from "@shared/dto";
import { STAFF_CHECKLIST_GROUPS } from "@shared/enums";
import { errorMessage } from "@/api/client";
import {
  useDeleteStaffDocument,
  usePortalProfile,
  useUpdateProfile,
  useUploadStaffDocument,
} from "@/api/hooks";
import { ErrorBlock, LoadingBlock } from "@/components/app/ui";
import { fileSize, prettyDate } from "@/lib/format";
import { useNotify } from "@/lib/notify";
import { Chip, Empty, expiryLabel, expiryTone, Section, toneFor } from "./kit";

const BLANK_CONTACT = {
  name: "",
  relationship: "",
  phone: "",
  email: "",
  primary: false,
};

function ChecklistRow({
  item,
  onUpload,
}: {
  item: StaffChecklistItemDTO;
  onUpload: (item: StaffChecklistItemDTO) => void;
}) {
  const done = item.status === "Approved";
  const Icon = done
    ? CheckCircle2
    : item.status === "Needs attention"
      ? TriangleAlert
      : CircleDashed;
  return (
    <div className="portal-row px-4">
      <Icon
        size={16}
        className={
          done
            ? "shrink-0 text-[#1d6f57]"
            : item.status === "Needs attention"
              ? "shrink-0 text-[#a33a33]"
              : "shrink-0 text-[#b3bfc2]"
        }
      />
      <span className="min-w-0 flex-1">
        <b className="block text-[12px] text-[#16323a]">{item.label}</b>
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          <Chip tone={toneFor(item.status)}>{item.status}</Chip>
          {item.expiry && (
            <Chip tone={expiryTone(item.expiryState)}>
              {expiryLabel(item.expiryState, item.daysLeft)}
            </Chip>
          )}
        </span>
        {item.reviewNote && (
          <small className="mt-1 block text-[11px] leading-4 text-[#8a5a22]">
            {item.reviewNote}
          </small>
        )}
      </span>
      <button
        type="button"
        className="shrink-0 rounded-lg border border-[#dbe4e0] bg-white px-2.5 py-1.5 text-[10px] font-bold text-[#12766f]"
        onClick={() => onUpload(item)}
      >
        {item.documentId ? "Replace" : "Upload"}
      </button>
    </div>
  );
}

/** The worker's own record: contact details, next of kin, and their compliance documents. */
export default function PortalProfilePage() {
  const profile = usePortalProfile();
  const update = useUpdateProfile();
  const upload = useUploadStaffDocument();
  const remove = useDeleteStaffDocument();
  const notify = useNotify();

  const [details, setDetails] = useState<Record<string, unknown> | null>(null);
  const [uploading, setUploading] = useState<StaffChecklistItemDTO | null>(
    null
  );
  const [problem, setProblem] = useState("");

  useEffect(() => {
    if (!profile.data || details) return;
    const source = profile.data.details;
    setDetails({
      phone: source.phone,
      dateOfBirth: source.dateOfBirth ?? "",
      address: source.address,
      about: source.about,
      medicalNotes: source.medicalNotes,
      nextOfKin: { ...source.nextOfKin },
      emergencyContacts: source.emergencyContacts.map(contact => ({
        name: contact.name,
        relationship: contact.relationship,
        phone: contact.phone,
        email: contact.email,
        primary: contact.primary,
      })),
      transport: { ...source.transport },
    });
  }, [profile.data, details]);

  if (profile.isPending) return <LoadingBlock label="Loading your profile…" />;
  if (profile.isError)
    return (
      <ErrorBlock
        error={profile.error}
        onRetry={() => void profile.refetch()}
      />
    );
  const data = profile.data;
  if (!details) return <LoadingBlock label="Loading your profile…" />;

  const field = (key: string) => (details[key] ?? "") as string;
  const kin = details.nextOfKin as Record<string, string>;
  const transport = details.transport as Record<string, unknown>;
  const contacts = details.emergencyContacts as Array<Record<string, unknown>>;
  const set = (key: string, value: unknown) =>
    setDetails(current => ({ ...current!, [key]: value }));

  const save = async () => {
    setProblem("");
    try {
      await update.mutateAsync(details);
      notify("Profile saved.");
    } catch (error) {
      setProblem(errorMessage(error));
    }
  };

  const submitDocument = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (uploading) form.set("checklistKey", uploading.key);
    try {
      await upload.mutateAsync({ form });
      notify("Document uploaded.");
      setUploading(null);
    } catch (error) {
      setProblem(errorMessage(error));
    }
  };

  const byGroup = (group: string) =>
    data.checklist.filter(item => item.group === group);

  return (
    <>
      <div className="portal-card mb-4">
        <b className="text-[15px] text-[#16323a]">{data.staff.name}</b>
        <p className="mt-0.5 text-[11px] text-[#7a888d]">
          {data.staff.position} · {data.staff.team}
        </p>
        <div className="mt-3">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-semibold text-[#41555d]">
              Onboarding {data.progress.completePct}% complete
            </span>
            <span className="text-[#7a888d]">
              {data.progress.approved}/{data.progress.total}
            </span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[#e9efec]">
            <div
              className="h-full rounded-full bg-[#12766f] transition-[width]"
              style={{ width: `${data.progress.completePct}%` }}
            />
          </div>
          {(data.progress.expiring > 0 || data.progress.expired > 0) && (
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-[#8a5a22]">
              <TriangleAlert size={12} />
              {data.progress.expired > 0 && `${data.progress.expired} expired`}
              {data.progress.expired > 0 && data.progress.expiring > 0 && " · "}
              {data.progress.expiring > 0 &&
                `${data.progress.expiring} expiring soon`}
            </p>
          )}
        </div>
      </div>

      {uploading !== null ? (
        <form onSubmit={submitDocument}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-[14px] font-bold text-[#16323a]">
              Upload: {uploading.label}
            </h2>
            <button
              type="button"
              className="grid h-8 w-8 place-items-center rounded-lg border border-[#dbe4e0] bg-white text-[#54636b]"
              onClick={() => setUploading(null)}
              aria-label="Cancel upload"
            >
              <X size={15} />
            </button>
          </div>
          <label className="portal-field">
            Title
            <input name="title" required defaultValue={uploading.label} />
          </label>
          <label className="portal-field">
            File
            <input
              name="file"
              type="file"
              required
              accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="portal-field">
              Issued
              <input name="issued" type="date" />
            </label>
            <label className="portal-field">
              Expires {uploading.requiresExpiry && <span aria-hidden>*</span>}
              <input
                name="expiry"
                type="date"
                required={uploading.requiresExpiry}
              />
            </label>
          </div>
          <label className="portal-field">
            Notes
            <textarea name="notes" rows={2} />
          </label>
          {problem && (
            <p className="mb-3 rounded-lg bg-[#fbe6e3] px-3 py-2.5 text-[11px] leading-4 text-[#9c3c34]">
              {problem}
            </p>
          )}
          <div className="portal-sticky space-y-2">
            <button
              type="submit"
              className="portal-primary"
              disabled={upload.isPending}
            >
              <FileUp size={15} />
              {upload.isPending ? "Uploading…" : "Upload document"}
            </button>
          </div>
        </form>
      ) : (
        <>
          <Section title="Your details">
            <div className="portal-card">
              <label className="portal-field">
                Phone
                <input
                  value={field("phone")}
                  onChange={event => set("phone", event.target.value)}
                />
              </label>
              <label className="portal-field">
                Date of birth
                <input
                  type="date"
                  value={field("dateOfBirth")}
                  onChange={event => set("dateOfBirth", event.target.value)}
                />
              </label>
              <label className="portal-field">
                Home address
                <input
                  value={field("address")}
                  onChange={event => set("address", event.target.value)}
                />
              </label>
              <label className="portal-field !mb-0">
                Medical notes or allergies we should know about
                <textarea
                  rows={2}
                  value={field("medicalNotes")}
                  onChange={event => set("medicalNotes", event.target.value)}
                />
              </label>
            </div>
          </Section>

          <Section title="Next of kin">
            <div className="portal-card">
              {(
                [
                  ["name", "Name"],
                  ["relationship", "Relationship"],
                  ["phone", "Phone"],
                  ["email", "Email"],
                  ["address", "Address"],
                ] as const
              ).map(([key, label], index, all) => (
                <label
                  key={key}
                  className={`portal-field ${index === all.length - 1 ? "!mb-0" : ""}`}
                >
                  {label}
                  <input
                    value={kin[key] ?? ""}
                    onChange={event =>
                      set("nextOfKin", { ...kin, [key]: event.target.value })
                    }
                  />
                </label>
              ))}
            </div>
          </Section>

          <Section
            title="Emergency contacts"
            action={
              <button
                type="button"
                className="flex items-center gap-1 text-[11px] font-bold text-[#12766f]"
                onClick={() =>
                  set("emergencyContacts", [...contacts, { ...BLANK_CONTACT }])
                }
              >
                <Plus size={13} /> Add
              </button>
            }
          >
            {contacts.length ? (
              contacts.map((contact, index) => (
                <div key={index} className="portal-card mb-2">
                  <div className="mb-2 flex items-center justify-between">
                    <b className="text-[11px] text-[#41555d]">
                      Contact {index + 1}
                    </b>
                    <button
                      type="button"
                      className="text-[#a33a33]"
                      aria-label={`Remove contact ${index + 1}`}
                      onClick={() =>
                        set(
                          "emergencyContacts",
                          contacts.filter((_, at) => at !== index)
                        )
                      }
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  {(
                    [
                      ["name", "Name"],
                      ["relationship", "Relationship"],
                      ["phone", "Phone"],
                      ["email", "Email"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key} className="portal-field">
                      {label}
                      <input
                        value={(contact[key] as string) ?? ""}
                        onChange={event =>
                          set(
                            "emergencyContacts",
                            contacts.map((item, at) =>
                              at === index
                                ? { ...item, [key]: event.target.value }
                                : item
                            )
                          )
                        }
                      />
                    </label>
                  ))}
                  <label className="flex items-center gap-2.5 text-[11px] font-semibold text-[#41555d]">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={Boolean(contact.primary)}
                      onChange={event =>
                        set(
                          "emergencyContacts",
                          contacts.map((item, at) => ({
                            ...item,
                            primary:
                              at === index ? event.target.checked : false,
                          }))
                        )
                      }
                    />
                    Call this person first
                  </label>
                </div>
              ))
            ) : (
              <Empty>
                Add at least one person we can call in an emergency.
              </Empty>
            )}
          </Section>

          <Section title="Driving">
            <div className="portal-card">
              <label className="mb-3 flex items-center gap-2.5 text-[12px] font-semibold text-[#41555d]">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={Boolean(transport.hasVehicle)}
                  onChange={event =>
                    set("transport", {
                      ...transport,
                      hasVehicle: event.target.checked,
                    })
                  }
                />
                I transport participants in my own vehicle
              </label>
              {Boolean(transport.hasVehicle) &&
                (
                  [
                    ["licenceNumber", "Licence number"],
                    ["vehicle", "Vehicle"],
                    ["registration", "Registration"],
                  ] as const
                ).map(([key, label], index, all) => (
                  <label
                    key={key}
                    className={`portal-field ${index === all.length - 1 ? "!mb-0" : ""}`}
                  >
                    {label}
                    <input
                      value={(transport[key] as string) ?? ""}
                      onChange={event =>
                        set("transport", {
                          ...transport,
                          [key]: event.target.value,
                        })
                      }
                    />
                  </label>
                ))}
            </div>
          </Section>

          {problem && (
            <p className="mb-3 rounded-lg bg-[#fbe6e3] px-3 py-2.5 text-[11px] leading-4 text-[#9c3c34]">
              {problem}
            </p>
          )}
          <button
            type="button"
            className="portal-primary mb-6"
            onClick={() => void save()}
            disabled={update.isPending}
          >
            {update.isPending ? "Saving…" : "Save my details"}
          </button>

          {STAFF_CHECKLIST_GROUPS.map(group => {
            const items = byGroup(group);
            if (!items.length) return null;
            return (
              <Section key={group} title={group}>
                <div className="portal-card !p-0">
                  {items.map(item => (
                    <ChecklistRow
                      key={item.key}
                      item={item}
                      onUpload={setUploading}
                    />
                  ))}
                </div>
              </Section>
            );
          })}

          {data.documents.length > 0 && (
            <Section title="Uploaded documents">
              <div className="portal-card !p-0">
                {data.documents.map((document: StaffDocumentDTO) => (
                  <div key={document.id} className="portal-row px-4">
                    <span className="min-w-0 flex-1">
                      <b className="block text-[12px] text-[#16323a]">
                        {document.title}
                      </b>
                      <small className="mt-0.5 block text-[11px] text-[#7a888d]">
                        {document.file
                          ? `${document.file.originalName} · ${fileSize(document.file.size)}`
                          : "No file"}
                        {document.expiry
                          ? ` · expires ${prettyDate(document.expiry)}`
                          : ""}
                      </small>
                      {document.expiryState && (
                        <span className="mt-1 inline-block">
                          <Chip tone={expiryTone(document.expiryState)}>
                            {expiryLabel(
                              document.expiryState,
                              document.daysLeft
                            )}
                          </Chip>
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      className="shrink-0 text-[#a33a33]"
                      aria-label={`Delete ${document.title}`}
                      onClick={() => {
                        if (window.confirm(`Delete “${document.title}”?`))
                          void remove.mutateAsync(document.id);
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </>
      )}
    </>
  );
}
