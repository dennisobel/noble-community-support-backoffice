import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import ImageExtension from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import StarterKit from "@tiptap/starter-kit";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Bold,
  Heading1,
  Heading2,
  Image as ImageIcon,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  NotebookPen,
  Pin,
  PinOff,
  Plus,
  Quote,
  Redo2,
  Search,
  Strikethrough,
  Trash2,
  Underline as UnderlineIcon,
  Undo2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useParams } from "wouter";
import type { NoteDTO, NoteSummaryDTO } from "@shared/dto";
import { ApiError, errorMessage } from "@/api/client";
import {
  useCreateNote,
  useDeleteNote,
  useNote,
  useNoteLabels,
  useNotes,
  useUpdateNote,
  type NotePatch,
} from "@/api/hooks";
import {
  Btn,
  ConfirmModal,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  useDebounced,
} from "@/components/app/ui";
import { timeAgo } from "@/lib/format";
import { useNotify } from "@/lib/notify";
import { shrinkImage, uploadNoteImage } from "./imageTools";
import "./notes.css";

/*
 * A personal notebook. Phone first: the list is one column with a big "new note" button, and
 * a note opens as a full-screen sheet whose formatting bar rides above the on-screen keyboard.
 * On a wider screen the list and the open note sit side by side. Notes save themselves.
 */

const STATUS_TEXT = {
  saved: "Saved",
  saving: "Saving…",
  offline: "Offline. Will retry",
  conflict: "Changed on another device",
  error: "Couldn't save",
} as const;
type Status = keyof typeof STATUS_TEXT;

const titleOf = (note: NoteSummaryDTO) =>
  note.title.trim() || note.snippet.slice(0, 60) || "Untitled";

/** On a phone the keyboard covers the bottom of the page, so follow the visible area and keep the toolbar above it. */
function useViewportBox() {
  const [box, setBox] = useState<{ top: number; height: number } | null>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    const phone = window.matchMedia("(max-width: 620px)");
    if (!viewport) return;
    const update = () =>
      setBox(
        phone.matches
          ? {
              top: Math.round(viewport.offsetTop),
              height: Math.round(viewport.height),
            }
          : null
      );
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    phone.addEventListener("change", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      phone.removeEventListener("change", update);
    };
  }, []);
  return box;
}

/* ───────────── The list ───────────── */

