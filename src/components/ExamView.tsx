// PilotReady
// Copyright (c) 2026 Aleksander Kopydłowski. All rights reserved.
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//
// NOTE: licensing stub - to be reviewed/refined later.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, apiFetch, apiJson } from "../api";
import { clearStoredExam, loadStoredExam, saveStoredExam } from "../examStorage";
import { useI18n } from "../i18n";
import type { Route } from "../router";
import { cx, Icon, Modal, ProgressBar, ProgressRing, RichText, Spinner, SUBJECT_ICON, useSlow } from "./ui";

// --------------------------------------------------------------------------- //
// API contract — mirrors backend/exam.py
// --------------------------------------------------------------------------- //
type ExamAnswerOption = {
  key: string;
  text: string;
};

type ExamQuestion = {
  id: string;
  external_id: string;
  category: string;
  question_text: string;
  answers: ExamAnswerOption[];
};

type ExamSection = {
  category: string;
  label: string;
  question_count: number;
  duration_minutes: number;
  duration_seconds: number;
  questions: ExamQuestion[];
};

type ExamStartResponse = {
  exam_id: string;
  total_questions: number;
  total_duration_minutes: number;
  total_duration_seconds: number;
  pass_threshold_percent: number;
  sections: ExamSection[];
};

type SectionResult = {
  category: string;
  label: string;
  question_count: number;
  answered: number;
  correct: number;
  score_percent: number;
  passed: boolean;
};

type QuestionResult = {
  question_id: string;
  category: string;
  selected_text: string | null;
  correct_answer: string;
  is_correct: boolean;
  answered: boolean;
};

type ExamSubmitResponse = {
  exam_id: string | null;
  passed: boolean;
  pass_threshold_percent: number;
  total_questions: number;
  total_correct: number;
  overall_score_percent: number;
  sections: SectionResult[];
  results: QuestionResult[];
};

type FlatQuestion = {
  globalIndex: number;
  sectionIndex: number;
  sectionCategory: string;
  question: ExamQuestion;
};

type ExamPhase = "intro" | "starting" | "active" | "submitting" | "submitError" | "finished";

type ExamViewProps = {
  userId: string;
  navigate: (route: Route) => void;
};

type Translate = (key: string, vars?: Record<string, string | number>) => string;

// Official ULC paper, shown on the intro screen before anything is loaded.
const BLUEPRINT: Array<[string, number, number]> = [
  ["AIR_LAW", 16, 25],
  ["AIRCRAFT_GENERAL_KNOWLEDGE", 12, 20],
  ["FLIGHT_PERFORMANCE_AND_PLANNING", 12, 20],
  ["HUMAN_PERFORMANCE", 12, 25],
  ["METEOROLOGY", 16, 30],
  ["NAVIGATION", 16, 45],
  ["OPERATIONAL_PROCEDURES", 12, 20],
  ["PRINCIPLES_OF_FLIGHT", 12, 25],
  ["COMMUNICATIONS", 12, 20],
];
const BLUEPRINT_QUESTIONS = BLUEPRINT.reduce((sum, [, count]) => sum + count, 0);
const BLUEPRINT_MINUTES = BLUEPRINT.reduce((sum, [, , minutes]) => sum + minutes, 0);

// --------------------------------------------------------------------------- //
// Helpers
// --------------------------------------------------------------------------- //
function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const pad = (value: number) => value.toString().padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

