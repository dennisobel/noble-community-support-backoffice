import { emailEnabled, sendMail } from "../../lib/mailer";
import { logger } from "../../lib/logger";
import { getWorkspace } from "../../lib/workspace";
import { User, type SignatureRequestDoc, type SignerSub } from "../../models";
import { COPY_LINK_DAYS, signUrlFor } from "./shared";

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Sends are best effort: no mail server, or one that is down, never stops a request being sent. */
async function attempt(
  message: Parameters<typeof sendMail>[0]
): Promise<boolean> {
  if (!emailEnabled()) return false;
  try {
    return await sendMail(message);
  } catch (error) {
    logger().warn(
      { err: error, subject: message.subject },
      "Signing email failed"
    );
    return false;
  }
}

/** Emails one signer their private link. Returns whether an email actually went out. */
export async function emailSigner(
  doc: SignatureRequestDoc,
  signer: SignerSub,
  kind: "request" | "reminder"
): Promise<boolean> {
  if (!signer.email || !signer.token) return false;
  const sender = (await getWorkspace()).name;
  const link = signUrlFor(signer.token);
  const note = doc.message?.trim();
  const expires = doc.expiresAt
    ? ` The link works until ${doc.expiresAt.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })}.`
    : "";
  const subject = `${kind === "reminder" ? "Reminder: " : ""}${sender} asked you to sign "${doc.title}"`;
  const text = [
    `Hi ${signer.name},`,
    "",
    `${sender} has sent you "${doc.title}" to sign. You do not need an account: open the link, read the document, and sign on the highlighted boxes.`,
    note ? `\nMessage from ${sender}:\n${note}\n` : "",
    link,
    "",
    `Only you should use this link.${expires}`,
  ].join("\n");
  const html = `<p>Hi ${escapeHtml(signer.name)},</p><p>${escapeHtml(sender)} has sent you <strong>${escapeHtml(doc.title)}</strong> to sign. You do not need an account: open the link, read the document, and sign on the highlighted boxes.</p>${note ? `<blockquote>${escapeHtml(note)}</blockquote>` : ""}<p><a href="${link}">Open the document</a></p><p>Only you should use this link.${escapeHtml(expires)}</p>`;
  return attempt({ to: signer.email, subject, text, html });
}

/** Tells everyone involved the document is finished and where to get their copy. */
export async function emailCompleted(doc: SignatureRequestDoc): Promise<void> {
  const subject = `Signed: "${doc.title}"`;
  for (const signer of doc.signers) {
    if (!signer.email || !signer.token) continue;
    // The sender who signed it themselves gets the one email below, not two.
    if (signer.userId && signer.userId === doc.createdBy?.id) continue;
    const link = signUrlFor(signer.token);
    await attempt({
      to: signer.email,
      subject,
      text: `Hi ${signer.name},\n\nEveryone has signed "${doc.title}". You can download your copy here for the next ${COPY_LINK_DAYS} days:\n\n${link}\n`,
      html: `<p>Hi ${escapeHtml(signer.name)},</p><p>Everyone has signed <strong>${escapeHtml(doc.title)}</strong>. You can download your copy for the next ${COPY_LINK_DAYS} days:</p><p><a href="${link}">Download the signed copy</a></p>`,
    });
  }
  const creator = doc.createdBy
    ? await User.findById(doc.createdBy.id)
        .select("email name")
        .lean<{ email: string; name: string }>()
    : null;
  if (creator?.email)
    await attempt({
      to: creator.email,
      subject,
      text: `Hi ${creator.name},\n\nEveryone has signed "${doc.title}". The signed copy is under Signatures.\n`,
      html: `<p>Hi ${escapeHtml(creator.name)},</p><p>Everyone has signed <strong>${escapeHtml(doc.title)}</strong>. The signed copy is under Signatures.</p>`,
    });
}
