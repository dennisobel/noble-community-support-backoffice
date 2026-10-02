import crypto from "node:crypto";
import { config } from "../../config";
import { RetryableProviderError } from "../../lib/errors";
import {
  XERO_CONNECTION_ID,
  XeroConnection,
  type XeroConnectionDoc,
} from "../../models";

/*
 * Everything that talks to Xero over the network. The rest of the integration sees only
 * `xeroApi` (calls for the connected organisation) and a few connect-time helpers.
 */

const IDENTITY_URL = "https://identity.xero.com/connect/token";
const AUTHORIZE_URL = "https://login.xero.com/identity/connect/authorize";
const CONNECTIONS_URL = "https://api.xero.com/connections";
const API_URL = "https://api.xero.com/api.xro/2.0";

export const RECONNECT_MESSAGE =
  "Xero no longer accepts the saved sign-in. Reconnect it in Settings → Accounting (Xero).";

/** Xero understood the request and refused it (validation, permissions, expired sign-in). Retrying will not help. */
export class XeroApiError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    /** The saved sign-in is no longer valid, so a person has to connect again. */
    public readonly reconnect = false
  ) {
    super(message);
    this.name = "XeroApiError";
  }
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
const realFetch: Fetch = (input, init) => fetch(input, init);
let fetchImpl: Fetch = realFetch;

/** Tests swap the network for a fake Xero. Pass null to restore the real one. */
export function setXeroFetch(next: Fetch | null): void {
  fetchImpl = next ?? realFetch;
}

/* ───────────── Sealing saved tokens ───────────── */

function sealKey(): Buffer {
  const { xero, auth } = config();
  return crypto
    .createHash("sha256")
    .update(`noble-xero:${xero.tokenKey ?? auth.jwtSecret}`)
    .digest();
}

/** AES-256-GCM, so a copy of the database or a backup cannot be used against the books without the key. */
export function seal(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", sealKey(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body]
    .map(part => part.toString("base64url"))
    .reduce((sealed, part) => `${sealed}.${part}`, "v1");
}

export function unseal(sealed: string): string {
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !body)
    throw new Error("Unreadable Xero token.");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    sealKey(),
    Buffer.from(iv, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(body, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/* ───────────── HTTP plumbing ───────────── */

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

async function readJson(response: Response): Promise<unknown> {
  const raw = await response.text();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** The most useful sentence in a Xero error body: field validation messages first. */
function describe(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const found = body as {
    Elements?: Array<{ ValidationErrors?: Array<{ Message?: string }> }>;
    Message?: string;
    Detail?: string;
    Title?: string;
  };
  const validation = (found.Elements ?? [])
    .flatMap(element => element.ValidationErrors ?? [])
    .map(entry => entry.Message ?? "")
    .filter(Boolean);
  if (validation.length) return [...new Set(validation)].join(" ");
  return found.Message || found.Detail || found.Title || "";
}

async function perform(
  method: string,
  url: string,
  headers: Record<string, string>,
  rawBody?: string
): Promise<{ response: Response; body: unknown }> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method,
      headers: {
        Accept: "application/json",
        ...(rawBody !== undefined && !headers["Content-Type"]
          ? { "Content-Type": "application/json" }
          : {}),
        ...headers,
      },
      body: rawBody,
    });
  } catch (error) {
    throw new RetryableProviderError(
      `Could not reach Xero: ${errorText(error)}`
    );
  }
  return { response, body: await readJson(response) };
}

export async function markNeedsReconnect(reason: string): Promise<void> {
  await XeroConnection.updateOne(
    { _id: XERO_CONNECTION_ID, status: "connected" },
    { $set: { status: "needs-reconnect", lastError: reason.slice(0, 300) } }
  );
}