function NoteList({ base, activeId }: { base: string; activeId?: string }) {
  const [, navigate] = useLocation();
  const notify = useNotify();
  const [text, setText] = useState("");
  const [label, setLabel] = useState("");
  const [archived, setArchived] = useState(false);
  const query = useDebounced(text.trim(), 250);
  const notes = useNotes({
    q: query || undefined,
    label: label || undefined,
    archived,
  });
  const labels = useNoteLabels();
  const create = useCreateNote();

  const add = async () => {
    try {
      const note = await create.mutateAsync();
      navigate(`${base}/${note.id}`);
    } catch (failure) {
      notify(errorMessage(failure), "error");
    }
  };
  const showAll = () => {
    setLabel("");
    setArchived(false);
  };

  return (
    <section className="notes-list" aria-label="Your notes">
      <div className="notes-list-head">
        <div className="notes-search">
          <Search size={15} />
          <input
            type="search"
            placeholder="Search notes"
            aria-label="Search notes"
            value={text}
            onChange={event => setText(event.target.value)}
          />
        </div>
        <Btn
          className="notes-new"
          onClick={() => void add()}
          loading={create.isPending}
        >
          <Plus size={15} />
          New note
        </Btn>
      </div>
      <div className="notes-chips" role="toolbar" aria-label="Filter notes">
        <button
          type="button"
          className={`chip${!label && !archived ? " on" : ""}`}
          onClick={showAll}
        >
          All
        </button>
        {labels.data?.map(entry => (
          <button
            key={entry.label}
            type="button"
            className={`chip${label === entry.label && !archived ? " on" : ""}`}
            onClick={() => {
              setLabel(entry.label);
              setArchived(false);
            }}
          >
            #{entry.label} <small>{entry.count}</small>
          </button>
        ))}
        <button
          type="button"
          className={`chip${archived ? " on" : ""}`}
          onClick={() => {
            setArchived(true);
            setLabel("");
          }}
        >
          <Archive size={12} />
          Archived
        </button>
      </div>
      <div className="notes-cards">
        {notes.isPending && <LoadingBlock />}
        {notes.isError && (
          <ErrorBlock error={notes.error} onRetry={() => notes.refetch()} />
        )}
        {notes.data?.map(note => (
          <Link
            key={note.id}
            href={`${base}/${note.id}`}
            className={`note-card${note.id === activeId ? " active" : ""}`}
          >
            <div className="note-card-top">
              <b className="note-card-title">{titleOf(note)}</b>
              {note.pinned && <Pin size={13} aria-label="Pinned" />}
            </div>
            {note.title.trim() && note.snippet && (
              <p className="note-card-snippet">{note.snippet}</p>
            )}
            <div className="note-card-meta">
              {note.labels.slice(0, 3).map(tag => (
                <span key={tag} className="note-tag">
                  #{tag}
                </span>
              ))}
              {note.imageCount > 0 && (
                <span className="note-meta-item">
                  <ImageIcon size={12} />
                  {note.imageCount}
                </span>
              )}
              <span className="note-meta-time">{timeAgo(note.updatedAt)}</span>
            </div>
          </Link>
        ))}
        {notes.data && !notes.data.length && (
          <EmptyState
            title={
              query || label
                ? "Nothing matches"
                : archived
                  ? "Nothing archived"
                  : "No notes yet"
            }
            text={
              query || label
                ? "Try a different word or label."
                : archived
                  ? "Archived notes wait here until you restore them."
                  : "Tap the + button to write your first note."
            }
            icon={<NotebookPen size={19} />}
          />
        )}
      </div>
      <button
        type="button"
        className="notes-fab"
        aria-label="New note"
        onClick={() => void add()}
      >
        <Plus size={24} />
      </button>
    </section>
  );
}

/* ───────────── The editor ───────────── */

