import { Check, FileCheck2, Info, UserRound } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import type { ParticipantDTO } from "@shared/dto";
import { EMPTY_KYC, KYC_ITEMS, type Kyc } from "@shared/enums";
import { normalizeNdis } from "@shared/logic/ndis";
import { MESSAGES } from "@shared/messages";
import { ApiError, errorMessage } from "@/api/client";
import { useCreateParticipant, useUpdateParticipant } from "@/api/hooks";
import { Btn, Drawer, FieldError, FormAlert } from "@/components/app/ui";
import { lines } from "@/lib/format";

interface FormState {
  name: string;
  preferred: string;
  ndis: string;
  dob: string;
  phone: string;
  email: string;
  address: string;
  planStart: string;
  planEnd: string;
  manager: string;
  managerEmail: string;
  nominee: string;
  coordinatorName: string;
  coordinatorOrg: string;
  coordinatorPhone: string;
  coordinatorEmail: string;
  emergencyName: string;
  emergencyPhone: string;
  alertsText: string;
  goalsText: string;
  communication: string;
  mobility: string;
  transport: string;
  support: string;
  risks: string;
  allergies: string;
  preferences: string;
  kyc: Kyc;
}

function initialState(participant?: ParticipantDTO): FormState {
  return {
    name: participant?.name ?? "",
    preferred: participant?.preferred ?? "",
    ndis: participant?.ndis ?? "",
    dob: participant?.dob ?? "",
    phone: participant?.phone ?? "",
    email: participant?.email ?? "",
    address: participant?.address ?? "",
    planStart: participant?.planStart ?? "",
    planEnd: participant?.planEnd ?? "",
    manager: participant?.manager ?? "",
    managerEmail: participant?.managerEmail ?? "",
    nominee: participant?.nominee ?? "",
    coordinatorName: participant?.coordinatorName ?? "",
    coordinatorOrg: participant?.coordinatorOrg ?? "",
    coordinatorPhone: participant?.coordinatorPhone ?? "",
    coordinatorEmail: participant?.coordinatorEmail ?? "",
    emergencyName: participant?.emergencyName ?? "",
    emergencyPhone: participant?.emergencyPhone ?? "",
    alertsText: (participant?.alerts ?? []).join("\n"),
    goalsText: (participant?.goals ?? []).join("\n"),
    communication: participant?.communication ?? "",
    mobility: participant?.mobility ?? "",
    transport: participant?.transport ?? "",
    support: participant?.support ?? "",
    risks: participant?.risks ?? "",
    allergies: participant?.allergies ?? "",
    preferences: participant?.preferences ?? "",
    kyc: participant?.kyc ?? { ...EMPTY_KYC },
  };
}

function Section({
  title,
  hint,
  children,
  tone = "white",
}: {
  title: string;
  hint: string;
  children: ReactNode;
  tone?: "white" | "tint";
}) {
  return (
    <section
      className={`rounded-lg border p-4 sm:p-5 ${tone === "tint" ? "border-[#dbe8e3] bg-[#f5f9f7]" : "border-[#e5ebe8] bg-white"}`}
    >
      <div className="mb-4">
        <h3 className="text-xs font-bold text-[#354b57]">{title}</h3>
        <p className="mt-1 text-[10px] text-[#87949a]">{hint}</p>
      </div>
      {children}
    </section>
  );
}

