import {
  ArrowLeft,
  Check,
  Clock,
  Copy,
  Download,
  ExternalLink,
  FileCheck2,
  Mail,
  PenLine,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "wouter";
import type { SignatureRequestDTO, SignerDTO } from "@shared/dto";
import { downloadFile, errorMessage } from "@/api/client";
import {
  useCancelSignature,
  useDeleteSignature,
  useExtendSignature,
  useRemindSigner,
  useResetSignerLink,
  useSealSignature,
} from "@/api/hooks";
import {
  Btn,
  ConfirmModal,
  ErrorBlock,
  FormAlert,
  InfoNote,
  LoadingBlock,
  Modal,
  Panel,
} from "@/components/app/ui";
import { useAuth } from "@/lib/auth";
import { fileSize, formatDateTime, prettyDate } from "@/lib/format";
import { useNotify } from "@/lib/notify";
import { PdfPage } from "./PdfPage";
import { usePdfDocument } from "./pdf";
import {
  colourAt,
  copyText,
  FIELD_ICON,
  isMySigner,
  SIGNER_STATUS_CLASS,
  SIGNER_STATUS_LABEL,
  SignatureStatusBadge,
  tokenFromUrl,
} from "./signature-ui";

function SignerRow({
  request,
  signer,
  index,
  mine,
  onSign,
}: {
  request: SignatureRequestDTO;
  signer: SignerDTO;
  index: number;
  /** This signer is the person looking at the page, so they sign here and need no link. */
  mine: boolean;
  onSign: (token: string) => void;
}) {
  const notify = useNotify();
  const remind = useRemindSigner();
  const reset = useResetSignerLink();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const open = request.status === "sent";
  const waiting = signer.status === "pending" || signer.status === "viewed";

  const copy = async () => {
    if (!signer.url) return;
    if (await copyText(signer.url)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } else
      setError("Could not copy automatically. Select the link and copy it.");
  };

  const sendReminder = async () => {
    setError("");
    try {
      const result = await remind.mutateAsync({
        id: request.id,
        signerId: signer.id,
      });
      notify(
        result.emailed
          ? `Reminder emailed to ${signer.name}.`
          : "Email is not set up on this server, so nothing was sent. Copy the link and send it yourself.",
        result.emailed ? "success" : "info"
      );
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  return (
    <div
      className="rounded-md border border-[#e4ebe8] p-3"
      style={{ borderLeft: `4px solid ${colourAt(index).line}` }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-[#2f4852]">
            {signer.name}
            {mine && <span className="font-normal text-[#6d7c82]"> (you)</span>}
          </div>
          <div className="truncate text-[11px] text-[#6d7c82]">
            {[signer.roleLabel, signer.email].filter(Boolean).join(" · ") ||
              "No email on file"}
          </div>
        </div>
        <span className={`badge ${SIGNER_STATUS_CLASS[signer.status]}`}>
          {SIGNER_STATUS_LABEL[signer.status]}
        </span>
      </div>
      <div className="mt-1.5 space-y-0.5 text-[11px] text-[#6d7c82]">
        {signer.signedAt && <div>Signed {formatDateTime(signer.signedAt)}</div>}
        {!signer.signedAt && signer.viewedAt && (
          <div>Opened {formatDateTime(signer.viewedAt)}</div>
        )}
        {signer.declinedAt && (
          <div>
            Declined {formatDateTime(signer.declinedAt)}
            {signer.declineReason && ` — "${signer.declineReason}"`}
          </div>
        )}
        {signer.emailedAt && (
          <div>Emailed {formatDateTime(signer.emailedAt)}</div>
        )}
      </div>
      {open && waiting && signer.url && mine && (
        <div className="mt-2.5">
          <Btn
            className="!h-8 text-[11px]"
            onClick={() => onSign(tokenFromUrl(signer.url!))}
          >
            <PenLine size={13} /> Sign now
          </Btn>
          <p className="mt-1.5 text-[10.5px] leading-4 text-[#7d8b91]">
            This one is yours. You sign it here, so there is no link to send.
          </p>
        </div>
      )}
      {open && waiting && signer.url && !mine && (
        <div className="mt-2.5">
          <input
            readOnly
            aria-label={`Signing link for ${signer.name}`}
            className="input !h-8 font-mono text-[10.5px]"
            value={signer.url}
            onFocus={event => event.currentTarget.select()}
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Btn onClick={() => void copy()} className="!h-8 text-[11px]">
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? "Copied" : "Copy link"}
            </Btn>
            <Btn
              variant="secondary"
              className="!h-8 text-[11px]"
              onClick={() => window.open(signer.url!, "_blank", "noopener")}
            >
              <ExternalLink size={13} /> Open
            </Btn>
            <Btn
              variant="secondary"
              className="!h-8 text-[11px]"
              loading={remind.isPending}
              onClick={() => void sendReminder()}
              title={
                signer.email
                  ? "Email them the link again"
                  : "Add an email address to send a reminder"
              }
              disabled={!signer.email}
            >
              <Mail size={13} /> Remind
            </Btn>
            <Btn
              variant="quiet"
              className="!h-8 text-[11px]"
              onClick={() => setConfirmReset(true)}
            >
              <RefreshCw size={13} /> New link
            </Btn>
          </div>
        </div>
      )}
      <FormAlert message={error} />
      {confirmReset && (
        <ConfirmModal
          title={`Replace ${signer.name}'s link?`}
          body="The current link stops working straight away. Use this if it was sent to the wrong place. You will need to share the new one."
          confirmLabel="Replace link"
          busy={reset.isPending}
          onClose={() => setConfirmReset(false)}
          onConfirm={async () => {
            try {
              await reset.mutateAsync({ id: request.id, signerId: signer.id });
              notify("New link created. The old one no longer works.");
              setConfirmReset(false);
            } catch (failure) {
              setConfirmReset(false);
              setError(errorMessage(failure));
            }
          }}
        />
      )}
    </div>
  );
}

function ExtendModal({
  request,
  onClose,
}: {
  request: SignatureRequestDTO;
  onClose: () => void;
}) {
  const extend = useExtendSignature();
  const notify = useNotify();
  const [days, setDays] = useState(14);
  const [error, setError] = useState("");
  return (
    <Modal
      title="Give more time"
      subtitle="The links keep working until the new date. Nothing else changes."
      onClose={onClose}
      busy={extend.isPending}
    >
      <label className="label" htmlFor="extend-days">
        Links work for another
      </label>
      <select
        id="extend-days"
        className="select"
        value={days}
        onChange={event => setDays(Number(event.target.value))}
      >
        {[7, 14, 30, 60, 90].map(choice => (
          <option key={choice} value={choice}>
            {choice} days from today
          </option>
        ))}
      </select>
      <FormAlert message={error} />
      <div className="mt-5 flex justify-end gap-2">
        <Btn variant="secondary" onClick={onClose} disabled={extend.isPending}>
          Cancel
        </Btn>
        <Btn
          loading={extend.isPending}
          onClick={async () => {
            try {
              await extend.mutateAsync({ id: request.id, days });
              notify(`Extended by ${days} days.`);
              onClose();
            } catch (failure) {
              setError(errorMessage(failure));
            }
          }}
        >
          Extend
        </Btn>
      </div>
    </Modal>
  );
}

function CancelModal({
  request,
  onClose,
}: {
  request: SignatureRequestDTO;
  onClose: () => void;
}) {
  const cancel = useCancelSignature();
  const notify = useNotify();
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  return (
    <Modal
      title="Cancel this request?"
      subtitle="Every link stops working straight away. Anything already signed is kept in the record."
      onClose={onClose}
      busy={cancel.isPending}
    >
      <label className="label" htmlFor="cancel-reason">
        Reason (optional, kept in the activity)
      </label>
      <input
        id="cancel-reason"
        className="input"
        value={reason}
        maxLength={300}
        onChange={event => setReason(event.target.value)}
      />
      <FormAlert message={error} />
      <div className="mt-5 flex justify-end gap-2">
        <Btn variant="secondary" onClick={onClose} disabled={cancel.isPending}>
          Keep it
        </Btn>
        <Btn
          variant="danger"
          loading={cancel.isPending}
          onClick={async () => {
            try {
              await cancel.mutateAsync({
                id: request.id,
                reason: reason.trim() || undefined,
              });
              notify("Request cancelled.");
              onClose();
            } catch (failure) {
              setError(errorMessage(failure));
            }
          }}
        >
          Cancel request
        </Btn>
      </div>
    </Modal>
  );
}

/** A request that has been sent: how far it has got, each person's link, the document, and the trail of what happened. */
export function RequestStatusView({
  request,
  onSign,
}: {
  request: SignatureRequestDTO;
  /** Opens the signing screen for the signed-in person, given the secret of their own link. */
  onSign: (token: string) => void;
}) {
  const [, navigate] = useLocation();
  const notify = useNotify();
  const { session } = useAuth();
  const seal = useSealSignature();
  const deleteRequest = useDeleteSignature();
  const [modal, setModal] = useState<"extend" | "cancel" | "delete" | null>(
    null
  );
  const [error, setError] = useState("");
  const completed = request.status === "completed";
  const file = usePdfDocument(
    completed
      ? `/signatures/${request.id}/signed`
      : `/signatures/${request.id}/original`
  );
  const live = request.status === "sent" || request.status === "expired";
  const removable = !completed && request.status !== "sent";
  const signerIndex = (id: string) =>
    request.signers.findIndex(signer => signer.id === id);
  const waiting = (signer: SignerDTO) =>
    request.status === "sent" &&
    Boolean(signer.url) &&
    (signer.status === "pending" || signer.status === "viewed");
  const isMine = (signer: SignerDTO) => isMySigner(signer, session?.user);
  // My own signature is still outstanding: I sign it here.
  const myTurn = request.signers.find(
    signer => isMine(signer) && waiting(signer)
  );
  const othersWaiting = request.signers.some(
    signer => !isMine(signer) && waiting(signer)
  );

  const download = async (kind: "original" | "signed") => {
    setError("");
    try {
      await downloadFile(
        `/signatures/${request.id}/${kind}`,
        kind === "signed"
          ? "signed-document.pdf"
          : request.document.originalName
      );
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link
          href="/app/signatures"
          className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#4b6a70] no-underline hover:text-[#12766f]"
        >
          <ArrowLeft size={14} /> Signatures
        </Link>
        <SignatureStatusBadge status={request.status} />
        <div className="ml-auto flex flex-wrap gap-2">
          {completed && (
            <Btn onClick={() => void download("signed")}>
              <Download size={14} /> Signed copy
            </Btn>
          )}
          <Btn variant="secondary" onClick={() => void download("original")}>
            <Download size={14} /> Original
          </Btn>
          {live && (
            <Btn variant="secondary" onClick={() => setModal("extend")}>
              <Clock size={14} /> Give more time
            </Btn>
          )}
          {request.status === "sent" && (
            <Btn variant="danger" onClick={() => setModal("cancel")}>
              Cancel request
            </Btn>
          )}
          {removable && (
            <Btn variant="quiet" onClick={() => setModal("delete")}>
              <Trash2 size={14} /> Delete
            </Btn>
          )}
        </div>
      </div>

      <h1 className="page-title serif">{request.title}</h1>
      <p className="page-subtitle">
        {request.document.originalName} · {request.pageCount}{" "}
        {request.pageCount === 1 ? "page" : "pages"} ·{" "}
        {fileSize(request.document.size)}
        {request.participantName && ` · ${request.participantName}`}
      </p>
      <div className="mt-3">
        <FormAlert message={error} />
      </div>
      {myTurn && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-[#bfe0d8] bg-[#eef8f5] p-3">
          <div className="min-w-0 flex-1 text-[12px] leading-5 text-[#1f5a54]">
            <strong>Your signature is needed.</strong>{" "}
            {othersWaiting
              ? "Sign your part here; the other links are listed under People."
              : "Sign it here. Nothing has to be sent to anyone."}
          </div>
          <Btn onClick={() => onSign(tokenFromUrl(myTurn.url!))}>
            <PenLine size={14} /> Sign now
          </Btn>
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="min-w-0">
          {file.error ? (
            <ErrorBlock error={new Error(file.error)} />
          ) : !file.pdf ? (
            <LoadingBlock label="Opening the document…" />
          ) : (
            <div className="mx-auto w-full max-w-[860px]">
              {Array.from(
                { length: file.pdf.numPages },
                (_, index) => index + 1
              ).map(pageNumber => {
                const size = request.pages[pageNumber - 1];
                return (
                  <div key={pageNumber} className="mb-5">
                    <div className="mb-1 text-[10px] font-semibold text-[#7d8b91]">
                      {completed && pageNumber > request.pageCount
                        ? "Completion certificate"
                        : `Page ${pageNumber} of ${request.pageCount}`}
                    </div>
                    <PdfPage
                      pdf={file.pdf!}
                      pageNumber={pageNumber}
                      aspect={
                        !completed && size
                          ? size.height / size.width
                          : undefined
                      }
                    >
                      {!completed &&
                        request.fields
                          .filter(field => field.page === pageNumber)
                          .map(field => {
                            const colour = colourAt(
                              signerIndex(field.signerId)
                            );
                            const Icon = FIELD_ICON[field.type];
                            const owner = request.signers.find(
                              signer => signer.id === field.signerId
                            );
                            const done = owner?.status === "signed";
                            return (
                              <div
                                key={field.id}
                                className="absolute flex items-center gap-1 overflow-hidden rounded-[3px] border-[1.5px] px-1 text-[10px] font-semibold"
                                title={`${owner?.name ?? ""}: ${SIGNER_STATUS_LABEL[owner?.status ?? "pending"]}`}
                                style={{
                                  left: `${field.x * 100}%`,
                                  top: `${field.y * 100}%`,
                                  width: `${field.w * 100}%`,
                                  height: `${field.h * 100}%`,
                                  borderColor: done ? "#2f9d6b" : colour.line,
                                  background: done
                                    ? "rgba(47,157,107,.16)"
                                    : colour.fill,
                                  color: done ? "#1f6f4a" : colour.text,
                                }}
                              >
                                {done ? (
                                  <Check size={12} />
                                ) : (
                                  <Icon size={12} />
                                )}
                                <span className="truncate">
                                  {field.type === "signature"
                                    ? owner?.name
                                    : field.value === "true"
                                      ? "Ticked"
                                      : field.value || owner?.name}
                                </span>
                              </div>
                            );
                          })}
                    </PdfPage>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <aside className="min-w-0 space-y-4 lg:sticky lg:top-[84px] lg:max-h-[calc(100vh-100px)] lg:self-start lg:overflow-y-auto lg:pr-1">
          {request.sealPending && (
            <div className="rounded-md border border-[#f0dcae] bg-[#fff8e8] p-3 text-[12px] leading-5 text-[#7a5a14]">
              Everyone has signed, but the finished copy has not been created
              yet. It is retried automatically; you can also do it now.
              <div className="mt-2">
                <Btn
                  loading={seal.isPending}
                  onClick={async () => {
                    try {
                      await seal.mutateAsync({ id: request.id });
                      notify("The signed copy is ready.");
                    } catch (failure) {
                      setError(errorMessage(failure));
                    }
                  }}
                >
                  <FileCheck2 size={14} /> Create signed copy
                </Btn>
              </div>
            </div>
          )}

          <Panel
            title={`People (${request.signedCount} of ${request.signerCount} signed)`}
          >
            <div className="space-y-3 p-4">
              {request.signers.map((signer, index) => (
                <SignerRow
                  key={signer.id}
                  request={request}
                  signer={signer}
                  index={index}
                  mine={isMine(signer)}
                  onSign={onSign}
                />
              ))}
              {request.expiresAt && request.status !== "completed" && (
                <p
                  className={`text-[11px] ${request.status === "expired" ? "font-semibold text-[#a84540]" : "text-[#6d7c82]"}`}
                >
                  {request.status === "expired"
                    ? `The links expired on ${prettyDate(request.expiresAt.slice(0, 10))}.`
                    : `Links work until ${prettyDate(request.expiresAt.slice(0, 10))}.`}
                </p>
              )}
              {othersWaiting && (
                <InfoNote>
                  Share each link only with that person. Anyone who has it can
                  sign for them.
                </InfoNote>
              )}
            </div>
          </Panel>

          {completed && request.signedFile && (
            <Panel title="Signed copy">
              <div className="space-y-2 p-4 text-[12px] text-[#52666f]">
                <p>
                  Everyone signed on {formatDateTime(request.completedAt)}. The
                  last pages are a certificate listing who signed, when and from
                  where.
                </p>
                <p className="break-all font-mono text-[10px] text-[#7d8b91]">
                  Signed copy SHA-256: {request.signedFile.sha256}
                </p>
                <p className="break-all font-mono text-[10px] text-[#7d8b91]">
                  Original SHA-256: {request.document.sha256}
                </p>
                {request.filedDocumentId && request.participantId && (
                  <p>
                    A copy is filed in{" "}
                    <Link
                      href={`/app/clients/${request.participantId}`}
                      className="font-semibold text-[#12766f]"
                    >
                      {request.participantName || "the client"}&rsquo;s
                      documents
                    </Link>
                    .
                  </p>
                )}
                <p className="text-[11px] text-[#7d8b91]">
                  Signers can also download it from their own link for 30 days.
                </p>
              </div>
            </Panel>
          )}

          <Panel title="Activity">
            <ol className="space-y-3 p-4">
              {[...request.events].reverse().map((event, index) => (
                <li key={`${event.at}-${index}`} className="text-[12px]">
                  <div className="text-[11px] text-[#7d8b91]">
                    {formatDateTime(event.at)} · {event.by || "System"}
                  </div>
                  <div className="text-[#34505a]">{event.detail}</div>
                </li>
              ))}
            </ol>
          </Panel>
        </aside>
      </div>

      {modal === "extend" && (
        <ExtendModal request={request} onClose={() => setModal(null)} />
      )}
      {modal === "cancel" && (
        <CancelModal request={request} onClose={() => setModal(null)} />
      )}
      {modal === "delete" && (
        <ConfirmModal
          title="Delete this request?"
          body="The uploaded PDF and its record are removed for good."
          confirmLabel="Delete"
          danger
          busy={deleteRequest.isPending}
          onClose={() => setModal(null)}
          onConfirm={async () => {
            try {
              await deleteRequest.mutateAsync({ id: request.id });
              notify("Request deleted.");
              navigate("/app/signatures");
            } catch (failure) {
              setModal(null);
              setError(errorMessage(failure));
            }
          }}
        />
      )}
    </>
  );
}