/** Turns a failed response into the error the caller should throw: retryable, or one a person must act on. */
async function problem(
  response: Response,
  body: unknown,
  signedIn: boolean
): Promise<Error> {
  const detail = describe(body) || `HTTP ${response.status}`;
  if (response.status === 429) {
    const wait = response.headers.get("retry-after");
    return new RetryableProviderError(
      `Xero is rate-limiting requests${wait ? ` (try again in ${wait}s)` : ""}.`
    );
  }
  if (response.status >= 500)
    return new RetryableProviderError(
      `Xero is unavailable (HTTP ${response.status}).`
    );
  if (response.status === 401) {
    if (signedIn) await markNeedsReconnect(detail);
    return new XeroApiError(RECONNECT_MESSAGE, 401, true);
  }
  if (response.status === 403)
    return new XeroApiError(
      `Xero refused the request (${detail}). The app may be missing a permission, so reconnect Xero.`,
      403
    );
  return new XeroApiError(detail, response.status);
}

/* ───────────── Tokens ───────────── */

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

async function tokenRequest(
  form: Record<string, string>
): Promise<TokenResponse> {
  const { clientId, clientSecret } = config().xero;
  if (!clientId || !clientSecret)
    throw new XeroApiError("Xero is not set up on this server yet.");
  const { response, body } = await perform(
    "POST",
    IDENTITY_URL,
    {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    new URLSearchParams(form).toString()
  );
  if (response.status === 429 || response.status >= 500)
    throw new RetryableProviderError(
      `Xero is unavailable (HTTP ${response.status}).`
    );
  if (!response.ok) {
    const data = body as { error?: string; error_description?: string } | null;
    throw new XeroApiError(
      data?.error_description || data?.error || `HTTP ${response.status}`,
      response.status,
      data?.error === "invalid_grant"
    );
  }
  return body as TokenResponse;
}

export function exchangeCode(code: string): Promise<TokenResponse> {
  return tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: config().xero.redirectUri,
  });
}

export function tokenExpiry(tokens: { expires_in: number }): Date {
  return new Date(Date.now() + tokens.expires_in * 1000);
}

/** The id Xero stamps on one sign-in, so we can tell which organisations were just granted. */
export function authEventIdOf(accessToken: string): string | undefined {
  try {
    const payload = JSON.parse(
      Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString("utf8")
    ) as { authentication_event_id?: unknown };
    return typeof payload.authentication_event_id === "string"
      ? payload.authentication_event_id
      : undefined;
  } catch {
    return undefined;
  }
}

export async function requireConnection(): Promise<XeroConnectionDoc> {
  const connection = await XeroConnection.findById(
    XERO_CONNECTION_ID
  ).lean<XeroConnectionDoc>();
  if (!connection || connection.status === "disconnected")
    throw new XeroApiError("Xero is not connected.");
  if (connection.status === "needs-reconnect")
    throw new XeroApiError(RECONNECT_MESSAGE, 401, true);
  return connection;
}

let refreshing: Promise<string> | null = null;

/**
 * A usable access token. Xero rotates the refresh token on every use, so concurrent callers
 * share one refresh, and the new pair is only saved if nobody else rotated it first.
 */
