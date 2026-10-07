import { z } from "zod";
import {
  ANNOUNCEMENT_AUDIENCES,
  CONVERSATION_KINDS,
  MESSAGE_CONTEXT_TYPES,
} from "../enums";
import { objectId, requiredText, searchText, text } from "./common";

const body = requiredText(4000, "Write a message.");

export const conversationCreateSchema = z.object({
  kind: z.enum(CONVERSATION_KINDS),
  /** The other people: one for a direct conversation, one or more for a group. */
  memberIds: z.array(objectId).max(200).optional(),
  /** Who an announcement goes to. */
  audience: z.enum(ANNOUNCEMENT_AUDIENCES).optional(),
  /** A group's name or an announcement's subject. */
  title: text(120).optional(),
  /** The shift or client the conversation is about. */
  context: z
    .object({ type: z.enum(MESSAGE_CONTEXT_TYPES), id: text(40) })
    .optional(),
  /** The first message. */
  body,
});
export type ConversationCreateInput = z.input<typeof conversationCreateSchema>;

export const messageCreateSchema = z.object({ body });
export type MessageCreateInput = z.input<typeof messageCreateSchema>;

export const messageListQuery = z.object({
  /** Messages older than this instant, for loading further back. */
  before: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const recipientQuery = z.object({ q: searchText });
