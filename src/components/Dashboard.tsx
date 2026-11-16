// PilotReady
// Copyright (c) 2026 Aleksander Kopydłowski. All rights reserved.
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//
// NOTE: licensing stub - to be reviewed/refined later.

import { useEffect, useMemo, useState } from "react";
import { apiJson } from "../api";
import { useI18n } from "../i18n";
import type { Route } from "../router";
import { hasExamInProgress } from "../examStorage";
import { cx, Icon, ProgressBar, ProgressRing, Spinner, SUBJECT_ICON, useSlow, type IconName } from "./ui";

type Category = {
  id: string;
  label: string;
  total: number;
  correct: number;
  incorrect: number;
  unattempted: number;
};

type ExamHistoryItem = {
  exam_id: string;
  finished_at: string;
  duration_seconds: number;
  passed: boolean;
  total_questions: number;
  total_correct: number;
  overall_score_percent: number;
};

type ExamHistory = {
  taken: number;
  passed: number;
  best_score_percent: number | null;
  items: ExamHistoryItem[];
};

// Official ULC paper: questions / minutes per subject (mirrors backend/exam.py).
const EXAM_BLUEPRINT: Record<string, [number, number]> = {
  AIR_LAW: [16, 25],
  AIRCRAFT_GENERAL_KNOWLEDGE: [12, 20],
  FLIGHT_PERFORMANCE_AND_PLANNING: [12, 20],
  HUMAN_PERFORMANCE: [12, 25],
  METEOROLOGY: [16, 30],
  NAVIGATION: [16, 45],
  OPERATIONAL_PROCEDURES: [12, 20],
  PRINCIPLES_OF_FLIGHT: [12, 25],
  COMMUNICATIONS: [12, 20],
};

export const LAST_SUBJECT_KEY = "pilotready:last-subject";

function StatTile({ icon, label, value, hint, tone }: { icon: IconName; label: string; value: string; hint?: string; tone: string }) {
  return (
    <div className="card flex items-center gap-3 p-3.5 sm:gap-4 sm:p-4">
      <span className={cx("grid h-10 w-10 shrink-0 place-items-center rounded-2xl sm:h-11 sm:w-11", tone)}>
        <Icon name={icon} />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-medium leading-tight text-slate-400">{label}</p>
        <p className="text-xl font-bold tabular-nums text-white">{value}</p>
        {hint && <p className="hidden truncate text-[11px] text-slate-500 sm:block">{hint}</p>}
      </div>
    </div>
  );
}

