import {
  ArrowLeft,
  ChevronRight,
  CircleDollarSign,
  Download,
  ExternalLink,
  FileText,
  FolderClosed,
  FolderOpen,
  HardDrive,
  Info,
  Pencil,
  Search,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DOCUMENT_UPLOAD } from "@shared/const";
import type { ParticipantDTO, TreeNode } from "@shared/dto";
import { downloadFile, errorMessage, openFile } from "@/api/client";
import {
  useDeleteDocument,
  useOrganisationTree,
  useParticipantTree,
  useReplaceDocumentFile,
  useUpdateDocument,
  useUploadDocuments,
} from "@/api/hooks";
import {
  Btn,
  ConfirmModal,
  ErrorBlock,
  FormAlert,
  LoadingBlock,
  Modal,
} from "@/components/app/ui";
import { fileSize } from "@/lib/format";
import { useNotify } from "@/lib/notify";

const INLINE_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
];

function flattenFolders(
  node: TreeNode,
  trail: string[] = []
): Array<{ folderKey: string; title: string }> {
  const here =
    node.kind === "folder" && node.uploadable && node.folderKey
      ? [
          {
            folderKey: node.folderKey,
            title: [...trail, node.title].slice(-2).join(" › "),
          },
        ]
      : [];
  return [
    ...here,
    ...(node.children ?? []).flatMap(child =>
      flattenFolders(
        child,
        node.kind === "folder" ? [...trail, node.title] : trail
      )
    ),
  ];
}

