import path from "node:path";
import { z } from "zod";
import { DEFAULT_TIMEZONE } from "@shared/const";
import { isValidTimeZone } from "@shared/logic/time";

const DEV_JWT_SECRET = "dev-only-insecure-secret-change-me-0123456789abcdef";
// The least Noble needs from a Xero organisation: invoices, payments, contacts and the chart of accounts.
const DEFAULT_XERO_SCOPES =
  "offline_access accounting.invoices accounting.payments accounting.contacts accounting.settings";

const bool = z
  .enum(["true", "false", "1", "0", "yes", "no", ""])
  .transform(value => value === "true" || value === "1" || value === "yes");

const optionalString = z
  .string()
  .optional()
  .transform(value => (value && value.trim() ? value.trim() : undefined));

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4100),
  APP_URL: z.url().default("http://localhost:5173"),
  ALLOWED_ORIGINS: z.string().default(""),
  APP_TIMEZONE: z
    .string()
    .refine(isValidTimeZone, { error: "APP_TIMEZONE must be an IANA timezone" })
    .default(DEFAULT_TIMEZONE),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  LOG_PRETTY: bool.default(false),
  // The API is only reachable through the reverse proxy on a private Docker network.
  TRUST_PROXY: z.string().default("loopback, linklocal, uniquelocal"),

  MONGO_URI: z
    .string()
    .min(1)
    .default("mongodb://127.0.0.1:27017/noble?directConnection=true"),

  JWT_ACCESS_SECRET: z.string().default(DEV_JWT_SECRET),
  ACCESS_TTL_MINUTES: z.coerce.number().int().min(1).max(120).default(15),
  REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(14),
  COOKIE_SECURE: bool.optional(),
  COOKIE_DOMAIN: optionalString,
  PASSWORD_MIN_LENGTH: z.coerce.number().int().min(8).max(64).default(8),
  LOGIN_MAX_FAILURES: z.coerce.number().int().min(1).max(50).default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  SETUP_CODE: optionalString,
  ALLOW_OPEN_SETUP: bool.default(false),

  UPLOADS_DIR: z.string().default("./data/uploads"),
  MAX_DOC_MB: z.coerce.number().min(1).max(200).default(25),
  MAX_AUDIO_MB: z.coerce.number().min(1).max(500).default(50),
  MAX_FILES_PER_REQUEST: z.coerce.number().int().min(1).max(50).default(10),

  SMTP_URL: optionalString,
  SMTP_HOST: optionalString,
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_SECURE: bool.default(false),
  SMTP_USER: optionalString,
  SMTP_PASS: optionalString,
  MAIL_FROM: z
    .string()
    .default("Noble Community Support <no-reply@noble.local>"),

  STT_PROVIDER: z.enum(["mock", "openai"]).default("mock"),
  STT_BASE_URL: z.url().default("https://api.openai.com/v1"),
  STT_API_KEY: optionalString,
  STT_MODEL: z.string().default("whisper-1"),
  STT_LANGUAGE: z.string().default("en"),

  NOTE_PROVIDER: z.enum(["mock", "anthropic"]).default("mock"),
  ANTHROPIC_API_KEY: optionalString,
  NOTE_MODEL: z.string().default("claude-opus-5-5"),
  NOTE_FALLBACKS: bool.default(true),

  XERO_CLIENT_ID: optionalString,
  XERO_CLIENT_SECRET: optionalString,
  XERO_REDIRECT_URI: optionalString,
  XERO_SCOPES: z.string().default(DEFAULT_XERO_SCOPES),
  XERO_TOKEN_KEY: optionalString,

  SEED_DEMO_DATA: bool.default(false),
  DEMO_ENABLED: bool.default(false),
  DEMO_ADMIN_EMAIL: z.string().default("admin@noble.local"),
  DEMO_ADMIN_PASSWORD: optionalString,

  RATE_LIMIT_ENABLED: bool.default(true),
  JOBS_ENABLED: bool.default(true),
  STATIC_DIR: optionalString,
});

export type Config = ReturnType<typeof buildConfig>;

