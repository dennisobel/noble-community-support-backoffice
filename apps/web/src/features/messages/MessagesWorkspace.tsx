import {
  ArrowLeft,
  CalendarDays,
  Megaphone,
  MessagesSquare,
  Send,
  SquarePen,
  UserRound,
  Users,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useLocation, useSearch } from "wouter";
import type {
  ConversationDTO,
  ConversationSummaryDTO,
  MessageDTO,
} from "@shared/dto";
import type {
  AnnouncementAudience,
  ConversationKind,
  MessageContextType,
} from "@shared/enums";
import { api, errorMessage } from "@/api/client";
import {
  useConversation,
  useConversations,
  useMarkConversationRead,
  useMessageOptions,
  useSendMessage,
  useStartConversation,
} from "@/api/hooks";
import {
  Avatar,
  Btn,
  EmptyState,
  ErrorBlock,
  FormAlert,
  LoadingBlock,
  Modal,
} from "@/components/app/ui";
import { useAuth } from "@/lib/auth";
import { formatTime, timeAgo } from "@/lib/format";
import "./messages.css";

const AUDIENCES: Array<[AnnouncementAudience, string]> = [
  ["workers", "All support workers"],
  ["office", "The office team"],
  ["everyone", "Everyone"],
];
const audienceLabel = (audience: AnnouncementAudience | null) =>
  AUDIENCES.find(([key]) => key === audience)?.[1] ?? "Everyone";

/** What a new conversation starts with: who it is to, and what it is about. */
interface Draft {
  kind: ConversationKind;
  to?: string;
  context?: { type: MessageContextType; id: string };
}

const dayLabel = (iso: string) => {
  const date = new Date(iso);
  const today = new Date();
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(date, today)) return "Today";
  if (same(date, new Date(today.getTime() - 86_400_000))) return "Yesterday";
  return date.toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
};

function KindIcon({ item }: { item: ConversationSummaryDTO }) {
  if (item.kind === "announcement")
    return (
      <span className="avatar !bg-[#fdf0da] !text-[#8a6224]">
        <Megaphone size={15} />
      </span>
    );
  if (item.kind === "group")
    return (
      <span className="avatar !bg-[#e6eef7] !text-[#2f5c86]">
        {item.context?.type === "shift" ? (
          <CalendarDays size={15} />
        ) : (
          <Users size={15} />
        )}
      </span>
    );
  return <Avatar name={item.title} />;
}

/* ───────────── Starting a conversation ───────────── */

