import { z } from "zod";
import { DOCUMENT_SCOPES } from "../enums";
import {
  objectId,
  optionalYmd,
  requiredText,
  searchText,
  text,
} from "./common";

/** Multipart text fields for an upload. */
export const documentUploadFields = z
  .object({
    scope: z.enum(DOCUMENT_SCOPES),
    participantId: objectId.optional(),
    folderKey: requiredText(40, "Choose a folder."),
    title: text(200).optional(),
    notes: text(1000).optional(),
    docDate: optionalYmd,
  })
  .refine(
    value => value.scope === "organisation" || Boolean(value.participantId),
    {
      error: "Choose the participant this document belongs to.",
      path: ["participantId"],
    }
  );

export const documentPatchSchema = z.object({
  title: requiredText(200, "Enter a document title.").optional(),
  notes: text(1000).optional(),
  folderKey: text(40).optional(),
  docDate: optionalYmd,
});

export const documentListQuery = z.object({
  scope: z.enum(DOCUMENT_SCOPES),
  participantId: objectId.optional(),
  folderKey: text(40).optional(),
  q: searchText,
});
