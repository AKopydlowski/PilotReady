import { useEffect, useMemo, useState } from "react";
import StudySession, { type StudySource } from "./components/StudySession";
import ExamView from "./components/ExamView";
import { useI18n, type Lang } from "./i18n";

type Category = {
  id: string;
  label: string;
  total: number;
  correct: number;
  incorrect: number;
  unattempted: number;
};

type View = { kind: "dashboard" } | { kind: "study"; source: StudySource } | { kind: "exam" };

// A stable demo user id so learning progress persists across reloads. A real
// build would obtain this from authentication.
function useDemoUserId(): string {
  return useMemo(() => {
    const key = "pilotready:demo-user-id";
    const existing = window.localStorage.getItem(key);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    window.localStorage.setItem(key, fresh);
    return fresh;
  }, []);
}

function LanguageToggle() {
  const { lang, setLang } = useI18n();
  return (
    <div className="flex gap-1 rounded-2xl border border-white/10 bg-white/5 p-1 text-xs font-bold">
      {(["pl", "en"] as Lang[]).map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => setLang(code)}
          className={`rounded-xl px-3 py-1.5 uppercase transition ${
            lang === code ? "bg-cyan-300 text-slate-950" : "text-slate-400 hover:text-white"
          }`}
        >
          {code}
        </button>
      ))}
    </div>
  );
}

export default function App() {
  const userId = useDemoUserId();
  const { t } = useI18n();
  const [view, setView] = useState<View>({ kind: "dashboard" });
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (view.kind !== "dashboard") return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch("/api/categories", { headers: { "X-User-Id": userId }, signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(t("dashboard.error", { status: response.status }));
        return response.json() as Promise<Category[]>;
      })
      .then(setCategories)
      .catch((fetchError: Error) => {
        if (fetchError.name !== "AbortError") setError(fetchError.message);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [userId, view.kind, t]);

  const totalMistakes = useMemo(() => categories.reduce((sum, category) => sum + category.incorrect, 0), [categories]);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.08),_transparent_45%)] px-4 py-6 md:px-8">
      <div className="mx-auto max-w-6xl">
        <nav className="mb-8 flex items-center justify-between gap-4">
          <button type="button" onClick={() => setView({ kind: "dashboard" })} className="flex items-center gap-3 text-left">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-cyan-300 text-lg font-black text-slate-950">PR</span>
            <span>
              <span className="block text-lg font-bold text-white">PilotReady</span>
              <span className="block text-xs uppercase tracking-[0.3em] text-cyan-300">{t("app.tagline")}</span>
            </span>
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setView({ kind: "dashboard" })}
              className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${
                view.kind !== "exam" ? "bg-white/10 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              {t("nav.learn")}
            </button>
            <button
              type="button"
              onClick={() => setView({ kind: "exam" })}
              className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${
                view.kind === "exam" ? "bg-cyan-300 text-slate-950" : "bg-white/5 text-slate-200 hover:bg-white/10"
              }`}
            >
              {t("nav.exam")}
            </button>
            <LanguageToggle />
          </div>
        </nav>

        {view.kind === "exam" && <ExamView onExit={() => setView({ kind: "dashboard" })} />}

        {view.kind === "study" && (
          <div>
            <button
              type="button"
              onClick={() => setView({ kind: "dashboard" })}
              className="mb-4 text-sm text-cyan-300 hover:underline"
            >
              {t("learn.back")}
            </button>
            <StudySession userId={userId} source={view.source} onExit={() => setView({ kind: "dashboard" })} />
          </div>
        )}

        {view.kind === "dashboard" && (
          <main>
            <header className="mb-8">
              <h1 className="text-3xl font-bold text-white">{t("dashboard.title")}</h1>
              <p className="mt-2 text-slate-400">{t("dashboard.subtitle")}</p>
            </header>

            {loading && <p className="text-slate-400">{t("dashboard.loading")}</p>}
            {error && <p className="rounded-2xl border border-red-900/70 bg-red-950/40 p-4 text-red-100">{error}</p>}

            {!loading && !error && (
              <>
                {/* Mistakes review pool */}
                <button
                  type="button"
                  disabled={totalMistakes === 0}
                  onClick={() => setView({ kind: "study", source: { kind: "mistakes" } })}
                  className={`mb-8 flex w-full items-center justify-between gap-4 rounded-3xl border p-5 text-left transition ${
                    totalMistakes > 0
                      ? "border-red-400/40 bg-red-500/10 hover:-translate-y-0.5 hover:border-red-300/70"
                      : "cursor-default border-white/10 bg-slate-950/60"
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <span className="grid h-12 w-12 place-items-center rounded-2xl bg-red-500/20 text-2xl">🔁</span>
                    <div>
                      <p className="text-lg font-bold text-white">{t("dashboard.mistakesCard")}</p>
                      <p className="text-sm text-slate-300">
                        {totalMistakes > 0 ? t("dashboard.mistakesCardCount", { n: totalMistakes }) : t("dashboard.mistakesCardEmpty")}
                      </p>
                    </div>
                  </div>
                  {totalMistakes > 0 && (
                    <span className="rounded-2xl bg-red-400 px-5 py-3 text-sm font-bold text-slate-950">{t("dashboard.mistakesStart")}</span>
                  )}
                </button>

                <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300">{t("dashboard.subjectsHeading")}</h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {categories.map((category) => {
                    const attempted = category.correct + category.incorrect;
                    const percent = category.total ? Math.round((category.correct / category.total) * 100) : 0;
                    return (
                      <button
                        key={category.id}
                        type="button"
                        onClick={() => setView({ kind: "study", source: { kind: "category", categoryId: category.id } })}
                        className="group flex flex-col rounded-3xl border border-white/10 bg-slate-950/60 p-5 text-left transition hover:-translate-y-0.5 hover:border-cyan-300/60 hover:bg-cyan-300/5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-base font-semibold text-white">{t(`subject.${category.id}`)}</span>
                          {category.incorrect > 0 && (
                            <span className="shrink-0 rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-bold text-red-300">
                              {category.incorrect} ✕
                            </span>
                          )}
                        </div>
                        <span className="mt-1 text-sm text-slate-400">{t("dashboard.questionsInBank", { n: category.total })}</span>
                        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-white/10">
                          <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400 transition-all" style={{ width: `${percent}%` }} />
                        </div>
                        <span className="mt-2 text-xs text-slate-500">
                          {t("dashboard.progress", { a: attempted, t: category.total, c: category.correct })}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </main>
        )}
      </div>
    </div>
  );
}
