import { t } from "./language";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

let onUnauthorized: () => void;
export function handleUnauthorized(handler: () => void) {
  onUnauthorized = handler;
}
export const pullPath = "/api/orbia/linkding-import";

function errorMessage(status: number, data: Record<string, unknown>) {
  if (status === 401) return t("errors.signInRequired");
  if (status === 409) return t("errors.staleDashboard");
  if (status === 413) return t("errors.payloadTooLarge");
  if (status === 429) return t("errors.rateLimited");
  if (status === 500) return t("errors.server");
  const field = Object.keys(data || {})[0];
  const fields: Record<string, string> = {
    url: "errors.invalidUrl",
    code: "errors.invalidCode",
    tag_names: "errors.invalidTags",
    title: "errors.invalidTitle",
    name: "errors.invalidName",
    pages: "errors.pageLimit",
    groups: "errors.groupLimit",
    q: "errors.invalidSearch",
    file: "errors.invalidImportFile",
  };
  return t(fields[field] ?? "errors.invalidRequest");
}
export function api<T = void>(path: string, options?: RequestInit, onResponse?: (response: Response) => void): Promise<T>;
export async function api(path: string, options: RequestInit = {}, onResponse?: (response: Response) => void): Promise<unknown> {
  let response;
  try {
    const headers = new Headers(options.headers);
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    response = await fetch(path, {
      credentials: "same-origin",
      ...options,
      headers,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new Error(t("errors.connection"));
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 && !path.startsWith("/auth/")) {
      onUnauthorized();
    }
    let message = errorMessage(response.status, data);
    if (path === pullPath) {
      if (response.status === 400) message = t("linkding.invalidCredentials");
      if (response.status === 422) message = t("linkding.localHttpOnly");
      if (response.status === 409) message = t("linkding.importAlreadyRunning");
      if (response.status === 502) {
        message = t("linkding.importInterrupted");
      }
      if (Number.isInteger(data.changed)) message += " " + t("linkding.importSummary", data);
    }
    throw new ApiError(message, response.status);
  }
  if (response.status === 204) return null;
  onResponse?.(response);
  return response.json();
}
