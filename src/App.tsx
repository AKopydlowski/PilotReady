// PilotReady
// Copyright (c) 2026 Aleksander Kopydłowski. All rights reserved.
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//
// NOTE: licensing stub - to be reviewed/refined later.

import { useEffect, useMemo, useState } from "react";
import StudySession, { type StudySource } from "./components/StudySession";
import ExamView from "./components/ExamView";
import AuthScreen from "./components/AuthScreen";
import SupportView from "./components/SupportView";
import { apiJson } from "./api";
import { useAuth } from "./auth";
import { useI18n, type Lang } from "./i18n";

type Category = {
  id: string;
  label: string;
  total: number;
  correct: number;
  incorrect: number;
  unattempted: number;
};

type View = { kind: "dashboard" } | { kind: "study"; source: StudySource } | { kind: "exam" } | { kind: "support" };

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
  const { t } = useI18n();
  const { user, loading: authLoading, logout } = useAuth();
  const [view, setView] = useState<View>({ kind: "dashboard" });
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user || view.kind !== "dashboard") return;
    setLoading(true);
    setError(null);
    apiJson<Category[]>("/api/categories")
      .then(setCategories)
      .catch((fetchError: Error) => setError(fetchError.message))
      .finally(() => setLoading(false));
  }, [user, view.kind]);

  const totalMistakes = useMemo(() => categories.reduce((sum, category) => sum + category.incorrect, 0), [categories]);

  // While we validate a stored token, show a neutral splash.
  if (authLoading) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-950 text-slate-400">
        <p className="text-sm uppercase tracking-[0.35em] text-cyan-300">{t("auth.loading")}</p>
      </div>
    );
  }

  // Not logged in → the auth gate. Nothing behind it is reachable.
  if (!user) return <AuthScreen />;

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
                view.kind === "dashboard" || view.kind === "study" ? "bg-white/10 text-white" : "text-slate-400 hover:text-white"
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
            <button
              type="button"
              onClick={() => setView({ kind: "support" })}
              className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${
                view.kind === "support" ? "bg-cyan-300 text-slate-950" : "bg-white/5 text-slate-200 hover:bg-white/10"
              }`}
            >
              {t("nav.support")}
            </button>
            <LanguageToggle />
            <div className="ml-1 flex items-center gap-2 border-l border-white/10 pl-3">
              <span className="hidden max-w-[12rem] truncate text-xs text-slate-400 sm:block" title={user.email}>
                {user.display_name || user.email}
              </span>
              <button
                type="button"
                onClick={logout}
                className="rounded-2xl border border-white/10 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-red-400/50 hover:text-red-200"
              >
                {t("nav.logout")}
              </button>
            </div>
          </div>
        </nav>

        {view.kind === "exam" && <ExamView onExit={() => setView({ kind: "dashboard" })} />}

        {view.kind === "support" && <SupportView />}

        {view.kind === "study" && (
          <div>
            <button
              type="button"
              onClick={() => setView({ kind: "dashboard" })}
              className="mb-4 text-sm text-cyan-300 hover:underline"
            >
              {t("learn.back")}
            </button>
            <StudySession source={view.source} onExit={() => setView({ kind: "dashboard" })} />
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
                        <span className="text-base font-semibold text-white">{t(`subject.${category.id}`)}</span>
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

                {/* Mistakes review — below the subjects, split per subject + an all-in-one option. */}
                <section className="mt-10">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300">{t("dashboard.mistakesCard")}</h2>
                    {totalMistakes > 0 && (
                      <button
                        type="button"
                        onClick={() => setView({ kind: "study", source: { kind: "mistakes" } })}
                        className="rounded-2xl bg-red-400 px-5 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-red-300"
                      >
                        {t("dashboard.mistakesStart")} ({totalMistakes})
                      </button>
                    )}
                  </div>

                  {totalMistakes === 0 ? (
                    <p className="rounded-2xl border border-emerald-400/25 bg-emerald-400/5 p-5 text-sm text-emerald-200">
                      {t("dashboard.mistakesCardEmpty")}
                    </p>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {categories
                        .filter((category) => category.incorrect > 0)
                        .map((category) => (
                          <button
                            key={`mistakes-${category.id}`}
                            type="button"
                            onClick={() => setView({ kind: "study", source: { kind: "mistakes", categoryId: category.id } })}
                            className="flex items-center justify-between gap-3 rounded-2xl border border-red-400/30 bg-red-500/5 px-4 py-3 text-left transition hover:-translate-y-0.5 hover:border-red-300/60"
                          >
                            <span className="text-sm font-semibold text-white">{t(`subject.${category.id}`)}</span>
                            <span className="shrink-0 rounded-full bg-red-500/20 px-2.5 py-1 text-xs font-bold text-red-300">
                              {category.incorrect}
                            </span>
                          </button>
                        ))}
                    </div>
                  )}
                </section>
              </>
            )}
          </main>
        )}
      </div>
    </div>
  );
}
