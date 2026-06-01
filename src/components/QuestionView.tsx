import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  const [questions, setQuestions] = useState<ApiQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<LocalAnswerState | null>(null);
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

    const answerState: LocalAnswerState = {
      questionId: currentQuestion.id,
      selectedText: answer.text,
      status: answer.isCorrect ? "CORRECT" : "INCORRECT",
      answeredAt: new Date().toISOString(),
      clientEventId: crypto.randomUUID?.() ?? `${currentQuestion.id}:${Date.now()}`,
      synced: false,
    };

    // Synchronous local autosave happens before React state updates or network I/O.
    saveLocalAnswer(userId, answerState);
    setSelectedAnswer(answerState);
    syncProgress(answerState);
  };

  const goToNext = () => setCurrentIndex((index) => Math.min(index + 1, questions.length - 1));
  const goToPrevious = () => setCurrentIndex((index) => Math.max(index - 1, 0));

  if (isLoading) {
    return <section className="rounded-3xl border border-slate-800 bg-slate-950 p-8 text-slate-300">Loading flight deck…</section>;
  }

  if (error) {
    return <section className="rounded-3xl border border-red-900/70 bg-red-950/40 p-8 text-red-100">{error}</section>;
  }

  if (!currentQuestion) {
    return <section className="rounded-3xl border border-slate-800 bg-slate-950 p-8 text-slate-300">No questions found.</section>;
  }

  const progressPercent = Math.round(((currentIndex + 1) / questions.length) * 100);

  return (
    <section className="min-h-[680px] rounded-[2rem] border border-cyan-400/10 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_34%),linear-gradient(145deg,_#020617,_#0f172a_58%,_#111827)] p-6 text-slate-100 shadow-2xl shadow-cyan-950/30">
      <header className="mb-8 flex flex-col gap-4 border-b border-white/10 pb-6 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-cyan-300">PilotReady Training</p>
          <h2 className="mt-2 text-2xl font-bold text-white">{currentQuestion.category.replaceAll("_", " ")}</h2>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300 backdrop-blur">
          Question {currentIndex + 1} / {questions.length} · {progressPercent}% complete
        </div>
      </header>

      <article className="rounded-3xl border border-white/10 bg-slate-950/70 p-6 shadow-xl shadow-black/30">
        <div className="mb-5 flex items-center justify-between gap-4 text-xs uppercase tracking-[0.28em] text-slate-400">
          <span>{currentQuestion.external_id}</span>
          <span className="text-cyan-300">{syncState === "failed" ? "Saved locally · retry pending" : syncState}</span>
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
      </article>

      <footer className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={goToPrevious}
          disabled={currentIndex === 0}
          className="rounded-2xl border border-white/10 px-5 py-3 text-sm font-semibold text-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Previous
        </button>
        <p className="text-center text-sm text-slate-400">
          Answers save instantly to this device, then sync quietly to your PilotReady account.
        </p>
        <button
          type="button"
          onClick={goToNext}
          disabled={currentIndex === questions.length - 1}
          className="rounded-2xl bg-cyan-300 px-5 py-3 text-sm font-bold text-slate-950 shadow-lg shadow-cyan-950/40 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next
        </button>
      </footer>
    </section>
  );
}

export default QuestionView;
