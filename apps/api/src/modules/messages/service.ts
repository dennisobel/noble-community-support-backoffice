import { Types } from "mongoose";
import type { z } from "zod";
import { ROLE_LABELS } from "@shared/access";
import type {
  ConversationDTO,
  ConversationListDTO,
  ConversationMemberDTO,
  ConversationSummaryDTO,
  MessageDTO,
  MessageOptionsDTO,
  MessageRecipientDTO,
} from "@shared/dto";
import type {
  AccessModule,
  AnnouncementAudience,
  UserRole,
} from "@shared/enums";
import { prettyDate } from "@shared/logic/time";
import type {
  conversationCreateSchema,
  messageListQuery,
} from "@shared/schemas/messages";
import { errors, isDuplicateKey } from "../../lib/errors";
import { actorDTO, iso, isoRequired } from "../../lib/mappers";
import {
  Conversation,
  Message,
  Participant,
  RosterShift,
  User,
  type ConversationDoc,
  type MessageDoc,
  type ParticipantDoc,
  type RosterShiftDoc,
  type UserDoc,
} from "../../models";

/*
 * In-app messages between the office and support workers. A conversation is only ever visible
 * to the people in it: there is no admin view of other people's messages. Workers can write to
 * the office and answer in any conversation they are in; starting groups and sending
 * announcements is the office's.
 */

/** The signed-in person, as the auth middleware describes them. */
export interface Me {
  id: string;
  name: string;
  role: UserRole;
  modules: AccessModule[];
  staffId: string | null;
}

type Person = Pick<UserDoc, "_id" | "name" | "role">;

const roleLabel = (role: UserRole) =>
  role === "staff" ? "Support worker" : ROLE_LABELS[role];

/** Admins, and anyone who manages the team, can address everyone at once. */
export const canAnnounce = (me: Pick<Me, "role" | "modules">) =>
  me.role === "admin" || me.modules.includes("staff");

const PREVIEW = 140;
const preview = (body: string) => {
  const line = body.replace(/\s+/g, " ").trim();
  return line.length > PREVIEW ? `${line.slice(0, PREVIEW - 1)}…` : line;
};

/** Everyone this person may start a conversation with. */
async function reachable(me: Me): Promise<Person[]> {
  const filter: Record<string, unknown> = {
    status: "active",
    _id: { $ne: me.id },
  };
  // A worker writes to the office, not to other workers.
  if (me.role === "staff") filter.role = { $ne: "staff" };
  return User.find(filter).select("name role").sort({ name: 1 }).lean<Person[]>();
}

export async function messageOptions(me: Me): Promise<MessageOptionsDTO> {
  const people = await reachable(me);
  return {
    recipients: people.map(
      (person): MessageRecipientDTO => ({
        id: String(person._id),
        name: person.name,
        roleLabel: roleLabel(person.role),
        worker: person.role === "staff",
      })
    ),
    canAnnounce: canAnnounce(me),
  };
}

const memberOf = (conversation: ConversationDoc, userId: string) =>
  conversation.members.find(member => String(member.userId) === userId);

/** Unread means something arrived after this person last had the conversation open. */
const hasUnread = (conversation: ConversationDoc, userId: string) => {
  const mine = memberOf(conversation, userId);
  if (!mine || !conversation.lastMessage) return false;
  return (
    !mine.lastReadAt ||
    mine.lastReadAt.getTime() < conversation.lastMessageAt.getTime()
  );
};

async function unreadCount(
  conversation: ConversationDoc,
  userId: string
): Promise<number> {
  if (!hasUnread(conversation, userId)) return 0;
  const since = memberOf(conversation, userId)?.lastReadAt ?? new Date(0);
  return Message.countDocuments({
    conversationId: conversation._id,
    createdAt: { $gt: since },
    "sender.id": { $ne: userId },
  });
}

function titleOf(
  conversation: ConversationDoc,
  me: Me,
  people: Map<string, Person>
): string {
  if (conversation.kind !== "direct")
    return conversation.title || "Group conversation";
  const other = conversation.members.find(
    member => String(member.userId) !== me.id
  );
  return (
    (other && people.get(String(other.userId))?.name) || "Someone who has left"
  );
}

