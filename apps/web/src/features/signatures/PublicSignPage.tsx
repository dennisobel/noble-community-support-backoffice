import { useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowDown,
  Check,
  CheckCircle2,
  Clock,
  Download,
  Info,
  PenLine,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "wouter";
import type {
  PublicSigningDTO,
  PublicSigningFieldDTO,
  PublicSigningResultDTO,
} from "@shared/dto";
import { API_BASE, errorMessage } from "@/api/client";
import {
  useDeclineSigning,
  usePublicSigning,
  useSubmitSigning,
} from "@/api/hooks";
import { Btn, FormAlert, Modal, Spinner } from "@/components/app/ui";
import { prettyDate } from "@/lib/format";
import { AdoptSignatureModal } from "./AdoptSignature";
import { PdfPage } from "./PdfPage";
import { usePdfDocument } from "./pdf";
import { STATE_TITLE } from "./signature-ui";

const CONSENT =
  "I agree to use electronic records and signatures, and I intend my signature here to be my legal signature on this document.";

function Shell({
  sender,
  children,
}: {
  sender?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-[#f4f6f5] pb-8">
      <header className="border-b border-[#e0e8e5] bg-white">
        <div className="mx-auto flex max-w-[860px] items-center gap-2 px-4 py-3">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-[#12766f] text-white">
            <PenLine size={15} />
          </span>
          <span className="text-[13px] font-bold text-[#16323a]">
            {sender || "Noble Community Support"}
          </span>
          <span className="ml-auto text-[11px] text-[#7d8b91]">
            Secure signing
          </span>
        </div>
      </header>
      <div className="mx-auto max-w-[860px] px-4 pt-5">{children}</div>
    </main>
  );
}

export function Notice({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "good" | "bad";
  title: string;
  children?: React.ReactNode;
}) {
  const Icon =
    tone === "good" ? CheckCircle2 : tone === "bad" ? AlertCircle : Info;
  const colour =
    tone === "good" ? "#2f7a55" : tone === "bad" ? "#a33a33" : "#397f78";
  return (
    <div className="rounded-xl border border-[#e4ebe8] bg-white p-6 text-center sm:p-8">
      <Icon size={26} className="mx-auto" style={{ color: colour }} />
      <h1 className="mt-3 text-[18px] font-bold text-[#16323a]">{title}</h1>
      {children && (
        <div className="mx-auto mt-2 max-w-[460px] text-[13px] leading-6 text-[#52666f]">
          {children}
        </div>
      )}
    </div>
  );
}

/** The document, read-only, for someone who has finished or is only looking. */
function Reader({
  url,
  pages,
}: {
  url: string;
  pages: PublicSigningDTO["pages"];
}) {
  const file = usePdfDocument(url);
  if (file.error)
    return (
      <p className="mt-4 text-center text-xs text-[#a33a33]">{file.error}</p>
    );
  if (!file.pdf)
    return (
      <div className="grid place-items-center py-10">
        <Spinner />
      </div>
    );
  return (
    <div className="mt-5 space-y-4">
      {Array.from({ length: file.pdf.numPages }, (_, index) => index + 1).map(
        number => (
          <PdfPage
            key={number}
            pdf={file.pdf!}
            pageNumber={number}
            aspect={
              pages[number - 1]
                ? pages[number - 1].height / pages[number - 1].width
                : undefined
            }
          />
        )
      )}
    </div>
  );
}

export function ClosedView({
  data,
  token,
}: {
  data: PublicSigningDTO;
  token: string;
}) {
  const pdf = `${API_BASE}/public/sign/${token}/pdf`;
  const waiting = data.others
    .filter(other => other.status !== "signed")
    .map(other => other.name);
  const showDocument =
    data.state === "signed" || (data.state === "completed" && data.canDownload);
  return (
    <>
      {data.state === "open" ? null : (
        <Notice
          tone={
            data.state === "signed" || data.state === "completed"
              ? "good"
              : "bad"
          }
          title={STATE_TITLE[data.state]}
        >
          {data.state === "signed" && (
            <>
              <p>
                Your signature on <strong>{data.title}</strong> has been
                recorded
                {data.signer.signedAt &&
                  ` (${new Date(data.signer.signedAt).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })})`}
                .
              </p>
              {waiting.length > 0 && (
                <p className="mt-2">
                  Still to sign: {waiting.join(", ")}. Open this link again once
                  everyone has signed to download the finished copy.
                </p>
              )}
            </>
          )}
          {data.state === "completed" && (
            <p>
              Everyone has signed <strong>{data.title}</strong>.{" "}
              {data.canDownload
                ? "You can download your copy below."
                : `This copy is no longer available online. Ask ${data.senderName} for a copy.`}
            </p>
          )}
          {data.state === "declined" && (
            <p>
              <strong>{data.title}</strong> was declined, so it can no longer be
              signed. If that was a mistake, ask {data.senderName} to send a new
              request.
            </p>
          )}
          {data.state === "cancelled" && (
            <p>
              {data.senderName} cancelled this request. Nothing more is needed
              from you.
            </p>
          )}
          {data.state === "expired" && (
            <p>
              This link is no longer valid. Ask {data.senderName} to send you a
              new one.
            </p>
          )}
        </Notice>
      )}
      {data.state === "completed" && data.canDownload && (
        <div className="mt-4 flex justify-center">
          <a
            href={`${pdf}?download=1`}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#12766f] px-4 text-[13px] font-semibold text-white no-underline"
          >
            <Download size={15} /> Download signed copy
          </a>
        </div>
      )}
      {showDocument && (
        <Reader url={`/public/sign/${token}/pdf`} pages={data.pages} />
      )}
    </>
  );
}

const describeFields = (fields: PublicSigningFieldDTO[]) => {
  const count = (type: PublicSigningFieldDTO["type"]) =>
    fields.filter(field => field.type === type).length;
  const parts = [
    [count("signature"), "signature"],
    [count("text"), "text box"],
    [count("checkbox"), "tick box"],
  ] as const;
  const made = parts
    .filter(([n]) => n > 0)
    .map(
      ([n, name]) =>
        `${n} ${name}${n === 1 ? "" : name === "text box" ? "es" : "s"}`
    );
  if (count("date"))
    made.push(
      `${count("date")} date${count("date") === 1 ? "" : "s"} (filled in for you)`
    );
  return made.join(", ");
};

function TextModal({
  field,
  value,
  onSave,
  onClose,
}: {
  field: PublicSigningFieldDTO;
  value: string;
  onSave: (value: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(value);
  return (
    <Modal title={field.label || "Type your answer"} onClose={onClose}>
      <form
        onSubmit={event => {
          event.preventDefault();
          onSave(text.trim());
        }}
      >
        <input
          className="input"
          autoFocus
          value={text}
          maxLength={300}
          onChange={event => setText(event.target.value)}
          aria-label={field.label || "Your answer"}
        />
        <div className="mt-4 flex justify-end gap-2">
          <Btn variant="secondary" onClick={onClose}>
            Cancel
          </Btn>
          <Btn type="submit" disabled={field.required && !text.trim()}>
            Save
          </Btn>
        </div>
      </form>
    </Modal>
  );
}

/**
 * The document with this signer's boxes to fill in. A link holder sees it on its own page; a team
 * member who added themselves as a signer gets the same screen inside the app (`onSigned`).
 */
export function SigningView({
  data,
  token,
  onSigned,
}: {
  data: PublicSigningDTO;
  token: string;
  /** Signing inside the app: called once the signature is recorded, in place of the thank-you page. */
  onSigned?: (state: PublicSigningResultDTO["state"]) => void;
}) {
  const inApp = Boolean(onSigned);
  const qc = useQueryClient();
  const file = usePdfDocument(`/public/sign/${token}/pdf`);
  const submit = useSubmitSigning(token);
  const decline = useDeclineSigning(token);
  const [signature, setSignature] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [consent, setConsent] = useState(false);
  const [adopting, setAdopting] = useState(false);
  const [typing, setTyping] = useState<PublicSigningFieldDTO | null>(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [pulse, setPulse] = useState<string | null>(null);
  const [error, setError] = useState("");

  const ordered = useMemo(
    () =>
      [...data.fields].sort(
        (a, b) => a.page - b.page || a.y - b.y || a.x - b.x
      ),
    [data.fields]
  );
  const complete = (field: PublicSigningFieldDTO) => {
    switch (field.type) {
      case "signature":
        return Boolean(signature);
      case "date":
        return true;
      case "checkbox":
        return !field.required || values[field.id] === "true";
      default:
        return !field.required || Boolean(values[field.id]?.trim());
    }
  };
  const remaining = ordered.filter(field => !complete(field));
  const current = remaining[0] ?? null;
  const total = ordered.filter(f => f.type !== "date").length;
  const done = total - remaining.filter(f => f.type !== "date").length;

  const goTo = (field: PublicSigningFieldDTO | null) => {
    if (!field) return;
    document
      .getElementById(`field-${field.id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
    setPulse(field.id);
    window.setTimeout(() => setPulse(null), 1600);
  };

  const press = (field: PublicSigningFieldDTO) => {
    setError("");
    if (field.type === "signature") setAdopting(true);
    else if (field.type === "text") setTyping(field);
    else if (field.type === "checkbox")
      setValues(previous => ({
        ...previous,
        [field.id]: previous[field.id] === "true" ? "false" : "true",
      }));
  };

  const finish = async () => {
    setError("");
    try {
      const result = await submit.mutateAsync({
        consent: true,
        signature: signature ?? undefined,
        values: ordered
          .filter(field => field.type === "text" || field.type === "checkbox")
          .map(field => ({
            fieldId: field.id,
            value:
              values[field.id] ?? (field.type === "checkbox" ? "false" : ""),
          })),
      });
      if (onSigned) {
        onSigned(result.state);
        return;
      }
      await qc.invalidateQueries({ queryKey: ["public-signing", token] });
      window.scrollTo({ top: 0 });
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  const refuse = async () => {
    try {
      await decline.mutateAsync({ reason: reason.trim() || undefined });
      setDeclining(false);
      await qc.invalidateQueries({ queryKey: ["public-signing", token] });
      window.scrollTo({ top: 0 });
    } catch (failure) {
      setDeclining(false);
      setError(errorMessage(failure));
    }
  };

  const first = data.signer.name.split(/\s+/)[0];
  const declineLink = (
    <button
      type="button"
      className="mt-1 block text-[11px] font-semibold text-[#7d8b91] underline"
      onClick={() => setDeclining(true)}
    >
      I can&rsquo;t or won&rsquo;t sign this
    </button>
  );
  return (
    <>
      <section className="rounded-xl border border-[#e4ebe8] bg-white p-5 sm:p-6">
        <h1 className="text-[20px] font-bold leading-tight text-[#16323a]">
          {data.title}
        </h1>
        <p className="mt-1 text-[13px] text-[#52666f]">
          {inApp
            ? `You are signing this as ${data.signer.name}${data.signer.roleLabel ? `, ${data.signer.roleLabel}` : ""}.`
            : `Hi ${first}, ${data.senderName} has asked you to sign this document.`}
        </p>
        {data.message && (
          <blockquote className="mt-3 rounded-md border-l-4 border-[#12766f] bg-[#f1f8f6] px-3 py-2 text-[13px] leading-5 text-[#2f4852]">
            {data.message}
          </blockquote>
        )}
        <h2 className="mt-4 text-[12px] font-bold uppercase tracking-wide text-[#6d7c82]">
          How to sign
        </h2>
        <ol className="mt-2 space-y-2 text-[13px] leading-5 text-[#34505a]">
          {[
            "Read the document below.",
            `Tap each highlighted box. You have ${describeFields(ordered)}. Your signature is drawn or typed once and used on every signature box.`,
            "When every box is done, tick the agreement at the bottom and press Finish.",
          ].map((step, index) => (
            <li key={step} className="flex gap-2.5">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#12766f] text-[11px] font-bold text-white">
                {index + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Btn onClick={() => goTo(current)}>
            <ArrowDown size={14} /> Go to the first box
          </Btn>
          <a
            href={`${API_BASE}/public/sign/${token}/pdf?download=1`}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#cfdcd7] bg-white px-3 text-[12px] font-semibold text-[#2b4a50] no-underline"
          >
            <Download size={14} /> Save a copy to read
          </a>
        </div>
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#7d8b91]">
          {!inApp && <span>No account needed. This link is only for you.</span>}
          {data.expiresAt && (
            <span className="inline-flex items-center gap-1">
              <Clock size={11} /> Valid until{" "}
              {prettyDate(data.expiresAt.slice(0, 10))}
            </span>
          )}
        </p>
        {!inApp && declineLink}
        {data.others.length > 0 && (
          <p className="mt-1 text-[11px] text-[#7d8b91]">
            Also signing:{" "}
            {data.others
              .map(
                other =>
                  `${other.name}${other.status === "signed" ? " (signed)" : ""}`
              )
              .join(", ")}
          </p>
        )}
      </section>

      <div className="mt-5 space-y-4 pb-48">
        {file.error ? (
          <p className="text-center text-xs text-[#a33a33]">{file.error}</p>
        ) : !file.pdf ? (
          <div className="grid place-items-center py-16">
            <Spinner size={20} />
          </div>
        ) : (
          data.pages.map((size, index) => {
            const number = index + 1;
            const aspect = size.height / size.width;
            return (
              <PdfPage
                key={number}
                pdf={file.pdf!}
                pageNumber={number}
                aspect={aspect}
                label={`Page ${number} of ${data.pages.length}`}
              >
                {ordered
                  .filter(field => field.page === number)
                  .map(field => {
                    const finished = complete(field);
                    const isCurrent = current?.id === field.id;
                    const interactive = field.type !== "date";
                    const fontSize = `clamp(11px, ${(field.h * aspect * 52).toFixed(2)}cqw, 24px)`;
                    return (
                      <button
                        key={field.id}
                        id={`field-${field.id}`}
                        type="button"
                        disabled={!interactive}
                        onClick={() => press(field)}
                        aria-label={
                          field.label ||
                          (field.type === "signature"
                            ? "Signature"
                            : field.type === "checkbox"
                              ? "Tick box"
                              : field.type === "date"
                                ? "Date"
                                : "Text box")
                        }
                        className={`absolute flex items-center justify-center overflow-visible rounded-[4px] p-0 text-left ${
                          pulse === field.id ? "animate-pulse" : ""
                        }`}
                        style={{
                          left: `${field.x * 100}%`,
                          top: `${field.y * 100}%`,
                          width: `${field.w * 100}%`,
                          height: `${field.h * 100}%`,
                          minWidth: field.type === "checkbox" ? 30 : 56,
                          minHeight: 30,
                          border: finished
                            ? "1.5px solid #2f9d6b"
                            : "2px dashed #d99a00",
                          background: finished
                            ? "rgba(47,157,107,.10)"
                            : "rgba(255,196,64,.32)",
                          boxShadow: isCurrent
                            ? "0 0 0 3px rgba(18,118,111,.45)"
                            : undefined,
                          cursor: interactive ? "pointer" : "default",
                          fontSize,
                        }}
                      >
                        {isCurrent && (
                          <span className="pointer-events-none absolute -top-[22px] left-0 rounded bg-[#12766f] px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                            {field.type === "signature"
                              ? "Sign here"
                              : field.type === "checkbox"
                                ? "Tick here"
                                : "Fill in"}
                          </span>
                        )}
                        {field.type === "signature" &&
                          (signature ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={signature}
                              alt="Your signature"
                              className="h-full w-full object-contain"
                            />
                          ) : (
                            <span className="inline-flex items-center gap-1 px-1 font-semibold text-[#7a5200]">
                              <PenLine size={14} />
                              {field.label || "Sign here"}
                            </span>
                          ))}
                        {field.type === "date" && (
                          <span className="px-1 font-medium text-[#1f3f4a]">
                            {prettyDate(data.today)}
                          </span>
                        )}
                        {field.type === "text" && (
                          <span
                            className={`max-w-full truncate px-1 ${values[field.id] ? "font-medium text-[#10253a]" : "font-semibold text-[#7a5200]"}`}
                          >
                            {values[field.id] || field.label || "Tap to type"}
                          </span>
                        )}
                        {field.type === "checkbox" &&
                          (values[field.id] === "true" ? (
                            <Check
                              size={20}
                              className="text-[#1f6f4a]"
                              strokeWidth={3}
                            />
                          ) : (
                            <span className="text-[10px] font-bold text-[#7a5200]">
                              Tap
                            </span>
                          ))}
                      </button>
                    );
                  })}
              </PdfPage>
            );
          })
        )}
        {file.pdf && !inApp && (
          <p className="pt-2 text-center">{declineLink}</p>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[#d9e6e2] bg-white shadow-[0_-6px_18px_rgba(24,45,52,.10)]">
        <div className="mx-auto max-w-[860px] px-4 py-2.5">
          <div className="flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#e4ece9]">
              <div
                className="h-full rounded-full bg-[#12766f] transition-all"
                style={{ width: `${total ? (done / total) * 100 : 100}%` }}
              />
            </div>
            <span className="shrink-0 text-[11px] font-semibold text-[#52666f]">
              {remaining.length
                ? `${done} of ${total} done`
                : "Everything is filled in"}
            </span>
          </div>
          <label className="mt-2 flex items-start gap-2 text-[11.5px] leading-[1.45] text-[#34505a]">
            <input
              type="checkbox"
              className="mt-1"
              checked={consent}
              onChange={event => setConsent(event.target.checked)}
            />
            {CONSENT}
          </label>
          <FormAlert message={error} />
          <div className="mt-2 flex items-center gap-2">
            {remaining.length > 0 && (
              <Btn
                variant="secondary"
                className="flex-1 justify-center sm:flex-none"
                onClick={() => goTo(current)}
              >
                <ArrowDown size={14} /> Next box
              </Btn>
            )}
            <Btn
              className="flex-1 justify-center sm:flex-none"
              onClick={() => void finish()}
              loading={submit.isPending}
              disabled={remaining.length > 0 || !consent}
            >
              <Check size={14} /> Finish and sign
            </Btn>
          </div>
        </div>
      </div>

      {adopting && (
        <AdoptSignatureModal
          name={data.signer.name}
          current={signature}
          onClose={() => setAdopting(false)}
          onAdopt={png => {
            setSignature(png);
            setAdopting(false);
          }}
        />
      )}
      {typing && (
        <TextModal
          field={typing}
          value={values[typing.id] ?? ""}
          onClose={() => setTyping(null)}
          onSave={value => {
            setValues(previous => ({ ...previous, [typing.id]: value }));
            setTyping(null);
          }}
        />
      )}
      {declining && (
        <Modal
          title="Decline to sign?"
          subtitle="This stops the request for everyone. The sender is told."
          onClose={() => setDeclining(false)}
          busy={decline.isPending}
        >
          <label className="label" htmlFor="decline-reason">
            Reason (optional)
          </label>
          <textarea
            id="decline-reason"
            className="input min-h-[80px]"
            value={reason}
            maxLength={500}
            onChange={event => setReason(event.target.value)}
          />
          <div className="mt-4 flex justify-end gap-2">
            <Btn
              variant="secondary"
              onClick={() => setDeclining(false)}
              disabled={decline.isPending}
            >
              Go back
            </Btn>
            <Btn
              variant="danger"
              loading={decline.isPending}
              onClick={() => void refuse()}
            >
              Decline
            </Btn>
          </div>
        </Modal>
      )}
    </>
  );
}

/**
 * A document opened from a signing link. Deliberately standalone, with no navigation and no
 * session, because whoever holds the link is a signer, not a user of the system.
 */
export default function PublicSignPage() {
  const { token } = useParams<{ token: string }>();
  const signing = usePublicSigning(token);
  const title = signing.data?.title;

  // A signing page must never be indexed, whatever state the link is in.
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);
  useEffect(() => {
    if (title) document.title = `Sign: ${title}`;
  }, [title]);

  if (signing.isPending)
    return (
      <Shell>
        <div className="grid place-items-center py-24">
          <Spinner size={20} />
        </div>
      </Shell>
    );

  if (signing.isError)
    return (
      <Shell>
        <Notice tone="bad" title="This signing link is not available.">
          The link may have been replaced, cancelled or mistyped. Ask the person
          who sent it for a current link.
        </Notice>
      </Shell>
    );

  const data = signing.data;
  return (
    <Shell sender={data.senderName}>
      {data.state === "open" ? (
        <SigningView data={data} token={token} />
      ) : (
        <ClosedView data={data} token={token} />
      )}
    </Shell>
  );
}