async function tokenFor(
  connection: XeroConnectionDoc,
  force: boolean
): Promise<string> {
  const fresh =
    connection.accessTokenExpiresAt &&
    connection.accessTokenExpiresAt.getTime() - Date.now() > 60_000;
  if (!force && fresh) {
    try {
      return unseal(connection.accessTokenSealed);
    } catch {
      // Unreadable (the sealing key changed): fall through to the refresh below.
    }
  }
  refreshing ??= refresh(connection).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function refresh(connection: XeroConnectionDoc): Promise<string> {
  let refreshToken: string;
  try {
    refreshToken = unseal(connection.refreshTokenSealed);
  } catch {
    await markNeedsReconnect("The saved Xero sign-in could not be read.");
    throw new XeroApiError(RECONNECT_MESSAGE, 401, true);
  }
  let tokens: TokenResponse;
  try {
    tokens = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
  } catch (error) {
    if (error instanceof XeroApiError) {
      // invalid_grant: the refresh token was used elsewhere, expired (60 idle days) or revoked.
      await markNeedsReconnect(error.message);
      throw new XeroApiError(RECONNECT_MESSAGE, 401, true);
    }
    throw error;
  }
  const saved = await XeroConnection.updateOne(
    {
      _id: XERO_CONNECTION_ID,
      refreshTokenSealed: connection.refreshTokenSealed,
    },
    {
      $set: {
        accessTokenSealed: seal(tokens.access_token),
        refreshTokenSealed: seal(tokens.refresh_token),
        accessTokenExpiresAt: tokenExpiry(tokens),
        lastError: "",
      },
    }
  );
  if (!saved.matchedCount) {
    // Another process rotated the token first; use what it saved.
    const latest = await XeroConnection.findById(
      XERO_CONNECTION_ID
    ).lean<XeroConnectionDoc>();
    if (latest?.status === "connected") return unseal(latest.accessTokenSealed);
    throw new XeroApiError(RECONNECT_MESSAGE, 401, true);
  }
  return tokens.access_token;
}

/* ───────────── Calls for the connected organisation ───────────── */

export interface XeroRequest {
  query?: Record<string, string>;
  body?: unknown;
  /** Makes a retried create safe: Xero returns the first result instead of creating twice. */
  idempotencyKey?: string;
}

async function send<T>(
  connection: XeroConnectionDoc,
  method: string,
  url: string,
  options: XeroRequest,
  forceToken: boolean
): Promise<T> {
  const token = await tokenFor(connection, forceToken);
  const { response, body } = await perform(
    method,
    url,
    {
      Authorization: `Bearer ${token}`,
      "xero-tenant-id": connection.tenantId,
      ...(options.idempotencyKey
        ? { "Idempotency-Key": options.idempotencyKey }
        : {}),
    },
    options.body === undefined ? undefined : JSON.stringify(options.body)
  );
  // A token Xero no longer honours: refresh once and try again before giving up.
  if (response.status === 401 && !forceToken)
    return send<T>(connection, method, url, options, true);
  if (!response.ok) throw await problem(response, body, true);
  return body as T;
}

/** Accounting API call for the connected organisation. Throws `XeroApiError` or `RetryableProviderError`. */
export async function xeroApi<T = unknown>(
  method: "GET" | "POST" | "PUT",
  path: string,
  options: XeroRequest = {}
): Promise<T> {
  const connection = await requireConnection();
  const query =
    options.query && Object.keys(options.query).length
      ? `?${new URLSearchParams(options.query)}`
      : "";
  return send<T>(connection, method, `${API_URL}${path}${query}`, options, false);
}

/* ───────────── Connecting and disconnecting ───────────── */

export function authorizeUrl(state: string): string {
  const { clientId, redirectUri, scopes } = config().xero;
  const parts = {
    response_type: "code",
    client_id: clientId ?? "",
    redirect_uri: redirectUri,
    scope: scopes.join(" "),
    state,
  };
  return `${AUTHORIZE_URL}?${Object.entries(parts)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&")}`;
}

export interface XeroConnectionInfo {
  id: string;
  tenantId: string;
  tenantType: string;
  tenantName?: string;
}

export async function listConnections(
  accessToken: string,
  authEventId?: string
): Promise<XeroConnectionInfo[]> {
  const url = authEventId
    ? `${CONNECTIONS_URL}?authEventId=${encodeURIComponent(authEventId)}`
    : CONNECTIONS_URL;
  const { response, body } = await perform("GET", url, {
    Authorization: `Bearer ${accessToken}`,
  });
  if (!response.ok) throw await problem(response, body, false);
  return Array.isArray(body) ? (body as XeroConnectionInfo[]) : [];
}

export async function organisationFor(
  accessToken: string,
  tenantId: string
): Promise<{ Name?: string; ShortCode?: string }> {
  const { response, body } = await perform("GET", `${API_URL}/Organisation`, {
    Authorization: `Bearer ${accessToken}`,
    "xero-tenant-id": tenantId,
  });
  if (!response.ok) throw await problem(response, body, false);
  const found = body as {
    Organisations?: Array<{ Name?: string; ShortCode?: string }>;
  } | null;
  return found?.Organisations?.[0] ?? {};
}

/** Removes the connection on Xero's side too, so the app disappears from the organisation's connected apps. */
export async function dropConnection(): Promise<void> {
  const connection = await requireConnection();
  const token = await tokenFor(connection, false);
  const { response, body } = await perform(
    "DELETE",
    `${CONNECTIONS_URL}/${encodeURIComponent(connection.connectionId)}`,
    { Authorization: `Bearer ${token}` }
  );
  if (!response.ok && response.status !== 404)
    throw await problem(response, body, false);
}
