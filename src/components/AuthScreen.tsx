// PilotReady
// Copyright (c) 2026 Aleksander Kopydłowski. All rights reserved.
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//
// NOTE: licensing stub - to be reviewed/refined later.

import { useState, type FormEvent } from "react";
import { ApiError } from "../api";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import LanguageToggle from "./LanguageToggle";
import { Icon, useSlow } from "./ui";

export default function AuthScreen() {
  const { t } = useI18n();
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const slow = useSlow(submitting);

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
      // Translate the API's outcome instead of echoing its English detail.
      const status = err instanceof ApiError ? err.status : 0;
      if (status === 401) setError(t("auth.errorInvalid"));
      else if (status === 409) setError(t("auth.errorEmailTaken"));
      else if (status === 429) setError(t("auth.errorTooMany"));
      else if (status === 422) setError(t("auth.errorEmailInvalid"));
      else if (status === 0) setError(t("auth.errorOffline"));
      else setError(t("auth.errorGeneric"));
    } finally {
      setSubmitting(false);
    }
  };

  const switchMode = () => {
    setMode((prev) => (prev === "login" ? "register" : "login"));
    setError(null);
  };

  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <div className="animate-rise w-full max-w-md">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/pilotready-logo.png" alt="" width={44} height={44} className="h-11 w-11 rounded-2xl" />
            <div>
              <span className="block text-lg font-bold text-white">PilotReady</span>
              <span className="block text-xs uppercase tracking-[0.3em] text-cyan-300">{t("app.tagline")}</span>
            </div>
          </div>
          <LanguageToggle />
        </div>

        <div className="card p-6 sm:p-8">
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
              <span className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete={isRegister ? "new-password" : "current-password"}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-white/5 py-3 pl-4 pr-20 text-white outline-none transition focus:border-cyan-300/70 focus:bg-white/10"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-pressed={showPassword}
                  className="absolute inset-y-0 right-2 my-auto h-8 rounded-lg px-2.5 text-xs font-semibold text-slate-400 hover:text-white"
                >
                  {showPassword ? t("auth.hide") : t("auth.show")}
                </button>
              </span>
              {isRegister && <span className="text-xs text-slate-500">{t("auth.passwordHint")}</span>}
            </label>

            {error && (
              <p role="alert" className="flex items-start gap-2.5 rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                <Icon name="alert" className="mt-0.5 h-4 w-4 text-red-300" />
                {error}
              </p>
            )}
            {slow && <p className="animate-rise text-xs leading-relaxed text-slate-500">{t("app.coldStart")}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="btn btn-primary mt-2"
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
