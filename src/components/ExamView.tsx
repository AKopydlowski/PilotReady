import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n";

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

type ExamPhase = "loading" | "error" | "active" | "submitting" | "finished";

type ExamViewProps = {
  apiBaseUrl?: string;
  onExit?: () => void;
};

// --------------------------------------------------------------------------- //
// Helpers
// --------------------------------------------------------------------------- //
function classNames(...names: Array<string | false | null | undefined>) {
  return names.filter(Boolean).join(" ");
}

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
export function ExamView({ apiBaseUrl = "", onExit }: ExamViewProps) {
  const { t } = useI18n();
  const [exam, setExam] = useState<ExamStartResponse | null>(null);
  const [phase, setPhase] = useState<ExamPhase>("loading");
  const [error, setError] = useState<string | null>(null);

  // questionId -> selected option text. Absence === skipped.
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [result, setResult] = useState<ExamSubmitResponse | null>(null);

  // Guard against double submission (timer + manual click racing).
  const submittedRef = useRef(false);

  // ----- Start a fresh exam on mount ----------------------------------------
  useEffect(() => {
    const controller = new AbortController();
    setPhase("loading");
    setError(null);

    fetch(`${apiBaseUrl}/api/exam/start`, { method: "POST", signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(t("exam.startError", { status: response.status }));
        return response.json() as Promise<ExamStartResponse>;
      })
      .then((payload) => {
        setExam(payload);
        setSecondsLeft(payload.total_duration_seconds);
        setCurrentIndex(0);
        setAnswers({});
        submittedRef.current = false;
        setPhase("active");
      })
      .catch((fetchError: Error) => {
        if (fetchError.name !== "AbortError") {
          setError(fetchError.message);
          setPhase("error");
        }
      });

    return () => controller.abort();
  }, [apiBaseUrl]);

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

  const answeredCount = Object.keys(answers).length;
  const totalCount = flatQuestions.length;

  // ----- Submit -------------------------------------------------------------
  const submitExam = useCallback(async () => {
    if (submittedRef.current || !exam) return;
    submittedRef.current = true;
    setPhase("submitting");

    try {
      const response = await fetch(`${apiBaseUrl}/api/exam/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exam_id: exam.exam_id,
          answers: flatQuestions.map(({ question }) => ({
            question_id: question.id,
            selected_text: answers[question.id] ?? null,
          })),
        }),
      });
      if (!response.ok) throw new Error(t("exam.submitError", { status: response.status }));
      const payload = (await response.json()) as ExamSubmitResponse;
      setResult(payload);
      setPhase("finished");
    } catch (submitError) {
      setError((submitError as Error).message);
      setPhase("error");
      submittedRef.current = false; // allow a retry
    }
  }, [apiBaseUrl, exam, flatQuestions, answers]);

  // ----- Strict countdown timer ---------------------------------------------
  useEffect(() => {
    if (phase !== "active") return;
    if (secondsLeft <= 0) {
      void submitExam();
      return;
    }
    const handle = window.setInterval(() => {
      setSecondsLeft((value) => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearInterval(handle);
  }, [phase, secondsLeft, submitExam]);

  // ----- Render: loading / error -------------------------------------------
  if (phase === "loading") {
    return (
      <section className="grid min-h-[680px] place-items-center rounded-[2rem] border border-cyan-400/10 bg-slate-950 p-8 text-slate-300">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-cyan-300/30 border-t-cyan-300" />
          <p className="text-sm uppercase tracking-[0.35em] text-cyan-300">{t("exam.assembling")}</p>
        </div>
      </section>
    );
  }

  if (phase === "error") {
    return (
      <section className="grid min-h-[680px] place-items-center rounded-[2rem] border border-red-900/70 bg-red-950/40 p-8 text-red-100">
        <div className="flex flex-col items-center gap-4 text-center">
          <p>{error}</p>
          {onExit && (
            <button type="button" onClick={onExit} className="rounded-2xl border border-red-300/40 px-5 py-3 text-sm font-semibold">
              {t("exam.errorBack")}
            </button>
          )}
        </div>
      </section>
    );
  }

  // ----- Render: results ----------------------------------------------------
  if (phase === "finished" && result) {
    return <ExamResultScreen result={result} questions={flatQuestions} onExit={onExit} t={t} />;
  }

  const current = flatQuestions[currentIndex];
  const isLastQuestion = currentIndex === totalCount - 1;
  const timeIsCritical = secondsLeft <= 60;
  const timeIsLow = secondsLeft <= 300;

  const goTo = (index: number) => setCurrentIndex(Math.min(Math.max(index, 0), totalCount - 1));

  const selectAnswer = (questionId: string, text: string) => {
    // No instant feedback — we only record the selection.
    setAnswers((prev) => ({ ...prev, [questionId]: text }));
  };

  const clearAnswer = (questionId: string) => {
    setAnswers((prev) => {
      const next = { ...prev };
      delete next[questionId];
      return next;
    });
  };

  return (
    <section className="min-h-[680px] rounded-[2rem] border border-cyan-400/10 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_34%),linear-gradient(145deg,_#020617,_#0f172a_58%,_#111827)] p-6 text-slate-100 shadow-2xl shadow-cyan-950/30">
      {/* Header / timer */}
      <header className="mb-6 flex flex-col gap-4 border-b border-white/10 pb-6 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-cyan-300">{t("exam.kicker")}</p>
          <h2 className="mt-2 text-2xl font-bold text-white">{current ? t(`subject.${current.sectionCategory}`) : ""}</h2>
        </div>
        <div
          className={classNames(
            "flex items-center gap-4 rounded-2xl border px-5 py-3 backdrop-blur transition",
            timeIsCritical
              ? "animate-pulse border-red-400/60 bg-red-500/10 text-red-200"
              : timeIsLow
                ? "border-amber-300/50 bg-amber-400/10 text-amber-100"
                : "border-white/10 bg-white/5 text-slate-100",
          )}
        >
          <span className="text-xs uppercase tracking-[0.3em] text-slate-400">{t("exam.timeLeft")}</span>
          <span className="font-mono text-2xl font-bold tabular-nums tracking-wider">{formatClock(secondsLeft)}</span>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        {/* Question pane */}
        <article className="flex flex-col rounded-3xl border border-white/10 bg-slate-950/70 p-6 shadow-xl shadow-black/30">
          <div className="mb-5 flex items-center justify-between gap-4 text-xs uppercase tracking-[0.28em] text-slate-400">
            <span>{t("exam.questionCounter", { i: currentIndex + 1, n: totalCount })}</span>
            <span>{current?.question.external_id}</span>
          </div>
          <h3 className="text-xl font-semibold leading-relaxed text-white md:text-2xl">{current?.question.question_text}</h3>

          <div className="mt-8 grid gap-4">
            {current?.question.answers.map((answer) => {
              const isSelected = answers[current.question.id] === answer.text;
              return (
                <button
                  key={`${current.question.id}-${answer.key}`}
                  type="button"
                  onClick={() => selectAnswer(current.question.id, answer.text)}
                  className={classNames(
                    "group flex w-full items-start gap-4 rounded-2xl border p-5 text-left transition duration-200",
                    "hover:-translate-y-0.5 hover:border-cyan-300/70 hover:bg-cyan-300/10",
                    // Neutral selection styling only — never green/red. No correctness is revealed.
                    isSelected
                      ? "border-cyan-300/80 bg-cyan-300/15 shadow-lg shadow-cyan-950/40"
                      : "border-white/10 bg-white/[0.035]",
                  )}
                >
                  <span
                    className={classNames(
                      "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border font-bold transition",
                      isSelected
                        ? "border-cyan-300/60 bg-cyan-300 text-slate-950"
                        : "border-cyan-300/30 bg-cyan-300/10 text-cyan-200",
                    )}
                  >
                    {answer.key}
                  </span>
                  <span className="pt-2 text-base leading-relaxed text-slate-100">{answer.text}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-6">
            <button
              type="button"
              onClick={() => goTo(currentIndex - 1)}
              disabled={currentIndex === 0}
              className="rounded-2xl border border-white/10 px-5 py-3 text-sm font-semibold text-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t("learn.previous")}
            </button>
            <button
              type="button"
              onClick={() => clearAnswer(current.question.id)}
              disabled={answers[current.question.id] === undefined}
              className="rounded-2xl px-4 py-3 text-sm font-semibold text-slate-400 underline-offset-4 hover:text-slate-200 hover:underline disabled:cursor-not-allowed disabled:opacity-30"
            >
              {t("exam.clear")}
            </button>
            {isLastQuestion ? (
              <button
                type="button"
                onClick={() => void submitExam()}
                className="rounded-2xl bg-emerald-400 px-6 py-3 text-sm font-bold text-slate-950 shadow-lg shadow-emerald-950/40 transition hover:bg-emerald-300"
              >
                {t("exam.submit")}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => goTo(currentIndex + 1)}
                className="rounded-2xl bg-cyan-300 px-6 py-3 text-sm font-bold text-slate-950 shadow-lg shadow-cyan-950/40 transition hover:bg-cyan-200"
              >
                {t("learn.next")}
              </button>
            )}
          </div>
        </article>

        {/* Review sheet sidebar */}
        <aside className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-slate-950/50 p-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300">{t("exam.reviewSheet")}</p>
            <p className="mt-2 text-sm text-slate-300">
              {t("exam.answeredSkipped", { answered: answeredCount, skipped: totalCount - answeredCount })}
            </p>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400 transition-all duration-300"
                style={{ width: `${totalCount ? (answeredCount / totalCount) * 100 : 0}%` }}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-3 text-[11px] text-slate-400">
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded bg-cyan-300" /> {t("exam.legendAnswered")}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded border border-white/25" /> {t("exam.legendSkipped")}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded ring-2 ring-cyan-300" /> {t("exam.legendCurrent")}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto pr-1">
            {exam?.sections.map((section, sectionIndex) => {
              const sectionStart = flatQuestions.find((item) => item.sectionIndex === sectionIndex)?.globalIndex ?? 0;
              return (
                <div key={section.category} className="mb-4">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    {t(`subject.${section.category}`)} · {section.duration_minutes}m
                  </p>
                  <div className="grid grid-cols-6 gap-1.5">
                    {section.questions.map((question, indexInSection) => {
                      const globalIndex = sectionStart + indexInSection;
                      const isAnswered = answers[question.id] !== undefined;
                      const isCurrent = globalIndex === currentIndex;
                      return (
                        <button
                          key={question.id}
                          type="button"
                          onClick={() => goTo(globalIndex)}
                          title={t("exam.questionCounter", { i: globalIndex + 1, n: totalCount })}
                          className={classNames(
                            "flex h-8 items-center justify-center rounded-lg text-xs font-semibold transition",
                            isAnswered ? "bg-cyan-300 text-slate-950" : "border border-white/15 text-slate-400 hover:border-cyan-300/50",
                            isCurrent && "ring-2 ring-cyan-300 ring-offset-2 ring-offset-slate-950",
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

          <button
            type="button"
            onClick={() => void submitExam()}
            disabled={phase === "submitting"}
            className="rounded-2xl bg-emerald-400 px-5 py-3 text-sm font-bold text-slate-950 shadow-lg shadow-emerald-950/40 transition hover:bg-emerald-300 disabled:opacity-50"
          >
            {phase === "submitting" ? t("exam.submitting") : t("exam.submit")}
          </button>
        </aside>
      </div>
    </section>
  );
}

// --------------------------------------------------------------------------- //
// Results screen
// --------------------------------------------------------------------------- //
function ExamResultScreen({
  result,
  questions,
  onExit,
  t,
}: {
  result: ExamSubmitResponse;
  questions: FlatQuestion[];
  onExit?: () => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
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

  return (
    <section className="min-h-[680px] rounded-[2rem] border border-cyan-400/10 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_34%),linear-gradient(145deg,_#020617,_#0f172a_58%,_#111827)] p-6 text-slate-100 shadow-2xl shadow-cyan-950/30">
      <header className="mb-8 flex flex-col items-center gap-3 border-b border-white/10 pb-8 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.35em] text-cyan-300">{t("result.kicker")}</p>
        <div
          className={classNames(
            "rounded-full px-8 py-3 text-3xl font-black tracking-wide",
            result.passed ? "bg-emerald-400/15 text-emerald-300" : "bg-red-500/15 text-red-300",
          )}
        >
          {result.passed ? t("result.passed") : t("result.failed")}
        </div>
        <p className="text-lg text-slate-200">
          {t("result.overall", {
            p: result.overall_score_percent,
            c: result.total_correct,
            t: result.total_questions,
          })}
        </p>
        <p className="text-sm text-slate-400">{t("result.threshold", { p: result.pass_threshold_percent })}</p>
      </header>

      <div className="grid gap-3">
        {result.sections.map((section) => (
          <div
            key={section.category}
            className={classNames(
              "flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between",
              section.passed ? "border-emerald-400/30 bg-emerald-400/5" : "border-red-400/30 bg-red-500/5",
            )}
          >
            <div className="flex items-center gap-3">
              <span
                className={classNames(
                  "flex h-9 w-9 items-center justify-center rounded-xl text-sm font-bold",
                  section.passed ? "bg-emerald-400 text-slate-950" : "bg-red-400 text-slate-950",
                )}
              >
                {section.passed ? "✓" : "✕"}
              </span>
              <div>
                <p className="font-semibold text-white">{t(`subject.${section.category}`)}</p>
                <p className="text-xs text-slate-400">
                  {t("result.sectionStats", {
                    correct: section.correct,
                    count: section.question_count,
                    answered: section.answered,
                  })}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="h-2 w-32 overflow-hidden rounded-full bg-white/10">
                <div
                  className={classNames("h-full rounded-full", section.passed ? "bg-emerald-400" : "bg-red-400")}
                  style={{ width: `${Math.min(100, section.score_percent)}%` }}
                />
              </div>
              <span className="w-14 text-right font-mono font-bold tabular-nums text-white">{section.score_percent}%</span>
            </div>
          </div>
        ))}
      </div>

      {/* Per-question review */}
      <div className="mt-10">
        <div className="mb-4 flex flex-col gap-3 border-b border-white/10 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-lg font-bold text-white">{t("result.reviewTitle")}</h3>
            <p className="text-sm text-slate-400">{t("result.reviewSummary", { wrong: wrongCount, total: reviewItems.length })}</p>
          </div>
          <div className="flex gap-1 rounded-2xl border border-white/10 bg-white/5 p-1 text-sm font-semibold">
            <button
              type="button"
              onClick={() => setOnlyWrong(true)}
              className={classNames("rounded-xl px-4 py-2 transition", onlyWrong ? "bg-cyan-300 text-slate-950" : "text-slate-300")}
            >
              {t("result.onlyWrong")}
            </button>
            <button
              type="button"
              onClick={() => setOnlyWrong(false)}
              className={classNames("rounded-xl px-4 py-2 transition", !onlyWrong ? "bg-cyan-300 text-slate-950" : "text-slate-300")}
            >
              {t("result.all")}
            </button>
          </div>
        </div>

        {visibleItems.length === 0 ? (
          <p className="rounded-2xl border border-emerald-400/30 bg-emerald-400/5 p-5 text-center text-emerald-200">
            {t("result.allCorrect")}
          </p>
        ) : (
          <div className="grid gap-4">
            {visibleItems.map(({ item, verdict }) => {
              const status = !verdict.answered ? "skipped" : verdict.is_correct ? "correct" : "wrong";
              return (
                <article
                  key={item.question.id}
                  className={classNames(
                    "rounded-2xl border p-5",
                    status === "correct"
                      ? "border-emerald-400/25 bg-emerald-400/5"
                      : status === "wrong"
                        ? "border-red-400/25 bg-red-500/5"
                        : "border-amber-300/25 bg-amber-400/5",
                  )}
                >
                  <div className="mb-3 flex items-center justify-between gap-3 text-xs uppercase tracking-[0.2em] text-slate-400">
                    <span>
                      #{item.globalIndex + 1} · {t(`subject.${item.sectionCategory}`)} · {item.question.external_id}
                    </span>
                    <span
                      className={classNames(
                        "rounded-full px-3 py-1 text-[11px] font-bold tracking-wider",
                        status === "correct"
                          ? "bg-emerald-400/15 text-emerald-300"
                          : status === "wrong"
                            ? "bg-red-500/15 text-red-300"
                            : "bg-amber-400/15 text-amber-200",
                      )}
                    >
                      {status === "correct"
                        ? t("result.badgeCorrect")
                        : status === "wrong"
                          ? t("result.badgeWrong")
                          : t("result.badgeSkipped")}
                    </span>
                  </div>
                  <p className="mb-4 font-semibold leading-relaxed text-white">{item.question.question_text}</p>
                  <div className="grid gap-2">
                    {item.question.answers.map((answer) => {
                      const isCorrect = answer.text === verdict.correct_answer;
                      const isPicked = verdict.selected_text === answer.text;
                      return (
                        <div
                          key={`${item.question.id}-${answer.key}`}
                          className={classNames(
                            "flex items-start gap-3 rounded-xl border px-4 py-3 text-sm",
                            isCorrect
                              ? "border-emerald-400/60 bg-emerald-400/10 text-emerald-100"
                              : isPicked
                                ? "border-red-400/60 bg-red-500/10 text-red-100"
                                : "border-white/10 text-slate-300",
                          )}
                        >
                          <span className="font-bold">{answer.key}</span>
                          <span className="flex-1 leading-relaxed">{answer.text}</span>
                          {isCorrect && <span className="text-xs font-bold text-emerald-300">{t("result.correctTag")}</span>}
                          {isPicked && !isCorrect && <span className="text-xs font-bold text-red-300">{t("result.yourChoice")}</span>}
                        </div>
                      );
                    })}
                  </div>
                  {status === "skipped" && <p className="mt-3 text-xs text-amber-200/80">{t("result.notAnswered")}</p>}
                </article>
              );
            })}
          </div>
        )}
      </div>

      {onExit && (
        <footer className="mt-8 flex justify-center">
          <button
            type="button"
            onClick={onExit}
            className="rounded-2xl bg-cyan-300 px-6 py-3 text-sm font-bold text-slate-950 shadow-lg shadow-cyan-950/40 transition hover:bg-cyan-200"
          >
            {t("result.back")}
          </button>
        </footer>
      )}
    </section>
  );
}

export default ExamView;
