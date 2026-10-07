import { useEffect, useState } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import { errorMessage, fetchBlob } from "@/api/client";

/** Where vite.config.ts publishes the data pdf.js loads on demand. */
const ASSETS = `${import.meta.env.BASE_URL}pdfjs/`;

/**
 * pdf.js is large, so it is only fetched when a page that shows a PDF is opened. The "legacy"
 * build is used on purpose: it also runs on the older phones people open signing links on.
 */
let loader: Promise<typeof import("pdfjs-dist")> | null = null;
export function loadPdfjs() {
  loader ??= (async () => {
    const [pdfjs, worker] = await Promise.all([
      import("pdfjs-dist/legacy/build/pdf.mjs"),
      import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
    ]);
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  })();
  return loader;
}

/** Downloads a PDF (with the normal sign-in handling) and opens it for drawing. */
export function usePdfDocument(url: string | null): {
  pdf: PDFDocumentProxy | null;
  error: string | null;
} {
  const [state, setState] = useState<{
    url: string | null;
    pdf: PDFDocumentProxy | null;
    error: string | null;
  }>({ url: null, pdf: null, error: null });

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    let task: PDFDocumentLoadingTask | null = null;
    void (async () => {
      try {
        const [pdfjs, file] = await Promise.all([loadPdfjs(), fetchBlob(url)]);
        const data = new Uint8Array(await file.blob.arrayBuffer());
        if (cancelled) return;
        task = pdfjs.getDocument({
          data,
          // Fonts, colour profiles and the decoders for scanned pages are served with the app.
          wasmUrl: `${ASSETS}wasm/`,
          standardFontDataUrl: `${ASSETS}standard_fonts/`,
          iccUrl: `${ASSETS}iccs/`,
          cMapUrl: `${ASSETS}cmaps/`,
          cMapPacked: true,
        });
        const document = await task.promise;
        if (cancelled) return;
        setState({ url, pdf: document, error: null });
      } catch (error) {
        if (!cancelled)
          setState({
            url,
            pdf: null,
            error: errorMessage(error, "This document could not be opened."),
          });
      }
    })();
    return () => {
      cancelled = true;
      // Releases the document and the worker that holds it.
      void task?.destroy();
    };
  }, [url]);

  // Switching to another file must not keep showing the old one.
  return state.url === url
    ? { pdf: state.pdf, error: state.error }
    : { pdf: null, error: null };
}
