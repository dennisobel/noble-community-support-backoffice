import pino, { type Logger } from "pino";
import { config } from "../config";

let instance: Logger | null = null;

export const REDACT_PATHS = [
  "req.headers.cookie",
  "req.headers.authorization",
  'res.headers["set-cookie"]',
  "*.password",
  "*.currentPassword",
  "*.newPassword",
  "*.token",
  "*.passwordHash",
  "*.tokenHash",
];

export function logger(): Logger {
  if (instance) return instance;
  const cfg = config();
  instance = pino({
    level: cfg.test ? "silent" : cfg.logLevel,
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
    base: { service: "noble-api" },
    ...(cfg.logPretty
      ? {
          transport: {
            target: "pino-pretty",
            options: { colorize: true, translateTime: "SYS:HH:MM:ss" },
          },
        }
      : {}),
  });
  return instance;
}
