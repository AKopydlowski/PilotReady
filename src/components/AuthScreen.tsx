// PilotReady
// Copyright (c) 2026 Aleksander Kopydłowski. All rights reserved.
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//
// NOTE: licensing stub - to be reviewed/refined later.

import { useState, type FormEvent } from "react";
import { ApiError } from "../api";
import { useAuth } from "../auth";
import { useI18n, type Lang } from "../i18n";

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

export default function AuthScreen() {
  const { t } = useI18n();
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isRegister = mode === "register";

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    const trimmedEmail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError(t("auth.errorEmailInvalid"));
      return;
    }
    if (isRegister && password.length < 8) {
      setError(t("auth.errorPasswordShort"));
      return;
    }

    setSubmitting(true);
    try {
      if (isRegister) {
        await register(trimmedEmail, password, displayName.trim() || undefined);
      } else {
        await login(trimmedEmail, password);
      }
      // On success the AuthProvider sets the user and App swaps to the dashboard.
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.detail || t("auth.errorGeneric"));
      } else {
        setError(t("auth.errorGeneric"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const switchMode = () => {
    setMode((prev) => (prev === "login" ? "register" : "login"));
    setError(null);
  };

  return (
    <div className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.1),_transparent_45%)] px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/pilotready-logo.png" alt="PilotReady" className="h-11 w-11 rounded-2xl object-contain" />
            <div>
              <span className="block text-lg font-bold text-white">PilotReady</span>
              <span className="block text-xs uppercase tracking-[0.3em] text-cyan-300">{t("app.tagline")}</span>
            </div>
          </div>
          <LanguageToggle />
        </div>

        <div className="rounded-[2rem] border border-white/10 bg-slate-950/70 p-8 shadow-2xl shadow-cyan-950/30">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-cyan-300">{t("auth.welcome")}</p>
          <h1 className="mt-2 text-2xl font-bold text-white">{isRegister ? t("auth.registerTitle") : t("auth.loginTitle")}</h1>
          <p className="mt-1 text-sm text-slate-400">{isRegister ? t("auth.registerSubtitle") : t("auth.loginSubtitle")}</p>

          <form onSubmit={handleSubmit} className="mt-6 grid gap-4">
            <label className="grid gap-1.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">{t("auth.email")}</span>
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition focus:border-cyan-300/70 focus:bg-white/10"
                placeholder="pilot@example.com"
              />
            </label>

            {isRegister && (
              <label className="grid gap-1.5">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">{t("auth.displayName")}</span>
                <input
                  type="text"
                  autoComplete="nickname"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition focus:border-cyan-300/70 focus:bg-white/10"
                  placeholder="Kapitan"
                />
              </label>
            )}

            <label className="grid gap-1.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">{t("auth.password")}</span>
              <input
                type="password"
                autoComplete={isRegister ? "new-password" : "current-password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition focus:border-cyan-300/70 focus:bg-white/10"
                placeholder="••••••••"
              />
              {isRegister && <span className="text-xs text-slate-500">{t("auth.passwordHint")}</span>}
            </label>

            {error && (
              <p className="rounded-2xl border border-red-900/70 bg-red-950/40 px-4 py-3 text-sm text-red-100">{error}</p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="mt-2 rounded-2xl bg-cyan-300 px-6 py-3 text-sm font-bold text-slate-950 shadow-lg shadow-cyan-950/40 transition hover:bg-cyan-200 disabled:opacity-50"
            >
              {submitting ? t("auth.submitting") : isRegister ? t("auth.registerCta") : t("auth.loginCta")}
            </button>
          </form>

          <button type="button" onClick={switchMode} className="mt-5 w-full text-center text-sm text-cyan-300 hover:underline">
            {isRegister ? t("auth.toLogin") : t("auth.toRegister")}
          </button>
        </div>

        <p className="mt-5 text-center text-xs text-slate-500">{t("auth.secured")}</p>
      </div>
    </div>
  );
}
