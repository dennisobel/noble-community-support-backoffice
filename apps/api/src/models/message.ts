import { model, Schema, type Types } from "mongoose";
import {
  ANNOUNCEMENT_AUDIENCES,
  CONVERSATION_KINDS,
  MESSAGE_CONTEXT_TYPES,
  type AnnouncementAudience,
  type ConversationKind,
  type MessageContextType,
} from "@shared/enums";
import { actorSchema, baseOptions, type ActorRefSub } from "./common";

/*
 * In-app messages. A conversation holds who is in it and when each of them last read it;
 * the messages are their own collection so a long thread never makes the conversation heavy.
 * Members are accounts (office users and support workers alike), not staff records.
 */

export interface ConversationMemberSub {
  userId: Types.ObjectId;
  lastReadAt: Date | null;
}

export interface ConversationDoc {
  _id: Types.ObjectId;
  kind: ConversationKind;
  /** A group's name or an announcement's subject. Direct conversations have none. */
  title: string;
  audience: AnnouncementAudience | null;
  members: ConversationMemberSub[];
  /** For a direct conversation: the two user ids in order, so a pair has only one. */
  directKey: string | null;
  /** What a group conversation is about, when it was started from a shift or a client. */
  context: MessageContextSub | null;
  lastMessage: { body: string; senderName: string; sentAt: Date } | null;
  lastMessageAt: Date;
  createdBy: ActorRefSub | null;
  createdAt: Date;
  updatedAt: Date;
}

const conversationContextSchema = new Schema<MessageContextSub>(
  {
    kind: { type: String, enum: MESSAGE_CONTEXT_TYPES, required: true },
    id: { type: String, required: true },
    label: { type: String, default: "" },
  },
  { _id: false }
);

const conversationSchema = new Schema<ConversationDoc>(
  {
    kind: { type: String, enum: CONVERSATION_KINDS, required: true },
    title: { type: String, default: "" },
    audience: {
      type: String,
      enum: [...ANNOUNCEMENT_AUDIENCES, null],
      default: null,
    },
    members: [
      {
        _id: false,
        userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
        lastReadAt: { type: Date, default: null },
      },
    ],
    directKey: { type: String, default: null },
    context: { type: conversationContextSchema, default: null },
    lastMessage: {
      type: new Schema(
        {
          body: { type: String, default: "" },
          senderName: { type: String, default: "" },
          sentAt: { type: Date, required: true },
        },
        { _id: false }
      ),
      default: null,
    },
    lastMessageAt: { type: Date, required: true },
    createdBy: { type: actorSchema, default: null },
  },
  baseOptions
);
conversationSchema.index({ "members.userId": 1, lastMessageAt: -1 });
conversationSchema.index(
  { directKey: 1 },
  { unique: true, partialFilterExpression: { directKey: { $type: "string" } } }
);

export const Conversation = model<ConversationDoc>(
  "Conversation",
  conversationSchema,
  "conversations"
);

/** A shift or client a conversation, or one message in it, is about. */
export interface MessageContextSub {
  /** Stored as `kind` because Mongoose reserves `type` inside a schema. */
  kind: MessageContextType;
  id: string;
  label: string;
}

const contextSchema = new Schema<MessageContextSub>(
  {
    kind: { type: String, enum: MESSAGE_CONTEXT_TYPES, required: true },
    id: { type: String, required: true },
    label: { type: String, default: "" },
  },
  { _id: false }
);

export interface MessageDoc {
  _id: Types.ObjectId;
  conversationId: Types.ObjectId;
  sender: ActorRefSub;
  body: string;
  /** Set when this message was written about a particular shift or client. */
  context: MessageContextSub | null;
  createdAt: Date;
  updatedAt: Date;
}

const messageSchema = new Schema<MessageDoc>(
  {
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
    },
    sender: { type: actorSchema, required: true },
    body: { type: String, required: true },
    context: { type: contextSchema, default: null },
  },
  baseOptions
);
messageSchema.index({ conversationId: 1, createdAt: -1 });

export const Message = model<MessageDoc>("Message", messageSchema, "messages");
