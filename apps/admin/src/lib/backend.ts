import "server-only";

import { cookies } from "next/headers";

const DEFAULT_BACKEND_URL = "http://127.0.0.1:3010";
const SESSION_COOKIE_NAME = "xiaochuang_session";

export function getBackendBaseUrl() {
  return process.env.BACKEND_BASE_URL || DEFAULT_BACKEND_URL;
}

function joinUrl(base: string, path: string) {
  const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

export async function backendFetch(path: string, init?: RequestInit) {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  const headers = new Headers(init?.headers);
  headers.set("accept", "application/json");

  if (sessionToken) {
    headers.set("cookie", `${SESSION_COOKIE_NAME}=${sessionToken}`);
  }

  return fetch(joinUrl(getBackendBaseUrl(), path), {
    ...init,
    headers,
    cache: "no-store",
  });
}

export async function backendJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await backendFetch(path, init);
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message =
      (data && typeof data.message === "string" && data.message) ||
      (data && typeof data.error === "string" && data.error) ||
      `Backend request failed: ${response.status}`;
    throw new Error(message);
  }

  return data as T;
}
