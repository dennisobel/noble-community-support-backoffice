import { AlertCircle, CheckCircle2, HandHeart } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { useParams } from "wouter";
import {
  FEEDBACK_KINDS,
  FEEDBACK_RELATIONSHIPS,
  type FeedbackKind,
  type FeedbackRelationship,
} from "@shared/enums";
import { errorMessage } from "@/api/client";
import { usePublicFeedbackForm, useSubmitPublicFeedback } from "@/api/hooks";
import { Spinner } from "@/components/app/ui";

const KIND_HELP: Record<FeedbackKind, string> = {
  Complaint: "Something went wrong or was not good enough",
  Compliment: "Something or someone did well",
  Suggestion: "An idea for doing things better",
};

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-[#f4f6f5] px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-[620px]">{children}</div>
    </main>
  );
}

function Notice({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[#e4ebe8] bg-white p-10 text-center">
      <div className="mx-auto grid h-11 w-11 place-items-center">{icon}</div>
      <h1 className="mt-3 text-[17px] font-bold text-[#16323a]">{title}</h1>
      <div className="mx-auto mt-2 max-w-[420px] text-[12px] leading-5 text-[#6d7c82]">
        {children}
      </div>
    </div>
  );
}

/**
 * The feedback form opened from the link an organisation publishes. Standalone like the invoice
 * and signing links: no navigation, no session, and nothing shown except who the feedback goes
 * to. A name is optional, so feedback can be anonymous.
 */
export default function PublicFeedbackPage() {
  const { token } = useParams<{ token: string }>();
  const page = usePublicFeedbackForm(token);
  const send = useSubmitPublicFeedback(token);
  const [reference, setReference] = useState("");
  const [problem, setProblem] = useState("");
  const [form, setForm] = useState({
    kind: "Complaint" as FeedbackKind,
    details: "",
    about: "",
    desiredOutcome: "",
    name: "",
    relationship: "Participant" as FeedbackRelationship,
    phone: "",
    email: "",
    wantsContact: false,
    // Hidden from people. Only a script fills it in.
    website: "",
  });
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm(current => ({ ...current, [key]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setProblem("");
    if (form.wantsContact && !form.phone.trim() && !form.email.trim())
      return setProblem(
        "Add a phone number or an email address so we can get back to you."
      );
    try {
      const result = await send.mutateAsync(form);
      setReference(result.reference);
      window.scrollTo({ top: 0 });
    } catch (error) {
      setProblem(errorMessage(error));
    }
  };

  if (page.isPending)
    return (
      <Shell>
        <div className="grid place-items-center py-24">
          <Spinner />
        </div>
      </Shell>
    );

  if (page.isError || !page.data.open)
    return (
      <Shell>
        <Notice
          icon={<AlertCircle size={22} className="text-[#a33a33]" />}
          title="This feedback form is not open."
        >
          The link may have been replaced or turned off. Please contact{" "}
          {page.data?.organisation ?? "the organisation"} directly.
        </Notice>
      </Shell>
    );

  const organisation = page.data.organisation;

  if (reference)
    return (
      <Shell>
        <Notice
          icon={<CheckCircle2 size={26} className="text-[#1d6f57]" />}
          title="Thank you. Your feedback has been sent."
        >
          <p>
            {organisation} has received it
            {form.wantsContact ? " and will be in touch" : ""}. If you contact
            them about it, quote this reference:
          </p>
          <p className="mt-3 text-[18px] font-bold tracking-[.04em] text-[#16323a]">
            {reference}
          </p>
        </Notice>
      </Shell>
    );

  return (
    <Shell>
      <header className="mb-5 flex items-center gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#2d6f70] text-white">
          <HandHeart size={20} />
        </div>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[.08em] text-[#6d7c82]">
            {organisation}
          </div>
          <h1 className="text-[20px] font-bold tracking-[-.01em] text-[#16323a]">
            Tell us how we are doing
          </h1>
        </div>
      </header>

      <form
        className="rounded-xl border border-[#e4ebe8] bg-white p-5 shadow-[0_1px_3px_rgba(24,45,52,.06)] sm:p-8"
        onSubmit={submit}
      >
        <fieldset>
          <legend className="label">What would you like to tell us?</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {FEEDBACK_KINDS.map(kind => (
              <label
                key={kind}
                className={`cursor-pointer rounded-lg border p-3 ${
                  form.kind === kind
                    ? "border-[#2d8f86] bg-[#f1f8f6]"
                    : "border-[#dce4e1] bg-white"
                }`}
              >
                <input
                  type="radio"
                  name="kind"
                  className="sr-only"
                  checked={form.kind === kind}
                  onChange={() => set("kind", kind)}
                />
                <span className="block text-[13px] font-bold text-[#24444b]">
                  A {kind.toLowerCase()}
                </span>
                <span className="mt-0.5 block text-[11px] leading-4 text-[#6d7c82]">
                  {KIND_HELP[kind]}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="label !mt-5">
          What happened? <span className="text-red-600">*</span>
          <textarea
            required
            className="textarea mt-1 !min-h-[140px]"
            value={form.details}
            onChange={event => set("details", event.target.value)}
            placeholder="Tell us in your own words. Include dates and names if you can."
          />
        </label>
        <label className="label !mt-4">
          Who or what is this about?
          <input
            className="input mt-1"
            value={form.about}
            onChange={event => set("about", event.target.value)}
            placeholder="For example a visit, a support worker or an invoice"
          />
        </label>
        {form.kind !== "Compliment" && (
          <label className="label !mt-4">
            What would you like to happen?
            <textarea
              className="textarea mt-1 !min-h-[70px]"
              value={form.desiredOutcome}
              onChange={event => set("desiredOutcome", event.target.value)}
            />
          </label>
        )}

        <div className="mt-6 border-t border-[#edf0ef] pt-5">
          <h2 className="text-[13px] font-bold text-[#24444b]">About you</h2>
          <p className="mt-1 text-[11px] leading-4 text-[#6d7c82]">
            All of this is optional. Leave your name blank to stay anonymous.
          </p>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="label">
              Your name
              <input
                className="input mt-1"
                autoComplete="name"
                value={form.name}
                onChange={event => set("name", event.target.value)}
              />
            </label>
            <label className="label">
              You are
              <select
                className="select mt-1"
                value={form.relationship}
                onChange={event =>
                  set("relationship", event.target.value as FeedbackRelationship)
                }
              >
                {FEEDBACK_RELATIONSHIPS.map(value => (
                  <option key={value} value={value}>
                    {value === "Participant" ? "The person receiving support" : value}
                  </option>
                ))}
              </select>
            </label>
            <label className="label">
              Phone
              <input
                type="tel"
                className="input mt-1"
                autoComplete="tel"
                value={form.phone}
                onChange={event => set("phone", event.target.value)}
              />
            </label>
            <label className="label">
              Email
              <input
                type="email"
                className="input mt-1"
                autoComplete="email"
                value={form.email}
                onChange={event => set("email", event.target.value)}
              />
            </label>
          </div>
          <label className="mt-1 flex items-center gap-2 text-[12px] text-[#41555d]">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[#147f79]"
              checked={form.wantsContact}
              onChange={event => set("wantsContact", event.target.checked)}
            />
            I would like someone to contact me about this
          </label>
        </div>

        {/* Off-screen and out of the tab order: a person never reaches it. */}
        <div className="absolute left-[-9999px]" aria-hidden="true">
          <label>
            Website
            <input
              tabIndex={-1}
              autoComplete="off"
              value={form.website}
              onChange={event => set("website", event.target.value)}
            />
          </label>
        </div>

        {problem && (
          <p
            role="alert"
            className="mt-4 rounded-md border border-[#f0d2d0] bg-[#fff2f0] px-3 py-2.5 text-xs text-[#9d4942]"
          >
            {problem}
          </p>
        )}
        <button
          type="submit"
          className="btn btn-primary mt-5 !h-11 w-full"
          disabled={send.isPending}
        >
          {send.isPending ? "Sending…" : "Send feedback"}
        </button>
        <p className="mt-3 text-center text-[10px] leading-4 text-[#8a979d]">
          What you write goes to {organisation} only. If someone is in danger,
          call 000.
        </p>
      </form>
    </Shell>
  );
}
