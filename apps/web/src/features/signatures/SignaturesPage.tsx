import { ChevronRight, FileUp, Plus, Search } from "lucide-react";
import { useRef, useState } from "react";
import { useLocation } from "wouter";
import { PARTICIPANT_FOLDERS } from "@shared/enums";
import { errorMessage } from "@/api/client";
import {
  useCreateSignature,
  useParticipants,
  useSignatures,
} from "@/api/hooks";
import {
  Btn,
  Drawer,
  EmptyState,
  ErrorBlock,
  FormAlert,
  InfoNote,
  LoadingBlock,
  Panel,
  SectionHeading,
  useDebounced,
} from "@/components/app/ui";
import { fileSize, timeAgo } from "@/lib/format";
import { useNotify } from "@/lib/notify";
import { SignatureStatusBadge, STATUS_LABEL } from "./signature-ui";

const MAX_MB = 25;

function NewRequestDrawer({ onClose }: { onClose: () => void }) {
  const [, navigate] = useLocation();
  const notify = useNotify();
  const create = useCreateSignature();
  const participants = useParticipants({ status: "Active" });
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [participantId, setParticipantId] = useState("");
  const [folderKey, setFolderKey] = useState("agreement");
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");

  const choose = (picked: File | undefined) => {
    setError("");
    if (!picked) return;
    if (!/\.pdf$/i.test(picked.name) && picked.type !== "application/pdf")
      return setError(
        "Only PDF files can be sent for signature. Save the document as a PDF first."
      );
    if (picked.size > MAX_MB * 1024 * 1024)
      return setError(`That file is over ${MAX_MB} MB.`);
    setFile(picked);
    setTitle(current => current || picked.name.replace(/\.pdf$/i, ""));
  };

  const submit = async () => {
    if (!file) return setError("Choose a PDF first.");
    setError("");
    const form = new FormData();
    form.append("file", file);
    if (title.trim()) form.append("title", title.trim());
    if (message.trim()) form.append("message", message.trim());
    if (participantId) {
      form.append("participantId", participantId);
      form.append("folderKey", folderKey);
    }
    try {
      const created = await create.mutateAsync({
        form,
        onProgress: setProgress,
      });
      notify("Uploaded. Now add who signs and place their boxes.");
      navigate(`/app/signatures/${created.id}`);
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  return (
    <Drawer
      onClose={onClose}
      eyebrow="Signature request"
      title="Upload a PDF to sign"
      subtitle="Next you will add who signs and place their boxes on the pages."
      footer={
        <div className="flex justify-end gap-2">
          <Btn
            variant="secondary"
            onClick={onClose}
            disabled={create.isPending}
          >
            Cancel
          </Btn>
          <Btn onClick={() => void submit()} loading={create.isPending}>
            {create.isPending
              ? `Uploading ${progress}%`
              : "Upload and continue"}
          </Btn>
        </div>
      }
    >
      <div className="space-y-4">
        <div
          onDragOver={event => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={event => {
            event.preventDefault();
            setDragging(false);
            choose(event.dataTransfer.files[0]);
          }}
          className={`rounded-lg border-2 border-dashed p-6 text-center ${
            dragging
              ? "border-[#12766f] bg-[#eef7f5]"
              : "border-[#c6d8d3] bg-[#f8fbfa]"
          }`}
        >
          <FileUp size={24} className="mx-auto text-[#397f78]" />
          {file ? (
            <p className="mt-2 text-[13px] font-semibold text-[#2f4852]">
              {file.name}
              <span className="ml-2 font-normal text-[#6d7c82]">
                {fileSize(file.size)}
              </span>
            </p>
          ) : (
            <p className="mt-2 text-[12px] text-[#52666f]">
              Drag a PDF here, or choose one. Up to {MAX_MB} MB.
            </p>
          )}
          <input
            ref={input}
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            aria-label="Choose a PDF"
            onChange={event => choose(event.target.files?.[0])}
          />
          <Btn
            variant="secondary"
            className="mt-3"
            onClick={() => input.current?.click()}
          >
            {file ? "Choose a different file" : "Choose a PDF"}
          </Btn>
        </div>

        <div>
          <label className="label" htmlFor="new-title">
            Title
          </label>
          <input
            id="new-title"
            className="input"
            value={title}
            maxLength={200}
            placeholder="e.g. Service agreement — Alex Client"
            onChange={event => setTitle(event.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="new-message">
            Message to the signers (optional)
          </label>
          <textarea
            id="new-message"
            className="input min-h-[70px]"
            value={message}
            maxLength={1000}
            placeholder="e.g. Please read pages 1–3, then sign on page 4."
            onChange={event => setMessage(event.target.value)}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="new-client">
              File the signed copy under a client
            </label>
            <select
              id="new-client"
              className="select"
              value={participantId}
              onChange={event => setParticipantId(event.target.value)}
            >
              <option value="">Not for a particular client</option>
              {(participants.data?.items ?? []).map(person => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </div>
          {participantId && (
            <div>
              <label className="label" htmlFor="new-folder">
                Folder
              </label>
              <select
                id="new-folder"
                className="select"
                value={folderKey}
                onChange={event => setFolderKey(event.target.value)}
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
        <InfoNote>
          Signed documents get a certificate page listing who signed, when and
          from where. The signed copy is filed with the client when everyone has
          signed.
        </InfoNote>
        <FormAlert message={error} />
      </div>
    </Drawer>
  );
}

const STATUS_FILTERS = [
  "draft",
  "sent",
  "completed",
  "declined",
  "expired",
  "cancelled",
] as const;

export default function SignaturesPage() {
  const [, navigate] = useLocation();
  const [status, setStatus] = useState("all");
  const [text, setText] = useState("");
  const [creating, setCreating] = useState(false);
  const q = useDebounced(text.trim(), 250);
  const signatures = useSignatures({ status, q: q || undefined });
  const totals = signatures.data?.totals;
  const items = signatures.data?.items ?? [];

  return (
    <>
      <SectionHeading
        title="Signatures"
        subtitle="Upload a PDF, place signature boxes, and share a private link. Clients and staff sign on their phone or computer without an account."
        actions={
          <Btn onClick={() => setCreating(true)}>
            <Plus size={15} />
            New signature request
          </Btn>
        }
      />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          ["Waiting for signatures", totals?.awaiting ?? 0, false],
          ["Needs attention", totals?.needsAttention ?? 0, true],
          ["Drafts", totals?.drafts ?? 0, false],
          ["Signed", totals?.completed ?? 0, false],
        ].map(([label, value, warn]) => (
          <div key={String(label)} className="panel p-4">
            <div className="text-[10px] text-[#809097]">{label}</div>
            <div
              className={`mt-1 text-xl font-semibold ${warn && Number(value) ? "text-[#a84540]" : ""}`}
            >
              {value}
            </div>
          </div>
        ))}
      </div>

      <Panel
        className="mt-5"
        title="All requests"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search
                size={13}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#89969b]"
              />
              <input
                className="input h-8 w-[190px] py-1 !pl-8 text-[11px]"
                placeholder="Title or person"
                value={text}
                onChange={event => setText(event.target.value)}
                aria-label="Search signature requests"
              />
            </div>
            <select
              className="select h-8 w-[150px] py-1 text-[10px]"
              value={status}
              onChange={event => setStatus(event.target.value)}
              aria-label="Filter by status"
            >
              <option value="all">All statuses</option>
              {STATUS_FILTERS.map(item => (
                <option key={item} value={item}>
                  {STATUS_LABEL[item]}
                </option>
              ))}
            </select>
          </div>
        }
      >
        {signatures.isError && (
          <div className="p-4">
            <ErrorBlock
              error={signatures.error}
              onRetry={() => signatures.refetch()}
            />
          </div>
        )}
        {signatures.isPending ? (
          <LoadingBlock />
        ) : !items.length ? (
          <EmptyState
            title={
              status === "all" && !q
                ? "No signature requests yet"
                : "Nothing matches"
            }
            text={
              status === "all" && !q
                ? "Upload a PDF such as a service agreement, place the signature boxes, and send each person their link."
                : "Try a different search or status."
            }
            action={
              status === "all" && !q ? (
                <Btn onClick={() => setCreating(true)}>
                  <Plus size={15} />
                  New signature request
                </Btn>
              ) : undefined
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Client</th>
                  <th>Signers</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.id}>
                    <td className="font-semibold text-[#375361]">
                      {item.title}
                      <small className="block font-normal text-[#7d8b91]">
                        {item.pageCount}{" "}
                        {item.pageCount === 1 ? "page" : "pages"}
                      </small>
                    </td>
                    <td>{item.participantName || "—"}</td>
                    <td>
                      {item.signerCount
                        ? `${item.signedCount} of ${item.signerCount} signed`
                        : "Not set up"}
                      {item.signerNames.length > 0 && (
                        <small className="block max-w-[220px] truncate text-[#7d8b91]">
                          {item.signerNames.join(", ")}
                        </small>
                      )}
                    </td>
                    <td>
                      <SignatureStatusBadge status={item.status} />
                    </td>
                    <td>{timeAgo(item.updatedAt)}</td>
                    <td>
                      <button
                        className="btn btn-quiet !h-8 !px-2 text-[11px]"
                        onClick={() => navigate(`/app/signatures/${item.id}`)}
                      >
                        {item.status === "draft" ? "Continue" : "Open"}
                        <ChevronRight size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {creating && <NewRequestDrawer onClose={() => setCreating(false)} />}
    </>
  );
}