function Tool({
  label,
  on = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  on?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`tool${on ? " on" : ""}`}
      aria-label={label}
      title={label}
      aria-pressed={on}
      disabled={disabled}
      // Keep the cursor (and on a phone, the keyboard) where it is while a button is used.
      onMouseDown={event => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function NoteEditor({ note, base }: { note: NoteDTO; base: string }) {
  const notify = useNotify();
  const [, navigate] = useLocation();
  const update = useUpdateNote();
  const remove = useDeleteNote();
  const known = useNoteLabels();
  const box = useViewportBox();

  const [title, setTitle] = useState(note.title);
  const [labels, setLabels] = useState(note.labels);
  const [labelDraft, setLabelDraft] = useState("");
  const [pinned, setPinned] = useState(note.pinned);
  const [archived, setArchived] = useState(note.archived);
  const [status, setStatus] = useState<Status>("saved");
  const [problem, setProblem] = useState("");
  const [uploads, setUploads] = useState(0);
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Autosave: changes wait here, go out together after a short pause, and one save runs at a time.
  const rev = useRef(note.rev);
  const pending = useRef<Partial<Omit<NotePatch, "id" | "rev">>>({});
  const inFlight = useRef(false);
  const stopped = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const flush = useRef<() => Promise<void>>(async () => {});
  flush.current = async () => {
    window.clearTimeout(timer.current);
    if (inFlight.current || stopped.current) return;
    if (!Object.keys(pending.current).length) return;
    inFlight.current = true;
    const patch = pending.current;
    pending.current = {};
    try {
      const saved = await update.mutateAsync({
        id: note.id,
        rev: rev.current,
        ...patch,
      });
      rev.current = saved.rev;
      inFlight.current = false;
      if (Object.keys(pending.current).length) void flush.current();
      else setStatus("saved");
    } catch (failure) {
      inFlight.current = false;
      pending.current = { ...patch, ...pending.current };
      if (failure instanceof ApiError && failure.status === 409) {
        // Another device saved this note since we opened it: stop, rather than overwrite it.
        stopped.current = true;
        setStatus("conflict");
      } else if (failure instanceof ApiError && failure.status > 0 && failure.status < 500) {
        setProblem(errorMessage(failure));
        setStatus("error");
      } else {
        setStatus("offline");
        timer.current = window.setTimeout(() => void flush.current(), 5000);
      }
    }
  };
  const save = (patch: Partial<Omit<NotePatch, "id" | "rev">>) => {
    Object.assign(pending.current, patch);
    setStatus("saving");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush.current(), 700);
  };
  const saveNow = (patch: Partial<Omit<NotePatch, "id" | "rev">>) => {
    Object.assign(pending.current, patch);
    setStatus("saving");
    void flush.current();
  };

  const addImages = useRef<(files: File[]) => void>(() => {});
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: {
          openOnClick: false,
          autolink: true,
          HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
        },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      ImageExtension.configure({ allowBase64: false }),
      Placeholder.configure({
        placeholder:
          "Start typing…  Try “- ” for a list, “[ ] ” for a checklist, “# ” for a heading.",
      }),
    ],
    content: note.content,
    editorProps: {
      attributes: { class: "note-prose", "aria-label": "Note text" },
      // Pictures come in through the upload button, paste or drop (so they are stored here), never as remote links.
      transformPastedHTML: html => html.replace(/<img[^>]*>/gi, ""),
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter(file =>
          file.type.startsWith("image/")
        );
        if (!files.length) return false;
        addImages.current(files);
        return true;
      },
      handleDrop: (_view, event) => {
        const files = Array.from(event.dataTransfer?.files ?? []).filter(file =>
          file.type.startsWith("image/")
        );
        if (!files.length) return false;
        event.preventDefault();
        addImages.current(files);
        return true;
      },
    },
    onUpdate: ({ editor: current }) => save({ content: current.getJSON() }),
  });
  addImages.current = async files => {
    for (const file of files) {
      setUploads(count => count + 1);
      try {
        const image = await uploadNoteImage(note.id, await shrinkImage(file));
        editor?.chain().focus().setImage({ src: image.url, alt: "" }).run();
      } catch (failure) {
        notify(errorMessage(failure), "error");
      } finally {
        setUploads(count => count - 1);
      }
    }
  };

  const active = useEditorState({
    editor,
    selector: ({ editor: current }) =>
      current
        ? {
            bold: current.isActive("bold"),
            italic: current.isActive("italic"),
            underline: current.isActive("underline"),
            strike: current.isActive("strike"),
            h1: current.isActive("heading", { level: 1 }),
            h2: current.isActive("heading", { level: 2 }),
            bullets: current.isActive("bulletList"),
            numbers: current.isActive("orderedList"),
            tasks: current.isActive("taskList"),
            quote: current.isActive("blockquote"),
            link: current.isActive("link"),
            canUndo: current.can().undo(),
            canRedo: current.can().redo(),
          }
        : null,
  });

  // Save on the way out, and hold the page still behind the full-screen sheet on a phone.
  useEffect(() => {
    const leave = () => void flush.current();
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      void flush.current();
    };
  }, []);
  useEffect(() => {
    if (!window.matchMedia("(max-width: 620px)").matches) return;
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = before;
    };
  }, []);

  const back = async () => {
    await flush.current();
    if (
      Object.keys(pending.current).length &&
      !window.confirm("This note hasn't saved yet. Leave anyway?")
    )
      return;
    navigate(base);
  };
  const addLabel = (raw: string) => {
    const label = raw.trim().replace(/^#+/, "").trim().toLowerCase().slice(0, 30);
    setLabelDraft("");
    if (!label || labels.includes(label) || labels.length >= 8) return;
    const next = [...labels, label];
    setLabels(next);
    saveNow({ labels: next });
  };
  const dropLabel = (label: string) => {
    const next = labels.filter(entry => entry !== label);
    setLabels(next);
    saveNow({ labels: next });
  };
  const togglePin = () => {
    setPinned(!pinned);
    saveNow({ pinned: !pinned });
  };
  const toggleArchive = () => {
    setArchived(!archived);
    saveNow({ archived: !archived });
    if (!archived) navigate(base);
  };
  const deleteNote = async () => {
    try {
      stopped.current = true;
      await remove.mutateAsync(note.id);
      navigate(base);
    } catch (failure) {
      stopped.current = false;
      setConfirming(false);
      notify(errorMessage(failure), "error");
    }
  };
  const applyLink = () => {
    const href = (linkDraft ?? "").trim();
    if (!href) editor?.chain().focus().extendMarkRange("link").unsetLink().run();
    else {
      const safe = /^(https?:\/\/|mailto:|tel:)/i.test(href) ? href : `https://${href}`;
      editor?.chain().focus().extendMarkRange("link").setLink({ href: safe }).run();
    }
    setLinkDraft(null);
  };

  const chain = () => editor?.chain().focus();
  return (
    <section
      className="notes-sheet"
      style={box ? { top: box.top, height: box.height } : undefined}
      aria-label="Note editor"
    >
      <header className="note-bar">
        <button
          type="button"
          className="icon-btn note-back"
          onClick={() => void back()}
          aria-label="Back to notes"
        >
          <ArrowLeft size={18} />
        </button>
        <span className={`note-status note-status--${status}`} role="status">
          {status === "error" && problem ? problem : STATUS_TEXT[status]}
        </span>
        <div className="note-actions">
          <button
            type="button"
            className="icon-btn"
            onClick={togglePin}
            aria-label={pinned ? "Unpin note" : "Pin note"}
            aria-pressed={pinned}
          >
            {pinned ? <PinOff size={17} /> : <Pin size={17} />}
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={toggleArchive}
            aria-label={archived ? "Restore note" : "Archive note"}
          >
            {archived ? <ArchiveRestore size={17} /> : <Archive size={17} />}
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setConfirming(true)}
            aria-label="Delete note"
          >
            <Trash2 size={17} />
          </button>
        </div>
      </header>
      {status === "conflict" && (
        <div className="note-banner" role="alert">
          This note was changed on another device, so this copy stopped saving.{" "}
          <button type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      )}

      <div className="note-scroll">
        <input
          className="note-title"
          placeholder="Title"
          aria-label="Title"
          maxLength={200}
          autoFocus={!note.title && !note.snippet}
          value={title}
          onChange={event => {
            setTitle(event.target.value);
            save({ title: event.target.value });
          }}
          onKeyDown={event => {
            if (event.key === "Enter") {
              event.preventDefault();
              editor?.commands.focus("start");
            }
          }}
        />
        <div className="note-labels">
          {labels.map(label => (
            <span key={label} className="note-label-chip">
              #{label}
              <button
                type="button"
                aria-label={`Remove label ${label}`}
                onClick={() => dropLabel(label)}
              >
                <X size={12} />
              </button>
            </span>
          ))}
          <input
            className="note-label-input"
            list="note-label-options"
            placeholder={labels.length ? "Add label" : "Add a label, e.g. visits"}
            aria-label="Add a label"
            enterKeyHint="done"
            value={labelDraft}
            onChange={event => setLabelDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Enter" || event.key === ",") {
                event.preventDefault();
                addLabel(labelDraft);
              }
            }}
            onBlur={() => labelDraft.trim() && addLabel(labelDraft)}
          />
          <datalist id="note-label-options">
            {known.data
              ?.filter(entry => !labels.includes(entry.label))
              .map(entry => (
                <option key={entry.label} value={entry.label} />
              ))}
          </datalist>
        </div>
        <div className="note-body">
          <EditorContent editor={editor} />
        </div>
        {uploads > 0 && (
          <p className="note-uploading" role="status">
            Adding {uploads} picture{uploads > 1 ? "s" : ""}…
          </p>
        )}
      </div>

      <div className="note-toolbar" role="toolbar" aria-label="Formatting">
        {linkDraft !== null ? (
          <form
            className="note-linkbar"
            onSubmit={event => {
              event.preventDefault();
              applyLink();
            }}
          >
            <Link2 size={16} />
            <input
              className="input"
              inputMode="url"
              autoFocus
              placeholder="Paste or type a link (leave empty to remove)"
              aria-label="Link address"
              value={linkDraft}
              onChange={event => setLinkDraft(event.target.value)}
            />
            <button type="submit" className="btn btn-primary">
              Apply
            </button>
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => setLinkDraft(null)}
            >
              Cancel
            </button>
          </form>
        ) : (
          <>
            <Tool label="Bold" on={active?.bold} onClick={() => chain()?.toggleBold().run()}>
              <Bold size={18} />
            </Tool>
            <Tool label="Italic" on={active?.italic} onClick={() => chain()?.toggleItalic().run()}>
              <Italic size={18} />
            </Tool>
            <Tool label="Underline" on={active?.underline} onClick={() => chain()?.toggleUnderline().run()}>
              <UnderlineIcon size={18} />
            </Tool>
            <Tool label="Strikethrough" on={active?.strike} onClick={() => chain()?.toggleStrike().run()}>
              <Strikethrough size={18} />
            </Tool>
            <span className="tool-sep" />
            <Tool label="Big heading" on={active?.h1} onClick={() => chain()?.toggleHeading({ level: 1 }).run()}>
              <Heading1 size={18} />
            </Tool>
            <Tool label="Heading" on={active?.h2} onClick={() => chain()?.toggleHeading({ level: 2 }).run()}>
              <Heading2 size={18} />
            </Tool>
            <span className="tool-sep" />
            <Tool label="Bullet list" on={active?.bullets} onClick={() => chain()?.toggleBulletList().run()}>
              <List size={18} />
            </Tool>
            <Tool label="Numbered list" on={active?.numbers} onClick={() => chain()?.toggleOrderedList().run()}>
              <ListOrdered size={18} />
            </Tool>
            <Tool label="Checklist" on={active?.tasks} onClick={() => chain()?.toggleTaskList().run()}>
              <ListChecks size={18} />
            </Tool>
            <Tool label="Quote" on={active?.quote} onClick={() => chain()?.toggleBlockquote().run()}>
              <Quote size={18} />
            </Tool>
            <span className="tool-sep" />
            <Tool
              label="Link"
              on={active?.link}
              onClick={() => setLinkDraft(editor?.getAttributes("link").href ?? "")}
            >
              <Link2 size={18} />
            </Tool>
            <Tool label="Add a picture" onClick={() => fileInput.current?.click()}>
              <ImagePlus size={18} />
            </Tool>
            <span className="tool-sep" />
            <Tool label="Undo" disabled={!active?.canUndo} onClick={() => chain()?.undo().run()}>
              <Undo2 size={18} />
            </Tool>
            <Tool label="Redo" disabled={!active?.canRedo} onClick={() => chain()?.redo().run()}>
              <Redo2 size={18} />
            </Tool>
          </>
        )}
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={event => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (files.length) addImages.current(files);
        }}
      />
      {confirming && (
        <ConfirmModal
          title="Delete this note?"
          body="The note and its pictures are removed for good. Archive it instead if you might want it back."
          confirmLabel="Delete"
          danger
          busy={remove.isPending}
          onConfirm={() => void deleteNote()}
          onClose={() => setConfirming(false)}
        />
      )}
    </section>
  );
}