function Composer({
  draft,
  portal,
  onClose,
  onStarted,
}: {
  draft: Draft;
  portal: boolean;
  onClose: () => void;
  onStarted: (id: string) => void;
}) {
  const options = useMessageOptions();
  const start = useStartConversation();
  const [kind, setKind] = useState<ConversationKind>(draft.kind);
  const [chosen, setChosen] = useState<string[]>(draft.to ? [draft.to] : []);
  const [filter, setFilter] = useState("");
  const [audience, setAudience] = useState<AnnouncementAudience>("workers");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");

  const recipients = options.data?.recipients ?? [];
  const shown = recipients.filter(person =>
    person.name.toLowerCase().includes(filter.trim().toLowerCase())
  );
  const kinds: Array<[ConversationKind, string]> = [
    ["direct", "One person"],
    ...(portal ? [] : ([["group", "A group"]] as Array<[ConversationKind, string]>)),
    ...(options.data?.canAnnounce
      ? ([["announcement", "Announcement"]] as Array<[ConversationKind, string]>)
      : []),
  ];
  const aboutShift = draft.context?.type === "shift";

  const toggle = (id: string) =>
    setChosen(current =>
      kind === "direct"
        ? [id]
        : current.includes(id)
          ? current.filter(item => item !== id)
          : [...current, id]
    );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      const conversation = await start.mutateAsync({
        kind,
        memberIds: kind === "announcement" ? undefined : chosen,
        audience: kind === "announcement" ? audience : undefined,
        title: title.trim() || undefined,
        context: kind === "announcement" ? undefined : draft.context,
        body,
      });
      onStarted(conversation.id);
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  return (
    <Modal
      title={
        kind === "announcement"
          ? "Send an announcement"
          : aboutShift
            ? "Message about this shift"
            : "New message"
      }
      subtitle={
        kind === "announcement"
          ? "Everyone in the audience gets it. They can read it but not answer it here."
          : undefined
      }
      onClose={onClose}
      busy={start.isPending}
    >
      <form className="space-y-4" onSubmit={submit}>
        {kinds.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {kinds.map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={kind === key}
                onClick={() => {
                  setKind(key);
                  if (key === "direct") setChosen(current => current.slice(0, 1));
                }}
                className={`rounded-full px-3 py-1.5 !text-[11px] !font-semibold ${
                  kind === key
                    ? "bg-[#12766f] text-white"
                    : "border border-[#dde5e2] bg-white text-[#63757d]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {kind === "announcement" ? (
          <>
            <label className="label">
              To
              <select
                className="select mt-1"
                value={audience}
                onChange={event =>
                  setAudience(event.target.value as AnnouncementAudience)
                }
              >
                {AUDIENCES.map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="label">
              Subject
              <input
                className="input mt-1"
                value={title}
                onChange={event => setTitle(event.target.value)}
                placeholder="e.g. New sign-on steps from Monday"
              />
            </label>
          </>
        ) : (
          <div>
            <span className="label">
              {kind === "direct" ? "To" : "People in the group"}
              {aboutShift && kind === "group" && (
                <span className="field-help ml-1 font-normal">
                  Leave everyone unticked to send it to the workers rostered on
                  the shift.
                </span>
              )}
            </span>
            {recipients.length > 8 && (
              <input
                className="input mb-2"
                value={filter}
                onChange={event => setFilter(event.target.value)}
                placeholder="Find someone…"
                aria-label="Find someone"
              />
            )}
            {options.isPending ? (
              <LoadingBlock className="!py-4" />
            ) : recipients.length ? (
              <div className="msg-people">
                {shown.map(person => (
                  <label key={person.id}>
                    <input
                      type={kind === "direct" ? "radio" : "checkbox"}
                      name="recipient"
                      className="accent-[#147f79]"
                      checked={chosen.includes(person.id)}
                      onChange={() => toggle(person.id)}
                    />
                    <span className="min-w-0 flex-1 truncate font-semibold text-[#344854]">
                      {person.name}
                    </span>
                    <span className="text-[10px] text-[#849198]">
                      {person.roleLabel}
                    </span>
                  </label>
                ))}
                {!shown.length && (
                  <p className="p-3 text-xs text-[#7b8990]">Nobody matches.</p>
                )}
              </div>
            ) : (
              <p className="text-xs leading-5 text-[#7b8990]">
                {portal
                  ? "Nobody in the office has an account to message yet."
                  : "Nobody else has an account yet. Invite a worker from Staff, or approve someone in Settings."}
              </p>
            )}
            {kind === "group" && (
              <label className="label !mt-3">
                Group name
                <input
                  className="input mt-1"
                  value={title}
                  onChange={event => setTitle(event.target.value)}
                  placeholder="Optional"
                />
              </label>
            )}
          </div>
        )}

        <label className="label">
          Message
          <textarea
            required
            className="textarea mt-1"
            value={body}
            onChange={event => setBody(event.target.value)}
            maxLength={4000}
          />
        </label>
        <FormAlert message={error} />
        <div className="flex justify-end gap-2">
          <Btn variant="secondary" onClick={onClose} disabled={start.isPending}>
            Cancel
          </Btn>
          <Btn
            type="submit"
            loading={start.isPending}
            disabled={
              !body.trim() ||
              (kind === "direct" && chosen.length !== 1) ||
              (kind === "group" && !chosen.length && !aboutShift)
            }
          >
            <Send size={14} />
            Send
          </Btn>
        </div>
      </form>
    </Modal>
  );
}

/* ───────────── One conversation ───────────── */

function Thread({
  id,
  onBack,
  onMessageSender,
}: {
  id: string;
  onBack: () => void;
  onMessageSender: (userId: string) => void;
}) {
  const thread = useConversation(id);
  const send = useSendMessage();
  const markRead = useMarkConversationRead();
  const me = useAuth().session?.user.id;
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [older, setOlder] = useState<MessageDTO[]>([]);
  const [moreOlder, setMoreOlder] = useState<boolean | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [showReaders, setShowReaders] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const data = thread.data;

  const messages = useMemo(() => {
    const seen = new Set<string>();
    return [...older, ...(data?.messages ?? [])].filter(message =>
      seen.has(message.id) ? false : (seen.add(message.id), true)
    );
  }, [older, data?.messages]);
  const lastId = messages[messages.length - 1]?.id;

  // Follow the conversation: stay at the newest message as they arrive.
  useLayoutEffect(() => {
    const node = scroller.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [lastId]);

  // Opening a conversation with something new in it marks it read.
  const unread = data?.unread ?? 0;
  useEffect(() => {
    if (unread > 0 && document.visibilityState === "visible" && !markRead.isPending)
      markRead.mutate(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, unread, lastId]);

  const loadOlder = async () => {
    const first = messages[0];
    if (!first) return;
    setLoadingOlder(true);
    try {
      const page = await api.get<ConversationDTO>(`/messages/${id}`, {
        before: first.sentAt,
        limit: 50,
      });
      setOlder(current => [...page.messages, ...current]);
      setMoreOlder(page.hasMore);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setLoadingOlder(false);
    }
  };

  const submit = async () => {
    const body = text.trim();
    if (!body || send.isPending) return;
    setError("");
    setText("");
    try {
      await send.mutateAsync({ id, body });
    } catch (failure) {
      setText(body);
      setError(errorMessage(failure));
    }
  };

  if (thread.isError)
    return (
      <div className="p-5">
        <ErrorBlock error={thread.error} />
        <Btn variant="secondary" className="mt-3" onClick={onBack}>
          Back to messages
        </Btn>
      </div>
    );
  if (!data) return <LoadingBlock />;

  const hasMore = moreOlder ?? data.hasMore;
  const announcement = data.kind === "announcement";
  const others = data.members.filter(member => member.id !== me);
  const mineLast = [...messages].reverse().find(message => message.mine);
  /** In a conversation between two people, whether the other one has read my last message. */
  const seen =
    data.kind === "direct" &&
    mineLast &&
    others.some(
      member => member.lastReadAt && member.lastReadAt >= mineLast.sentAt
    );
  // Read means opened since the last thing that was said, the same way the count is worked out.
  const latest = data.lastMessage?.sentAt ?? "";
  const readers = others.filter(
    member => member.lastReadAt && member.lastReadAt >= latest
  );

  return (
    <>
      <div className="msg-head">
        <button
          type="button"
          className="icon-btn msg-back"
          aria-label="Back to messages"
          onClick={onBack}
        >
          <ArrowLeft size={17} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-[#2c4250]">
            {data.title}
          </div>
          <div className="truncate text-[10px] text-[#849198]">
            {announcement
              ? `Announcement to ${audienceLabel(data.audience).toLowerCase()}${data.createdBy ? ` · from ${data.createdBy.name}` : ""}`
              : data.context
                ? `About ${data.context.label}`
                : data.kind === "group"
                  ? others.map(member => member.name).join(", ")
                  : (others[0]?.roleLabel ?? "")}
          </div>
        </div>
        {data.readBy !== null && (
          <button
            type="button"
            className="badge badge-submitted"
            onClick={() => setShowReaders(current => !current)}
            aria-expanded={showReaders}
          >
            Read by {data.readBy} of {data.memberCount - 1}
          </button>
        )}
      </div>
      {showReaders && (
        <div className="border-b border-[#e9eeec] bg-[#fbfcfb] px-4 py-2.5 text-[11px] leading-5 text-[#63757d]">
          {readers.length
            ? `Opened by ${readers.map(member => member.name).join(", ")}.`
            : "Nobody has opened it yet."}
        </div>
      )}

      <div className="msg-scroll px-4 py-2" ref={scroller}>
        {hasMore && (
          <div className="py-2 text-center">
            <Btn
              variant="quiet"
              className="!h-8 text-[11px]"
              onClick={() => void loadOlder()}
              loading={loadingOlder}
            >
              Earlier messages
            </Btn>
          </div>
        )}
        {messages.map((message, index) => {
          const previous = messages[index - 1];
          const newDay =
            !previous ||
            new Date(previous.sentAt).toDateString() !==
              new Date(message.sentAt).toDateString();
          const named =
            !message.mine &&
            data.kind !== "direct" &&
            (newDay || previous?.sender.id !== message.sender.id);
          return (
            <div key={message.id}>
              {newDay && <div className="msg-day">{dayLabel(message.sentAt)}</div>}
              <div className={`msg-row ${message.mine ? "mine" : "theirs"}`}>
                {named && (
                  <span className="msg-meta !mb-0.5 !mt-1 font-semibold text-[#63757d]">
                    {message.sender.name}
                  </span>
                )}
                {/* What this one message is about, unless the whole thread already is. */}
                {message.context && message.context.id !== data.context?.id && (
                  <span className="msg-about">About {message.context.label}</span>
                )}
                <div className="msg-bubble">{message.body}</div>
                <span className="msg-meta">
                  {formatTime(message.sentAt)}
                  {seen && message.id === mineLast?.id && " · Seen"}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {data.canReply ? (
        <form
          className="msg-compose"
          onSubmit={event => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="flex-1">
            {error && (
              <p className="mb-1.5 text-[11px] text-[#b9433e]" role="alert">
                {error}
              </p>
            )}
            <textarea
              rows={1}
              className="w-full"
              value={text}
              maxLength={4000}
              placeholder={
                announcement ? "Add to this announcement…" : "Write a message…"
              }
              aria-label="Message"
              onChange={event => setText(event.target.value)}
              onKeyDown={event => {
                // Enter sends; Shift+Enter starts a new line.
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  void submit();
                }
              }}
            />
          </div>
          <button
            type="submit"
            className="msg-send"
            disabled={!text.trim() || send.isPending}
            aria-label="Send"
          >
            <Send size={16} />
          </button>
        </form>
      ) : (
        <div className="msg-compose !items-center justify-between text-[11px] text-[#7b8990]">
          Announcements cannot be answered here.
          {data.createdBy && (
            <Btn
              variant="secondary"
              className="!h-8 !px-2 text-[11px]"
              onClick={() => onMessageSender(data.createdBy!.id)}
            >
              Message {data.createdBy.name.split(/\s+/)[0]}
            </Btn>
          )}
        </div>
      )}
    </>
  );
}

/* ───────────── The workspace ───────────── */

/**
 * Messages, used as it is by the back office and the worker portal. `base` is where it is
 * mounted. A link carrying ?shift=, ?client= or ?to= opens a new message already pointed at
 * that shift, client or person.
 */
export default function MessagesWorkspace({
  base,
  id,
  portal = false,
}: {
  base: string;
  id?: string;
  portal?: boolean;
}) {
  const [, navigate] = useLocation();
  const search = useSearch();
  const list = useConversations();
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(search);
    const shift = params.get("shift");
    const client = params.get("client");
    const to = params.get("to");
    if (!shift && !client && !to) return;
    setDraft({
      // The office writes to everyone on a shift at once; a worker writes to one person in the office.
      kind: (shift || client) && !portal ? "group" : "direct",
      to: to ?? undefined,
      context: shift
        ? { type: "shift", id: shift }
        : client
          ? { type: "participant", id: client }
          : undefined,
    });
    navigate(id ? `${base}/${id}` : base, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const items = list.data?.items ?? [];
  const open = (conversationId?: string) =>
    navigate(conversationId ? `${base}/${conversationId}` : base);

  return (
    <>
      <div className="msg" data-open={id ? "true" : "false"}>
        <div className="msg-list">
          <div className="msg-head">
            <div className="flex-1 text-sm font-semibold text-[#2c4250]">
              Conversations
            </div>
            <Btn
              className="!h-9 !px-3 text-xs"
              onClick={() => setDraft({ kind: "direct" })}
            >
              <SquarePen size={14} />
              New
            </Btn>
          </div>
          <div className="msg-scroll">
            {list.isError ? (
              <div className="p-4">
                <ErrorBlock error={list.error} onRetry={() => list.refetch()} />
              </div>
            ) : list.isPending ? (
              <LoadingBlock />
            ) : items.length ? (
              items.map(item => (
                <button
                  key={item.id}
                  type="button"
                  className={`msg-item ${item.id === id ? "active" : ""}`}
                  onClick={() => open(item.id)}
                >
                  <KindIcon item={item} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span
                        className={`min-w-0 flex-1 truncate text-xs ${
                          item.unread
                            ? "font-bold text-[#1f3542]"
                            : "font-semibold text-[#3d525c]"
                        }`}
                      >
                        {item.title}
                      </span>
                      <span className="shrink-0 text-[10px] text-[#9aa5a8]">
                        {timeAgo(item.lastMessage?.sentAt ?? item.updatedAt)}
                      </span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-2">
                      <span
                        className={`min-w-0 flex-1 truncate text-[11px] ${
                          item.unread ? "text-[#344854]" : "text-[#7b8990]"
                        }`}
                      >
                        {item.lastMessage
                          ? `${item.kind === "direct" ? "" : `${item.lastMessage.senderName.split(/\s+/)[0]}: `}${item.lastMessage.body}`
                          : "No messages yet"}
                      </span>
                      {item.unread > 0 && (
                        <span
                          className="shrink-0 rounded-full bg-[#e18a65] px-1.5 text-[10px] font-bold leading-4 text-white"
                          aria-label={`${item.unread} new`}
                        >
                          {item.unread}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              ))
            ) : (
              <EmptyState
                icon={<MessagesSquare size={19} />}
                title="No conversations yet"
                text={
                  portal
                    ? "Write to the office here. They can write to you too."
                    : "Write to a worker or a colleague, or send an announcement to the team."
                }
              />
            )}
          </div>
        </div>

        <div className="msg-thread">
          {id ? (
            <Thread
              key={id}
              id={id}
              onBack={() => open()}
              onMessageSender={userId => setDraft({ kind: "direct", to: userId })}
            />
          ) : (
            <div className="grid flex-1 place-items-center p-6">
              <EmptyState
                icon={<UserRound size={19} />}
                title="Choose a conversation"
                text="Or start a new one. Messages are only seen by the people in the conversation."
              />
            </div>
          )}
        </div>
      </div>

      {draft && (
        <Composer
          draft={draft}
          portal={portal}
          onClose={() => setDraft(null)}
          onStarted={conversationId => {
            setDraft(null);
            open(conversationId);
          }}
        />
      )}
    </>
  );
}