export default function ParticipantFormDrawer({
  participant,
  onClose,
  onSaved,
}: {
  participant?: ParticipantDTO;
  onClose: () => void;
  onSaved: (participant: ParticipantDTO) => void;
}) {
  const editing = Boolean(participant);
  const [form, setForm] = useState<FormState>(() => initialState(participant));
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const create = useCreateParticipant();
  const update = useUpdateParticipant();
  const busy = create.isPending || update.isPending;
  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm(current => ({ ...current, [key]: value }));

  const text = (
    key: keyof FormState,
    label: string,
    options: {
      required?: boolean;
      type?: string;
      placeholder?: string;
      span?: boolean;
      inputMode?: "numeric" | "tel" | "email";
    } = {}
  ) => (
    <label className={`label ${options.span ? "sm:col-span-2" : ""}`}>
      {label} {options.required && <span className="text-red-600">*</span>}
      <input
        required={options.required}
        type={options.type ?? "text"}
        inputMode={options.inputMode}
        className="input mt-1"
        value={String(form[key])}
        onChange={event => setField(key, event.target.value as never)}
        placeholder={options.placeholder}
        aria-invalid={Boolean(fieldErrors[key]) || undefined}
      />
      <FieldError message={fieldErrors[key]} />
    </label>
  );
  const area = (
    key: keyof FormState,
    label: string,
    placeholder: string,
    span = false
  ) => (
    <label className={`label ${span ? "sm:col-span-2" : ""}`}>
      {label}
      <textarea
        className="textarea mt-1"
        value={String(form[key])}
        onChange={event => setField(key, event.target.value as never)}
        placeholder={placeholder}
      />
      <FieldError message={fieldErrors[key]} />
    </label>
  );

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setFieldErrors({});
    if (normalizeNdis(form.ndis).length !== 9) {
      setFieldErrors({ ndis: MESSAGES.ndis });
      return setError(MESSAGES.ndis);
    }
    if (form.planStart && form.planEnd && form.planEnd < form.planStart) {
      setFieldErrors({ planEnd: MESSAGES.planDates });
      return setError(MESSAGES.planDates);
    }
    const payload = {
      name: form.name,
      preferred: form.preferred,
      ndis: form.ndis,
      dob: form.dob,
      phone: form.phone,
      email: form.email,
      address: form.address,
      planStart: form.planStart,
      planEnd: form.planEnd,
      manager: form.manager,
      managerEmail: form.managerEmail,
      nominee: form.nominee,
      coordinatorName: form.coordinatorName,
      coordinatorOrg: form.coordinatorOrg,
      coordinatorPhone: form.coordinatorPhone,
      coordinatorEmail: form.coordinatorEmail,
      emergencyName: form.emergencyName,
      emergencyPhone: form.emergencyPhone,
      alerts: lines(form.alertsText),
      goals: lines(form.goalsText),
      communication: form.communication,
      mobility: form.mobility,
      transport: form.transport,
      support: form.support,
      risks: form.risks,
      allergies: form.allergies,
      preferences: form.preferences,
    };
    try {
      const saved = participant
        ? await update.mutateAsync({
            id: participant.id,
            rev: participant.rev,
            ...payload,
          })
        : await create.mutateAsync({ ...payload, kyc: form.kyc });
      onSaved(saved);
    } catch (failure) {
      if (failure instanceof ApiError) setFieldErrors(failure.fieldErrors());
      setError(errorMessage(failure));
    }
  };

  return (
    <Drawer
      onClose={onClose}
      eyebrow={
        <span className="flex items-center gap-2 font-bold text-[#538880]">
          <UserRound size={13} />
          Client {editing ? "profile" : "intake"} · Admin
        </span>
      }
      title={
        <span className="serif text-2xl font-normal text-[#243d49]">
          {editing
            ? `Edit ${participant!.preferred}'s profile`
            : "Add participant"}
        </span>
      }
      subtitle={
        editing
          ? "Update contact, plan and support details."
          : "Create a client profile and record the initial KYC checklist."
      }
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[10px] text-[#87949a]">
            {editing
              ? "Changes are saved to the client record and audit log."
              : "The profile is saved to the workspace; unchecked KYC items stay pending."}
          </p>
          <div className="flex gap-2">
            <Btn variant="secondary" onClick={onClose}>
              Cancel
            </Btn>
            <Btn type="submit" form="participant-form" loading={busy}>
              <Check size={14} />
              {editing ? "Save profile" : "Create client profile"}
            </Btn>
          </div>
        </div>
      }
    >
      <form id="participant-form" onSubmit={submit} className="space-y-5">
        <Section
          title="01 · Identity & contact"
          hint="Core participant and contact details."
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {text("name", "Legal name", {
              required: true,
              placeholder: "Full legal name",
            })}
            {text("preferred", "Preferred name", {
              required: true,
              placeholder: "Name used day to day",
            })}
            {text("ndis", "NDIS number", {
              required: true,
              placeholder: "9 digits",
              inputMode: "numeric",
            })}
            {text("dob", "Date of birth", { required: true, type: "date" })}
            {text("phone", "Phone", {
              required: true,
              type: "tel",
              placeholder: "04xx xxx xxx",
            })}
            {text("email", "Email", {
              required: true,
              type: "email",
              placeholder: "name@example.com",
            })}
            {text("address", "Residential address", {
              required: true,
              placeholder: "Street, suburb, state and postcode",
              span: true,
            })}
          </div>
        </Section>
        <Section
          title="02 · Plan, nominee & emergency contact"
          hint="Record the current NDIS plan period and the people Noble should contact."
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {text("planStart", "Plan start", { type: "date" })}
            {text("planEnd", "Plan end", { type: "date" })}
            {text("manager", "Plan manager / self-managed", {
              placeholder: "Plan manager or Self-managed",
            })}
            {text("managerEmail", "Plan manager email (for invoices)", {
              type: "email",
              placeholder: "invoices@planmanager.com.au",
            })}
            {text("nominee", "Nominee / guardian", {
              placeholder: "Name and relationship, if applicable",
              span: true,
            })}
            {text("emergencyName", "Emergency contact name", {
              required: true,
              placeholder: "Contact name and relationship",
            })}
            {text("emergencyPhone", "Emergency contact phone", {
              required: true,
              type: "tel",
              placeholder: "Phone number",
            })}
          </div>
        </Section>
        <Section
          title="03 · NDIS support coordinator"
          hint="Optional. Record the participant's support coordinator, if they have one."
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {text("coordinatorName", "Coordinator name", {
              placeholder: "Full name",
            })}
            {text("coordinatorOrg", "Organisation", {
              placeholder: "Support coordination provider",
            })}
            {text("coordinatorPhone", "Coordinator phone", {
              type: "tel",
              placeholder: "Phone number",
            })}
            {text("coordinatorEmail", "Coordinator email", {
              type: "email",
              placeholder: "name@example.com",
            })}
          </div>
        </Section>
        <Section
          title="04 · Support, goals & safety"
          hint="Practical information needed before services are delivered."
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {area(
              "support",
              "Support needs",
              "Types of support and day-to-day assistance required",
              true
            )}
            {area(
              "goalsText",
              "Goals (one per line)",
              "Participant-led goals and outcomes",
              true
            )}
            {area(
              "communication",
              "Communication needs",
              "Preferred communication approach"
            )}
            {area(
              "mobility",
              "Mobility needs",
              "Mobility aids or access needs"
            )}
            {area(
              "transport",
              "Transport requirements",
              "Vehicle and travel requirements"
            )}
            {area(
              "risks",
              "Risks & hazards",
              "Known risks, hazards and safety information"
            )}
            {area(
              "allergies",
              "Allergies",
              "List allergies or write ‘None known’"
            )}
            {area(
              "preferences",
              "Preferences",
              "Participant preferences and routines"
            )}
            {area(
              "alertsText",
              "Important alerts (one per line)",
              "Urgent or high-priority information",
              true
            )}
          </div>
        </Section>
        {!editing && (
          <Section
            title="05 · KYC & onboarding checklist"
            hint="Mark what has been received or confirmed. Unchecked items remain pending in the client file."
            tone="tint"
          >
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {KYC_ITEMS.map(item => (
                <label
                  key={item.key}
                  className="flex cursor-pointer items-start gap-2.5 rounded-md border border-[#e4ece8] bg-white p-3"
                >
                  <input
                    type="checkbox"
                    checked={form.kyc[item.key]}
                    onChange={event =>
                      setField("kyc", {
                        ...form.kyc,
                        [item.key]: event.target.checked,
                      })
                    }
                    className="mt-0.5 h-4 w-4 accent-[#177d76]"
                  />
                  <span>
                    <b className="block text-[11px] text-[#465b65]">
                      {item.label}
                    </b>
                    <small className="mt-0.5 block text-[9px] text-[#87949a]">
                      {item.detail}
                    </small>
                  </span>
                </label>
              ))}
            </div>
            <div className="mt-3 flex items-start gap-2 rounded-md border border-[#d9e9e5] bg-white p-3 text-[10px] leading-4 text-[#496663]">
              <FileCheck2 size={13} className="mt-0.5 shrink-0" />
              Upload the signed agreement, consent forms and plan documents from
              the client's Documents tab once the profile exists.
            </div>
          </Section>
        )}
        {editing && (
          <div className="flex items-start gap-2 rounded-md border border-[#d9e9e5] bg-[#f1f8f6] p-3 text-[10px] leading-4 text-[#496663]">
            <Info size={13} className="mt-0.5 shrink-0" />
            The onboarding checklist is updated from the client's Overview tab.
          </div>
        )}
        <FormAlert message={error} />
      </form>
    </Drawer>
  );
}
