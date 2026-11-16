// PilotReady
// Copyright (c) 2026 Aleksander Kopydłowski. All rights reserved.
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//
// NOTE: licensing stub - to be reviewed/refined later.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiJson, saveProgress } from "../api";
import { useI18n } from "../i18n";
import { LAST_SUBJECT_KEY } from "./Dashboard";
import { cx, Icon, ProgressBar, RichText, Spinner, useSlow } from "./ui";

type ProgressStatus = "CORRECT" | "INCORRECT";

type ApiAnswer = { key: string; text: string };

export type ApiQuestion = {
  id: string;
  external_id: string;
  category: string;
  question_text: string;
  correct_answer: string;
  answers: ApiAnswer[];
  progress_status?: ProgressStatus | null;
};

type ShuffledAnswer = ApiAnswer & { isCorrect: boolean };

export type StudySource =
  | { kind: "category"; categoryId: string }
  | { kind: "mistakes"; categoryId?: string };

type StudySessionProps = {
  source: StudySource;
  onExit: () => void;
  /** Open the support form pre-filled with a reference to this question. */
  onReport?: (externalId: string) => void;
};

const BATCH_SIZE = 10;
const LETTERS = ["A", "B", "C", "D"];

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function shuffledAnswersFor(question: ApiQuestion): ShuffledAnswer[] {
  return shuffle(
    question.answers.map((answer) => ({
      ...answer,
      isCorrect: answer.key === "A" || answer.text === question.correct_answer,
    })),
  );
}

type BatchEntry = { question: ApiQuestion; answers: ShuffledAnswer[] };
type BatchOutcome = { question: ApiQuestion; pickedText: string; correct: boolean };

