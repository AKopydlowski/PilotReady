import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n";

type ProgressStatus = "CORRECT" | "INCORRECT";

type ApiAnswer = {
  key: string;
  text: string;
};

export type ApiQuestion = {
  id: string;
  external_id: string;
  category: string;
  question_text: string;
  correct_answer: string;
  answers: ApiAnswer[];
  progress_status?: ProgressStatus | null;
};

type ShuffledAnswer = ApiAnswer & {
  displayKey: string;
  isCorrect: boolean;
};

type LocalAnswerState = {
  questionId: string;
  selectedText: string;
  status: ProgressStatus;
  answeredAt: string;
  clientEventId: string;
  synced: boolean;
};

type QuestionViewProps = {
  userId: string;
  categoryId: string;
  apiBaseUrl?: string;
};

const OPTION_LABELS = ["A", "B", "C", "D"] as const;
const SYNC_DEBOUNCE_MS = 650;

function localStorageKey(userId: string, questionId: string) {
  return `pilotready:answer:${userId}:${questionId}`;
}

function loadLocalAnswer(userId: string, questionId: string): LocalAnswerState | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(localStorageKey(userId, questionId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LocalAnswerState;
  } catch {
    return null;
  }
}

function saveLocalAnswer(userId: string, answerState: LocalAnswerState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(localStorageKey(userId, answerState.questionId), JSON.stringify(answerState));
}

function markLocalAnswerSynced(userId: string, answerState: LocalAnswerState) {
  saveLocalAnswer(userId, { ...answerState, synced: true });
}

function shuffleAnswers(question: ApiQuestion): ShuffledAnswer[] {
  const shuffled = question.answers.map((answer) => ({
    ...answer,
    isCorrect: answer.key === "A" || answer.text === question.correct_answer,
  }));

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled.map((answer, index) => ({ ...answer, displayKey: OPTION_LABELS[index] ?? String(index + 1) }));
}

function classNames(...names: Array<string | false | null | undefined>) {
  return names.filter(Boolean).join(" ");
}

