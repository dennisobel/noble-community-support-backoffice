import nodemailer, { type Transporter } from "nodemailer";
import { config } from "../config";
import { errors } from "./errors";
import { logger } from "./logger";

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  const mail = config().mail;
  if (!mail.enabled) return null;
  if (!transporter) {
    transporter = mail.url
      ? nodemailer.createTransport(mail.url)
      : nodemailer.createTransport({
          host: mail.host,
          port: mail.port,
          secure: mail.secure,
          auth: mail.user ? { user: mail.user, pass: mail.pass } : undefined,
        });
  }
  return transporter;
}

export function emailEnabled(): boolean {
  return config().mail.enabled;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer;
    contentType: string;
  }>;
}

/** Sends an email. Returns false (and logs) when SMTP is not configured; throws 502 when delivery fails. */
export async function sendMail(message: MailMessage): Promise<boolean> {
  const transport = getTransporter();
  if (!transport) {
    logger().warn(
      { subject: message.subject },
      "SMTP is not configured; email not sent"
    );
    return false;
  }
  try {
    await transport.sendMail({ from: config().mail.from, ...message });
    return true;
  } catch (error) {
    logger().error(
      { err: error, subject: message.subject },
      "Email delivery failed"
    );
    throw errors.provider(
      "The email could not be sent. Check the mail settings and try again."
    );
  }
}

/** Test hook: forget the cached transport so a new configuration takes effect. */
export function resetMailer(): void {
  transporter = null;
}
