import { ArrowLeft } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { PublicSigningResultDTO } from "@shared/dto";
import { usePublicSigning } from "@/api/hooks";
import { Btn, Spinner } from "@/components/app/ui";
import { ClosedView, Notice, SigningView } from "./PublicSignPage";

/**
 * Signing for a team member who is one of the signers. It is the same screen a client gets from
 * their link, opened over the app, so nobody has to send a link to themselves.
 */
export function SignInApp({
  token,
  onClose,
}: {
  token: string;
  /** Given the outcome when a signature was recorded ("completed" when it was the last one). */
  onClose: (signed?: PublicSigningResultDTO["state"]) => void;
}) {
  const signing = usePublicSigning(token);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const data = signing.data;
  return createPortal(
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-[#f4f6f5]"
      role="dialog"
      aria-modal="true"
      aria-label="Sign the document"
    >
      <header className="sticky top-0 z-40 border-b border-[#e0e8e5] bg-white">
        <div className="mx-auto flex max-w-[860px] items-center gap-3 px-4 py-2.5">
          <Btn variant="secondary" onClick={() => onClose()}>
            <ArrowLeft size={14} /> Back to the request
          </Btn>
          {data && (
            <span className="ml-auto truncate text-[11px] text-[#7d8b91]">
              Signing as {data.signer.name}
            </span>
          )}
        </div>
      </header>
      <div className="mx-auto max-w-[860px] px-4 pb-8 pt-5">
        {signing.isPending ? (
          <div className="grid place-items-center py-24">
            <Spinner size={20} />
          </div>
        ) : !data ? (
          <Notice tone="bad" title="This document cannot be signed right now.">
            The request may have been cancelled or changed. Go back to the
            request and reload the page.
          </Notice>
        ) : data.state === "open" ? (
          <SigningView data={data} token={token} onSigned={onClose} />
        ) : (
          <ClosedView data={data} token={token} />
        )}
      </div>
    </div>,
    document.body
  );
}
