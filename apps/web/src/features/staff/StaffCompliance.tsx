import {
  CheckCircle2,
  CircleDashed,
  Download,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import type { StaffChecklistItemDTO, StaffDTO } from "@shared/dto";
import { CHECKLIST_ITEM_STATUSES, STAFF_CHECKLIST_GROUPS } from "@shared/enums";
import { downloadFile, errorMessage } from "@/api/client";
import { useReviewChecklistItem, useStaffCompliance } from "@/api/hooks";
import {
  Btn,
  ErrorBlock,
  FormAlert,
  LoadingBlock,
  Panel,
  Status,
} from "@/components/app/ui";
import { fileSize, formatDateTime, prettyDate } from "@/lib/format";
import { useNotify } from "@/lib/notify";
import { expiryLabel } from "@/features/staff-portal/kit";

/** One checklist item, with the Admin's approve / send-back control. */
function Row({
  staffId,
  item,
  documentTitle,
}: {
  staffId: string;
  item: StaffChecklistItemDTO;
  documentTitle?: string;
}) {
  const review = useReviewChecklistItem();
  const notify = useNotify();
  const [note, setNote] = useState(item.reviewNote ?? "");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  const decide = async (status: string) => {
    setError("");
    try {
      await review.mutateAsync({ id: staffId, key: item.key, status, note });
      notify(`${item.label}: ${status.toLowerCase()}.`);
      setOpen(false);
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  const Icon =
    item.status === "Approved"
      ? CheckCircle2
      : item.status === "Needs attention"
        ? TriangleAlert
        : CircleDashed;

  return (
    <div className="border-b border-[#edf1ef] p-4 last:border-b-0">
      <div className="flex items-start gap-3">
        <Icon
          size={15}
          className={
            item.status === "Approved"
              ? "mt-0.5 shrink-0 text-[#1d6f57]"
              : item.status === "Needs attention"
                ? "mt-0.5 shrink-0 text-[#a33a33]"
                : "mt-0.5 shrink-0 text-[#b3bfc2]"
          }
        />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-[#354a56]">
            {item.label}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Status value={item.status} />
            {item.expiry && (
              <span
                className={`badge ${
                  item.expiryState === "expired"
                    ? "badge-danger"
                    : item.expiryState === "urgent"
                      ? "badge-returned"
                      : "badge-draft"
                }`}
              >
                {expiryLabel(item.expiryState, item.daysLeft)}
              </span>
            )}
            {item.expiry && (
              <span className="text-[10px] text-[#849198]">
                Expires {prettyDate(item.expiry)}
              </span>
            )}
          </div>
          {documentTitle && (
            <div className="mt-1.5 flex items-center gap-2 text-[10px] text-[#63757d]">
              {documentTitle}
              {item.documentId && (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 font-semibold text-[#12766f]"
                  onClick={() =>
                    void downloadFile(
                      `/portal/documents/${item.documentId}/download`,
                      documentTitle ?? item.label
                    )
                  }
                >
                  <Download size={11} /> Download
                </button>
              )}
            </div>
          )}
          {item.reviewNote && !open && (
            <p className="mt-1.5 text-[11px] leading-4 text-[#8a5a22]">
              {item.reviewNote}
            </p>
          )}
          {open && (
            <div className="mt-3">
              <textarea
                className="textarea !min-h-[54px]"
                value={note}
                onChange={event => setNote(event.target.value)}
                placeholder="What the worker needs to fix, if anything."
              />
              <div className="mt-2 flex flex-wrap gap-2">
                {CHECKLIST_ITEM_STATUSES.filter(
                  option => option !== "Not started"
                ).map(option => (
                  <Btn
                    key={option}
                    variant={option === "Approved" ? "primary" : "secondary"}
                    className="!h-8 !px-2 text-[11px]"
                    onClick={() => void decide(option)}
                    loading={review.isPending}
                  >
                    {option}
                  </Btn>
                ))}
                <Btn
                  variant="quiet"
                  className="!h-8 !px-2 text-[11px]"
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </Btn>
              </div>
              <FormAlert message={error} />
            </div>
          )}
        </div>
        {!open && (
          <Btn
            variant="secondary"
            className="!h-8 shrink-0 !px-2 text-[11px]"
            onClick={() => setOpen(true)}
          >
            Review
          </Btn>
        )}
      </div>
    </div>
  );
}

/** The Admin's view of one worker's onboarding: checklist, documents and expiries. */
export default function StaffCompliance({ member }: { member: StaffDTO }) {
  const compliance = useStaffCompliance(member.id);

  if (compliance.isPending) return <LoadingBlock />;
  if (compliance.isError)
    return (
      <ErrorBlock
        error={compliance.error}
        onRetry={() => compliance.refetch()}
      />
    );
  const data = compliance.data;
  const titleFor = (key: string) =>
    data.documents.find(document => document.checklistKey === key)?.title;

  return (
    <>
      <Panel title="Onboarding">
        <div className="p-5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-[#41555d]">
              {data.progress.completePct}% complete
            </span>
            <span className="text-[#849198]">
              {data.progress.approved}/{data.progress.total} approved
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#e9efec]">
            <div
              className="h-full rounded-full bg-[#12766f]"
              style={{ width: `${data.progress.completePct}%` }}
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-[10px]">
            {data.progress.expired > 0 && (
              <span className="badge badge-danger">
                {data.progress.expired} expired
              </span>
            )}
            {data.progress.expiring > 0 && (
              <span className="badge badge-returned">
                {data.progress.expiring} expiring soon
              </span>
            )}
            <span className="badge badge-draft">
              Portal:{" "}
              {data.account.hasAccess
                ? data.account.accepted
                  ? "active"
                  : "invited"
                : "no access"}
            </span>
            {data.account.lastLoginAt && (
              <span className="text-[#849198]">
                Last signed in {formatDateTime(data.account.lastLoginAt)}
              </span>
            )}
          </div>
        </div>
      </Panel>

      {STAFF_CHECKLIST_GROUPS.map(group => {
        const items = data.checklist.filter(item => item.group === group);
        if (!items.length) return null;
        return (
          <Panel key={group} title={group} className="mt-4">
            {items.map(item => (
              <Row
                key={item.key}
                staffId={member.id}
                item={item}
                documentTitle={titleFor(item.key)}
              />
            ))}
          </Panel>
        );
      })}

      {data.documents.length > 0 && (
        <Panel title="All documents" className="mt-4">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>File</th>
                  <th>Expires</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.documents.map(document => (
                  <tr key={document.id}>
                    <td className="font-semibold">{document.title}</td>
                    <td className="text-[#63757d]">
                      {document.file
                        ? `${document.file.originalName} · ${fileSize(document.file.size)}`
                        : "—"}
                    </td>
                    <td>
                      {document.expiry ? prettyDate(document.expiry) : "—"}
                    </td>
                    <td className="text-right">
                      {document.file && (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#12766f]"
                          onClick={() =>
                            void downloadFile(
                              `/portal/documents/${document.id}/download`,
                              document.file?.originalName ?? document.title
                            )
                          }
                        >
                          <Download size={11} /> Download
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </>
  );
}
