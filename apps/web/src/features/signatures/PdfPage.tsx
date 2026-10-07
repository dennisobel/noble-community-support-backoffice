import { useEffect, useRef, useState, type ReactNode } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";

/**
 * One page of a PDF, drawn at whatever width its container gives it. Children are drawn on top
 * and placed with percentages, so a box saved as "40% across, 60% down" lines up at every size.
 *
 * Pages far off screen are not drawn until they come near, which keeps a long document light.
 */
export function PdfPage({
  pdf,
  pageNumber,
  aspect,
  className = "",
  children,
  onPointerDown,
  label,
}: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  /** Height divided by width, when it is already known, so the page keeps its shape while loading. */
  aspect?: number;
  className?: string;
  children?: ReactNode;
  onPointerDown?: (event: React.PointerEvent<HTMLDivElement>) => void;
  label?: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [near, setNear] = useState(false);
  const [measured, setMeasured] = useState<number | null>(null);

  useEffect(() => {
    const element = wrap.current;
    if (!element) return;
    const size = new ResizeObserver(entries =>
      setWidth(Math.round(entries[0].contentRect.width))
    );
    const view = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) setNear(true);
      },
      { rootMargin: "900px 0px" }
    );
    size.observe(element);
    view.observe(element);
    return () => {
      size.disconnect();
      view.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!near || !width) return;
    let cancelled = false;
    let task: RenderTask | null = null;
    void (async () => {
      try {
        const page = await pdf.getPage(pageNumber);
        const base = page.getViewport({ scale: 1 });
        if (cancelled) return;
        setMeasured(base.height / base.width);
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({
          scale: (width / base.width) * ratio,
        });
        const target = canvas.current;
        if (!target) return;
        target.width = Math.floor(viewport.width);
        target.height = Math.floor(viewport.height);
        task = page.render({ canvas: target, viewport });
        await task.promise;
      } catch (error) {
        // A newer draw replaced this one; nothing to report.
        if ((error as Error)?.name !== "RenderingCancelledException")
          console.warn("Could not draw a PDF page", error);
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, pageNumber, width, near]);

  return (
    <div
      ref={wrap}
      data-page={pageNumber}
      role="img"
      aria-label={label ?? `Page ${pageNumber}`}
      onPointerDown={onPointerDown}
      className={`relative w-full select-none overflow-hidden bg-white shadow-[0_1px_4px_rgba(24,45,52,.18)] ${className}`}
      style={{
        aspectRatio: `1 / ${aspect ?? measured ?? 1.4142}`,
        // Lets boxes size their text from the page width (cqw), so it scales with the page.
        containerType: "inline-size",
      }}
    >
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" />
      {children}
    </div>
  );
}
