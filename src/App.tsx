// PilotReady
// Copyright (c) 2026 Aleksander Kopydłowski. All rights reserved.
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//
// NOTE: licensing stub - to be reviewed/refined later.

import { useEffect } from "react";
import AdminView from "./components/AdminView";
import AuthScreen from "./components/AuthScreen";
import Dashboard from "./components/Dashboard";
import ExamView from "./components/ExamView";
import LanguageToggle from "./components/LanguageToggle";
import StudySession from "./components/StudySession";
import SupportView from "./components/SupportView";
import { cx, Icon, Spinner, useSlow, type IconName } from "./components/ui";
import { flushProgressOutbox } from "./api";
import { useAuth } from "./auth";
import { useI18n } from "./i18n";
import { routeHref, useRoute, type Route } from "./router";

type NavItem = { key: string; label: string; icon: IconName; route: Route; active: boolean; admin?: boolean };

export default function App() {
  const { t } = useI18n();
  const { user, loading: authLoading, logout } = useAuth();
  const [route, navigate] = useRoute();
  const slowAuth = useSlow(authLoading);

  // Deliver any answers that could not be sent last time (offline, cold start).
  useEffect(() => {
    if (user) void flushProgressOutbox();
  }, [user]);

  // While we validate a stored token, show a neutral splash.
  if (authLoading) {
    return (
      <div className="grid min-h-screen place-items-center px-6">
        <div className="flex max-w-sm flex-col items-center gap-4 text-center">
          <img src="/pilotready-logo.png" alt="" width={56} height={56} className="h-14 w-14 rounded-2xl" />
          <Spinner />
          <p className="kicker">{t("auth.loading")}</p>
          {slowAuth && <p className="animate-rise text-xs leading-relaxed text-slate-500">{t("app.coldStart")}</p>}
        </div>
      </div>
    );
  }

  // Not logged in → the auth gate. Nothing behind it is reachable.
  if (!user) return <AuthScreen />;

  const goHome = () => navigate({ kind: "dashboard" });
  const navItems: NavItem[] = [
    {
      key: "learn",
      label: t("nav.learn"),
      icon: "book",
      route: { kind: "dashboard" },
      active: route.kind === "dashboard" || route.kind === "study" || route.kind === "review",
    },
    { key: "exam", label: t("nav.exam"), icon: "exam", route: { kind: "exam" }, active: route.kind === "exam" },
    { key: "support", label: t("nav.support"), icon: "help", route: { kind: "support" }, active: route.kind === "support" },
  ];
  if (user.is_admin) {
    navItems.push({ key: "admin", label: t("nav.admin"), icon: "settings", route: { kind: "admin" }, active: route.kind === "admin", admin: true });
  }

  return (
    <div className="min-h-screen">
      <a
        href="#main"
        onClick={(event) => {
          // Plain in-page jump: must not be mistaken for a route change.
          event.preventDefault();
          const main = document.getElementById("main");
          main?.focus();
          main?.scrollIntoView();
        }}
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-xl focus:bg-cyan-300 focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-slate-950"
      >
        {t("app.skipToContent")}
      </a>

      <header className="sticky top-0 z-40 border-b border-white/5 bg-slate-950/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 md:px-8">
          <a href={routeHref({ kind: "dashboard" })} className="flex items-center gap-3 rounded-xl">
            <img src="/pilotready-logo.png" alt="" width={40} height={40} className="h-10 w-10 rounded-xl" />
            <span>
              <span className="block text-base font-bold leading-tight text-white">PilotReady</span>
              <span className="block text-[10px] font-semibold uppercase tracking-[0.3em] text-cyan-300">{t("app.tagline")}</span>
            </span>
          </a>

          <nav className="hidden items-center gap-1 md:flex" aria-label={t("app.mainNav")}>
            {navItems.map((item) => (
              <a
                key={item.key}
                href={routeHref(item.route)}
                aria-current={item.active ? "page" : undefined}
                className={cx(
                  "flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition",
                  item.active
                    ? item.admin
                      ? "bg-amber-300/15 text-amber-200"
                      : "bg-white/10 text-white"
                    : item.admin
                      ? "text-amber-200/70 hover:bg-amber-300/10 hover:text-amber-200"
                      : "text-slate-400 hover:bg-white/5 hover:text-white",
                )}
              >
                <Icon name={item.icon} className="h-4 w-4" />
                {item.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <LanguageToggle />
            <span className="hidden max-w-[10rem] truncate pl-2 text-xs text-slate-400 lg:block" title={user.email}>
              {user.display_name || user.email}
            </span>
            <button
              type="button"
              onClick={logout}
              title={t("nav.logout")}
              aria-label={t("nav.logout")}
              className="flex items-center gap-2 rounded-xl border border-white/10 px-2.5 py-2 text-xs font-semibold text-slate-300 transition hover:border-red-400/50 hover:text-red-200"
            >
              <Icon name="logout" className="h-4 w-4" />
              <span className="hidden sm:inline">{t("nav.logout")}</span>
            </button>
          </div>
        </div>
      </header>

      <div id="main" tabIndex={-1} className="mx-auto max-w-6xl px-4 pb-28 pt-6 md:px-8 md:pb-12 md:pt-8">
        {route.kind === "dashboard" && <Dashboard userId={user.id} displayName={user.display_name} navigate={navigate} />}

        {(route.kind === "study" || route.kind === "review") && (
          <StudySession
            // Remount when the subject changes so no state leaks between sessions.
            key={`${route.kind}:${route.categoryId ?? "all"}`}
            source={route.kind === "study" ? { kind: "category", categoryId: route.categoryId } : { kind: "mistakes", categoryId: route.categoryId }}
            onExit={goHome}
            onReport={(questionRef) => navigate({ kind: "support", questionRef })}
          />
        )}

        {route.kind === "exam" && <ExamView userId={user.id} navigate={navigate} />}

        {route.kind === "support" && <SupportView questionRef={route.questionRef} />}

        {route.kind === "admin" && (user.is_admin ? <AdminView /> : <Dashboard userId={user.id} displayName={user.display_name} navigate={navigate} />)}
      </div>

      {/* Mobile: thumb-reachable tab bar instead of a cramped top menu. */}
      <nav
        className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-slate-950/95 backdrop-blur-md md:hidden"
        aria-label={t("app.mainNav")}
      >
        <div className="mx-auto flex max-w-md">
          {navItems.map((item) => (
            <a
              key={item.key}
              href={routeHref(item.route)}
              aria-current={item.active ? "page" : undefined}
              className={cx(
                "flex flex-1 flex-col items-center gap-1 px-1 py-2.5 text-[11px] font-semibold transition",
                item.active ? (item.admin ? "text-amber-200" : "text-cyan-300") : "text-slate-500",
              )}
            >
              <Icon name={item.icon} className="h-5 w-5" />
              <span className="max-w-full truncate">{item.label}</span>
            </a>
          ))}
        </div>
      </nav>
    </div>
  );
}