// --------------------------------------------------------------------------- //
// Component
// --------------------------------------------------------------------------- //
export function ExamView({ userId, navigate }: ExamViewProps) {
  const { t } = useI18n();

  // Resume an exam left in progress (reload, closed tab) - the clock kept running.
  const stored = useMemo(() => loadStoredExam<ExamStartResponse>(userId), [userId]);

  const [exam, setExam] = useState<ExamStartResponse | null>(stored?.exam ?? null);
  const [deadline, setDeadline] = useState<number>(stored?.deadline ?? 0);
  const [phase, setPhase] = useState<ExamPhase>(stored ? "active" : "intro");
  const [error, setError] = useState<string | null>(null);

  // questionId -> selected option text. Absence === skipped.
  const [answers, setAnswers] = useState<Record<string, string>>(stored?.answers ?? {});
  const [flags, setFlags] = useState<Set<string>>(() => new Set(stored?.flags ?? []));
  const [currentIndex, setCurrentIndex] = useState(stored?.index ?? 0);
  const [now, setNow] = useState(() => Date.now());
  const [result, setResult] = useState<ExamSubmitResponse | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Guard against double submission (timer + manual click racing).
  const submittedRef = useRef(false);
  const slowStart = useSlow(phase === "starting");

  // ----- Start a fresh exam (only when the user asks for it) ----------------
  const startExam = useCallback(async () => {
    setPhase("starting");
    setError(null);
    try {
      const payload = await apiJson<ExamStartResponse>("/api/exam/start", { method: "POST" });
      setExam(payload);
      setDeadline(Date.now() + payload.total_duration_seconds * 1000);
      setNow(Date.now());
      setCurrentIndex(0);
      setAnswers({});
      setFlags(new Set());
      setResult(null);
      submittedRef.current = false;
      setPhase("active");
      window.scrollTo({ top: 0 });
    } catch (startError) {
      const status = startError instanceof ApiError ? startError.status : 0;
      setError(t("exam.startError", { status: status || "–" }));
      setPhase("intro");
    }
  }, [t]);

  // ----- Flatten sections into one ordered question list --------------------
  const flatQuestions = useMemo<FlatQuestion[]>(() => {
    if (!exam) return [];
    const flat: FlatQuestion[] = [];
    exam.sections.forEach((section, sectionIndex) => {
      section.questions.forEach((question) => {
        flat.push({ globalIndex: flat.length, sectionIndex, sectionCategory: section.category, question });
      });
    });
    return flat;
  }, [exam]);

  const totalCount = flatQuestions.length;
  const answeredCount = flatQuestions.reduce((count, item) => count + (answers[item.question.id] !== undefined ? 1 : 0), 0);

  // ----- Mirror progress to localStorage so nothing is lost on reload -------
  useEffect(() => {
    if (!exam || (phase !== "active" && phase !== "submitting" && phase !== "submitError")) return;
    saveStoredExam(userId, { exam, deadline, answers, flags: [...flags], index: currentIndex });
  }, [userId, exam, deadline, answers, flags, currentIndex, phase]);

  // ----- Submit -------------------------------------------------------------
  const submitExam = useCallback(async () => {
    if (submittedRef.current || !exam) return;
    submittedRef.current = true;
    setConfirmOpen(false);
    setSheetOpen(false);
    setPhase("submitting");
    setError(null);

    try {
      const response = await apiFetch("/api/exam/submit", {
        method: "POST",
        body: JSON.stringify({
          exam_id: exam.exam_id,
          answers: flatQuestions.map(({ question }) => ({
            question_id: question.id,
            selected_text: answers[question.id] ?? null,
          })),
        }),
      });
      if (response.status === 409) {
        // Already graded (e.g. submitted from another tab): nothing left to send.
        clearStoredExam(userId);
        setExam(null);
        setError(t("exam.alreadySubmitted"));
        setPhase("intro");
        return;
      }
      if (!response.ok) throw new Error(t("exam.submitError", { status: response.status }));
      const payload = (await response.json()) as ExamSubmitResponse;
      clearStoredExam(userId);
      setResult(payload);
      setPhase("finished");
      window.scrollTo({ top: 0 });
    } catch (submitError) {
      // Keep every answer: the user can retry as soon as the connection is back.
      const message = submitError instanceof ApiError && submitError.status === 401 ? null : (submitError as Error).message;
      setError(message && !/fetch|network/i.test(message) ? message : t("exam.submitOffline"));
      setPhase("submitError");
      submittedRef.current = false;
    }
  }, [exam, flatQuestions, answers, t, userId]);

  // ----- Countdown against an absolute deadline (no drift, survives sleep) --
  useEffect(() => {
    if (phase !== "active") return;
    const tick = () => setNow(Date.now());
    tick();
    const handle = window.setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(handle);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [phase]);

  const secondsLeft = Math.max(0, Math.ceil((deadline - now) / 1000));

  useEffect(() => {
    if (phase === "active" && deadline > 0 && now >= deadline) void submitExam();
  }, [phase, deadline, now, submitExam]);

  const goTo = useCallback(
    (index: number) => {
      setCurrentIndex(Math.min(Math.max(index, 0), Math.max(0, totalCount - 1)));
      setSheetOpen(false);
    },
    [totalCount],
  );

  const current = flatQuestions[Math.min(currentIndex, Math.max(0, totalCount - 1))];

  const selectAnswer = useCallback((questionId: string, text: string) => {
    // No instant feedback — we only record the selection.
    setAnswers((prev) => ({ ...prev, [questionId]: text }));
  }, []);

  const clearAnswer = (questionId: string) => {
    setAnswers((prev) => {
      const next = { ...prev };
      delete next[questionId];
      return next;
    });
  };

  const toggleFlag = useCallback((questionId: string) => {
    setFlags((prev) => {
      const next = new Set(prev);
      if (next.has(questionId)) next.delete(questionId);
      else next.add(questionId);
      return next;
    });
  }, []);

  // ----- Keyboard: 1–4 / A–D select, ←/→ navigate, F flag -------------------
  useEffect(() => {
    if (phase !== "active" || confirmOpen || sheetOpen || !current) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const key = event.key.toLowerCase();
      const index = ["1", "2", "3", "4"].indexOf(key) >= 0 ? Number(key) - 1 : ["a", "b", "c", "d"].indexOf(key);
      if (index >= 0 && index < current.question.answers.length) {
        event.preventDefault();
        selectAnswer(current.question.id, current.question.answers[index].text);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        goTo(currentIndex + 1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        goTo(currentIndex - 1);
      } else if (key === "f") {
        event.preventDefault();
        toggleFlag(current.question.id);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [phase, confirmOpen, sheetOpen, current, currentIndex, goTo, selectAnswer, toggleFlag]);

  // ----- Render: intro ------------------------------------------------------
  if (phase === "intro" || phase === "starting") {
    return <ExamIntro t={t} starting={phase === "starting"} slow={slowStart} error={error} onStart={() => void startExam()} />;
  }

  // ----- Render: results ----------------------------------------------------
  if (phase === "finished" && result) {
    return (
      <ExamResultScreen
        result={result}
        questions={flatQuestions}
        t={t}
        onExit={() => navigate({ kind: "dashboard" })}
        onReview={() => navigate({ kind: "review" })}
        onRetake={() => {
          setExam(null);
          setResult(null);
          setPhase("intro");
          window.scrollTo({ top: 0 });
        }}
      />
    );
  }

  // ----- Render: submitting / failed to submit ------------------------------
  if (phase === "submitting" || phase === "submitError" || !current) {
    return (
      <section className="card mx-auto grid min-h-[420px] max-w-xl place-items-center p-8 text-center">
        {phase === "submitError" ? (
          <div className="flex flex-col items-center gap-4">
            <Icon name="alert" className="h-10 w-10 text-amber-300" />
            <h2 className="text-xl font-bold text-white">{t("exam.submitFailedTitle")}</h2>
            <p className="text-sm text-slate-400">{error}</p>
            <p className="text-xs text-slate-500">{t("exam.submitFailedHint", { n: answeredCount })}</p>
            <button type="button" onClick={() => void submitExam()} className="btn btn-primary mt-2">
              <Icon name="refresh" className="h-4 w-4" />
              {t("app.retry")}
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4">
            <Spinner className="h-10 w-10" />
            <p className="kicker">{t("exam.submitting")}</p>
          </div>
        )}
      </section>
    );
  }

  // ----- Render: active exam ------------------------------------------------
  const isLastQuestion = currentIndex === totalCount - 1;
  const timeIsCritical = secondsLeft <= 60;
  const timeIsLow = secondsLeft <= 300;
  const selected = answers[current.question.id];
  const isFlagged = flags.has(current.question.id);
  const flaggedCount = flatQuestions.reduce((count, item) => count + (flags.has(item.question.id) ? 1 : 0), 0);

  const navigator = (
    <ExamNavigator
      t={t}
      exam={exam}
      flatQuestions={flatQuestions}
      answers={answers}
      flags={flags}
      currentIndex={currentIndex}
      onJump={goTo}
    />
  );

  return (
    <section>
      {/* Sticky status bar: subject, progress, clock, finish. */}
      <div className="sticky top-[4.5rem] z-30 mb-5 rounded-2xl border border-white/10 bg-slate-900/95 px-4 py-3 shadow-xl shadow-black/30 backdrop-blur-md">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="hidden text-[10px] font-semibold uppercase tracking-[0.25em] text-cyan-300 sm:block">{t("exam.kicker")}</p>
            <p className="truncate text-sm font-bold text-white sm:text-base">{t(`subject.${current.sectionCategory}`)}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <div
              role="timer"
              aria-label={t("exam.timeLeft")}
              className={cx(
                "flex items-center gap-2 rounded-xl border px-3 py-1.5 transition",
                timeIsCritical
                  ? "animate-pulse border-red-400/60 bg-red-500/10 text-red-200"
                  : timeIsLow
                    ? "border-amber-300/50 bg-amber-400/10 text-amber-100"
                    : "border-white/10 bg-white/5 text-slate-100",
              )}
            >
              <Icon name="clock" className="h-4 w-4 opacity-70" />
              <span className="font-mono text-base font-bold tabular-nums sm:text-lg">{formatClock(secondsLeft)}</span>
            </div>
            <button type="button" data-exam-finish onClick={() => setConfirmOpen(true)} className="btn btn-success btn-sm sm:px-4 sm:py-2.5 sm:text-sm">
              {t("exam.finishShort")}
            </button>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <ProgressBar value={totalCount ? (answeredCount / totalCount) * 100 : 0} tone="gradient" className="h-1.5" />
          <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-400">
            {answeredCount}/{totalCount}
          </span>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_19rem]">
        {/* Question pane */}
        <article className="card flex flex-col p-5 sm:p-7">
          <div className="mb-4 flex items-center justify-between gap-3">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              {t("exam.questionCounter", { i: currentIndex + 1, n: totalCount })}
            </span>
            <button
              type="button"
              onClick={() => toggleFlag(current.question.id)}
              aria-pressed={isFlagged}
              className={cx(
                "inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition",
                isFlagged ? "border-amber-300/60 bg-amber-400/15 text-amber-200" : "border-white/10 text-slate-400 hover:border-amber-300/40 hover:text-amber-200",
              )}
            >
              <Icon name="flag" className="h-3.5 w-3.5" />
              {isFlagged ? t("exam.flagged") : t("exam.flag")}
            </button>
          </div>

          <h2 key={current.question.id} className="animate-rise text-lg font-semibold leading-relaxed text-white sm:text-xl">
            <RichText text={current.question.question_text} />
          </h2>

          <div className="mt-6 grid gap-3" role="radiogroup" aria-label={t("exam.answers")}>
            {current.question.answers.map((answer) => {
              const isSelected = selected === answer.text;
              return (
                <button
                  key={`${current.question.id}-${answer.key}`}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  data-answer
                  onClick={() => selectAnswer(current.question.id, answer.text)}
                  className={cx(
                    "flex w-full items-start gap-4 rounded-2xl border p-4 text-left transition duration-150",
                    // Neutral selection styling only — never green/red. No correctness is revealed.
                    isSelected
                      ? "border-cyan-300/80 bg-cyan-300/[0.12]"
                      : "border-white/10 bg-white/[0.03] hover:border-cyan-300/50 hover:bg-cyan-300/[0.06]",
                  )}
                >
                  <span
                    className={cx(
                      "grid h-9 w-9 shrink-0 place-items-center rounded-xl border text-sm font-bold transition",
                      isSelected ? "border-cyan-300 bg-cyan-300 text-slate-950" : "border-cyan-300/25 bg-cyan-300/10 text-cyan-200",
                    )}
                  >
                    {answer.key}
                  </span>
                  <span className="min-w-0 flex-1 pt-1.5 leading-relaxed text-slate-100">
                    <RichText text={answer.text} />
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-6 flex items-center justify-between gap-2 border-t border-white/5 pt-5">
            <button type="button" onClick={() => goTo(currentIndex - 1)} disabled={currentIndex === 0} className="btn btn-ghost px-4">
              <Icon name="chevronLeft" className="h-4 w-4" />
              <span className="hidden sm:inline">{t("learn.previous")}</span>
            </button>
            <button
              type="button"
              onClick={() => clearAnswer(current.question.id)}
              disabled={selected === undefined}
              className="rounded-xl px-3 py-2 text-xs font-semibold text-slate-400 hover:text-slate-200 disabled:invisible"
            >
              {t("exam.clear")}
            </button>
            {isLastQuestion ? (
              <button type="button" onClick={() => setConfirmOpen(true)} className="btn btn-success px-4">
                {t("exam.finishShort")}
              </button>
            ) : (
              <button type="button" onClick={() => goTo(currentIndex + 1)} className="btn btn-primary px-4">
                <span>{t("learn.next")}</span>
                <Icon name="chevronRight" className="h-4 w-4" />
              </button>
            )}
          </div>

          <p className="mt-4 hidden items-center gap-1.5 text-xs text-slate-500 lg:flex">
            <span className="kbd">1</span>–<span className="kbd">4</span> {t("study.keysPick")} · <span className="kbd">←</span>
            <span className="kbd">→</span> {t("exam.keysNav")} · <span className="kbd">F</span> {t("exam.keysFlag")}
          </p>
        </article>

        {/* Review sheet: sidebar on desktop, bottom sheet on mobile. */}
        <aside className="card hidden max-h-[calc(100vh-11rem)] flex-col gap-4 overflow-hidden p-5 lg:sticky lg:top-44 lg:flex">{navigator}</aside>
      </div>

      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        className="btn btn-ghost mt-4 w-full lg:hidden"
      >
        <Icon name="grid" className="h-4 w-4" />
        {t("exam.reviewSheet")} · {answeredCount}/{totalCount}
        {flaggedCount > 0 && <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-xs text-amber-200">{flaggedCount}</span>}
      </button>

      {sheetOpen && (
        <Modal title={t("exam.reviewSheet")} onClose={() => setSheetOpen(false)} wide>
          <div className="flex flex-col gap-4">{navigator}</div>
        </Modal>
      )}

      {confirmOpen && (
        <Modal title={t("exam.confirmTitle")} onClose={() => setConfirmOpen(false)}>
          <dl className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-2xl bg-white/5 p-3">
              <dt className="text-[11px] text-slate-400">{t("exam.legendAnswered")}</dt>
              <dd className="text-xl font-bold tabular-nums text-white">{answeredCount}</dd>
            </div>
            <div className={cx("rounded-2xl p-3", totalCount - answeredCount > 0 ? "bg-red-500/10" : "bg-white/5")}>
              <dt className="text-[11px] text-slate-400">{t("exam.legendSkipped")}</dt>
              <dd className={cx("text-xl font-bold tabular-nums", totalCount - answeredCount > 0 ? "text-red-300" : "text-white")}>
                {totalCount - answeredCount}
              </dd>
            </div>
            <div className={cx("rounded-2xl p-3", flaggedCount > 0 ? "bg-amber-400/10" : "bg-white/5")}>
              <dt className="text-[11px] text-slate-400">{t("exam.legendFlagged")}</dt>
              <dd className={cx("text-xl font-bold tabular-nums", flaggedCount > 0 ? "text-amber-200" : "text-white")}>{flaggedCount}</dd>
            </div>
          </dl>
          <p className="mt-4 text-sm leading-relaxed text-slate-400">
            {totalCount - answeredCount > 0 ? t("exam.confirmUnanswered", { n: totalCount - answeredCount }) : t("exam.confirmAllAnswered")}{" "}
            {t("exam.confirmTime", { time: formatClock(secondsLeft) })}
          </p>
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => setConfirmOpen(false)} className="btn btn-ghost" data-autofocus>
              {t("exam.confirmBack")}
            </button>
            <button type="button" data-exam-confirm onClick={() => void submitExam()} className="btn btn-success">
              {t("exam.submit")}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}

// --------------------------------------------------------------------------- //
// Intro screen
// --------------------------------------------------------------------------- //
function ExamIntro({
  t,
  starting,
  slow,
  error,
  onStart,
}: {
  t: Translate;
  starting: boolean;
  slow: boolean;
  error: string | null;
  onStart: () => void;
}) {
  return (
    <section className="animate-rise mx-auto max-w-3xl">
      <header className="mb-6">
        <p className="kicker">{t("exam.kicker")}</p>
        <h1 className="mt-2 text-2xl font-bold text-white sm:text-3xl">{t("exam.introTitle")}</h1>
        <p className="mt-2 text-slate-400">{t("exam.introSubtitle")}</p>
      </header>

      <div className="grid grid-cols-3 gap-3">
        {[
          ["exam", `${BLUEPRINT_QUESTIONS}`, t("exam.introQuestions")],
          ["clock", `${Math.floor(BLUEPRINT_MINUTES / 60)} h ${BLUEPRINT_MINUTES % 60} min`, t("exam.introTime")],
          ["target", "75%", t("exam.introThreshold")],
        ].map(([icon, value, label]) => (
          <div key={label} className="card p-4 text-center">
            <Icon name={icon as "exam"} className="mx-auto h-5 w-5 text-cyan-300" />
            <p className="mt-2 text-lg font-bold text-white sm:text-xl">{value}</p>
            <p className="text-[11px] leading-tight text-slate-400 sm:text-xs">{label}</p>
          </div>
        ))}
      </div>

      <div className="card mt-4 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left text-[11px] uppercase tracking-wider text-slate-500">
              <th className="px-5 py-3 font-semibold">{t("exam.introSubject")}</th>
              <th className="px-3 py-3 text-right font-semibold">{t("exam.introColQuestions")}</th>
              <th className="px-5 py-3 text-right font-semibold">{t("exam.introColTime")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {BLUEPRINT.map(([category, count, minutes]) => (
              <tr key={category}>
                <td className="px-5 py-2.5">
                  <span className="flex items-center gap-3 text-slate-200">
                    <Icon name={SUBJECT_ICON[category] ?? "book"} className="h-4 w-4 text-slate-500" />
                    {t(`subject.${category}`)}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-300">{count}</td>
                <td className="px-5 py-2.5 text-right tabular-nums text-slate-300">{minutes} min</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="mt-4 grid gap-2 text-sm text-slate-400">
        {["exam.rule1", "exam.rule2", "exam.rule3", "exam.rule4"].map((key) => (
          <li key={key} className="flex items-start gap-2.5">
            <Icon name="check" className="mt-0.5 h-4 w-4 text-emerald-400" />
            <span>{t(key)}</span>
          </li>
        ))}
      </ul>

      {error && <p className="mt-5 rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">{error}</p>}

      <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row">
        <button type="button" data-exam-start onClick={onStart} disabled={starting} className="btn btn-primary w-full px-8 py-4 text-base sm:w-auto">
          {starting ? <Spinner className="h-5 w-5 border-slate-950/30 border-t-slate-950" /> : <Icon name="exam" />}
          {starting ? t("exam.assembling") : t("exam.startCta")}
        </button>
        {slow && <p className="animate-rise text-xs text-slate-500">{t("app.coldStart")}</p>}
      </div>
    </section>
  );
}

// --------------------------------------------------------------------------- //
// Question navigator ("review sheet")
// --------------------------------------------------------------------------- //
function ExamNavigator({
  t,
  exam,
  flatQuestions,
  answers,
  flags,
  currentIndex,
  onJump,
}: {
  t: Translate;
  exam: ExamStartResponse | null;
  flatQuestions: FlatQuestion[];
  answers: Record<string, string>;
  flags: Set<string>;
  currentIndex: number;
  onJump: (index: number) => void;
}) {
  return (
    <>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded bg-cyan-300" /> {t("exam.legendAnswered")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded border border-white/25" /> {t("exam.legendSkipped")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded border-2 border-amber-300" /> {t("exam.legendFlagged")}
        </span>
      </div>

      <div className="-mr-2 flex-1 overflow-y-auto pr-2">
        {exam?.sections.map((section, sectionIndex) => {
          const sectionStart = flatQuestions.find((item) => item.sectionIndex === sectionIndex)?.globalIndex ?? 0;
          const done = section.questions.filter((question) => answers[question.id] !== undefined).length;
          return (
            <div key={section.category} className="mb-4 last:mb-0">
              <p className="mb-2 flex items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <span className="truncate">{t(`subject.${section.category}`)}</span>
                <span className="shrink-0 tabular-nums">
                  {done}/{section.questions.length}
                </span>
              </p>
              <div className="grid grid-cols-8 gap-1.5 lg:grid-cols-6">
                {section.questions.map((question, indexInSection) => {
                  const globalIndex = sectionStart + indexInSection;
                  const isAnswered = answers[question.id] !== undefined;
                  const isCurrent = globalIndex === currentIndex;
                  const isFlagged = flags.has(question.id);
                  return (
                    <button
                      key={question.id}
                      type="button"
                      onClick={() => onJump(globalIndex)}
                      aria-current={isCurrent ? "true" : undefined}
                      aria-label={`${t("exam.questionCounter", { i: globalIndex + 1, n: flatQuestions.length })}${isAnswered ? ` · ${t("exam.legendAnswered")}` : ""}${isFlagged ? ` · ${t("exam.legendFlagged")}` : ""}`}
                      className={cx(
                        "grid h-8 place-items-center rounded-lg text-xs font-semibold tabular-nums transition",
                        isAnswered ? "bg-cyan-300 text-slate-950" : "border border-white/15 text-slate-400 hover:border-cyan-300/50",
                        isFlagged && "border-2 border-amber-300",
                        isCurrent && "ring-2 ring-white ring-offset-2 ring-offset-slate-900",
                      )}
                    >
                      {globalIndex + 1}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// --------------------------------------------------------------------------- //
// Results screen
// --------------------------------------------------------------------------- //
function ExamResultScreen({
  result,
  questions,
  onExit,
  onReview,
  onRetake,
  t,
}: {
  result: ExamSubmitResponse;
  questions: FlatQuestion[];
  onExit: () => void;
  onReview: () => void;
  onRetake: () => void;
  t: Translate;
}) {
  const [onlyWrong, setOnlyWrong] = useState(true);

  // Join the server verdicts (which carry the canonical correct answer) onto the
  // locally-held question text/options so we can render a full review.
  const resultByQid = useMemo(() => {
    const map = new Map<string, QuestionResult>();
    for (const item of result.results) map.set(item.question_id, item);
    return map;
  }, [result.results]);

  const reviewItems = useMemo(
    () =>
      questions
        .map((item) => ({ item, verdict: resultByQid.get(item.question.id) }))
        .filter((entry): entry is { item: FlatQuestion; verdict: QuestionResult } => entry.verdict !== undefined),
    [questions, resultByQid],
  );

  const visibleItems = onlyWrong ? reviewItems.filter((entry) => !entry.verdict.is_correct) : reviewItems;
  const wrongCount = reviewItems.filter((entry) => !entry.verdict.is_correct).length;
  const wrongAnswered = reviewItems.filter((entry) => entry.verdict.answered && !entry.verdict.is_correct).length;
  const failedSections = result.sections.filter((section) => !section.passed).length;

  return (
    <section className="animate-rise mx-auto max-w-4xl">
      <header className="card flex flex-col items-center gap-6 p-6 text-center sm:flex-row sm:p-8 sm:text-left">
        <ProgressRing value={result.overall_score_percent} size={140} stroke={12} tone={result.passed ? "emerald" : "red"}>
          <div>
            <p className="text-3xl font-black tabular-nums text-white">{result.overall_score_percent}%</p>
            <p className="text-xs tabular-nums text-slate-400">
              {result.total_correct}/{result.total_questions}
            </p>
          </div>
        </ProgressRing>
        <div className="min-w-0 flex-1">
          <p className="kicker">{t("result.kicker")}</p>
          <p className={cx("mt-2 text-3xl font-black tracking-wide sm:text-4xl", result.passed ? "text-emerald-300" : "text-red-300")}>
            {result.passed ? t("result.passed") : t("result.failed")}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">
            {result.passed ? t("result.passedHint") : t("result.failedHint", { n: failedSections, p: result.pass_threshold_percent })}
          </p>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            {wrongAnswered > 0 && (
              <button type="button" onClick={onReview} className="btn btn-primary">
                <Icon name="refresh" className="h-4 w-4" />
                {t("result.reviewMistakes")}
              </button>
            )}
            <button type="button" onClick={onRetake} className="btn btn-ghost">
              {t("result.retake")}
            </button>
            <button type="button" onClick={onExit} className="btn btn-ghost">
              {t("result.back")}
            </button>
          </div>
        </div>
      </header>

      <h2 className="kicker mb-3 mt-8">{t("result.bySubject")}</h2>
      <div className="grid gap-2.5">
        {result.sections.map((section) => (
          <div key={section.category} className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <span
                className={cx(
                  "grid h-9 w-9 shrink-0 place-items-center rounded-xl",
                  section.passed ? "bg-emerald-400/15 text-emerald-300" : "bg-red-500/15 text-red-300",
                )}
              >
                <Icon name={section.passed ? "check" : "x"} className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="truncate font-semibold text-white">{t(`subject.${section.category}`)}</p>
                <p className="text-xs text-slate-400">
                  {t("result.sectionStats", { correct: section.correct, count: section.question_count, answered: section.answered })}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {/* The tick marks the 75% pass line. */}
              <ProgressBar
                value={section.score_percent}
                marker={result.pass_threshold_percent}
                tone={section.passed ? "emerald" : "red"}
                className="sm:w-44"
              />
              <span className="w-14 shrink-0 text-right font-mono font-bold tabular-nums text-white">{section.score_percent}%</span>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-slate-500">{t("result.threshold", { p: result.pass_threshold_percent })}</p>

      {/* Per-question review */}
      <div className="mt-10">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">{t("result.reviewTitle")}</h2>
            <p className="text-sm text-slate-400">{t("result.reviewSummary", { wrong: wrongCount, total: reviewItems.length })}</p>
          </div>
          <div className="flex gap-0.5 self-start rounded-xl border border-white/10 bg-white/5 p-0.5 text-sm font-semibold">
            {[true, false].map((value) => (
              <button
                key={String(value)}
                type="button"
                aria-pressed={onlyWrong === value}
                onClick={() => setOnlyWrong(value)}
                className={cx("rounded-[0.6rem] px-4 py-2 transition", onlyWrong === value ? "bg-cyan-300 text-slate-950" : "text-slate-300 hover:text-white")}
              >
                {value ? t("result.onlyWrong") : t("result.all")}
              </button>
            ))}
          </div>
        </div>

        {visibleItems.length === 0 ? (
          <p className="rounded-2xl border border-emerald-400/30 bg-emerald-400/5 p-5 text-center text-emerald-200">{t("result.allCorrect")}</p>
        ) : (
          <div className="grid gap-3">
            {visibleItems.map(({ item, verdict }) => {
              const status = !verdict.answered ? "skipped" : verdict.is_correct ? "correct" : "wrong";
              return (
                <article key={item.question.id} className="card p-5">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                    <span>
                      #{item.globalIndex + 1} · {t(`subject.${item.sectionCategory}`)} · <span className="font-mono">{item.question.external_id}</span>
                    </span>
                    <span
                      className={cx(
                        "rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wider",
                        status === "correct"
                          ? "bg-emerald-400/15 text-emerald-300"
                          : status === "wrong"
                            ? "bg-red-500/15 text-red-300"
                            : "bg-amber-400/15 text-amber-200",
                      )}
                    >
                      {status === "correct" ? t("result.badgeCorrect") : status === "wrong" ? t("result.badgeWrong") : t("result.badgeSkipped")}
                    </span>
                  </div>
                  <p className="mb-4 font-semibold leading-relaxed text-white">
                    <RichText text={item.question.question_text} />
                  </p>
                  <div className="grid gap-2">
                    {item.question.answers.map((answer) => {
                      const isCorrect = answer.text === verdict.correct_answer;
                      const isPicked = verdict.selected_text === answer.text;
                      return (
                        <div
                          key={`${item.question.id}-${answer.key}`}
                          className={cx(
                            "flex items-start gap-3 rounded-xl border px-4 py-2.5 text-sm",
                            isCorrect
                              ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-100"
                              : isPicked
                                ? "border-red-400/50 bg-red-500/10 text-red-100"
                                : "border-white/5 text-slate-400",
                          )}
                        >
                          <span className="font-bold">{answer.key}</span>
                          <span className="min-w-0 flex-1 leading-relaxed">
                            <RichText text={answer.text} />
                          </span>
                          {isCorrect && <span className="shrink-0 text-xs font-bold text-emerald-300">{t("result.correctTag")}</span>}
                          {isPicked && !isCorrect && <span className="shrink-0 text-xs font-bold text-red-300">{t("result.yourChoice")}</span>}
                        </div>
                      );
                    })}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

export default ExamView;
