// PilotReady
// Copyright (c) 2026 Aleksander Kopydłowski. All rights reserved.
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//
// NOTE: licensing stub - to be reviewed/refined later.

// An exam in progress is mirrored to localStorage on every change, so a page
// reload, a closed tab or a dead phone battery does not throw away up to four
// hours of work. The clock keeps running: the deadline is an absolute time.

export type StoredExam<TExam> = {
  exam: TExam;
  /** Absolute local time (ms since epoch) at which the exam auto-submits. */
  deadline: number;
  answers: Record<string, string>;
  flags: string[];
  index: number;
};

const key = (userId: string) => `pilotready:exam:${userId}`;

export function loadStoredExam<TExam>(userId: string): StoredExam<TExam> | null {
  try {
    const raw = window.localStorage.getItem(key(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredExam<TExam>;
    if (!parsed || typeof parsed.deadline !== "number" || !parsed.exam || typeof parsed.answers !== "object") return null;
    return { ...parsed, flags: Array.isArray(parsed.flags) ? parsed.flags : [], index: Number(parsed.index) || 0 };
  } catch {
    return null;
  }
}

export function saveStoredExam<TExam>(userId: string, state: StoredExam<TExam>): void {
  try {
    window.localStorage.setItem(key(userId), JSON.stringify(state));
  } catch {
    /* storage full or unavailable - the exam still works, just without resume */
  }
}

export function clearStoredExam(userId: string): void {
  try {
    window.localStorage.removeItem(key(userId));
  } catch {
    /* nothing to clear */
  }
}

export function hasExamInProgress(userId: string): boolean {
  return loadStoredExam<unknown>(userId) !== null;
}
