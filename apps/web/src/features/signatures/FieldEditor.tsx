import { nanoid } from "nanoid";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { SignatureFieldType } from "@shared/enums";
import { SIGNATURE_FIELD_DEFAULTS } from "@shared/schemas/signatures";
import { PdfPage } from "./PdfPage";
import { colourAt, FIELD_ICON, FIELD_NAME } from "./signature-ui";

export interface EditorField {
  id: string;
  signerId: string;
  type: SignatureFieldType;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  required: boolean;
  label: string;
}

export interface EditorSigner {
  id: string;
  name: string;
}

const MIN_W = 0.02;
const MIN_H = 0.012;
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/** A new box centred where the sender clicked, sized like a real signature line on that page. */
export function newField(
  type: SignatureFieldType,
  page: number,
  centre: { x: number; y: number },
  signerId: string,
  pageSize: { width: number; height: number }
): EditorField {
  const preset = SIGNATURE_FIELD_DEFAULTS[type];
  const w = Math.min(preset.w / pageSize.width, 0.9);
  const h = Math.min(preset.h / pageSize.height, 0.5);
  return {
    id: nanoid(12),
    signerId,
    type,
    page,
    x: clamp(centre.x - w / 2, 0, 1 - w),
    y: clamp(centre.y - h / 2, 0, 1 - h),
    w,
    h,
    required: true,
    label: preset.label,
  };
}

type Update = (change: (previous: EditorField[]) => EditorField[]) => void;

/**
 * The pages of the document with the boxes on them. With a tool picked, clicking a page puts a
 * box there; boxes can be dragged, resized from the corner, and picked to change or remove.
 * Everything is stored as a fraction of the page, so it holds at any zoom or screen size.
 */
export function FieldEditor({
  pdf,
  pages,
  signers,
  fields,
  tool,
  activeSignerId,
  selectedId,
  onSelect,
  onChange,
  onPlaced,
}: {
  pdf: PDFDocumentProxy;
  pages: Array<{ width: number; height: number }>;
  signers: EditorSigner[];
  fields: EditorField[];
  tool: SignatureFieldType | null;
  activeSignerId: string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: Update;
  onPlaced: () => void;
}) {
  const signerIndex = (id: string) =>
    signers.findIndex(signer => signer.id === id);

  const place =
    (pageNumber: number) => (event: React.PointerEvent<HTMLDivElement>) => {
      // Boxes stop their own clicks, so anything arriving here landed on bare page.
      if (!tool || !activeSignerId) return onSelect(null);
      const rect = event.currentTarget.getBoundingClientRect();
      const field = newField(
        tool,
        pageNumber,
        {
          x: (event.clientX - rect.left) / rect.width,
          y: (event.clientY - rect.top) / rect.height,
        },
        activeSignerId,
        pages[pageNumber - 1]
      );
      onChange(previous => [...previous, field]);
      onSelect(field.id);
      onPlaced();
    };

  const begin = (
    event: React.PointerEvent<HTMLElement>,
    field: EditorField,
    mode: "move" | "resize"
  ) => {
    event.stopPropagation();
    event.preventDefault();
    onSelect(field.id);
    const page = event.currentTarget.closest<HTMLElement>("[data-page]");
    if (!page) return;
    const rect = page.getBoundingClientRect();
    const origin = { x: event.clientX, y: event.clientY };
    const start = { ...field };
    const move = (next: PointerEvent) => {
      const dx = (next.clientX - origin.x) / rect.width;
      const dy = (next.clientY - origin.y) / rect.height;
      onChange(previous =>
        previous.map(item =>
          item.id !== start.id
            ? item
            : mode === "move"
              ? {
                  ...item,
                  x: clamp(start.x + dx, 0, 1 - item.w),
                  y: clamp(start.y + dy, 0, 1 - item.h),
                }
              : {
                  ...item,
                  w: clamp(start.w + dx, MIN_W, 1 - item.x),
                  h: clamp(start.h + dy, MIN_H, 1 - item.y),
                }
        )
      );
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  const nudge = (event: React.KeyboardEvent, field: EditorField) => {
    const step = event.shiftKey ? 0.02 : 0.005;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = delta[event.key];
    if (!move) return;
    event.preventDefault();
    onChange(previous =>
      previous.map(item =>
        item.id === field.id
          ? {
              ...item,
              x: clamp(item.x + move[0], 0, 1 - item.w),
              y: clamp(item.y + move[1], 0, 1 - item.h),
            }
          : item
      )
    );
  };

  return (
    <div className="mx-auto w-full max-w-[860px]">
      {pages.map((size, index) => {
        const pageNumber = index + 1;
        return (
          <div key={pageNumber} className="mb-5">
            <div className="mb-1 text-[10px] font-semibold text-[#7d8b91]">
              Page {pageNumber} of {pages.length}
            </div>
            <PdfPage
              pdf={pdf}
              pageNumber={pageNumber}
              aspect={size.height / size.width}
              onPointerDown={place(pageNumber)}
              className={tool ? "cursor-crosshair" : ""}
            >
              {fields
                .filter(field => field.page === pageNumber)
                .map(field => {
                  const colour = colourAt(signerIndex(field.signerId));
                  const Icon = FIELD_ICON[field.type];
                  const selected = field.id === selectedId;
                  const owner =
                    signers.find(signer => signer.id === field.signerId)
                      ?.name ?? "";
                  return (
                    <div
                      key={field.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`${FIELD_NAME[field.type]} box for ${owner}`}
                      aria-pressed={selected}
                      onPointerDown={event => begin(event, field, "move")}
                      onKeyDown={event => nudge(event, field)}
                      onFocus={() => onSelect(field.id)}
                      className="absolute flex cursor-move items-center gap-1 rounded-[3px] border-[1.5px] px-1 text-[10px] font-semibold outline-none"
                      style={{
                        left: `${field.x * 100}%`,
                        top: `${field.y * 100}%`,
                        width: `${field.w * 100}%`,
                        height: `${field.h * 100}%`,
                        borderColor: colour.line,
                        background: colour.fill,
                        color: colour.text,
                        touchAction: "none",
                        boxShadow: selected
                          ? `0 0 0 2px #fff, 0 0 0 4px ${colour.line}`
                          : undefined,
                        zIndex: selected ? 3 : 2,
                      }}
                    >
                      <Icon size={12} className="shrink-0" />
                      <span className="truncate">
                        {field.type === "signature"
                          ? "Sign"
                          : (field.label || FIELD_NAME[field.type]).slice(
                              0,
                              40
                            )}
                        {!field.required && field.type !== "date" && " (opt.)"}
                      </span>
                      <span
                        className="pointer-events-none absolute -top-[15px] left-[-1.5px] max-w-[160px] truncate rounded-t px-1 text-[9px] font-bold leading-[14px] text-white"
                        style={{ background: colour.line }}
                      >
                        {owner}
                      </span>
                      {selected && (
                        <span
                          onPointerDown={event => begin(event, field, "resize")}
                          className="absolute -bottom-[7px] -right-[7px] h-3.5 w-3.5 cursor-nwse-resize rounded-sm border-2 border-white"
                          style={{
                            background: colour.line,
                            touchAction: "none",
                          }}
                          aria-hidden="true"
                        />
                      )}
                    </div>
                  );
                })}
            </PdfPage>
          </div>
        );
      })}
    </div>
  );
}
