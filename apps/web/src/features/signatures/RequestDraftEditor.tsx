import {
  ArrowLeft,
  Check,
  MousePointerClick,
  Plus,
  Send,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import type { SignatureRequestDTO } from "@shared/dto";
import {
  PARTICIPANT_FOLDERS,
  SIGNATURE_FIELD_TYPES,
  type SignatureFieldType,
} from "@shared/enums";
import { SIGNATURE_LIMITS } from "@shared/schemas/signatures";
import { errorMessage } from "@/api/client";
import {
  useDeleteSignature,
  useParticipants,
  useSaveSignatureDraft,
  useSendSignature,
  useStaff,
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
import { useNotify } from "@/lib/notify";
import {
  FieldEditor,
  type EditorField,
  type EditorSigner,
} from "./FieldEditor";
import { usePdfDocument } from "./pdf";
import {
  colourAt,
  FIELD_HELP,
  FIELD_ICON,
  FIELD_NAME,
  SignatureStatusBadge,
} from "./signature-ui";

interface DraftSigner extends EditorSigner {
  email: string;
  roleLabel: string;
}

const EXPIRY_CHOICES = [7, 14, 30, 60, 90];
/** Only to hold off saving a half-typed address; the server does the real check. */
const LOOKS_LIKE_EMAIL = /^[^@ ]+@[^@ ]+[.][^@ ]+$/;

function SendModal({
  signers,
  fields,
  busy,
  error,
  onSend,
  onClose,
}: {
  signers: DraftSigner[];
  fields: EditorField[];
  busy: boolean;
  error: string;
  onSend: (options: { days: number; email: boolean }) => void;
  onClose: () => void;
}) {
  const [days, setDays] = useState<number>(SIGNATURE_LIMITS.defaultExpiryDays);
  const [email, setEmail] = useState(true);
  const anyEmail = signers.some(signer => signer.email.trim());
  return (
    <Modal
      title="Send for signature"
      subtitle="Each person gets their own private link. They do not need an account."
      onClose={onClose}
      busy={busy}
    >
      <ul className="space-y-2">
        {signers.map((signer, index) => {
          const count = fields.filter(f => f.signerId === signer.id).length;
          return (
            <li
              key={signer.id}
              className="flex items-center gap-2 rounded-md border border-[#e4ebe8] px-3 py-2 text-xs"
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: colourAt(index).line }}
              />
              <span className="min-w-0 flex-1 truncate font-semibold text-[#2f4852]">
                {signer.name}
                {signer.roleLabel && (
                  <span className="font-normal text-[#6d7c82]">
                    {" "}
                    · {signer.roleLabel}
                  </span>
                )}
              </span>
              <span className="shrink-0 text-[#6d7c82]">
                {count} {count === 1 ? "box" : "boxes"}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="expiry-days">
            Links work for
          </label>
          <select
            id="expiry-days"
            className="select"
            value={days}
            onChange={event => setDays(Number(event.target.value))}
          >
            {EXPIRY_CHOICES.map(choice => (
              <option key={choice} value={choice}>
                {choice} days
              </option>
            ))}
          </select>
        </div>
        {anyEmail && (
          <label className="flex items-end gap-2 pb-2 text-xs text-[#4b6068]">
            <input
              type="checkbox"
              checked={email}
              onChange={event => setEmail(event.target.checked)}
            />
            Also email each person their link
          </label>
        )}
      </div>
      <InfoNote className="mt-4">
        Once sent, the document and its boxes are locked: what the signers see
        is exactly what you set up. You can copy each link afterwards, replace
        one, or cancel the request.
      </InfoNote>
      <FormAlert message={error} />
      <div className="mt-5 flex justify-end gap-2">
        <Btn variant="secondary" onClick={onClose} disabled={busy}>
          Back
        </Btn>
        <Btn
          loading={busy}
          onClick={() => onSend({ days, email: anyEmail && email })}
        >
          <Send size={14} />
          Send now
        </Btn>
      </div>
    </Modal>
  );
}

/**
 * Sets a request up: who signs, where, and what each box asks for. Changes are kept as the
 * sender goes (a short pause after the last edit saves them), so nothing is lost by leaving.
 */
export function RequestDraftEditor({
  request,
}: {
  request: SignatureRequestDTO;
}) {
  const [, navigate] = useLocation();
  const notify = useNotify();
  const { session } = useAuth();
  const file = usePdfDocument(`/signatures/${request.id}/original`);
  const participants = useParticipants({ status: "Active" });
  const team = useStaff();
  const saveDraft = useSaveSignatureDraft();
  const sendRequest = useSendSignature();
  const deleteRequest = useDeleteSignature();

  const [title, setTitle] = useState(request.title);
  const [message, setMessage] = useState(request.message);
  const [participantId, setParticipantId] = useState(
    request.participantId ?? ""
  );
  const [folderKey, setFolderKey] = useState(request.folderKey);
  const [signers, setSigners] = useState<DraftSigner[]>(() =>
    request.signers.map(signer => ({
      id: signer.id,
      name: signer.name,
      email: signer.email,
      roleLabel: signer.roleLabel,
    }))
  );
  const [fields, setFields] = useState<EditorField[]>(() =>
    request.fields.map(field => ({
      id: field.id,
      signerId: field.signerId,
      type: field.type,
      page: field.page,
      x: field.x,
      y: field.y,
      w: field.w,
      h: field.h,
      required: field.required,
      label: field.label,
    }))
  );
  const [activeSigner, setActiveSigner] = useState(
    request.signers[0]?.id ?? ""
  );
  const [tool, setTool] = useState<SignatureFieldType | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [sendOpen, setSendOpen] = useState(false);
  const [sendError, setSendError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const revision = useRef(request.rev);
  const edits = useRef(0);
  const dirtyRef = useRef(false);
  const inflight = useRef<Promise<boolean> | null>(null);

  const touch = useCallback(() => {
    edits.current += 1;
    dirtyRef.current = true;
    setDirty(true);
  }, []);
  const editFields = useCallback(
    (change: (previous: EditorField[]) => EditorField[]) => {
      setFields(change);
      touch();
    },
    [touch]
  );

  const selected = fields.find(field => field.id === selectedId) ?? null;
  const activeIndex = signers.findIndex(signer => signer.id === activeSigner);
  const counts = useMemo(
    () =>
      new Map(
        signers.map(signer => [
          signer.id,
          fields.filter(field => field.signerId === signer.id).length,
        ])
      ),
    [signers, fields]
  );

  // Keep a valid person picked for new boxes.
  useEffect(() => {
    if (!signers.some(signer => signer.id === activeSigner))
      setActiveSigner(signers[0]?.id ?? "");
  }, [signers, activeSigner]);

  const problem = (): string => {
    if (!title.trim()) return "Give the request a title.";
    if (signers.some(signer => !signer.name.trim()))
      return "Enter a name for everyone who signs.";
    const badEmail = signers.find(
      signer =>
        signer.email.trim() && !LOOKS_LIKE_EMAIL.test(signer.email.trim())
    );
    if (badEmail) return `Check the email address for ${badEmail.name.trim()}.`;
    return "";
  };

  const saveNow = useCallback(
    (quiet = false): Promise<boolean> => {
      if (inflight.current) return inflight.current;
      const blocked = problem();
      if (blocked) {
        if (!quiet) setError(blocked);
        return Promise.resolve(false);
      }
      const marker = edits.current;
      setSaving(true);
      const run = (async () => {
        try {
          const saved = await saveDraft.mutateAsync({
            id: request.id,
            title: title.trim(),
            message,
            participantId: participantId || null,
            folderKey,
            signers: signers.map(signer => ({
              id: signer.id,
              name: signer.name.trim(),
              email: signer.email.trim(),
              roleLabel: signer.roleLabel.trim(),
            })),
            fields: fields.map(field => ({ ...field })),
            rev: revision.current,
          });
          revision.current = saved.rev;
          // Edits made while this was saving still need saving.
          if (edits.current === marker) {
            dirtyRef.current = false;
            setDirty(false);
          }
          setError("");
          return true;
        } catch (failure) {
          setError(errorMessage(failure));
          return false;
        } finally {
          inflight.current = null;
          setSaving(false);
        }
      })();
      inflight.current = run;
      return run;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [request.id, title, message, participantId, folderKey, signers, fields]
  );
  const latestSave = useRef(saveNow);
  latestSave.current = saveNow;

  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(() => void latestSave.current(true), 2000);
    return () => window.clearTimeout(timer);
  }, [dirty, title, message, participantId, folderKey, signers, fields]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select")) return;
      if (event.key === "Escape") {
        setTool(null);
        setSelectedId(null);
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedId) {
        event.preventDefault();
        editFields(previous => previous.filter(f => f.id !== selectedId));
        setSelectedId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, editFields]);

  const ready =
    signers.length > 0 && signers.every(s => (counts.get(s.id) ?? 0) > 0);

  const send = async (options: { days: number; email: boolean }) => {
    setSendError("");
    // Wait for any save in progress, then save whatever changed since.
    if (inflight.current) await inflight.current;
    if (dirtyRef.current && !(await latestSave.current(false))) {
      setSendError(problem() || "The draft could not be saved. Try again.");
      return;
    }
    try {
      const result = await sendRequest.mutateAsync({
        id: request.id,
        expiresInDays: options.days,
        emailSigners: options.email,
        rev: revision.current,
      });
      dirtyRef.current = false;
      setDirty(false);
      setSendOpen(false);
      notify(
        result.emailed.length
          ? `Sent. ${result.emailed.length} ${result.emailed.length === 1 ? "person was" : "people were"} emailed; copy anyone else's link below.`
          : "Sent. Copy each person's link below and share it."
      );
    } catch (failure) {
      setSendError(errorMessage(failure));
    }
  };

  const addSigner = (seed: Partial<DraftSigner> = {}) => {
    if (signers.length >= SIGNATURE_LIMITS.maxSigners) return;
    const signer: DraftSigner = {
      id: nanoid(10),
      name: "",
      email: "",
      roleLabel: "",
      ...seed,
    };
    setSigners(previous => [...previous, signer]);
    setActiveSigner(current => current || signer.id);
    touch();
  };
  const changeSigner = (id: string, patch: Partial<DraftSigner>) => {
    setSigners(previous =>
      previous.map(signer =>
        signer.id === id ? { ...signer, ...patch } : signer
      )
    );
    touch();
  };
  const removeSigner = (id: string) => {
    setSigners(previous => previous.filter(signer => signer.id !== id));
    setFields(previous => previous.filter(field => field.signerId !== id));
    setSelectedId(null);
    touch();
  };

  const clients = participants.data?.items ?? [];
  const members = team.data ?? [];
  const pickOne = (value: string) => {
    const [kind, id] = value.split(":");
    if (kind === "p") {
      const client = clients.find(person => person.id === id);
      if (client)
        addSigner({
          name: client.name,
          email: client.email ?? "",
          roleLabel: "Participant",
        });
    } else if (kind === "s") {
      const member = members.find(person => person.id === id);
      if (member)
        addSigner({
          name: member.name,
          email: member.email ?? "",
          roleLabel: member.position || "Support worker",
        });
    }
  };

  const checklist: Array<[boolean, string]> = [
    [signers.length > 0, "Add the people who need to sign"],
    [
      signers.length > 0 && signers.every(s => (counts.get(s.id) ?? 0) > 0),
      "Give each person at least one box on the document",
    ],
  ];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link
          href="/app/signatures"
          className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#4b6a70] no-underline hover:text-[#12766f]"
        >
          <ArrowLeft size={14} /> Signatures
        </Link>
        <SignatureStatusBadge status="draft" />
        <span className="text-[11px] text-[#7d8b91]" role="status">
          {saving ? "Saving…" : dirty ? "Unsaved changes" : "All changes saved"}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Btn variant="quiet" onClick={() => setConfirmDelete(true)}>
            <Trash2 size={14} /> Delete
          </Btn>
          <Btn
            variant="secondary"
            onClick={() => void saveNow(false)}
            loading={saving}
            disabled={!dirty}
          >
            Save draft
          </Btn>
          <Btn disabled={!ready} onClick={() => setSendOpen(true)}>
            <Send size={14} />
            Send for signature
          </Btn>
        </div>
      </div>

      <input
        aria-label="Title"
        className="input mb-4 !h-12 !text-[19px] font-semibold"
        value={title}
        maxLength={200}
        onChange={event => {
          setTitle(event.target.value);
          touch();
        }}
      />
      <FormAlert message={error} />

      <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_350px]">
        <section className="min-w-0">
          <div className="sticky top-[76px] z-10 -mx-1 mb-4 rounded-lg border border-[#d9e6e2] bg-white/95 p-2.5 shadow-sm backdrop-blur">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold text-[#52666f]">
                Add a box for
              </span>
              <select
                className="select !h-8 w-auto min-w-[140px] !py-1 text-[11px]"
                value={activeSigner}
                onChange={event => setActiveSigner(event.target.value)}
                aria-label="Who the next box is for"
                disabled={!signers.length}
              >
                {!signers.length && (
                  <option value="">Add a person first</option>
                )}
                {signers.map(signer => (
                  <option key={signer.id} value={signer.id}>
                    {signer.name || "Unnamed person"}
                  </option>
                ))}
              </select>
              {SIGNATURE_FIELD_TYPES.map(type => {
                const Icon = FIELD_ICON[type];
                const on = tool === type;
                return (
                  <button
                    key={type}
                    type="button"
                    title={FIELD_HELP[type]}
                    disabled={!signers.length}
                    aria-pressed={on}
                    onClick={() => setTool(on ? null : type)}
                    className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-semibold disabled:opacity-50 ${
                      on
                        ? "border-[#12766f] bg-[#12766f] text-white"
                        : "border-[#cfdcd7] bg-white text-[#2b4a50]"
                    }`}
                    style={
                      !on && activeIndex >= 0
                        ? { borderColor: colourAt(activeIndex).line }
                        : undefined
                    }
                  >
                    <Icon size={13} />
                    {FIELD_NAME[type]}
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 flex items-center gap-1.5 text-[10.5px] text-[#6d7c82]">
              <MousePointerClick size={12} />
              {tool
                ? `Click the page where the ${FIELD_NAME[tool].toLowerCase()} box should go. Press Esc to stop.`
                : signers.length
                  ? "Pick a box type, then click the page. Drag a box to move it; drag its corner to resize."
                  : "Add the people who need to sign, then place their boxes on the pages."}
            </p>
          </div>

          {file.error ? (
            <ErrorBlock error={new Error(file.error)} />
          ) : !file.pdf ? (
            <LoadingBlock label="Opening the document…" />
          ) : (
            <FieldEditor
              pdf={file.pdf}
              pages={request.pages}
              signers={signers}
              fields={fields}
              tool={tool}
              activeSignerId={activeSigner}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onChange={editFields}
              onPlaced={() => setTool(null)}
            />
          )}
        </section>

        <aside className="min-w-0 space-y-4 lg:sticky lg:top-[84px] lg:max-h-[calc(100vh-100px)] lg:self-start lg:overflow-y-auto lg:pr-1">
          <Panel title="Who signs">
            <div className="space-y-3 p-4">
              {signers.map((signer, index) => (
                <div
                  key={signer.id}
                  className="rounded-md border border-[#e4ebe8] p-2.5"
                  style={{ borderLeft: `4px solid ${colourAt(index).line}` }}
                >
                  <div className="flex items-start gap-2">
                    <input
                      aria-label="Name"
                      className="input !h-8 flex-1 text-[12px] font-semibold"
                      placeholder="Full name"
                      value={signer.name}
                      maxLength={120}
                      onChange={event =>
                        changeSigner(signer.id, { name: event.target.value })
                      }
                    />
                    <button
                      type="button"
                      className="icon-btn !h-8 !w-8"
                      aria-label={`Remove ${signer.name || "this person"}`}
                      onClick={() => removeSigner(signer.id)}
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <input
                      aria-label="Email (optional)"
                      className="input !h-8 text-[11px]"
                      placeholder="Email (optional)"
                      inputMode="email"
                      value={signer.email}
                      onChange={event =>
                        changeSigner(signer.id, { email: event.target.value })
                      }
                    />
                    <input
                      aria-label="Role"
                      className="input !h-8 text-[11px]"
                      placeholder="Role, e.g. Participant"
                      value={signer.roleLabel}
                      maxLength={60}
                      onChange={event =>
                        changeSigner(signer.id, {
                          roleLabel: event.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="mt-1.5 text-[10px] text-[#7d8b91]">
                    {counts.get(signer.id) ?? 0}{" "}
                    {(counts.get(signer.id) ?? 0) === 1 ? "box" : "boxes"}{" "}
                    placed
                  </div>
                </div>
              ))}
              {!signers.length && (
                <p className="text-[11px] leading-5 text-[#6d7c82]">
                  Add everyone who needs to sign: a client, a worker, a family
                  member, or yourself.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Btn
                  variant="secondary"
                  onClick={() => addSigner()}
                  disabled={signers.length >= SIGNATURE_LIMITS.maxSigners}
                >
                  <Plus size={13} /> Add person
                </Btn>
                {session?.user && (
                  <Btn
                    variant="quiet"
                    onClick={() =>
                      addSigner({
                        name: session.user.name,
                        email: session.user.email,
                        roleLabel: "Noble Community Support",
                      })
                    }
                  >
                    <UserPlus size={13} /> Add me
                  </Btn>
                )}
              </div>
              {(clients.length > 0 || members.length > 0) && (
                <select
                  className="select !h-8 text-[11px]"
                  value=""
                  aria-label="Add a client or team member"
                  onChange={event => pickOne(event.target.value)}
                >
                  <option value="">Add a client or team member…</option>
                  {clients.length > 0 && (
                    <optgroup label="Clients">
                      {clients.map(person => (
                        <option key={person.id} value={`p:${person.id}`}>
                          {person.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {members.length > 0 && (
                    <optgroup label="Team">
                      {members.map(person => (
                        <option key={person.id} value={`s:${person.id}`}>
                          {person.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              )}
            </div>
          </Panel>

          {selected && (
            <Panel
              title={`${FIELD_NAME[selected.type]} box`}
              action={
                <button
                  type="button"
                  className="btn btn-quiet !h-7 !px-2 text-[11px]"
                  onClick={() => {
                    editFields(previous =>
                      previous.filter(field => field.id !== selected.id)
                    );
                    setSelectedId(null);
                  }}
                >
                  <Trash2 size={12} /> Remove
                </button>
              }
            >
              <div className="space-y-3 p-4">
                <div>
                  <label className="label" htmlFor="box-owner">
                    Belongs to
                  </label>
                  <select
                    id="box-owner"
                    className="select !h-8 text-[12px]"
                    value={selected.signerId}
                    onChange={event =>
                      editFields(previous =>
                        previous.map(field =>
                          field.id === selected.id
                            ? { ...field, signerId: event.target.value }
                            : field
                        )
                      )
                    }
                  >
                    {signers.map(signer => (
                      <option key={signer.id} value={signer.id}>
                        {signer.name || "Unnamed person"}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="box-label">
                    Hint shown on the box
                  </label>
                  <input
                    id="box-label"
                    className="input !h-8 text-[12px]"
                    value={selected.label}
                    maxLength={80}
                    onChange={event =>
                      editFields(previous =>
                        previous.map(field =>
                          field.id === selected.id
                            ? { ...field, label: event.target.value }
                            : field
                        )
                      )
                    }
                  />
                </div>
                {selected.type !== "date" && (
                  <label className="flex items-center gap-2 text-xs text-[#4b6068]">
                    <input
                      type="checkbox"
                      checked={selected.required}
                      onChange={event =>
                        editFields(previous =>
                          previous.map(field =>
                            field.id === selected.id
                              ? { ...field, required: event.target.checked }
                              : field
                          )
                        )
                      }
                    />
                    Must be completed before they can finish
                  </label>
                )}
                <p className="text-[10.5px] leading-4 text-[#6d7c82]">
                  {FIELD_HELP[selected.type]}
                </p>
              </div>
            </Panel>
          )}

          <Panel title="Message and filing">
            <div className="space-y-3 p-4">
              <div>
                <label className="label" htmlFor="request-message">
                  Message to the signers (optional)
                </label>
                <textarea
                  id="request-message"
                  className="input min-h-[70px] text-[12px]"
                  value={message}
                  maxLength={1000}
                  placeholder="e.g. Please read pages 1–3, then sign on page 4."
                  onChange={event => {
                    setMessage(event.target.value);
                    touch();
                  }}
                />
              </div>
              <div>
                <label className="label" htmlFor="request-client">
                  File the signed copy under a client (optional)
                </label>
                <select
                  id="request-client"
                  className="select !h-8 text-[12px]"
                  value={participantId}
                  onChange={event => {
                    setParticipantId(event.target.value);
                    touch();
                  }}
                >
                  <option value="">Don't file it with a client</option>
                  {clients.map(person => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
              </div>
              {participantId && (
                <div>
                  <label className="label" htmlFor="request-folder">
                    Folder
                  </label>
                  <select
                    id="request-folder"
                    className="select !h-8 text-[12px]"
                    value={folderKey}
                    onChange={event => {
                      setFolderKey(event.target.value);
                      touch();
                    }}
                  >
                    {PARTICIPANT_FOLDERS.map(folder => (
                      <option key={folder.key} value={folder.key}>
                        {folder.title}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </Panel>

          <Panel title="Ready to send?">
            <ul className="space-y-1.5 p-4 text-[12px]">
              {checklist.map(([ok, text]) => (
                <li
                  key={text}
                  className={`flex items-start gap-2 ${ok ? "text-[#2f7a55]" : "text-[#6d7c82]"}`}
                >
                  <span
                    className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full ${
                      ok ? "bg-[#dff1e8]" : "border border-[#cfdcd7]"
                    }`}
                  >
                    {ok && <Check size={11} />}
                  </span>
                  {text}
                </li>
              ))}
            </ul>
            <div className="px-4 pb-4">
              <Btn
                className="w-full justify-center"
                disabled={!ready}
                onClick={() => setSendOpen(true)}
              >
                <Send size={14} />
                Send for signature
              </Btn>
            </div>
          </Panel>
        </aside>
      </div>

      {sendOpen && (
        <SendModal
          signers={signers}
          fields={fields}
          busy={sendRequest.isPending || saving}
          error={sendError}
          onSend={options => void send(options)}
          onClose={() => setSendOpen(false)}
        />
      )}
      {confirmDelete && (
        <ConfirmModal
          title="Delete this draft?"
          body="The uploaded PDF and everything placed on it will be removed. This cannot be undone."
          confirmLabel="Delete draft"
          danger
          busy={deleteRequest.isPending}
          onClose={() => setConfirmDelete(false)}
          onConfirm={async () => {
            try {
              dirtyRef.current = false;
              setDirty(false);
              await deleteRequest.mutateAsync({ id: request.id });
              notify("Draft deleted.");
              navigate("/app/signatures");
            } catch (failure) {
              setConfirmDelete(false);
              setError(errorMessage(failure));
            }
          }}
        />
      )}
    </>
  );
}
