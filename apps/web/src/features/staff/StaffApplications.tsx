import { Check, Mail, MapPin, Phone, UserRoundCheck, X } from "lucide-react";
import { useState } from "react";
import type { StaffApplicationDTO } from "@shared/dto";
import { errorMessage } from "@/api/client";
import { useReviewApplication, useStaffApplications } from "@/api/hooks";
import {
  Btn,
  Drawer,
  EmptyState,
  ErrorBlock,
  FormAlert,
  LoadingBlock,
  Panel,
  Status,
} from "@/components/app/ui";
import { formatDateTime } from "@/lib/format";
import { useNotify } from "@/lib/notify";

/** Approve or decline one request for portal access. */
function ReviewDrawer({
  application,
  onClose,
}: {
  application: StaffApplicationDTO;
  onClose: () => void;
}) {
  const review = useReviewApplication();
  const notify = useNotify();
  const [position, setPosition] = useState(
    application.position || "Support Worker"
  );
  const [team, setTeam] = useState(application.team || "Community Support");
  const [note, setNote] = useState("");
  const [grantAccess, setGrantAccess] = useState(true);
  const [error, setError] = useState("");

  const decide = async (decision: "Approved" | "Rejected") => {
    setError("");
    try {
      const result = await review.mutateAsync({
        id: application.id,
        decision,
        note,
        position,
        team,
        grantAccess: decision === "Approved" ? grantAccess : false,
      });
      if (decision === "Rejected") notify(`${application.name} was declined.`);
      else if (result.invite?.emailed)
        notify(`${application.name} approved — invite emailed.`);
      else if (result.invite)
        notify(
          `${application.name} approved. Email is off, so send them this link: ${result.invite.link}`,
          "info"
        );
      else notify(`${application.name} approved.`);
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  return (
    <Drawer
      title={application.name}
      subtitle={`Requested ${formatDateTime(application.createdAt)}`}
      onClose={onClose}
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>
            Cancel
          </Btn>
          <Btn
            variant="secondary"
            onClick={() => void decide("Rejected")}
            loading={review.isPending}
          >
            <X size={14} /> Decline
          </Btn>
          <Btn
            onClick={() => void decide("Approved")}
            loading={review.isPending}
          >
            <Check size={14} /> Approve
          </Btn>
        </>
      }
    >
      <Panel title="What they told us">
        <div className="space-y-3 p-5 text-xs text-[#52666f]">
          <div className="flex items-center gap-1.5 break-all">
            <Mail size={12} className="shrink-0 text-[#849198]" />
            {application.email}
          </div>
          {application.phone && (
            <div className="flex items-center gap-1.5">
              <Phone size={12} className="text-[#849198]" />
              {application.phone}
            </div>
          )}
          {application.suburb && (
            <div className="flex items-center gap-1.5">
              <MapPin size={12} className="text-[#849198]" />
              {application.suburb}
            </div>
          )}
          {application.experience && (
            <div>
              <div className="text-[10px] font-semibold text-[#849198]">
                Experience
              </div>
              <p className="mt-1 leading-5">{application.experience}</p>
            </div>
          )}
          {application.message && (
            <div>
              <div className="text-[10px] font-semibold text-[#849198]">
                Anything else
              </div>
              <p className="mt-1 leading-5">{application.message}</p>
            </div>
          )}
        </div>
      </Panel>

      <Panel title="If you approve" className="mt-4">
        <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
          <label className="label">
            Position
            <input
              className="input mt-1"
              value={position}
              onChange={event => setPosition(event.target.value)}
            />
          </label>
          <label className="label">
            Team
            <input
              className="input mt-1"
              value={team}
              onChange={event => setTeam(event.target.value)}
            />
          </label>
          <label className="label sm:col-span-2">
            Note for the record
            <textarea
              className="textarea mt-1 !min-h-[60px]"
              value={note}
              onChange={event => setNote(event.target.value)}
              placeholder="Why you approved or declined — kept on the application."
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-[#52666f] sm:col-span-2">
            <input
              type="checkbox"
              checked={grantAccess}
              onChange={event => setGrantAccess(event.target.checked)}
            />
            Create their portal account and email an invite now
          </label>
        </div>
      </Panel>
      <FormAlert message={error} />
    </Drawer>
  );
}

/** Pending requests for portal access, plus the ones already decided. */
export default function StaffApplications() {
  const [status, setStatus] = useState("Pending");
  const applications = useStaffApplications(status);
  const [reviewing, setReviewing] = useState<StaffApplicationDTO | null>(null);

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-xs text-[#63757d]">
          People who asked for portal access. Approving creates their team
          record and emails them a link to set a password.
        </p>
        <select
          className="select h-[38px] w-[150px] shrink-0"
          value={status}
          onChange={event => setStatus(event.target.value)}
          aria-label="Filter applications"
        >
          <option value="Pending">Pending</option>
          <option value="Approved">Approved</option>
          <option value="Rejected">Declined</option>
          <option value="all">All</option>
        </select>
      </div>

      {applications.isError && (
        <ErrorBlock
          error={applications.error}
          onRetry={() => applications.refetch()}
        />
      )}
      {applications.isPending ? (
        <LoadingBlock />
      ) : applications.data?.length ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {applications.data.map(application => (
            <div key={application.id} className="panel p-5">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-[#354a56]">
                    {application.name}
                  </div>
                  <div className="mt-1 break-all text-[10px] text-[#819097]">
                    {application.email}
                  </div>
                </div>
                <Status value={application.status} />
              </div>
              <div className="mt-3 border-t border-[#edf0ef] pt-3 text-xs text-[#52666f]">
                {application.position || "No position given"}
                {application.suburb ? ` · ${application.suburb}` : ""}
                <div className="mt-1 text-[10px] text-[#849198]">
                  Requested {formatDateTime(application.createdAt)}
                </div>
                {application.experience && (
                  <p className="mt-2 line-clamp-3 leading-5">
                    {application.experience}
                  </p>
                )}
                {application.reviewNote && (
                  <p className="mt-2 text-[11px] leading-4 text-[#2f5c86]">
                    {application.reviewNote}
                  </p>
                )}
              </div>
              {application.status === "Pending" && (
                <div className="mt-4">
                  <Btn
                    className="!h-8 !px-2 text-[11px]"
                    onClick={() => setReviewing(application)}
                  >
                    <UserRoundCheck size={13} /> Review
                  </Btn>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <Panel>
          <EmptyState
            title={
              status === "Pending" ? "No requests waiting" : "Nothing to show"
            }
            text={
              status === "Pending"
                ? "When a support worker requests access from the sign-in page, it appears here for approval."
                : "No applications with that status."
            }
          />
        </Panel>
      )}
      {reviewing && (
        <ReviewDrawer
          application={reviewing}
          onClose={() => setReviewing(null)}
        />
      )}
    </>
  );
}