export function StudySession({ source, onExit, onReport }: StudySessionProps) {
  const { t } = useI18n();
  const [questions, setQuestions] = useState<ApiQuestion[]>([]);
  const [statuses, setStatuses] = useState<Record<string, ProgressStatus>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const slow = useSlow(loading);

  // Current batch state.
  const [batch, setBatch] = useState<BatchEntry[]>([]);
  const [batchPos, setBatchPos] = useState(0);
  const [picked, setPicked] = useState<string | null>(null); // selected answer text for current question
  const [outcomes, setOutcomes] = useState<BatchOutcome[]>([]);
  const [sessionNumber, setSessionNumber] = useState(0);
  const [phase, setPhase] = useState<"answering" | "batchResult">("answering");

  const nextButtonRef = useRef<HTMLButtonElement>(null);

  const fetchUrl =
    source.kind === "category"
      ? `/api/questions/${source.categoryId}`
      : `/api/mistakes${source.categoryId ? `?category=${source.categoryId}` : ""}`;

  // Remember the subject so the dashboard can offer "continue".
  useEffect(() => {
    if (source.kind !== "category") return;
    try {
      window.localStorage.setItem(LAST_SUBJECT_KEY, source.categoryId);
    } catch {
      /* storage unavailable */
    }
  }, [source]);

  // ----- Load the question pool ---------------------------------------------
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiJson<ApiQuestion[]>(fetchUrl)
      .then((payload) => {
        if (cancelled) return;
        setQuestions(payload);
        const seeded: Record<string, ProgressStatus> = {};
        for (const q of payload) if (q.progress_status === "CORRECT" || q.progress_status === "INCORRECT") seeded[q.id] = q.progress_status;
        setStatuses(seeded);
      })
      .catch((fetchError: Error) => {
        if (!cancelled) setError(fetchError.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchUrl, reloadKey]);

  // Questions still to master = not yet answered correctly.
  const remaining = useMemo(() => questions.filter((q) => statuses[q.id] !== "CORRECT"), [questions, statuses]);
  const masteredCount = questions.length - remaining.length;

  // ----- Build the next batch of up to 10 (wrong first, then unseen) --------
  const startNextBatch = useCallback(() => {
    const pool = questions.filter((q) => statuses[q.id] !== "CORRECT");
    const wrong = shuffle(pool.filter((q) => statuses[q.id] === "INCORRECT"));
    const unseen = shuffle(pool.filter((q) => statuses[q.id] !== "INCORRECT"));
    const chosen = [...wrong, ...unseen].slice(0, BATCH_SIZE);
    setBatch(chosen.map((question) => ({ question, answers: shuffledAnswersFor(question) })));
    setBatchPos(0);
    setPicked(null);
    setOutcomes([]);
    setSessionNumber((n) => n + 1);
    setPhase("answering");
    window.scrollTo({ top: 0 });
  }, [questions, statuses]);

  // Kick off the first batch once questions arrive.
  useEffect(() => {
    if (!loading && !error && questions.length > 0 && sessionNumber === 0 && remaining.length > 0) {
      startNextBatch();
    }
  }, [loading, error, questions.length, sessionNumber, remaining.length, startNextBatch]);

  const current = batch[batchPos];

  const handlePick = useCallback(
    (answer: ShuffledAnswer) => {
      if (picked || !current) return;
      const status: ProgressStatus = answer.isCorrect ? "CORRECT" : "INCORRECT";
      setPicked(answer.text);
      setStatuses((prev) => ({ ...prev, [current.question.id]: status }));
      setOutcomes((prev) => [...prev, { question: current.question, pickedText: answer.text, correct: answer.isCorrect }]);
      saveProgress(current.question.id, answer.text, answer.isCorrect);
    },
    [picked, current],
  );

  const advance = useCallback(() => {
    if (batchPos + 1 >= batch.length) {
      setPhase("batchResult");
    } else {
      setBatchPos((p) => p + 1);
      setPicked(null);
    }
    window.scrollTo({ top: 0 });
  }, [batchPos, batch.length]);

  // Once an answer is revealed, focus "Next" so Enter/Space moves on.
  useEffect(() => {
    if (picked) nextButtonRef.current?.focus({ preventScroll: true });
  }, [picked]);

  // ----- Keyboard: 1–4 / A–D pick an answer, Enter or → continues -----------
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const onControl = tag === "BUTTON" || tag === "A";

      if (phase === "answering" && current) {
        const key = event.key.toLowerCase();
        const index = ["1", "2", "3", "4"].indexOf(key) >= 0 ? Number(key) - 1 : ["a", "b", "c", "d"].indexOf(key);
        if (index >= 0 && index < current.answers.length && !picked) {
          event.preventDefault();
          handlePick(current.answers[index]);
          return;
        }
        // Enter/Space on a focused control already clicks it - don't act twice.
        if (picked && (event.key === "ArrowRight" || (!onControl && (event.key === "Enter" || event.key === " ")))) {
          event.preventDefault();
          advance();
        }
      } else if (phase === "batchResult" && !onControl && event.key === "Enter" && remaining.length > 0) {
        event.preventDefault();
        startNextBatch();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [phase, current, picked, handlePick, advance, remaining.length, startNextBatch]);

  const isReview = source.kind === "mistakes";
  const heading = source.categoryId ? t(`subject.${source.categoryId}`) : t("study.mistakesHeading");

  const backLink = (
    <button type="button" onClick={onExit} className="mb-4 inline-flex items-center gap-2 rounded-lg text-sm font-medium text-cyan-300 hover:text-cyan-200">
      <Icon name="arrowLeft" className="h-4 w-4" />
      {t("learn.back")}
    </button>
  );

  // ----- Render: loading / error / done -------------------------------------
  if (loading) {
    return (
      <div>
        {backLink}
        <section className="card grid min-h-[420px] place-items-center p-8">
          <div className="flex max-w-sm flex-col items-center gap-4 text-center">
            <Spinner />
            <p className="text-sm text-slate-400">{t("learn.loading")}</p>
            {slow && <p className="animate-rise text-xs leading-relaxed text-slate-500">{t("app.coldStart")}</p>}
          </div>
        </section>
      </div>
    );
  }
  if (error) {
    return (
      <div>
        {backLink}
        <section className="rounded-3xl border border-red-400/30 bg-red-500/5 p-8 text-center">
          <Icon name="alert" className="mx-auto h-8 w-8 text-red-300" />
          <p className="mt-3 text-red-100">{t("learn.error", { status: error })}</p>
          <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="btn btn-ghost mt-5">
            <Icon name="refresh" className="h-4 w-4" />
            {t("app.retry")}
          </button>
        </section>
      </div>
    );
  }

  const allMastered = remaining.length === 0;
  const masteryPercent = questions.length ? Math.round((masteredCount / questions.length) * 100) : 0;

  // Empty pool (e.g. no mistakes yet) or everything mastered - but let the
  // user see the result of the batch that got them there first.
  if (questions.length === 0 || (allMastered && phase !== "batchResult")) {
    return (
      <div>
        {backLink}
        <section className="card grid min-h-[420px] place-items-center border-emerald-400/20 p-8 text-center">
          <div className="flex flex-col items-center gap-4">
            <span className="grid h-16 w-16 place-items-center rounded-3xl bg-emerald-400/15 text-emerald-300">
              <Icon name="trophy" className="h-8 w-8" />
            </span>
            <h2 className="text-2xl font-bold text-white">
              {questions.length === 0 ? (isReview ? t("study.noMistakes") : t("learn.empty")) : isReview ? t("study.reviewDone") : t("study.mastered")}
            </h2>
            {questions.length > 0 && <p className="text-slate-400">{t("study.masteredSubtitle", { total: questions.length })}</p>}
            <button type="button" onClick={onExit} className="btn btn-primary mt-2">
              {t("result.back")}
            </button>
          </div>
        </section>
      </div>
    );
  }

  const correctInBatch = outcomes.filter((o) => o.correct).length;
  const wrongOutcomes = outcomes.filter((o) => !o.correct);

  return (
    <div className="mx-auto max-w-3xl">
      {backLink}

      {/* Header: subject + mastery progress */}
      <header className="mb-5">
        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="kicker">
              {isReview ? t("study.mistakesKicker") : t("learn.kicker")} · {t("study.sessionLabel", { n: sessionNumber })}
            </p>
            <h1 className="mt-1.5 truncate text-xl font-bold text-white sm:text-2xl">{heading}</h1>
          </div>
          <p className="shrink-0 text-right text-sm text-slate-400">
            <span className="text-lg font-bold tabular-nums text-white">{masteryPercent}%</span>
            <span className="block text-xs">{t("study.masteryProgress", { m: masteredCount, t: questions.length })}</span>
          </p>
        </div>
        <ProgressBar value={masteryPercent} tone="gradient" className="mt-3" />
      </header>

      {phase === "answering" && current && (
        <article key={current.question.id} className="card animate-rise p-5 sm:p-7">
          {/* One segment per question of this session: green/red once answered. */}
          <div className="mb-5 flex items-center gap-3">
            <div className="flex flex-1 gap-1" aria-hidden="true">
              {batch.map((entry, index) => {
                const outcome = outcomes.find((o) => o.question.id === entry.question.id);
                return (
                  <span
                    key={entry.question.id}
                    className={cx(
                      "h-1.5 flex-1 rounded-full transition-colors",
                      outcome ? (outcome.correct ? "bg-emerald-400" : "bg-red-400") : index === batchPos ? "bg-cyan-300" : "bg-white/10",
                    )}
                  />
                );
              })}
            </div>
            <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-400">
              {t("study.batchCounter", { i: batchPos + 1, n: batch.length })}
            </span>
          </div>

          <h2 className="text-lg font-semibold leading-relaxed text-white sm:text-xl">
            <RichText text={current.question.question_text} />
          </h2>

          <div className="mt-6 grid gap-3">
            {current.answers.map((answer, index) => {
              const isPicked = picked === answer.text;
              const reveal = Boolean(picked);
              const showCorrect = reveal && answer.isCorrect;
              const showWrong = reveal && isPicked && !answer.isCorrect;
              return (
                <button
                  key={`${current.question.id}-${index}`}
                  type="button"
                  data-answer
                  aria-disabled={reveal}
                  onClick={() => handlePick(answer)}
                  className={cx(
                    "group flex w-full items-start gap-4 rounded-2xl border p-4 text-left transition duration-150",
                    !reveal && "border-white/10 bg-white/[0.03] hover:border-cyan-300/60 hover:bg-cyan-300/[0.07]",
                    showCorrect && "border-emerald-400/70 bg-emerald-400/10",
                    showWrong && "border-red-400/70 bg-red-500/10",
                    reveal && !showCorrect && !showWrong && "cursor-default border-white/5 opacity-50",
                    reveal && "cursor-default",
                  )}
                >
                  <span
                    className={cx(
                      "grid h-9 w-9 shrink-0 place-items-center rounded-xl border text-sm font-bold transition",
                      showCorrect
                        ? "border-emerald-400 bg-emerald-400 text-slate-950"
                        : showWrong
                          ? "border-red-400 bg-red-400 text-slate-950"
                          : "border-cyan-300/25 bg-cyan-300/10 text-cyan-200",
                    )}
                  >
                    {showCorrect ? <Icon name="check" className="h-4 w-4" /> : showWrong ? <Icon name="x" className="h-4 w-4" /> : LETTERS[index]}
                  </span>
                  <span className="min-w-0 flex-1 pt-1.5 leading-relaxed text-slate-100">
                    <RichText text={answer.text} />
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-6 flex min-h-[3rem] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {picked ? (
              <>
                <p
                  role="status"
                  className={cx(
                    "flex items-center gap-2 text-sm font-semibold",
                    statuses[current.question.id] === "CORRECT" ? "text-emerald-300" : "text-red-300",
                  )}
                >
                  <Icon name={statuses[current.question.id] === "CORRECT" ? "check" : "x"} className="h-4 w-4" />
                  {statuses[current.question.id] === "CORRECT" ? t("learn.correct") : t("learn.incorrect")}
                </p>
                <button ref={nextButtonRef} type="button" onClick={advance} className="btn btn-primary">
                  {batchPos + 1 >= batch.length ? t("study.seeResult") : t("learn.next")}
                  <Icon name="chevronRight" className="h-4 w-4" />
                </button>
              </>
            ) : (
              <p className="hidden items-center gap-1.5 text-xs text-slate-500 md:flex">
                <span className="kbd">1</span>–<span className="kbd">4</span> {t("study.keysPick")} · <span className="kbd">Enter</span> {t("study.keysNext")}
              </p>
            )}
          </div>

          <footer className="mt-5 flex items-center justify-between gap-3 border-t border-white/5 pt-4 text-xs text-slate-500">
            <span className="font-mono">{current.question.external_id}</span>
            {onReport && (
              <button
                type="button"
                onClick={() => onReport(current.question.external_id)}
                className="inline-flex items-center gap-1.5 rounded-lg hover:text-slate-300"
              >
                <Icon name="flag" className="h-3.5 w-3.5" />
                {t("study.report")}
              </button>
            )}
          </footer>
        </article>
      )}

      {phase === "batchResult" && (
        <article className="card animate-rise p-5 sm:p-7">
          <div className="text-center">
            <p className="kicker">{t("study.batchResultTitle")}</p>
            <p className="mt-3 text-5xl font-black tabular-nums text-white">
              {correctInBatch}
              <span className="text-2xl text-slate-500">/{outcomes.length}</span>
            </p>
            <p className="mt-2 text-sm text-slate-400">
              {wrongOutcomes.length === 0 ? t("study.batchPerfect") : t("study.batchKeepGoing", { n: wrongOutcomes.length })}
            </p>
          </div>

          {wrongOutcomes.length > 0 && (
            <div className="mt-6">
              <p className="mb-3 text-sm font-semibold text-red-300">{t("study.wrongInBatch")}</p>
              <ul className="grid gap-3">
                {wrongOutcomes.map(({ question, pickedText }) => (
                  <li key={question.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm">
                    <p className="font-medium leading-relaxed text-slate-100">
                      <RichText text={question.question_text} />
                    </p>
                    <p className="mt-2.5 flex items-start gap-2 text-red-300/90">
                      <Icon name="x" className="mt-0.5 h-4 w-4" />
                      <span className="line-through decoration-red-400/50">
                        <RichText text={pickedText} />
                      </span>
                    </p>
                    <p className="mt-1.5 flex items-start gap-2 text-emerald-300">
                      <Icon name="check" className="mt-0.5 h-4 w-4" />
                      <span>
                        <RichText text={question.correct_answer} />
                      </span>
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-7 flex flex-col-reverse items-stretch justify-center gap-3 sm:flex-row sm:items-center">
            <button type="button" onClick={onExit} className="btn btn-ghost">
              {t("study.finish")}
            </button>
            {remaining.length > 0 ? (
              <button type="button" onClick={startNextBatch} className="btn btn-primary" autoFocus>
                {t("study.nextBatch", { n: Math.min(BATCH_SIZE, remaining.length) })}
                <Icon name="chevronRight" className="h-4 w-4" />
              </button>
            ) : (
              <p className="flex items-center justify-center gap-2 text-base font-bold text-emerald-300">
                <Icon name="trophy" />
                {isReview ? t("study.reviewDone") : t("study.mastered")}
              </p>
            )}
          </div>
          <p className="mt-4 text-center text-xs text-slate-500">{t("study.masteryProgress", { m: masteredCount, t: questions.length })}</p>
        </article>
      )}
    </div>
  );
}

export default StudySession;
