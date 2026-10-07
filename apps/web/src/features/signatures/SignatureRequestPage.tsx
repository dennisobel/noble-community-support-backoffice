import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "wouter";
import { refresh, useSignature } from "@/api/hooks";
import { ErrorBlock, LoadingBlock } from "@/components/app/ui";
import { useNotify } from "@/lib/notify";
import { RequestDraftEditor } from "./RequestDraftEditor";
import { RequestStatusView } from "./RequestStatusView";
import { SignInApp } from "./SignInApp";

/** One signature request: the editor while it is a draft, the progress view once it has been sent. */
export default function SignatureRequestPage() {
  const { id } = useParams<{ id: string }>();
  const request = useSignature(id);
  const qc = useQueryClient();
  const notify = useNotify();
  // Held here, not in either view, so the signing screen stays open while a draft turns into a sent request.
  const [signToken, setSignToken] = useState<string | null>(null);

  if (request.isPending) return <LoadingBlock label="Loading the request…" />;
  if (request.isError)
    return (
      <ErrorBlock error={request.error} onRetry={() => request.refetch()} />
    );

  const data = request.data;
  // Keyed by id so opening a different request never carries over the previous one's edits.
  return (
    <>
      {data.status === "draft" ? (
        <RequestDraftEditor
          key={data.id}
          request={data}
          onSign={setSignToken}
        />
      ) : (
        <RequestStatusView key={data.id} request={data} onSign={setSignToken} />
      )}
      {signToken && (
        <SignInApp
          token={signToken}
          onClose={signed => {
            setSignToken(null);
            void refresh(qc, ["signatures", "documents"]);
            if (signed === "completed")
              notify("Signed. The finished copy is ready to download.");
            else if (signed)
              notify(
                "Your signature is recorded. The others still need to sign."
              );
          }}
        />
      )}
    </>
  );
}