function toSummaryDTO(
  conversation: ConversationDoc,
  me: Me,
  people: Map<string, Person>,
  unread: number
): ConversationSummaryDTO {
  const sender = conversation.createdBy?.id === me.id;
  return {
    id: String(conversation._id),
    kind: conversation.kind,
    title: titleOf(conversation, me, people),
    audience: conversation.audience ?? null,
    context: conversation.context
      ? {
          type: conversation.context.kind,
          id: conversation.context.id,
          label: conversation.context.label,
        }
      : null,
    memberCount: conversation.members.length,
    lastMessage: conversation.lastMessage
      ? {
          body: conversation.lastMessage.body,
          senderName: conversation.lastMessage.senderName,
          sentAt: conversation.lastMessage.sentAt.toISOString(),
        }
      : null,
    unread,
    canReply: conversation.kind !== "announcement" || sender,
    createdBy: actorDTO(conversation.createdBy),
    updatedAt: conversation.lastMessageAt.toISOString(),
  };
}

async function peopleIn(
  conversations: ConversationDoc[]
): Promise<Map<string, Person>> {
  const ids = [
    ...new Set(
      conversations.flatMap(conversation =>
        conversation.members.map(member => String(member.userId))
      )
    ),
  ];
  const people = await User.find({ _id: { $in: ids } })
    .select("name role")
    .lean<Person[]>();
  return new Map(people.map(person => [String(person._id), person]));
}

const mine = (me: Me) => ({ "members.userId": me.id });

export async function listConversations(me: Me): Promise<ConversationListDTO> {
  const conversations = await Conversation.find(mine(me))
    .sort({ lastMessageAt: -1 })
    .limit(200)
    .lean<ConversationDoc[]>();
  const [people, counts] = await Promise.all([
    peopleIn(conversations),
    Promise.all(
      conversations.map(conversation => unreadCount(conversation, me.id))
    ),
  ]);
  const items = conversations.map((conversation, index) =>
    toSummaryDTO(conversation, me, people, counts[index])
  );
  return { items, unread: items.filter(item => item.unread > 0).length };
}

/** How many conversations have something new, for the badge. Cheap enough to ask for often. */
export async function unreadConversations(userId: string): Promise<number> {
  const conversations = await Conversation.find({ "members.userId": userId })
    .select("members lastMessage lastMessageAt")
    .sort({ lastMessageAt: -1 })
    .limit(200)
    .lean<ConversationDoc[]>();
  return conversations.filter(conversation => hasUnread(conversation, userId))
    .length;
}

const toMessageDTO = (message: MessageDoc, me: Me): MessageDTO => ({
  id: String(message._id),
  conversationId: String(message.conversationId),
  sender: { id: message.sender.id, name: message.sender.name },
  mine: message.sender.id === me.id,
  body: message.body,
  context: message.context
    ? {
        type: message.context.kind,
        id: message.context.id,
        label: message.context.label,
      }
    : null,
  sentAt: isoRequired(message.createdAt),
});

/** Loads a conversation only if this person is in it; to anyone else it does not exist. */
async function loadMine(id: string, me: Me): Promise<ConversationDoc> {
  const conversation = await Conversation.findOne({
    _id: id,
    ...mine(me),
  }).lean<ConversationDoc>();
  if (!conversation) throw errors.notFound("Conversation");
  return conversation;
}

