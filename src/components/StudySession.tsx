import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "../i18n";

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
  userId: string;
  source: StudySource;
  apiBaseUrl?: string;
  onExit?: () => void;
};

const BATCH_SIZE = 10;

function classNames(...names: Array<string | false | null | undefined>) {
  return names.filter(Boolean).join(" ");
}

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

export function StudySession({ userId, source, apiBaseUrl = "", onExit }: StudySessionProps) {
  const { t } = useI18n();
  const [questions, setQuestions] = useState<ApiQuestion[]>([]);
  const [statuses, setStatuses] = useState<Record<string, ProgressStatus>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Current batch state.
  const [batch, setBatch] = useState<BatchEntry[]>([]);
  const [batchPos, setBatchPos] = useState(0);
  const [picked, setPicked] = useState<string | null>(null); // selected answer text for current question
  const [batchWrong, setBatchWrong] = useState<ApiQuestion[]>([]);
  const [batchDoneCount, setBatchDoneCount] = useState(0);
  const [sessionNumber, setSessionNumber] = useState(0);
  const [phase, setPhase] = useState<"answering" | "batchResult">("answering");

  const fetchUrl =
    source.kind === "category"
      ? `${apiBaseUrl}/api/questions/${source.categoryId}`
      : `${apiBaseUrl}/api/mistakes${source.categoryId ? `?category=${source.categoryId}` : ""}`;

  // ----- Load the question pool ---------------------------------------------
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch(fetchUrl, { headers: { "X-User-Id": userId }, signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`(${response.status})`);
        return response.json() as Promise<ApiQuestion[]>;
      })
      .then((payload) => {
        setQuestions(payload);
        const seeded: Record<string, ProgressStatus> = {};
        for (const q of payload) if (q.progress_status === "CORRECT" || q.progress_status === "INCORRECT") seeded[q.id] = q.progress_status;
        setStatuses(seeded);
      })
      .catch((fetchError: Error) => {
        if (fetchError.name !== "AbortError") setError(fetchError.message);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [fetchUrl, userId]);

  // Questions still to master = not yet answered correctly in this session.
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
    setBatchWrong([]);
    setBatchDoneCount(0);
    setSessionNumber((n) => n + 1);
    setPhase("answering");
  }, [questions, statuses]);

  // Kick off the first batch once questions arrive.
  useEffect(() => {
    if (!loading && !error && questions.length > 0 && sessionNumber === 0 && remaining.length > 0) {
      startNextBatch();
    }
  }, [loading, error, questions.length, sessionNumber, remaining.length, startNextBatch]);

  const syncProgress = useCallback(
    (questionId: string, status: ProgressStatus) => {
      void fetch(`${apiBaseUrl}/api/progress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, question_id: questionId, status }),
      }).catch(() => {
        /* best-effort; UI already reflects the answer locally */
      });
    },
    [apiBaseUrl, userId],
  );

  const current = batch[batchPos];

  const handlePick = (answer: ShuffledAnswer) => {
    if (picked || !current) return;
    const status: ProgressStatus = answer.isCorrect ? "CORRECT" : "INCORRECT";
    setPicked(answer.text);
    setStatuses((prev) => ({ ...prev, [current.question.id]: status }));
    if (status === "INCORRECT") setBatchWrong((prev) => [...prev, current.question]);
    syncProgress(current.question.id, status);
  };

  const advance = () => {
    setBatchDoneCount((n) => n + 1);
    if (batchPos + 1 >= batch.length) {
      setPhase("batchResult");
    } else {
      setBatchPos((p) => p + 1);
      setPicked(null);
    }
  };

  const heading =
    source.kind === "category"
      ? t(`subject.${source.categoryId}`)
      : source.categoryId
        ? t(`subject.${source.categoryId}`)
        : t("study.mistakesHeading");

  // ----- Render -------------------------------------------------------------
  if (loading) {
    return <section className="rounded-3xl border border-slate-800 bg-slate-950 p-8 text-slate-300">{t("learn.loading")}</section>;
  }
  if (error) {
    return <section className="rounded-3xl border border-red-900/70 bg-red-950/40 p-8 text-red-100">{t("dashboard.error", { status: error })}</section>;
  }

  const allMastered = remaining.length === 0;
  const masteryPercent = questions.length ? Math.round((masteredCount / questions.length) * 100) : 0;

  // Empty pool (e.g. no mistakes yet) or everything mastered.
  if (questions.length === 0 || allMastered) {
    return (
      <section className="grid min-h-[480px] place-items-center rounded-[2rem] border border-emerald-400/20 bg-slate-950/70 p-8 text-center">
        <div className="flex flex-col items-center gap-4">
          <span className="text-5xl">🎉</span>
          <h2 className="text-2xl font-bold text-white">
            {questions.length === 0 && source.kind === "mistakes" ? t("study.noMistakes") : t("study.mastered")}
          </h2>
          {questions.length > 0 && <p className="text-slate-400">{t("study.masteredSubtitle", { total: questions.length })}</p>}
          {onExit && (
            <button type="button" onClick={onExit} className="mt-2 rounded-2xl bg-cyan-300 px-6 py-3 text-sm font-bold text-slate-950 hover:bg-cyan-200">
              {t("result.back")}
            </button>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="min-h-[680px] rounded-[2rem] border border-cyan-400/10 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_34%),linear-gradient(145deg,_#020617,_#0f172a_58%,_#111827)] p-6 text-slate-100 shadow-2xl shadow-cyan-950/30">
      {/* Header: subject + mastery progress */}
      <header className="mb-6 flex flex-col gap-4 border-b border-white/10 pb-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-cyan-300">
              {source.kind === "mistakes" ? t("study.mistakesKicker") : t("learn.kicker")} · {t("study.sessionLabel", { n: sessionNumber })}
            </p>
            <h2 className="mt-2 text-2xl font-bold text-white">{heading}</h2>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
            {t("study.masteryProgress", { m: masteredCount, t: questions.length })}
          </div>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400 transition-all duration-500" style={{ width: `${masteryPercent}%` }} />
        </div>
      </header>

      {phase === "answering" && current && (
        <article className="rounded-3xl border border-white/10 bg-slate-950/70 p-6 shadow-xl shadow-black/30">
          <div className="mb-5 flex items-center justify-between gap-4 text-xs uppercase tracking-[0.28em] text-slate-400">
            <span>{t("study.batchCounter", { i: batchPos + 1, n: batch.length })}</span>
            <span>{current.question.external_id}</span>
          </div>
          <h3 className="text-xl font-semibold leading-relaxed text-white md:text-2xl">{current.question.question_text}</h3>

          <div className="mt-8 grid gap-4">
            {current.answers.map((answer, index) => {
              const isPicked = picked === answer.text;
              const reveal = Boolean(picked);
              return (
                <button
                  key={`${current.question.id}-${index}`}
                  type="button"
                  disabled={reveal}
                  onClick={() => handlePick(answer)}
                  className={classNames(
                    "group flex w-full items-start gap-4 rounded-2xl border p-5 text-left transition duration-200",
                    "bg-white/[0.035] hover:-translate-y-0.5 hover:border-cyan-300/70 hover:bg-cyan-300/10",
                    reveal && answer.isCorrect && "border-emerald-400/80 bg-emerald-400/10",
                    reveal && isPicked && !answer.isCorrect && "border-red-400/80 bg-red-500/10",
                    !reveal && "border-white/10",
                    reveal && !answer.isCorrect && !isPicked && "border-white/10 opacity-60",
                  )}
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-300/30 bg-cyan-300/10 font-bold text-cyan-200">
                    {["A", "B", "C", "D"][index] ?? index + 1}
                  </span>
                  <span className="pt-2 text-base leading-relaxed text-slate-100">{answer.text}</span>
                </button>
              );
            })}
          </div>

          {picked && (
            <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <p
                className={classNames(
                  "rounded-2xl border px-5 py-3 text-sm font-semibold",
                  statuses[current.question.id] === "CORRECT"
                    ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200"
                    : "border-red-400/40 bg-red-500/10 text-red-200",
                )}
              >
                {statuses[current.question.id] === "CORRECT" ? t("learn.correct") : t("learn.incorrect")}
              </p>
              <button
                type="button"
                onClick={advance}
                className="rounded-2xl bg-cyan-300 px-6 py-3 text-sm font-bold text-slate-950 shadow-lg shadow-cyan-950/40 transition hover:bg-cyan-200"
              >
                {batchPos + 1 >= batch.length ? t("study.seeResult") : t("learn.next")}
              </button>
            </div>
          )}
        </article>
      )}

      {phase === "batchResult" && (
        <article className="rounded-3xl border border-white/10 bg-slate-950/70 p-6 text-center shadow-xl shadow-black/30">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-cyan-300">{t("study.batchResultTitle")}</p>
          <p className="mt-3 text-4xl font-black text-white">
            {t("study.batchScore", { correct: batchDoneCount - batchWrong.length, total: batchDoneCount })}
          </p>

          {batchWrong.length > 0 && (
            <div className="mx-auto mt-6 max-w-xl text-left">
              <p className="mb-2 text-sm font-semibold text-red-300">{t("study.wrongInBatch")}</p>
              <ul className="grid gap-2">
                {batchWrong.map((question) => (
                  <li key={question.id} className="rounded-xl border border-red-400/25 bg-red-500/5 px-4 py-2 text-sm text-slate-200">
                    {question.question_text}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            {remaining.length > 0 ? (
              <button
                type="button"
                onClick={startNextBatch}
                className="rounded-2xl bg-cyan-300 px-6 py-3 text-sm font-bold text-slate-950 shadow-lg shadow-cyan-950/40 transition hover:bg-cyan-200"
              >
                {t("study.nextBatch", { n: Math.min(BATCH_SIZE, remaining.length) })}
              </button>
            ) : (
              <p className="text-lg font-bold text-emerald-300">{t("study.mastered")}</p>
            )}
            {onExit && (
              <button
                type="button"
                onClick={onExit}
                className="rounded-2xl border border-white/10 px-6 py-3 text-sm font-semibold text-slate-200 hover:bg-white/5"
              >
                {t("study.finish")}
              </button>
            )}
          </div>
          <p className="mt-4 text-xs text-slate-500">{t("study.masteryProgress", { m: masteredCount, t: questions.length })}</p>
        </article>
      )}
    </section>
  );
}

export default StudySession;
