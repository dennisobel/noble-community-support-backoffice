import { API_PREFIX } from "@shared/const";
import { NOTE_LIMITS } from "@shared/schemas/notes";
import { errors } from "../../lib/errors";

/*
 * The editor sends its own JSON, which is never trusted: the server rebuilds the document
 * from known pieces only. Unknown nodes are refused, attributes are whitelisted, links must
 * be http(s)/mailto/tel, and pictures must be this app's own uploads. What is stored is
 * therefore safe to render and free of arbitrary keys.
 */

type Json = Record<string, unknown>;

const IMAGE_SRC = new RegExp(`^${API_PREFIX}/notes/images/([a-f0-9]{24})$`);
const LINK_HREF = /^(https?:\/\/|mailto:|tel:)/i;

const BLOCKS = new Set([
  "paragraph",
  "heading",
  "listItem",
  "taskItem",
  "blockquote",
  "codeBlock",
  "horizontalRule",
]);
const NODES = new Set([
  "doc",
  "text",
  "hardBreak",
  "bulletList",
  "orderedList",
  "taskList",
  "image",
  ...BLOCKS,
]);
const MARKS = new Set(["bold", "italic", "underline", "strike", "code", "link"]);
const MAX_NODES = 20_000;
const MAX_DEPTH = 24;
const MAX_TEXT = 20_000;

export interface CleanNote {
  doc: Json;
  /** The words of the note, for search and previews. */
  text: string;
  /** Ids of the uploaded pictures the note refers to. */
  imageIds: string[];
}

export const emptyDoc = (): Json => ({
  type: "doc",
  content: [{ type: "paragraph" }],
});

const unsupported = () =>
  errors.validation(
    "This note can't be saved: it uses formatting Noble doesn't support."
  );
const unreadable = () =>
  errors.validation("This note can't be saved: part of it is unreadable.");

interface State {
  nodes: number;
  text: string[];
  images: Set<string>;
}

const short = (value: unknown, max: number): string | undefined =>
  typeof value === "string" && value ? value.slice(0, max) : undefined;

function cleanMarks(raw: unknown): Json[] {
  if (!Array.isArray(raw)) return [];
  const marks: Json[] = [];
  for (const mark of raw) {
    const type = (mark as Json | null)?.type;
    if (typeof type !== "string" || !MARKS.has(type)) throw unsupported();
    if (type === "link") {
      const href = ((mark as Json).attrs as Json | undefined)?.href;
      // An unsafe address is dropped; the words stay.
      if (typeof href === "string" && href.length <= 2000 && LINK_HREF.test(href))
        marks.push({ type, attrs: { href } });
    } else marks.push({ type });
  }
  return marks;
}

function cleanAttrs(type: string, raw: unknown): Json | undefined {
  const attrs = (raw && typeof raw === "object" ? raw : {}) as Json;
  switch (type) {
    case "heading": {
      const level = Number(attrs.level);
      return { level: level >= 1 && level <= 3 ? Math.trunc(level) : 2 };
    }
    case "orderedList": {
      const start = Number(attrs.start);
      return Number.isInteger(start) && start > 1 && start < 10_000
        ? { start }
        : undefined;
    }
    case "taskItem":
      return { checked: attrs.checked === true };
    case "codeBlock": {
      const language = short(attrs.language, 30);
      return language ? { language } : undefined;
    }
    default:
      return undefined;
  }
}

function cleanNode(raw: unknown, depth: number, state: State): Json {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw unreadable();
  const node = raw as Json;
  const type = node.type;
  if (typeof type !== "string" || !NODES.has(type)) throw unsupported();
  if (depth > MAX_DEPTH)
    throw errors.validation("This note can't be saved: it is nested too deeply.");
  if (++state.nodes > MAX_NODES)
    throw errors.validation("This note can't be saved: it is too long.");

  const out: Json = { type };
  if (type === "text") {
    if (typeof node.text !== "string") throw unreadable();
    out.text = node.text.slice(0, 100_000);
    state.text.push(out.text as string);
    const marks = cleanMarks(node.marks);
    if (marks.length) out.marks = marks;
    return out;
  }
  if (type === "image") {
    const attrs = (node.attrs ?? {}) as Json;
    const match =
      typeof attrs.src === "string" ? IMAGE_SRC.exec(attrs.src) : null;
    if (!match)
      throw errors.validation(
        "This note can't be saved: a picture in it was not added from this app."
      );
    state.images.add(match[1]!);
    out.attrs = {
      src: attrs.src,
      ...(short(attrs.alt, 200) ? { alt: short(attrs.alt, 200) } : {}),
      ...(short(attrs.title, 200) ? { title: short(attrs.title, 200) } : {}),
    };
    return out;
  }

  const attrs = cleanAttrs(type, node.attrs);
  if (attrs) out.attrs = attrs;
  if (type === "hardBreak") state.text.push("\n");
  if (Array.isArray(node.content)) {
    const content = node.content
      // ProseMirror never stores empty text nodes; tolerate one rather than refuse the whole note.
      .filter(
        (child: unknown) =>
          !(
            child &&
            (child as Json).type === "text" &&
            !(child as Json).text
          )
      )
      .map((child: unknown) => cleanNode(child, depth + 1, state));
    if (content.length) out.content = content;
  }
  if (BLOCKS.has(type)) state.text.push("\n");
  return out;
}

export function sanitizeDoc(raw: unknown): CleanNote {
  if (JSON.stringify(raw ?? null).length > NOTE_LIMITS.contentBytes)
    throw errors.validation("This note can't be saved: it is too long.");
  if (!raw || typeof raw !== "object" || (raw as Json).type !== "doc")
    throw unreadable();
  const state: State = { nodes: 0, text: [], images: new Set() };
  const doc = cleanNode(raw, 0, state);
  if (!doc.content) doc.content = [{ type: "paragraph" }];
  const text = state.text
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_TEXT);
  return { doc, text, imageIds: [...state.images] };
}