export async function getConversation(
  id: string,
  me: Me,
  query: z.output<typeof messageListQuery>
): Promise<ConversationDTO> {
  const conversation = await loadMine(id, me);
  const filter: Record<string, unknown> = { conversationId: conversation._id };
  if (query.before) filter.createdAt = { $lt: new Date(query.before) };
  const [page, people, unread] = await Promise.all([
    Message.find(filter)
      .sort({ createdAt: -1 })
      .limit(query.limit + 1)
      .lean<MessageDoc[]>(),
    peopleIn([conversation]),
    unreadCount(conversation, me.id),
  ]);
  const sender = conversation.createdBy?.id === me.id;
  const announcement = conversation.kind === "announcement";
  // Who else received an announcement, and who has read it, is the sender's to see.
  const visible = announcement && !sender ? [] : conversation.members;
  const members: ConversationMemberDTO[] = visible
    .map(member => {
      const person = people.get(String(member.userId));
      return {
        id: String(member.userId),
        name: person?.name ?? "Someone who has left",
        roleLabel: person ? roleLabel(person.role) : "",
        lastReadAt: iso(member.lastReadAt),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    ...toSummaryDTO(conversation, me, people, unread),
    members,
    messages: page
      .slice(0, query.limit)
      .reverse()
      .map(message => toMessageDTO(message, me)),
    hasMore: page.length > query.limit,
    readBy:
      announcement && sender
        ? conversation.members.filter(
            member =>
              String(member.userId) !== me.id &&
              member.lastReadAt &&
              member.lastReadAt.getTime() >=
                conversation.lastMessageAt.getTime()
          ).length
        : null,
  };
}

/** Adds a message and moves the conversation to the top of everyone's list. */
async function append(
  conversation: ConversationDoc,
  me: Me,
  body: string,
  context: ConversationDoc["context"] = null
): Promise<MessageDoc> {
  const message = await Message.create({
    conversationId: conversation._id,
    sender: { id: me.id, name: me.name },
    body,
    context,
  });
  const sentAt = message.createdAt;
  await Conversation.updateOne(
    { _id: conversation._id, "members.userId": me.id },
    {
      $set: {
        lastMessage: { body: preview(body), senderName: me.name, sentAt },
        lastMessageAt: sentAt,
        // Whoever wrote it has, by definition, read up to it.
        "members.$.lastReadAt": sentAt,
      },
    }
  );
  return message.toObject<MessageDoc>();
}

export async function sendMessage(
  id: string,
  me: Me,
  body: string
): Promise<MessageDTO> {
  const conversation = await loadMine(id, me);
  if (
    conversation.kind === "announcement" &&
    conversation.createdBy?.id !== me.id
  )
    throw errors.forbidden(
      "An announcement cannot be answered here. Message the sender directly."
    );
  return toMessageDTO(await append(conversation, me, body), me);
}

export async function markRead(id: string, me: Me): Promise<void> {
  const result = await Conversation.updateOne(
    { _id: id, "members.userId": me.id },
    { $set: { "members.$.lastReadAt": new Date() } }
  );
  if (!result.matchedCount) throw errors.notFound("Conversation");
}

/** What a conversation is about, checked and given a label people will recognise. */
async function resolveContext(
  input: { type: "shift" | "participant"; id: string } | undefined,
  me: Me
): Promise<{
  context: ConversationDoc["context"];
  shift: RosterShiftDoc | null;
}> {
  if (!input) return { context: null, shift: null };
  if (input.type === "shift") {
    const shift = await RosterShift.findById(input.id).lean<RosterShiftDoc>();
    const onIt =
      shift && shift.staffIds.some(staffId => String(staffId) === me.staffId);
    // A worker can only talk about a shift they are rostered on.
    if (!shift || (me.role === "staff" && !onIt)) throw errors.notFound("Shift");
    return {
      shift,
      context: {
        kind: "shift",
        id: shift._id,
        label: `${shift.type} · ${prettyDate(shift.date)} ${shift.start}–${shift.end}`,
      },
    };
  }
  if (me.role === "staff")
    throw errors.forbidden("Only the office can start a conversation about a client.");
  if (!Types.ObjectId.isValid(input.id)) throw errors.notFound("Participant");
  const participant = await Participant.findById(input.id)
    .select("name preferred")
    .lean<ParticipantDoc>();
  if (!participant) throw errors.notFound("Participant");
  return {
    shift: null,
    context: {
      kind: "participant",
      id: String(participant._id),
      label: participant.preferred || participant.name,
    },
  };
}

async function audienceIds(audience: AnnouncementAudience): Promise<string[]> {
  const filter: Record<string, unknown> = { status: "active" };
  if (audience === "workers") filter.role = "staff";
  if (audience === "office") filter.role = { $ne: "staff" };
  const users = await User.find(filter)
    .select("_id")
    .lean<Array<{ _id: Types.ObjectId }>>();
  return users.map(user => String(user._id));
}

const AUDIENCE_LABEL: Record<AnnouncementAudience, string> = {
  everyone: "everyone",
  workers: "all support workers",
  office: "the office team",
};

/**
 * Starts a conversation with its first message. Writing to someone you already have a direct
 * conversation with continues that one, so two people never end up with two threads.
 */
export async function createConversation(
  input: z.output<typeof conversationCreateSchema>,
  me: Me
): Promise<ConversationDTO> {
  const allowed = new Map(
    (await reachable(me)).map(person => [String(person._id), person])
  );
  const wanted = [...new Set(input.memberIds ?? [])].filter(id => id !== me.id);
  const { context, shift } = await resolveContext(input.context, me);
  const firstPage = { limit: 50 };

  if (input.kind === "direct") {
    if (wanted.length !== 1 || !allowed.has(wanted[0]))
      throw errors.validation("Choose one person to write to.", [
        { path: "memberIds", message: "Choose who to write to." },
      ]);
    const directKey = [me.id, wanted[0]].sort().join(":");
    let conversation = await Conversation.findOne({
      directKey,
    }).lean<ConversationDoc>();
    if (!conversation) {
      try {
        const created = await Conversation.create({
          kind: "direct",
          members: [me.id, wanted[0]].map(userId => ({
            userId,
            lastReadAt: null,
          })),
          directKey,
          context: null,
          lastMessageAt: new Date(),
          createdBy: { id: me.id, name: me.name },
        });
        conversation = created.toObject<ConversationDoc>();
      } catch (error) {
        // The other person started the same conversation a moment ago: use theirs.
        if (!isDuplicateKey(error)) throw error;
        conversation = await Conversation.findOne({
          directKey,
        }).lean<ConversationDoc>();
        if (!conversation) throw error;
      }
    }
    // Two people have one thread, so what this message is about travels with the message.
    await append(conversation, me, input.body, context);
    return getConversation(String(conversation._id), me, firstPage);
  }

  let memberIds: string[];
  let title = input.title?.trim() ?? "";
  if (input.kind === "announcement") {
    if (!canAnnounce(me))
      throw errors.forbidden(
        "Only people who manage the team can send an announcement."
      );
    const audience = input.audience ?? "everyone";
    memberIds = (await audienceIds(audience)).filter(id => id !== me.id);
    if (!memberIds.length)
      throw errors.invalidState(
        `There is nobody in ${AUDIENCE_LABEL[audience]} with an account yet.`
      );
    title ||= `Announcement to ${AUDIENCE_LABEL[audience]}`;
  } else {
    if (me.role === "staff")
      throw errors.forbidden("Only the office can start a group conversation.");
    memberIds = wanted;
    // A conversation about a shift, with nobody named, is with the workers rostered on it.
    if (!memberIds.length && shift) {
      const workers = await User.find({
        staffId: { $in: shift.staffIds },
        status: "active",
      })
        .select("_id")
        .lean<Array<{ _id: Types.ObjectId }>>();
      memberIds = workers.map(user => String(user._id)).filter(id => id !== me.id);
    }
    if (!memberIds.length || memberIds.some(id => !allowed.has(id)))
      throw errors.validation(
        shift && !wanted.length
          ? "Nobody rostered on this shift has a portal account to message."
          : "Choose at least one person for the group.",
        [{ path: "memberIds", message: "Choose who is in the group." }]
      );
    title ||=
      context?.label ??
      memberIds
        .map(id => allowed.get(id)!.name.split(/\s+/)[0])
        .slice(0, 4)
        .join(", ");
  }

  const created = await Conversation.create({
    kind: input.kind,
    title,
    audience: input.kind === "announcement" ? (input.audience ?? "everyone") : null,
    members: [me.id, ...memberIds].map(userId => ({ userId, lastReadAt: null })),
    directKey: null,
    context,
    lastMessageAt: new Date(),
    createdBy: { id: me.id, name: me.name },
  });
  const conversation = created.toObject<ConversationDoc>();
  await append(conversation, me, input.body);
  return getConversation(String(conversation._id), me, firstPage);
}