function UploadDialog({
  scope,
  participantId,
  folders,
  initialFolder,
  slot,
  onClose,
}: {
  scope: "participant" | "organisation";
  participantId?: string;
  folders: Array<{ folderKey: string; title: string }>;
  initialFolder?: string;
  slot?: TreeNode;
  onClose: () => void;
}) {
  const notify = useNotify();
  const upload = useUploadDocuments();
  const replace = useReplaceDocumentFile();
  const [folderKey, setFolderKey] = useState(
    initialFolder ?? folders[0]?.folderKey ?? ""
  );
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [docDate, setDocDate] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const busy = upload.isPending || replace.isPending;

  const submit = async () => {
    setError("");
    if (!files.length) return setError("Choose a file to upload.");
    try {
      if (slot?.documentId) {
        const form = new FormData();
        form.append("file", files[0]);
        await replace.mutateAsync({
          id: slot.documentId,
          form,
          onProgress: setProgress,
        });
        notify(`${slot.title} updated.`);
      } else {
        if (!folderKey) return setError("Choose a folder.");
        const form = new FormData();
        form.append("scope", scope);
        if (participantId) form.append("participantId", participantId);
        form.append("folderKey", folderKey);
        if (title.trim() && files.length === 1)
          form.append("title", title.trim());
        if (notes.trim()) form.append("notes", notes.trim());
        if (docDate) form.append("docDate", docDate);
        files.forEach(file => form.append("files", file));
        const created = await upload.mutateAsync({
          form,
          onProgress: setProgress,
        });
        notify(
          created.length === 1
            ? `${created[0].title} uploaded.`
            : `${created.length} documents uploaded.`
        );
      }
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
      setProgress(0);
    }
  };

  return (
    <Modal
      onClose={onClose}
      busy={busy}
      title={slot ? `Upload ${slot.title}` : "Upload documents"}
      subtitle={`PDF, Word, Excel, CSV, text or images · up to ${DOCUMENT_UPLOAD.maxFiles} files`}
    >
      <div className="space-y-4">
        {!slot && (
          <label className="label">
            Folder
            <select
              className="select mt-1"
              value={folderKey}
              onChange={event => setFolderKey(event.target.value)}
            >
              {folders.map(folder => (
                <option key={folder.folderKey} value={folder.folderKey}>
                  {folder.title}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="label">
          File{slot ? "" : "s"}
          <input
            className="input mt-1"
            type="file"
            multiple={!slot}
            accept={DOCUMENT_UPLOAD.accept}
            onChange={event =>
              setFiles(
                Array.from(event.target.files ?? []).slice(
                  0,
                  DOCUMENT_UPLOAD.maxFiles
                )
              )
            }
          />
        </label>
        {files.length > 0 && (
          <ul className="space-y-1 text-[11px] text-[#5c6e76]">
            {files.map(file => (
              <li key={`${file.name}-${file.size}`}>
                {file.name} · {fileSize(file.size)}
              </li>
            ))}
          </ul>
        )}
        {!slot && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="label">
              Title{" "}
              {files.length > 1 && (
                <span className="font-normal text-[#88959a]">
                  (file names are used for multiple files)
                </span>
              )}
              <input
                className="input mt-1"
                value={title}
                disabled={files.length > 1}
                onChange={event => setTitle(event.target.value)}
                placeholder="e.g. Signed service agreement"
              />
            </label>
            <label className="label">
              Document date
              <input
                className="input mt-1"
                type="date"
                value={docDate}
                onChange={event => setDocDate(event.target.value)}
              />
            </label>
            <label className="label sm:col-span-2">
              Notes
              <textarea
                className="textarea mt-1 !min-h-[60px]"
                value={notes}
                onChange={event => setNotes(event.target.value)}
              />
            </label>
          </div>
        )}
        {busy && (
          <div className="h-1.5 overflow-hidden rounded-full bg-[#eaf0ee]">
            <div
              className="h-full rounded-full bg-[#49a295] transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
        <FormAlert message={error} />
        <div className="flex justify-end gap-2">
          <Btn variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Btn>
          <Btn onClick={submit} loading={busy}>
            <Upload size={14} />
            Upload
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

function FileDialog({
  node,
  folders,
  onClose,
  onReplace,
}: {
  node: TreeNode;
  folders: Array<{ folderKey: string; title: string }>;
  onClose: () => void;
  onReplace: () => void;
}) {
  const notify = useNotify();
  const update = useUpdateDocument();
  const remove = useDeleteDocument();
  const [title, setTitle] = useState(node.title);
  const [folderKey, setFolderKey] = useState(node.folderKey ?? "");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const isSlot = node.kind === "template";
  const id = node.documentId!;
  const file = node.file;

  const act = async (action: () => Promise<void>) => {
    setError("");
    try {
      await action();
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };
  if (confirming) {
    return (
      <ConfirmModal
        title={isSlot ? "Remove the template file?" : "Delete this document?"}
        body={
          isSlot
            ? "The template slot stays in place without a file."
            : "The document is removed from the folder. Deleted files are purged after 30 days."
        }
        confirmLabel={isSlot ? "Remove file" : "Delete document"}
        danger
        busy={remove.isPending}
        onClose={() => setConfirming(false)}
        onConfirm={() =>
          void act(async () => {
            await remove.mutateAsync(id);
            notify(isSlot ? "Template file removed." : "Document deleted.");
            onClose();
          })
        }
      />
    );
  }
  return (
    <Modal
      onClose={onClose}
      title={node.title}
      subtitle={
        file
          ? `${file.originalName} · ${fileSize(file.size)}`
          : "No file attached"
      }
    >
      <div className="space-y-4">
        {file && (
          <div className="flex flex-wrap gap-2">
            {INLINE_TYPES.includes(file.mimeType) && (
              <Btn
                variant="secondary"
                onClick={() =>
                  void act(() =>
                    openFile(`/documents/${id}/download`, { inline: 1 })
                  )
                }
              >
                <ExternalLink size={14} />
                Open
              </Btn>
            )}
            <Btn
              variant="secondary"
              onClick={() =>
                void act(() =>
                  downloadFile(`/documents/${id}/download`, file.originalName)
                )
              }
            >
              <Download size={14} />
              Download
            </Btn>
            {isSlot && (
              <Btn variant="secondary" onClick={onReplace}>
                <Upload size={14} />
                Replace file
              </Btn>
            )}
          </div>
        )}
        {!isSlot && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="label">
              Title
              <input
                className="input mt-1"
                value={title}
                onChange={event => setTitle(event.target.value)}
              />
            </label>
            <label className="label">
              Folder
              <select
                className="select mt-1"
                value={folderKey}
                onChange={event => setFolderKey(event.target.value)}
              >
                {folders.map(folder => (
                  <option key={folder.folderKey} value={folder.folderKey}>
                    {folder.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        <FormAlert message={error} />
        <div className="flex flex-wrap justify-between gap-2">
          <Btn variant="danger" onClick={() => setConfirming(true)}>
            <Trash2 size={14} />
            {isSlot ? "Remove file" : "Delete"}
          </Btn>
          {!isSlot && (
            <Btn
              loading={update.isPending}
              disabled={
                !title.trim() ||
                (title === node.title && folderKey === node.folderKey)
              }
              onClick={() =>
                void act(async () => {
                  await update.mutateAsync({
                    id,
                    title: title.trim(),
                    folderKey,
                  });
                  notify("Document updated.");
                  onClose();
                })
              }
            >
              <Pencil size={14} />
              Save changes
            </Btn>
          )}
        </div>
      </div>
    </Modal>
  );
}

export default function DocumentLibrary({
  participant,
}: {
  participant?: ParticipantDTO;
}) {
  const [, navigate] = useLocation();
  const notify = useNotify();
  const participantTree = useParticipantTree(participant?.id);
  const organisationTree = useOrganisationTree(!participant);
  const tree = participant ? participantTree : organisationTree;
  const [path, setPath] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState<{ slot?: TreeNode } | null>(null);
  const [selected, setSelected] = useState<TreeNode | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const root = tree.data;
  const trail = useMemo(() => {
    if (!root) return [];
    const nodes: TreeNode[] = [root];
    for (const id of path) {
      const next = nodes[nodes.length - 1].children?.find(
        child => child.id === id
      );
      if (!next) break;
      nodes.push(next);
    }
    return nodes;
  }, [root, path]);
  const folders = useMemo(() => (root ? flattenFolders(root) : []), [root]);

  if (tree.isPending) return <LoadingBlock label="Loading documents…" />;
  if (tree.isError || !root)
    return <ErrorBlock error={tree.error} onRetry={() => tree.refetch()} />;

  const current = trail[trail.length - 1];
  const items = (current.children ?? []).filter(item =>
    `${item.title} ${item.description ?? ""}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );
  const open = (item: TreeNode) => {
    if (item.kind === "folder") {
      setPath(
        trail
          .slice(1)
          .map(node => node.id)
          .concat(item.id)
      );
      setSearch("");
      return;
    }
    if (item.kind === "external")
      return notify(
        "Accounting records live in Xero. Connect or manage it under Settings → Accounting (Xero); other finance files go in the Finance documents folder.",
        "info"
      );
    if (item.kind === "record" && item.recordId)
      return navigate(`/app/records/${item.recordId}`);
    if (item.kind === "reference" && item.clientId)
      return navigate(
        `/app/clients/${item.clientId}/${item.id.endsWith("goals-link") ? "support" : "overview"}`
      );
    if (item.kind === "template" && !item.file)
      return setUploading({ slot: item });
    setSelected(item);
  };
  const uploadFolder = current.uploadable ? current.folderKey : undefined;

  return (
    <div className="space-y-4">
      {!participant ? (
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="page-title serif">Organisation files</h1>
            <p className="page-subtitle">
              Organisation-wide business records, finance and templates. Client
              documents live inside each client profile.
            </p>
          </div>
          <Btn variant="secondary" onClick={() => setUploading({})}>
            <Upload size={14} />
            Upload document
          </Btn>
        </div>
      ) : (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="panel-title">Participant documents</h3>
            <p className="mt-1 text-[11px] text-[#819097]">
              {current.title} · folders are linked to this participant.
            </p>
          </div>
          <Btn
            variant="secondary"
            className="!h-8 !px-3 text-[11px]"
            onClick={() => setUploading({})}
          >
            <Upload size={13} />
            Add document
          </Btn>
        </div>
      )}

      <div className="panel p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <nav
            className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-[11px]"
            aria-label="Document folder breadcrumb"
          >
            {trail.map((node, index) => (
              <span key={node.id} className="inline-flex items-center gap-1">
                <button
                  className={`rounded px-1.5 py-1 ${index === trail.length - 1 ? "font-semibold text-[#254d52]" : "text-[#74848b] hover:bg-[#f2f6f4] hover:text-[#277c76]"}`}
                  onClick={() => {
                    setPath(trail.slice(1, index + 1).map(item => item.id));
                    setSearch("");
                  }}
                >
                  {node.title}
                </button>
                {index < trail.length - 1 && (
                  <ChevronRight size={12} className="text-[#9aa6a8]" />
                )}
              </span>
            ))}
          </nav>
          <div className="relative min-w-[190px] flex-1 sm:max-w-[280px]">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[#89969b]"
            />
            <input
              ref={searchRef}
              className="input h-9 pl-9 text-xs"
              placeholder="Search this folder"
              value={search}
              onChange={event => setSearch(event.target.value)}
              aria-label="Search this folder"
            />
          </div>
        </div>
        {trail.length > 1 && (
          <button
            className="mt-2 inline-flex items-center gap-1 text-[10px] font-semibold text-[#277c76]"
            onClick={() => setPath(path.slice(0, trail.length - 2))}
          >
            <ArrowLeft size={12} />
            Up one folder
          </button>
        )}
      </div>

      <div className="rounded-md border border-[#d9e9e5] bg-[#f1f8f6] p-3 text-[10px] leading-4 text-[#496663]">
        <Info size={13} className="mr-1.5 inline" />
        {participant
          ? "Progress notes and travel entries are linked service records, not duplicate files. Uploaded files are stored securely and only available to signed-in staff."
          : "Organisation files only. Client folders are managed from each client profile. Accounting is managed under Settings → Accounting (Xero)."}
      </div>

      {items.length ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map(item => {
            const isFolder = item.kind === "folder";
            const Icon = isFolder
              ? trail.length > 1
                ? FolderClosed
                : item.id === "finance-root"
                  ? CircleDollarSign
                  : item.id.startsWith("client-")
                    ? Users
                    : FolderOpen
              : item.kind === "external"
                ? HardDrive
                : FileText;
            const tone =
              item.badgeTone === "ok"
                ? "badge-approved"
                : item.badgeTone === "external"
                  ? "badge-returned"
                  : "badge-draft";
            return (
              <button
                key={item.id}
                className="panel group flex min-h-[112px] items-start gap-3 p-4 text-left transition hover:-translate-y-0.5 hover:border-[#bfd9d3] hover:shadow-[0_8px_24px_rgba(25,70,67,.07)]"
                onClick={() => open(item)}
              >
                <span
                  className={`grid h-10 w-10 shrink-0 place-items-center rounded-md ${
                    item.kind === "external"
                      ? "bg-[#fff4de] text-[#a6782d]"
                      : isFolder
                        ? "bg-[#edf5f2] text-[#3c8177]"
                        : "bg-[#eef2f6] text-[#617993]"
                  }`}
                >
                  <Icon size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-[#344854] group-hover:text-[#147c76]">
                      {item.title}
                    </span>
                    {item.badge && (
                      <span className={`badge ${tone}`}>{item.badge}</span>
                    )}
                  </span>
                  <span className="mt-1 block text-[10px] leading-4 text-[#7c8a90]">
                    {item.description}
                  </span>
                  <span className="mt-2 flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide text-[#96a2a5]">
                    {isFolder
                      ? `${item.count ?? 0} ${item.count === 1 ? "item" : "items"}`
                      : item.kind === "record"
                        ? "Linked record"
                        : item.kind === "reference"
                          ? "Portal reference"
                          : item.kind === "external"
                            ? "External source"
                            : item.kind === "template"
                              ? item.file
                                ? "Template file"
                                : "Template slot"
                              : "Document"}
                    {isFolder && (
                      <ChevronRight
                        size={11}
                        className="ml-auto text-[#a5b0b1]"
                      />
                    )}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="panel px-5 py-10 text-center">
          <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-[#f1f5f3] text-[#82938f]">
            <FolderOpen size={18} />
          </div>
          <b className="text-xs text-[#40545e]">
            {search ? "No matching folders or records" : "This folder is empty"}
          </b>
          <p className="mt-1 text-[10px] text-[#87949a]">
            {search
              ? "Try another search term."
              : uploadFolder
                ? "Upload a document to add it to this folder."
                : "Items appear here as service records and documents are added."}
          </p>
          {!search && uploadFolder && (
            <div className="mt-4">
              <Btn variant="secondary" onClick={() => setUploading({})}>
                <Upload size={14} />
                Upload to this folder
              </Btn>
            </div>
          )}
        </div>
      )}

      {uploading && (
        <UploadDialog
          scope={participant ? "participant" : "organisation"}
          participantId={participant?.id}
          folders={folders}
          initialFolder={uploadFolder}
          slot={uploading.slot}
          onClose={() => setUploading(null)}
        />
      )}
      {selected && (
        <FileDialog
          node={selected}
          folders={folders}
          onClose={() => setSelected(null)}
          onReplace={() => {
            setUploading({ slot: selected });
            setSelected(null);
          }}
        />
      )}
    </div>
  );
}
