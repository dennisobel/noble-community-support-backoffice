import axios, {
  AxiosError,
  type AxiosProgressEvent,
  type AxiosRequestConfig,
} from "axios";
import { API_PREFIX } from "@shared/const";
import type { ApiErrorBody } from "@shared/dto";

/** Error thrown by every API call; `message` is always safe to show to the user. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** Field-level messages keyed by field path (from 422 validation details). */
  fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.details)) return {};
    const result: Record<string, string> = {};
    for (const item of this.details as Array<{
      path?: string;
      message?: string;
    }>) {
      if (item?.path && item.message && !result[item.path])
        result[item.path] = item.message;
    }
    return result;
  }
}

export const errorMessage = (
  error: unknown,
  fallback = "Something went wrong. Try again."
) =>
  error instanceof ApiError
    ? error.message
    : error instanceof Error && error.message
      ? error.message
      : fallback;

type RequestConfig = AxiosRequestConfig & {
  _retried?: boolean;
  skipAuthRefresh?: boolean;
};

export const http = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || API_PREFIX,
  withCredentials: true,
  headers: { "X-Requested-With": "XMLHttpRequest" },
});

const NO_REFRESH = [
  "/auth/login",
  "/auth/signup",
  "/auth/refresh",
  "/auth/logout",
  "/auth/forgot-password",
  "/auth/reset-password",
  "/auth/demo",
  "/auth/bootstrap",
];

let refreshing: Promise<boolean> | null = null;
let sessionExpired: (() => void) | null = null;

export function onSessionExpired(handler: () => void): () => void {
  sessionExpired = handler;
  return () => {
    if (sessionExpired === handler) sessionExpired = null;
  };
}

/** One refresh at a time: concurrent 401s wait for the same rotation. */
export function refreshSession(): Promise<boolean> {
  if (!refreshing) {
    refreshing = http
      .post("/auth/refresh", undefined, {
        skipAuthRefresh: true,
      } as RequestConfig)
      .then(() => true)
      .catch(() => false)
      .finally(() => {
        setTimeout(() => {
          refreshing = null;
        }, 0);
      });
  }
  return refreshing;
}

function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (axios.isAxiosError(error)) {
    const body = error.response?.data as ApiErrorBody | Blob | undefined;
    if (
      body &&
      !(body instanceof Blob) &&
      typeof body === "object" &&
      "error" in body &&
      body.error
    ) {
      return new ApiError(
        error.response!.status,
        body.error.code,
        body.error.message,
        body.error.details
      );
    }
    if (!error.response)
      return new ApiError(
        0,
        "NETWORK",
        "Can't reach the server. Check your connection and try again."
      );
    if (error.response.status === 413)
      return new ApiError(
        413,
        "PAYLOAD_TOO_LARGE",
        "That file is too large to upload."
      );
    return new ApiError(
      error.response.status,
      "INTERNAL",
      "Something went wrong. Try again."
    );
  }
  return new ApiError(
    0,
    "INTERNAL",
    error instanceof Error ? error.message : "Something went wrong. Try again."
  );
}

http.interceptors.response.use(
  response => response,
  async (error: AxiosError) => {
    const config = error.config as RequestConfig | undefined;
    const url = config?.url ?? "";
    if (
      error.response?.status === 401 &&
      config &&
      !config._retried &&
      !config.skipAuthRefresh &&
      !NO_REFRESH.some(path => url.startsWith(path))
    ) {
      config._retried = true;
      if (await refreshSession()) return http(config);
      sessionExpired?.();
    }
    // Blob responses carry JSON errors as blobs; decode them so callers get a real message.
    if (
      error.response?.data instanceof Blob &&
      error.response.data.type.includes("json")
    ) {
      try {
        error.response.data = JSON.parse(await error.response.data.text());
      } catch {
        /* keep the generic error */
      }
    }
    throw toApiError(error);
  }
);

export const api = {
  get: <T>(url: string, params?: object) =>
    http.get<T>(url, { params }).then(response => response.data),
  post: <T>(url: string, body?: unknown) =>
    http.post<T>(url, body ?? {}).then(response => response.data),
  put: <T>(url: string, body?: unknown) =>
    http.put<T>(url, body ?? {}).then(response => response.data),
  patch: <T>(url: string, body?: unknown) =>
    http.patch<T>(url, body ?? {}).then(response => response.data),
  delete: <T = void>(url: string) =>
    http.delete<T>(url).then(response => response.data),
  upload: <T>(
    url: string,
    form: FormData,
    onProgress?: (percent: number) => void,
    method: "post" | "put" = "post"
  ) =>
    http
      .request<T>({
        url,
        method,
        data: form,
        onUploadProgress: (event: AxiosProgressEvent) => {
          if (onProgress && event.total)
            onProgress(Math.round((event.loaded / event.total) * 100));
        },
      })
      .then(response => response.data),
};

/** Fetches a protected file (with the normal refresh handling) as a Blob. */
export async function fetchBlob(
  url: string,
  params?: object
): Promise<{ blob: Blob; filename: string | null }> {
  const response = await http.get<Blob>(url, { params, responseType: "blob" });
  const disposition = String(response.headers["content-disposition"] ?? "");
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  const plain = /filename="([^"]+)"/i.exec(disposition)?.[1];
  return {
    blob: response.data,
    filename: encoded ? decodeURIComponent(encoded) : (plain ?? null),
  };
}

export async function downloadFile(
  url: string,
  fallbackName: string,
  params?: object
): Promise<void> {
  const { blob, filename } = await fetchBlob(url, params);
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename ?? fallbackName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
}

export async function openFile(url: string, params?: object): Promise<void> {
  // Open the tab synchronously so pop-up blockers allow it, then point it at the downloaded file.
  const tab = window.open("", "_blank");
  try {
    const { blob } = await fetchBlob(url, params);
    const href = URL.createObjectURL(blob);
    if (tab) tab.location.href = href;
    else window.location.href = href;
    setTimeout(() => URL.revokeObjectURL(href), 5 * 60_000);
  } catch (error) {
    tab?.close();
    throw error;
  }
}
