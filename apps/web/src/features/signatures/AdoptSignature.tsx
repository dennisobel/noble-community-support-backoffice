import { Eraser, PenLine, Type } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import SignaturePad from "signature_pad";
import { Btn, Modal } from "@/components/app/ui";

/** A handwriting-style stack that exists on Windows, Apple and most Android devices. */
const SCRIPT_FONT =
  '"Segoe Script", "Snell Roundhand", "Brush Script MT", "Apple Chancery", "Lucida Handwriting", "Dancing Script", cursive';
const INK = "#10253a";

/**
 * Crops the empty space around whatever was drawn and scales it down to a sensible size, so a
 * signature fits its box properly and the file stays small. Returns null when nothing was drawn.
 */
function trimmedPng(source: HTMLCanvasElement, maxWidth = 1000): string | null {
  const context = source.getContext("2d");
  if (!context) return null;
  const { width, height } = source;
  const pixels = context.getImageData(0, 0, width, height).data;
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1)
      if (pixels[(y * width + x) * 4 + 3] > 8) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
  if (right < 0) return null;
  const margin = Math.round(Math.max(width, height) * 0.01);
  left = Math.max(0, left - margin);
  top = Math.max(0, top - margin);
  right = Math.min(width - 1, right + margin);
  bottom = Math.min(height - 1, bottom + margin);
  const cropWidth = right - left + 1;
  const cropHeight = bottom - top + 1;
  const scale = Math.min(1, maxWidth / cropWidth);
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(cropWidth * scale));
  out.height = Math.max(1, Math.round(cropHeight * scale));
  out
    .getContext("2d")
    ?.drawImage(
      source,
      left,
      top,
      cropWidth,
      cropHeight,
      0,
      0,
      out.width,
      out.height
    );
  return out.toDataURL("image/png");
}

function DrawPad({ onChange }: { onChange: (png: string | null) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const pad = useRef<SignaturePad | null>(null);
  const [empty, setEmpty] = useState(true);

  const report = useCallback(() => {
    const target = canvas.current;
    const instance = pad.current;
    if (!target || !instance) return;
    setEmpty(instance.isEmpty());
    onChange(instance.isEmpty() ? null : trimmedPng(target));
  }, [onChange]);

  useEffect(() => {
    const target = canvas.current;
    if (!target) return;
    const instance = new SignaturePad(target, {
      penColor: INK,
      minWidth: 0.9,
      maxWidth: 2.8,
      throttle: 8,
    });
    pad.current = instance;
    const fit = () => {
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      const box = target.getBoundingClientRect();
      target.width = Math.round(box.width * ratio);
      target.height = Math.round(box.height * ratio);
      target.getContext("2d")?.scale(ratio, ratio);
      instance.clear();
      setEmpty(true);
      onChange(null);
    };
    fit();
    instance.addEventListener("endStroke", report);
    window.addEventListener("resize", fit);
    return () => {
      window.removeEventListener("resize", fit);
      instance.off();
    };
  }, [onChange, report]);

  return (
    <div>
      <div className="relative rounded-lg border border-dashed border-[#9db8b3] bg-white">
        <canvas
          ref={canvas}
          aria-label="Draw your signature here"
          className="block h-[190px] w-full touch-none rounded-lg"
        />
        {empty && (
          <span className="pointer-events-none absolute inset-0 grid place-items-center text-[13px] text-[#9aa9ae]">
            Sign here with your finger or mouse
          </span>
        )}
        <span className="pointer-events-none absolute bottom-9 left-5 right-5 border-b border-[#d8e2df]" />
      </div>
      <button
        type="button"
        className="btn btn-quiet mt-2 !h-8 text-[11px]"
        onClick={() => {
          pad.current?.clear();
          report();
        }}
      >
        <Eraser size={13} /> Clear
      </button>
    </div>
  );
}

function TypePad({
  initialName,
  onChange,
}: {
  initialName: string;
  onChange: (png: string | null) => void;
}) {
  const [name, setName] = useState(initialName);

  useEffect(() => {
    const text = name.trim();
    if (!text) return onChange(null);
    let cancelled = false;
    void (async () => {
      try {
        await document.fonts?.load(`72px ${SCRIPT_FONT}`, text);
      } catch {
        /* the fallback font is fine */
      }
      if (cancelled) return;
      const size = 96;
      const target = document.createElement("canvas");
      const context = target.getContext("2d");
      if (!context) return onChange(null);
      context.font = `${size}px ${SCRIPT_FONT}`;
      const measured = Math.ceil(context.measureText(text).width);
      target.width = measured + size;
      target.height = Math.round(size * 2);
      // Resizing a canvas resets its state, so the font is set again.
      context.font = `${size}px ${SCRIPT_FONT}`;
      context.fillStyle = INK;
      context.textBaseline = "middle";
      context.fillText(text, size / 2, target.height / 2);
      onChange(trimmedPng(target));
    })();
    return () => {
      cancelled = true;
    };
  }, [name, onChange]);

  return (
    <div>
      <label className="label" htmlFor="typed-signature">
        Type your full name
      </label>
      <input
        id="typed-signature"
        className="input"
        value={name}
        maxLength={60}
        autoComplete="name"
        onChange={event => setName(event.target.value)}
      />
      <div
        aria-hidden="true"
        className="mt-3 grid h-[130px] place-items-center overflow-hidden rounded-lg border border-dashed border-[#9db8b3] bg-white px-4 text-center text-[#10253a]"
        style={{ fontFamily: SCRIPT_FONT, fontSize: "clamp(28px, 9vw, 46px)" }}
      >
        {name.trim() || (
          <span
            className="text-[13px] text-[#9aa9ae]"
            style={{ fontFamily: "inherit" }}
          >
            Your signature will look like this
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Lets someone draw or type their signature. What comes back is a small PNG with no empty margin,
 * which is then used on every signature box of theirs in the document.
 */
export function AdoptSignatureModal({
  name,
  current,
  onAdopt,
  onClose,
}: {
  name: string;
  current: string | null;
  onAdopt: (png: string) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"draw" | "type">("draw");
  const [png, setPng] = useState<string | null>(null);

  return (
    <Modal
      title={current ? "Change your signature" : "Add your signature"}
      subtitle="Draw it, or type your name and a signature is made for you."
      onClose={onClose}
    >
      <div className="mb-3 grid grid-cols-2 gap-1 rounded-lg bg-[#eef3f1] p-1">
        {(
          [
            ["draw", "Draw", PenLine],
            ["type", "Type", Type],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              setMode(key);
              setPng(null);
            }}
            aria-pressed={mode === key}
            className={`flex h-9 items-center justify-center gap-1.5 rounded-md text-[12px] font-semibold ${
              mode === key
                ? "bg-white text-[#12766f] shadow-sm"
                : "text-[#5d7077]"
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>
      {mode === "draw" ? (
        <DrawPad onChange={setPng} />
      ) : (
        <TypePad initialName={name} onChange={setPng} />
      )}
      <p className="mt-3 text-[10.5px] leading-4 text-[#6d7c82]">
        By adding your signature you agree it is a valid way of signing this
        document.
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <Btn variant="secondary" onClick={onClose}>
          Cancel
        </Btn>
        <Btn disabled={!png} onClick={() => png && onAdopt(png)}>
          Use this signature
        </Btn>
      </div>
    </Modal>
  );
}