function buildConfig(env: z.output<typeof envSchema>) {
  const production = env.NODE_ENV === "production";
  const appOrigin = new URL(env.APP_URL).origin;
  const allowedOrigins = new Set(
    [
      appOrigin,
      ...env.ALLOWED_ORIGINS.split(",")
        .map(origin => origin.trim())
        .filter(Boolean),
    ].map(origin => new URL(origin).origin)
  );
  return {
    env: env.NODE_ENV,
    production,
    test: env.NODE_ENV === "test",
    port: env.PORT,
    appUrl: env.APP_URL.replace(/\/+$/, ""),
    allowedOrigins,
    timezone: env.APP_TIMEZONE,
    logLevel: env.LOG_LEVEL,
    logPretty: env.LOG_PRETTY,
    trustProxy: env.TRUST_PROXY,
    mongoUri: env.MONGO_URI,
    auth: {
      jwtSecret: env.JWT_ACCESS_SECRET,
      accessTtlMinutes: env.ACCESS_TTL_MINUTES,
      refreshTtlDays: env.REFRESH_TTL_DAYS,
      cookieSecure: env.COOKIE_SECURE ?? production,
      cookieDomain: env.COOKIE_DOMAIN,
      passwordMinLength: env.PASSWORD_MIN_LENGTH,
      loginMaxFailures: env.LOGIN_MAX_FAILURES,
      loginLockMinutes: env.LOGIN_LOCK_MINUTES,
      setupCode: env.SETUP_CODE,
    },
    uploads: {
      dir: path.resolve(env.UPLOADS_DIR),
      maxDocBytes: Math.round(env.MAX_DOC_MB * 1024 * 1024),
      maxAudioBytes: Math.round(env.MAX_AUDIO_MB * 1024 * 1024),
      maxFilesPerRequest: env.MAX_FILES_PER_REQUEST,
    },
    mail: {
      url: env.SMTP_URL,
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
      from: env.MAIL_FROM,
      enabled: Boolean(env.SMTP_URL || env.SMTP_HOST),
    },
    stt: {
      provider: env.STT_PROVIDER,
      baseUrl: env.STT_BASE_URL.replace(/\/+$/, ""),
      apiKey: env.STT_API_KEY,
      model: env.STT_MODEL,
      language: env.STT_LANGUAGE,
    },
    notes: {
      provider: env.NOTE_PROVIDER,
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.NOTE_MODEL,
      fallbacks: env.NOTE_FALLBACKS,
    },
    xero: {
      clientId: env.XERO_CLIENT_ID,
      clientSecret: env.XERO_CLIENT_SECRET,
      configured: Boolean(env.XERO_CLIENT_ID && env.XERO_CLIENT_SECRET),
      /** Must match, character for character, the redirect URI registered on the Xero app. */
      redirectUri:
        env.XERO_REDIRECT_URI ??
        `${env.APP_URL.replace(/\/+$/, "")}/api/v1/integrations/xero/callback`,
      scopes: env.XERO_SCOPES.split(/[\s,]+/).filter(Boolean),
      /** Seals the saved Xero tokens in the database. Falls back to the JWT secret. */
      tokenKey: env.XERO_TOKEN_KEY,
    },
    demo: {
      seed: env.SEED_DEMO_DATA,
      enabled: env.DEMO_ENABLED,
      adminEmail: env.DEMO_ADMIN_EMAIL.toLowerCase(),
      adminPassword: env.DEMO_ADMIN_PASSWORD,
    },
    rateLimitEnabled: env.RATE_LIMIT_ENABLED,
    jobsEnabled: env.JOBS_ENABLED,
    staticDir: env.STATIC_DIR ? path.resolve(env.STATIC_DIR) : undefined,
  };
}

/**
 * Parses and validates the environment. Blank values (`KEY=` as copied from .env.example)
 * count as unset so defaults apply. Refuses unsafe production settings.
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const present = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value?.trim())
  );
  const parsed = envSchema.safeParse(present);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map(issue => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  const env = parsed.data;
  const cfg = buildConfig(env);
  if (cfg.production) {
    const problems: string[] = [];
    if (
      env.JWT_ACCESS_SECRET === DEV_JWT_SECRET ||
      env.JWT_ACCESS_SECRET.length < 32
    ) {
      problems.push(
        "JWT_ACCESS_SECRET must be set to at least 32 random characters."
      );
    }
    if (!env.SETUP_CODE && !env.ALLOW_OPEN_SETUP) {
      problems.push(
        "SETUP_CODE is required in production (or set ALLOW_OPEN_SETUP=true)."
      );
    }
    if (env.DEMO_ENABLED || env.SEED_DEMO_DATA)
      problems.push(
        "DEMO_ENABLED and SEED_DEMO_DATA must be false in production."
      );
    if (problems.length)
      throw new Error(
        `Unsafe production configuration:\n  ${problems.join("\n  ")}`
      );
  }
  if (cfg.notes.provider === "anthropic" && !cfg.notes.apiKey) {
    throw new Error("NOTE_PROVIDER=anthropic requires ANTHROPIC_API_KEY.");
  }
  if (Boolean(env.XERO_CLIENT_ID) !== Boolean(env.XERO_CLIENT_SECRET)) {
    throw new Error("Set XERO_CLIENT_ID and XERO_CLIENT_SECRET together.");
  }
  return cfg;
}

let current: Config | null = null;

export function config(): Config {
  if (!current) current = loadConfig();
  return current;
}

export function setConfig(next: Config): void {
  current = next;
}

export const usingDevJwtSecret = (cfg: Config) =>
  cfg.auth.jwtSecret === DEV_JWT_SECRET;
