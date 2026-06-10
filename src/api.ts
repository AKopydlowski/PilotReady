// PilotReady
// Copyright (c) 2026 PilotReady. All rights reserved.
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//
// NOTE: licensing stub - to be reviewed/refined later.

// Centralized API access: base URL, bearer-token storage, and a fetch wrapper
// that attaches the token and surfaces auth failures.
//
// In development the app talks to the backend through Vite's proxy, so the base
// URL is empty and requests use relative "/api/..." paths. In production the
// frontend (Vercel) and backend (Render) live on different domains, so set
// VITE_API_URL to the backend's public URL at build time.

export const API_BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

const TOKEN_KEY = "pilotready:token";

// Fired when the server rejects our token (401) so the app can log the user out.
export const UNAUTHORIZED_EVENT = "pilotready:unauthorized";

export function getToken(): string | null {
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  window.localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: string,
  ) {
    super(detail);
    this.name = "ApiError";
  }
}

/**
 * fetch() against the API with the bearer token attached and JSON helpers.
 * Throws {@link ApiError} on non-2xx responses; emits {@link UNAUTHORIZED_EVENT}
 * on 401 so the auth layer can drop the session.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });

  if (response.status === 401) {
    clearToken();
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    throw new ApiError(401, "Sesja wygasła — zaloguj się ponownie.");
  }
  return response;
}

/** Like {@link apiFetch} but parses JSON and raises a readable error on failure. */
export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, init);
  if (!response.ok) {
    let detail = `(${response.status})`;
    try {
      const body = await response.json();
      if (body?.detail) detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* non-JSON error body — keep the status code */
    }
    throw new ApiError(response.status, detail);
  }
  return (await response.json()) as T;
}
