import { useParams } from "wouter";
import { useSignature } from "@/api/hooks";
import { ErrorBlock, LoadingBlock } from "@/components/app/ui";
import { RequestDraftEditor } from "./RequestDraftEditor";
import { RequestStatusView } from "./RequestStatusView";

/** One signature request: the editor while it is a draft, the progress view once it has been sent. */
export default function SignatureRequestPage() {
  const { id } = useParams<{ id: string }>();
  const request = useSignature(id);

  if (request.isPending) return <LoadingBlock label="Loading the request…" />;
  if (request.isError)
    return (
      <ErrorBlock error={request.error} onRetry={() => request.refetch()} />
    );

  const data = request.data;
  // Keyed by id so opening a different request never carries over the previous one's edits.
  return data.status === "draft" ? (
    <RequestDraftEditor key={data.id} request={data} />
  ) : (
    <RequestStatusView key={data.id} request={data} />
  );
}
