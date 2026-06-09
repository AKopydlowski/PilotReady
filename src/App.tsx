import { useEffect, useMemo, useState } from "react";
import QuestionView from "./components/QuestionView";
import ExamView from "./components/ExamView";

type Category = {
  id: string;
  label: string;
  total: number;
  correct: number;
  incorrect: number;
  unattempted: number;
};

type View = { kind: "dashboard" } | { kind: "learn"; categoryId: string; label: string } | { kind: "exam" };

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

export default function App() {
  const userId = useDemoUserId();
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
        if (!response.ok) throw new Error(`Nie udało się pobrać kategorii (${response.status})`);
        return response.json() as Promise<Category[]>;
      })
      .then(setCategories)
      .catch((fetchError: Error) => {
        if (fetchError.name !== "AbortError") setError(fetchError.message);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [userId, view.kind]);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.08),_transparent_45%)] px-4 py-6 md:px-8">
      <div className="mx-auto max-w-6xl">
        <nav className="mb-8 flex items-center justify-between">
          <button type="button" onClick={() => setView({ kind: "dashboard" })} className="flex items-center gap-3 text-left">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-cyan-300 text-lg font-black text-slate-950">PR</span>
            <span>
              <span className="block text-lg font-bold text-white">PilotReady</span>
              <span className="block text-xs uppercase tracking-[0.3em] text-cyan-300">PPL(A)</span>
            </span>
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setView({ kind: "dashboard" })}
              className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${
                view.kind !== "exam" ? "bg-white/10 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              Nauka
            </button>
            <button
              type="button"
              onClick={() => setView({ kind: "exam" })}
              className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${
                view.kind === "exam" ? "bg-cyan-300 text-slate-950" : "bg-white/5 text-slate-200 hover:bg-white/10"
              }`}
            >
              Egzamin ULC
            </button>
          </div>
        </nav>

        {view.kind === "exam" && <ExamView onExit={() => setView({ kind: "dashboard" })} />}

        {view.kind === "learn" && (
          <div>
            <button
              type="button"
              onClick={() => setView({ kind: "dashboard" })}
              className="mb-4 text-sm text-cyan-300 hover:underline"
            >
              ← Wróć do przedmiotów
            </button>
            <QuestionView userId={userId} categoryId={view.categoryId} />
          </div>
        )}

        {view.kind === "dashboard" && (
          <main>
            <header className="mb-8">
              <h1 className="text-3xl font-bold text-white">Twoje przedmioty</h1>
              <p className="mt-2 text-slate-400">Ucz się pytaniami z banku PPL(A) lub podejdź do pełnej symulacji egzaminu ULC.</p>
            </header>

            {loading && <p className="text-slate-400">Ładowanie…</p>}
            {error && <p className="rounded-2xl border border-red-900/70 bg-red-950/40 p-4 text-red-100">{error}</p>}

            {!loading && !error && (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {categories.map((category) => {
                  const attempted = category.correct + category.incorrect;
                  const percent = category.total ? Math.round((attempted / category.total) * 100) : 0;
                  return (
                    <button
                      key={category.id}
                      type="button"
                      onClick={() => setView({ kind: "learn", categoryId: category.id, label: category.label })}
                      className="group flex flex-col rounded-3xl border border-white/10 bg-slate-950/60 p-5 text-left transition hover:-translate-y-0.5 hover:border-cyan-300/60 hover:bg-cyan-300/5"
                    >
                      <span className="text-base font-semibold text-white">{category.label}</span>
                      <span className="mt-1 text-sm text-slate-400">{category.total} pytań w banku</span>
                      <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-white/10">
                        <div className="h-full rounded-full bg-cyan-300 transition-all" style={{ width: `${percent}%` }} />
                      </div>
                      <span className="mt-2 text-xs text-slate-500">
                        {attempted}/{category.total} przerobionych · {category.correct} poprawnych
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </main>
        )}
      </div>
    </div>
  );
}
