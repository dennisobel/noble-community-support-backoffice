import { Router, type Request } from "express";
import {
  conversationCreateSchema,
  messageCreateSchema,
  messageListQuery,
} from "@shared/schemas/messages";
import { parse, requireAuth } from "../../lib/http";
import { objectIdParam } from "../../lib/mappers";
import { limiter } from "../../middleware/security";
import {
  createConversation,
  getConversation,
  listConversations,
  markRead,
  messageOptions,
  sendMessage,
  unreadConversations,
  type Me,
} from "./service";

const me = (req: Request): Me => requireAuth(req).user;
const conversationId = (req: Request) =>
  objectIdParam(req, "id", "Conversation");

/**
 * Messages, for every signed-in role: office users and support workers alike. Each person
 * reaches only the conversations they are in.
 */
export function messagesRouter(): Router {
  const router = Router();
  const sending = limiter({
    windowMs: 60_000,
    limit: 40,
    message: "You are sending messages very quickly. Wait a moment.",
  });

  router.get("/", async (req, res) => {
    res.json(await listConversations(me(req)));
  });
  router.post("/", sending, async (req, res) => {
    res
      .status(201)
      .json(
        await createConversation(
          parse(conversationCreateSchema, req.body),
          me(req)
        )
      );
  });
  /* Declared before /:id so neither word is read as a conversation id. */
  router.get("/unread", async (req, res) => {
    res.json({ unread: await unreadConversations(me(req).id) });
  });
  router.get("/options", async (req, res) => {
    res.json(await messageOptions(me(req)));
  });

  router.get("/:id", async (req, res) => {
    res.json(
      await getConversation(
        conversationId(req),
        me(req),
        parse(messageListQuery, req.query)
      )
    );
  });
  router.post("/:id/messages", sending, async (req, res) => {
    res
      .status(201)
      .json(
        await sendMessage(
          conversationId(req),
          me(req),
          parse(messageCreateSchema, req.body).body
        )
      );
  });
  router.post("/:id/read", async (req, res) => {
    await markRead(conversationId(req), me(req));
    res.status(204).end();
  });
  return router;
}
