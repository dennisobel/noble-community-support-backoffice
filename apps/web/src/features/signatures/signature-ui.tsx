import { CalendarDays, CheckSquare, PenLine, Type } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  SignatureDisplayStatus,
  SignatureFieldType,
  SignerStatus,
  SigningState,
} from "@shared/enums";

export const FIELD_ICON: Record<SignatureFieldType, LucideIcon> = {
  signature: PenLine,
  date: CalendarDays,
  text: Type,
  checkbox: CheckSquare,
};

export const FIELD_NAME: Record<SignatureFieldType, string> = {
  signature: "Signature",
  date: "Date",
  text: "Text",
  checkbox: "Checkbox",
};

export const FIELD_HELP: Record<SignatureFieldType, string> = {
  signature: "The person draws or types their signature.",
  date: "Filled in with the day they sign. They cannot change it.",
  text: "A line they type, such as their full name or address.",
  checkbox: "A tick, such as agreeing to a statement.",
};

/** One colour per signer, so whose box is whose can be told at a glance. */
export const SIGNER_COLOURS = [
  { line: "#147f79", fill: "rgba(20,127,121,.16)", text: "#0d5c57" },
  { line: "#7a4fd1", fill: "rgba(122,79,209,.15)", text: "#5b36a8" },
  { line: "#c27a12", fill: "rgba(194,122,18,.17)", text: "#8d5608" },
  { line: "#c2415d", fill: "rgba(194,65,93,.14)", text: "#9a2c45" },
  { line: "#2a6fd6", fill: "rgba(42,111,214,.14)", text: "#1c52a3" },
  { line: "#4c8c2b", fill: "rgba(76,140,43,.16)", text: "#356a1c" },
] as const;
export const colourAt = (index: number) =>
  SIGNER_COLOURS[Math.max(0, index) % SIGNER_COLOURS.length];

export const STATUS_LABEL: Record<SignatureDisplayStatus, string> = {
  draft: "Draft",
  sent: "Out for signature",
  completed: "Signed",
  declined: "Declined",
  cancelled: "Cancelled",
  expired: "Expired",
};

const STATUS_CLASS: Record<SignatureDisplayStatus, string> = {
  draft: "badge-draft",
  sent: "badge-submitted",
  completed: "badge-approved",
  declined: "badge-danger",
  cancelled: "badge-danger",
  expired: "badge-returned",
};

export function SignatureStatusBadge({
  status,
}: {
  status: SignatureDisplayStatus;
}) {
  return (
    <span className={`badge ${STATUS_CLASS[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export const SIGNER_STATUS_LABEL: Record<SignerStatus, string> = {
  pending: "Not opened yet",
  viewed: "Opened, not signed",
  signed: "Signed",
  declined: "Declined",
};

export const SIGNER_STATUS_CLASS: Record<SignerStatus, string> = {
  pending: "badge-draft",
  viewed: "badge-submitted",
  signed: "badge-approved",
  declined: "badge-danger",
};

export const STATE_TITLE: Record<Exclude<SigningState, "open">, string> = {
  signed: "Thank you, you have signed",
  completed: "This document has been signed",
  declined: "This document was declined",
  cancelled: "This request was cancelled",
  expired: "This link has expired",
};

/**
 * Whether a signer is the person looking at the screen. They added themselves with "Add me"; for
 * requests made before that was recorded, the signer's email being their own says the same.
 */
export function isMySigner(
  signer: { userId?: string | null; email: string },
  me: { id: string; email: string } | null | undefined
): boolean {
  if (!me) return false;
  if (signer.userId) return signer.userId === me.id;
  const email = signer.email.trim().toLowerCase();
  return Boolean(email) && email === me.email.trim().toLowerCase();
}

/** The secret at the end of a signing link, which is what the signing screen is opened with. */
export const tokenFromUrl = (url: string) => url.split("/sign/")[1] ?? "";

/** "Alex Client" → "AC", for the little round marker on a box. */
export const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join("");

/** Copies text, and says whether it worked (some browsers only allow it on secure pages). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
