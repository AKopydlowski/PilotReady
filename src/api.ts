// PilotReady
// Copyright (c) 2026 Aleksander Kopydłowski. All rights reserved.
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
  // Unsent answers belong to the account that is being signed out.
  window.localStorage.removeItem(OUTBOX_KEY);
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

  // A 401 on a request that carried a token means the session is no longer
  // valid. Without a token it is just a failed login, which the caller reports.
  if (response.status === 401 && token) {
    clearToken();
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    throw new ApiError(401, "session_expired");
  }
  return response;
}

// --- Study progress with an offline outbox ------------------------------------
// Every answer is queued in localStorage first and only removed once the server
// has accepted it. A dropped connection or a sleeping backend therefore never
// loses progress: the queue is retried on the next answer and on app start.
const OUTBOX_KEY = "pilotready:progress-outbox";
const OUTBOX_LIMIT = 500;

type PendingAnswer = { question_id: string; selected_text: string; status: "CORRECT" | "INCORRECT" };

function readOutbox(): PendingAnswer[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(OUTBOX_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeOutbox(queue: PendingAnswer[]): void {
  try {
    if (queue.length) window.localStorage.setItem(OUTBOX_KEY, JSON.stringify(queue.slice(-OUTBOX_LIMIT)));
    else window.localStorage.removeItem(OUTBOX_KEY);
  } catch {
    /* storage full or unavailable - progress falls back to best-effort */
  }
}

let flushing = false;

/** Send queued answers in order; stops at the first one the server cannot take yet. */
export async function flushProgressOutbox(): Promise<void> {
  if (flushing || !getToken()) return;
  flushing = true;
  try {
    for (let queue = readOutbox(); queue.length > 0; queue = readOutbox()) {
      const response = await apiFetch("/api/progress", { method: "POST", body: JSON.stringify(queue[0]) });
      // Server trouble or throttling: keep the answer and try again later.
      if (response.status >= 500 || response.status === 429) return;
      // Accepted - or rejected for good (e.g. the question no longer exists).
      writeOutbox(readOutbox().slice(1));
    }
  } catch {
    /* offline, or the session expired (which already cleared the queue) */
  } finally {
    flushing = false;
  }
}

/** Record a study answer. Returns immediately; delivery is handled by the outbox. */
export function saveProgress(questionId: string, selectedText: string, isCorrect: boolean): void {
  writeOutbox([
    ...readOutbox(),
    { question_id: questionId, selected_text: selectedText, status: isCorrect ? "CORRECT" : "INCORRECT" },
  ]);
  void flushProgressOutbox();
}

// --- Anonymous visit tracking -------------------------------------------------
// A stable per-browser id (uuid) kept in localStorage lets the backend count
// unique visitors without storing any IP / personal data. The per-session flag
// makes sure we record at most one visit per tab open.
const VISITOR_KEY = "pilotready:visitor";
const VISIT_SESSION_FLAG = "pilotready:visit-recorded";

function getVisitorId(): string {
  let id = window.localStorage.getItem(VISITOR_KEY);
  if (!id) {
    id = (window.crypto?.randomUUID?.() ?? `v-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    window.localStorage.setItem(VISITOR_KEY, id);
  }
  return id;
}

/**
 * Record a page visit for analytics, at most once per browser session. Fire and
 * forget — never throws, never blocks the UI, and silently ignores failures
 * (e.g. offline or rate-limited).
 */
export function recordVisit(): void {
  try {
    if (window.sessionStorage.getItem(VISIT_SESSION_FLAG)) return;
    window.sessionStorage.setItem(VISIT_SESSION_FLAG, "1");
    void apiFetch("/api/analytics/visit", {
      method: "POST",
      body: JSON.stringify({ visitor_id: getVisitorId(), path: window.location.pathname }),
    }).catch(() => {
      /* analytics is best-effort; ignore errors */
    });
  } catch {
    /* storage unavailable (private mode etc.) — skip tracking */
  }
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