export default function Dashboard({
  userId,
  displayName,
  navigate,
}: {
  userId: string;
  displayName: string | null;
  navigate: (route: Route) => void;
}) {
  const { t, lang } = useI18n();
  const [categories, setCategories] = useState<Category[]>([]);
  const [history, setHistory] = useState<ExamHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const slow = useSlow(loading);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiJson<Category[]>("/api/categories")
      .then((data) => {
        if (!cancelled) setCategories(data);
      })
      .catch((fetchError: Error) => {
        if (!cancelled) setError(fetchError.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    // The exam history is a nice-to-have: never let it block or break the page.
    apiJson<ExamHistory>("/api/exam/history?limit=5")
      .then((data) => {
        if (!cancelled) setHistory(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const totals = useMemo(() => {
    const total = categories.reduce((sum, c) => sum + c.total, 0);
    const correct = categories.reduce((sum, c) => sum + c.correct, 0);
    const incorrect = categories.reduce((sum, c) => sum + c.incorrect, 0);
    return { total, correct, incorrect, percent: total ? Math.round((correct / total) * 100) : 0 };
  }, [categories]);

  // "Continue" goes to the subject studied last; otherwise the first unfinished one.
  const continueSubject = useMemo(() => {
    const unfinished = categories.filter((c) => c.total > 0 && c.correct < c.total);
    let lastId: string | null = null;
    try {
      lastId = window.localStorage.getItem(LAST_SUBJECT_KEY);
    } catch {
      /* storage unavailable */
    }
    return unfinished.find((c) => c.id === lastId) ?? unfinished[0] ?? null;
  }, [categories]);

  const hasStarted = totals.correct + totals.incorrect > 0;
  const examInProgress = hasExamInProgress(userId);
  const firstName = displayName?.trim().split(/\s+/)[0];

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(lang === "pl" ? "pl-PL" : "en-GB", { day: "numeric", month: "short", year: "numeric" });

  if (loading) {
    return (
      <div className="grid min-h-[50vh] place-items-center">
        <div className="flex max-w-sm flex-col items-center gap-4 text-center">
          <Spinner />
          <p className="text-sm text-slate-400">{t("dashboard.loading")}</p>
          {slow && <p className="animate-rise text-xs leading-relaxed text-slate-500">{t("app.coldStart")}</p>}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto mt-10 max-w-md rounded-3xl border border-red-400/30 bg-red-500/5 p-6 text-center">
        <Icon name="alert" className="mx-auto h-8 w-8 text-red-300" />
        <p className="mt-3 text-red-100">{t("dashboard.error", { status: error })}</p>
        <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="btn btn-ghost mt-5">
          <Icon name="refresh" className="h-4 w-4" />
          {t("app.retry")}
        </button>
      </div>
    );
  }

  return (
    <main className="animate-rise">
      {examInProgress && (
        <button
          type="button"
          onClick={() => navigate({ kind: "exam" })}
          className="mb-5 flex w-full items-center justify-between gap-4 rounded-2xl border border-amber-300/40 bg-amber-400/10 px-5 py-4 text-left transition hover:bg-amber-400/15"
        >
          <span className="flex items-center gap-3">
            <Icon name="clock" className="h-5 w-5 text-amber-200" />
            <span>
              <span className="block text-sm font-bold text-amber-100">{t("dashboard.examInProgress")}</span>
              <span className="block text-xs text-amber-200/70">{t("dashboard.examInProgressHint")}</span>
            </span>
          </span>
          <Icon name="chevronRight" className="h-5 w-5 text-amber-200" />
        </button>
      )}

      {/* Hero: overall mastery + the two things a user most likely wants next. */}
      <section className="card overflow-hidden bg-gradient-to-br from-cyan-400/10 via-slate-900/60 to-slate-900/60 p-6 sm:p-8">
        <div className="flex flex-col items-center gap-6 text-center sm:flex-row sm:text-left">
          <ProgressRing value={totals.percent} size={132} stroke={11} tone="cyan" label={t("dashboard.masteryRing", { p: totals.percent })}>
            <div>
              <p className="text-3xl font-black tabular-nums text-white">{totals.percent}%</p>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{t("dashboard.mastered")}</p>
            </div>
          </ProgressRing>
          <div className="min-w-0 flex-1">
            <p className="kicker">{t("dashboard.kicker")}</p>
            <h1 className="mt-2 text-2xl font-bold text-white sm:text-3xl">
              {firstName ? t("dashboard.greeting", { name: firstName }) : t("dashboard.greetingAnon")}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-400 sm:text-base">
              {hasStarted
                ? t("dashboard.heroProgress", { c: totals.correct, t: totals.total, left: totals.total - totals.correct })
                : t("dashboard.heroStart", { t: totals.total })}
            </p>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              {continueSubject && (
                <button
                  type="button"
                  onClick={() => navigate({ kind: "study", categoryId: continueSubject.id })}
                  className="btn btn-primary"
                >
                  <Icon name="book" className="h-4 w-4" />
                  <span className="truncate">
                    {hasStarted ? t("dashboard.continue") : t("dashboard.start")}: {t(`subject.${continueSubject.id}`)}
                  </span>
                </button>
              )}
              <button type="button" onClick={() => navigate({ kind: "exam" })} className="btn btn-ghost">
                <Icon name="exam" className="h-4 w-4" />
                {t("dashboard.examCta")}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label={t("dashboard.statsLabel")}>
        <StatTile
          icon="check"
          tone="bg-emerald-400/15 text-emerald-300"
          label={t("dashboard.statMastered")}
          value={`${totals.correct}`}
          hint={t("dashboard.statOf", { t: totals.total })}
        />
        <StatTile
          icon="refresh"
          tone="bg-red-400/15 text-red-300"
          label={t("dashboard.statMistakes")}
          value={`${totals.incorrect}`}
          hint={totals.incorrect ? t("dashboard.statMistakesHint") : t("dashboard.statMistakesNone")}
        />
        <StatTile
          icon="exam"
          tone="bg-cyan-300/15 text-cyan-200"
          label={t("dashboard.statExams")}
          value={history ? `${history.passed}/${history.taken}` : "–"}
          hint={t("dashboard.statExamsHint")}
        />
        <StatTile
          icon="trophy"
          tone="bg-amber-300/15 text-amber-200"
          label={t("dashboard.statBest")}
          value={history?.best_score_percent != null ? `${history.best_score_percent}%` : "–"}
          hint={t("dashboard.statBestHint")}
        />
      </section>

      <section className="mt-10">
        <div className="mb-4 flex items-end justify-between gap-3">
          <h2 className="kicker">{t("dashboard.subjectsHeading")}</h2>
          <p className="text-xs text-slate-500">{t("dashboard.subjectsHint")}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((category) => {
            const percent = category.total ? Math.round((category.correct / category.total) * 100) : 0;
            const wrongPercent = category.total ? (category.incorrect / category.total) * 100 : 0;
            const done = category.total > 0 && category.correct === category.total;
            const blueprint = EXAM_BLUEPRINT[category.id];
            return (
              <button
                key={category.id}
                type="button"
                onClick={() => navigate({ kind: "study", categoryId: category.id })}
                className="card group flex flex-col p-5 text-left transition duration-200 hover:-translate-y-0.5 hover:border-cyan-300/50 hover:bg-slate-900/80"
              >
                <div className="flex items-start gap-3">
                  <span
                    className={cx(
                      "grid h-11 w-11 shrink-0 place-items-center rounded-2xl transition",
                      done ? "bg-emerald-400/15 text-emerald-300" : "bg-cyan-300/10 text-cyan-200 group-hover:bg-cyan-300/20",
                    )}
                  >
                    <Icon name={done ? "check" : (SUBJECT_ICON[category.id] ?? "book")} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold leading-snug text-white">{t(`subject.${category.id}`)}</h3>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {blueprint ? t("dashboard.examMeta", { q: blueprint[0], m: blueprint[1] }) : t("dashboard.extraMaterial")}
                    </p>
                  </div>
                  <span className="text-lg font-bold tabular-nums text-white">{percent}%</span>
                </div>
                <ProgressBar value={percent} secondary={wrongPercent} tone="gradient" className="mt-4" />
                <div className="mt-3 flex items-center justify-between gap-2 text-xs">
                  <span className="text-slate-400">{t("dashboard.cardMastered", { c: category.correct, t: category.total })}</span>
                  {category.incorrect > 0 && (
                    <span className="rounded-full bg-red-500/15 px-2 py-0.5 font-semibold text-red-300">
                      {t("dashboard.cardMistakes", { n: category.incorrect })}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Mistakes review: per subject, plus everything at once. */}
      <section className="mt-10">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="kicker">{t("dashboard.mistakesCard")}</h2>
          {totals.incorrect > 0 && (
            <button type="button" onClick={() => navigate({ kind: "review" })} className="btn btn-danger btn-sm">
              <Icon name="refresh" className="h-4 w-4" />
              {t("dashboard.mistakesStart")} ({totals.incorrect})
            </button>
          )}
        </div>
        {totals.incorrect === 0 ? (
          <p className="flex items-center gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-5 text-sm text-emerald-200">
            <Icon name="check" className="h-5 w-5" />
            {hasStarted ? t("dashboard.mistakesCardEmpty") : t("dashboard.mistakesCardFresh")}
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {categories
              .filter((category) => category.incorrect > 0)
              .map((category) => (
                <button
                  key={`mistakes-${category.id}`}
                  type="button"
                  onClick={() => navigate({ kind: "review", categoryId: category.id })}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-red-400/25 bg-red-500/5 px-4 py-3 text-left transition hover:-translate-y-0.5 hover:border-red-300/60"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <Icon name={SUBJECT_ICON[category.id] ?? "book"} className="h-4 w-4 text-red-300" />
                    <span className="truncate text-sm font-semibold text-white">{t(`subject.${category.id}`)}</span>
                  </span>
                  <span className="shrink-0 rounded-full bg-red-500/20 px-2.5 py-1 text-xs font-bold tabular-nums text-red-300">
                    {category.incorrect}
                  </span>
                </button>
              ))}
          </div>
        )}
      </section>

      {history && history.items.length > 0 && (
        <section className="mt-10">
          <h2 className="kicker mb-4">{t("dashboard.recentExams")}</h2>
          <ul className="card divide-y divide-white/5">
            {history.items.map((item) => (
              <li key={item.exam_id} className="flex items-center gap-4 px-5 py-3.5">
                <span
                  className={cx(
                    "grid h-9 w-9 shrink-0 place-items-center rounded-xl",
                    item.passed ? "bg-emerald-400/15 text-emerald-300" : "bg-red-500/15 text-red-300",
                  )}
                >
                  <Icon name={item.passed ? "check" : "x"} className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-white">{item.passed ? t("result.passed") : t("result.failed")}</p>
                  <p className="text-xs text-slate-500">
                    {formatDate(item.finished_at)} · {t("dashboard.examDuration", { m: Math.max(1, Math.round(item.duration_seconds / 60)) })}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-sm font-bold tabular-nums text-white">{item.overall_score_percent}%</p>
                  <p className="text-xs tabular-nums text-slate-500">
                    {item.total_correct}/{item.total_questions}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