function NoteEditorPane({ id, base }: { id: string; base: string }) {
  const note = useNote(id);
  const [, navigate] = useLocation();
  if (note.isPending)
    return (
      <div className="notes-sheet">
        <LoadingBlock />
      </div>
    );
  if (note.isError)
    return (
      <div className="notes-sheet p-4">
        <ErrorBlock error={note.error} onRetry={() => note.refetch()} />
        <Btn variant="secondary" onClick={() => navigate(base)}>
          Back to notes
        </Btn>
      </div>
    );
  // Keyed by id so opening another note starts a fresh editor.
  return <NoteEditor key={note.data.id} note={note.data} base={base} />;
}

/** `base` is where the notebook lives ("/app/notes" in the back office), so the same screens work anywhere. */
export default function NotesWorkspace({ base }: { base: string }) {
  const { id } = useParams<{ id?: string }>();
  return (
    <div className={`notes${id ? " is-editing" : ""}`}>
      <NoteList base={base} activeId={id} />
      <div className="notes-pane">
        {id ? (
          <NoteEditorPane key={id} id={id} base={base} />
        ) : (
          <div className="notes-placeholder">
            <NotebookPen size={28} />
            <p>Pick a note, or start a new one.</p>
          </div>
        )}
      </div>
    </div>
  );
}