export function QuestionView({ userId, categoryId, apiBaseUrl = "" }: QuestionViewProps) {
  const { t } = useI18n();
  const [questions, setQuestions] = useState<ApiQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<LocalAnswerState | null>(null);
  // questionId -> latest known result, seeded from the server and updated as the
  // learner answers. Drives the "your mistakes" review panel.
  const [statuses, setStatuses] = useState<Record<string, ProgressStatus>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<"idle" | "queued" | "syncing" | "synced" | "failed">("idle");
  const syncTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setError(null);

    fetch(`${apiBaseUrl}/api/questions/${categoryId}`, {
      headers: { "X-User-Id": userId },
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`Failed to load questions (${response.status})`);
        return response.json() as Promise<ApiQuestion[]>;
      })
      .then((payload) => {
        setQuestions(payload);
        setCurrentIndex(0);
        // Seed statuses from the server, then overlay any locally-saved answers.
        const seeded: Record<string, ProgressStatus> = {};
        for (const question of payload) {
          const local = loadLocalAnswer(userId, question.id);
          const status = local?.status ?? question.progress_status ?? null;
          if (status === "CORRECT" || status === "INCORRECT") seeded[question.id] = status;
        }
        setStatuses(seeded);
      })
      .catch((fetchError: Error) => {
        if (fetchError.name !== "AbortError") setError(fetchError.message);
      })
      .finally(() => setIsLoading(false));

    return () => controller.abort();
  }, [apiBaseUrl, categoryId, userId]);

  const currentQuestion = questions[currentIndex];

  const shuffledAnswers = useMemo(() => {
    if (!currentQuestion) return [];
    return shuffleAnswers(currentQuestion);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQuestion?.id]);

  const syncProgress = useCallback(
    (answerState: LocalAnswerState) => {
      setSyncState("queued");
      if (syncTimeoutRef.current) window.clearTimeout(syncTimeoutRef.current);

      syncTimeoutRef.current = window.setTimeout(async () => {
        setSyncState("syncing");
        try {
          const response = await fetch(`${apiBaseUrl}/api/progress`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              user_id: userId,
              question_id: answerState.questionId,
              status: answerState.status,
              client_event_id: answerState.clientEventId,
            }),
          });
          if (!response.ok) throw new Error(`Progress sync failed (${response.status})`);
          markLocalAnswerSynced(userId, answerState);
          setSyncState("synced");
        } catch {
          setSyncState("failed");
        }
      }, SYNC_DEBOUNCE_MS);
    },
    [apiBaseUrl, userId],
  );

  useEffect(() => {
    if (!currentQuestion) {
      setSelectedAnswer(null);
      return;
    }
    const localAnswer = loadLocalAnswer(userId, currentQuestion.id);
    setSelectedAnswer(localAnswer);
    setSyncState(localAnswer?.synced ? "synced" : "idle");
    if (localAnswer && !localAnswer.synced) syncProgress(localAnswer);
  }, [currentQuestion, syncProgress, userId]);

  useEffect(() => {
    return () => {
      if (syncTimeoutRef.current) window.clearTimeout(syncTimeoutRef.current);
    };
  }, []);

  const handleAnswerClick = (answer: ShuffledAnswer) => {
    if (!currentQuestion || selectedAnswer) return;

    const status: ProgressStatus = answer.isCorrect ? "CORRECT" : "INCORRECT";
    const answerState: LocalAnswerState = {
      questionId: currentQuestion.id,
      selectedText: answer.text,
      status,
      answeredAt: new Date().toISOString(),
      clientEventId: crypto.randomUUID?.() ?? `${currentQuestion.id}:${Date.now()}`,
      synced: false,
    };

    // Synchronous local autosave happens before React state updates or network I/O.
    saveLocalAnswer(userId, answerState);
    setSelectedAnswer(answerState);
    setStatuses((prev) => ({ ...prev, [currentQuestion.id]: status }));
    syncProgress(answerState);
  };

  const goToNext = () => setCurrentIndex((index) => Math.min(index + 1, questions.length - 1));
  const goToPrevious = () => setCurrentIndex((index) => Math.max(index - 1, 0));

  // Indexes of questions answered incorrectly — powers the mistakes review panel.
  const mistakeIndexes = useMemo(
    () => questions.map((question, index) => ({ question, index })).filter(({ question }) => statuses[question.id] === "INCORRECT"),
    [questions, statuses],
  );

  if (isLoading) {
    return <section className="rounded-3xl border border-slate-800 bg-slate-950 p-8 text-slate-300">{t("learn.loading")}</section>;
  }

  if (error) {
    return <section className="rounded-3xl border border-red-900/70 bg-red-950/40 p-8 text-red-100">{error}</section>;
  }

  if (!currentQuestion) {
    return <section className="rounded-3xl border border-slate-800 bg-slate-950 p-8 text-slate-300">{t("learn.empty")}</section>;
  }

  const progressPercent = Math.round(((currentIndex + 1) / questions.length) * 100);

  return (
    <section className="min-h-[680px] rounded-[2rem] border border-cyan-400/10 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_34%),linear-gradient(145deg,_#020617,_#0f172a_58%,_#111827)] p-6 text-slate-100 shadow-2xl shadow-cyan-950/30">
      <header className="mb-8 flex flex-col gap-4 border-b border-white/10 pb-6 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-cyan-300">{t("learn.kicker")}</p>
          <h2 className="mt-2 text-2xl font-bold text-white">{t(`subject.${currentQuestion.category}`)}</h2>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300 backdrop-blur">
          {t("learn.questionCounter", { i: currentIndex + 1, n: questions.length, p: progressPercent })}
        </div>
      </header>

      <article className="rounded-3xl border border-white/10 bg-slate-950/70 p-6 shadow-xl shadow-black/30">
        <div className="mb-5 flex items-center justify-between gap-4 text-xs uppercase tracking-[0.28em] text-slate-400">
          <span>{currentQuestion.external_id}</span>
          <span className="text-cyan-300">{t(`sync.${syncState}`)}</span>
        </div>
        <h3 className="text-2xl font-semibold leading-relaxed text-white">{currentQuestion.question_text}</h3>

        <div className="mt-8 grid gap-4">
          {shuffledAnswers.map((answer) => {
            const isSelected = selectedAnswer?.selectedText === answer.text;
            const reveal = Boolean(selectedAnswer);
            return (
              <button
                key={`${currentQuestion.id}-${answer.key}`}
                type="button"
                disabled={Boolean(selectedAnswer)}
                onClick={() => handleAnswerClick(answer)}
                className={classNames(
                  "group flex w-full items-start gap-4 rounded-2xl border p-5 text-left transition duration-200",
                  "bg-white/[0.035] hover:-translate-y-0.5 hover:border-cyan-300/70 hover:bg-cyan-300/10 hover:shadow-lg hover:shadow-cyan-950/40",
                  reveal && answer.isCorrect && "border-emerald-400/80 bg-emerald-400/10",
                  reveal && isSelected && !answer.isCorrect && "border-red-400/80 bg-red-500/10",
                  !reveal && "border-white/10",
                  reveal && !answer.isCorrect && !isSelected && "border-white/10 opacity-60",
                )}
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-300/30 bg-cyan-300/10 font-bold text-cyan-200">
                  {answer.displayKey}
                </span>
                <span className="pt-2 text-base leading-relaxed text-slate-100">{answer.text}</span>
              </button>
            );
          })}
        </div>

        {selectedAnswer && (
          <p
            className={classNames(
              "mt-6 rounded-2xl border px-5 py-3 text-sm font-semibold",
              selectedAnswer.status === "CORRECT"
                ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200"
                : "border-red-400/40 bg-red-500/10 text-red-200",
            )}
          >
            {selectedAnswer.status === "CORRECT" ? t("learn.correct") : t("learn.incorrect")}
          </p>
        )}
      </article>

      <footer className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={goToPrevious}
          disabled={currentIndex === 0}
          className="rounded-2xl border border-white/10 px-5 py-3 text-sm font-semibold text-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t("learn.previous")}
        </button>
        <p className="text-center text-sm text-slate-400">{t("learn.footer")}</p>
        <button
          type="button"
          onClick={goToNext}
          disabled={currentIndex === questions.length - 1}
          className="rounded-2xl bg-cyan-300 px-5 py-3 text-sm font-bold text-slate-950 shadow-lg shadow-cyan-950/40 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t("learn.next")}
        </button>
      </footer>

      {/* Your mistakes — only the questions answered incorrectly, jumpable. */}
      <div className="mt-8 rounded-3xl border border-white/10 bg-slate-950/50 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
          <div>
            <h3 className="text-lg font-bold text-white">{t("learn.mistakesTitle")}</h3>
            <p className="text-sm text-slate-400">{t("learn.mistakesSubtitle")}</p>
          </div>
          {mistakeIndexes.length > 0 && (
            <span className="rounded-full bg-red-500/15 px-3 py-1 text-xs font-bold text-red-300">
              {t("learn.mistakesCount", { n: mistakeIndexes.length })}
            </span>
          )}
        </div>

        {mistakeIndexes.length === 0 ? (
          <p className="mt-4 text-sm text-emerald-200">{t("learn.mistakesEmpty")}</p>
        ) : (
          <ol className="mt-4 grid gap-2">
            {mistakeIndexes.map(({ question, index }) => (
              <li key={question.id}>
                <button
                  type="button"
                  onClick={() => setCurrentIndex(index)}
                  className={classNames(
                    "flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition hover:border-cyan-300/60 hover:bg-cyan-300/5",
                    index === currentIndex ? "border-cyan-300/60 bg-cyan-300/10" : "border-white/10",
                  )}
                >
                  <span className="flex h-7 w-9 shrink-0 items-center justify-center rounded-lg bg-red-500/20 text-xs font-bold text-red-300">
                    {index + 1}
                  </span>
                  <span className="flex-1 truncate text-sm text-slate-200">{question.question_text}</span>
                  <span className="shrink-0 text-[11px] uppercase tracking-wider text-slate-500">{question.external_id}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

export default QuestionView;
