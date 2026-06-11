// PilotReady
// Copyright (c) 2026 Aleksander Kopydłowski. All rights reserved.
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//
// NOTE: licensing stub - to be reviewed/refined later.

import { useEffect, useMemo, useState } from "react";
import { apiJson } from "../api";
import { useI18n } from "../i18n";

type CountWindow = { total: number; last_24h: number; last_7d: number; last_30d: number };
type DayCount = { day: string; count: number };

type Overview = {
  generated_at: string;
  users: CountWindow;
  visits: CountWindow;
  unique_visitors: CountWindow;
  reports: Record<string, number>;
  reports_total: number;
  total_answers: number;
  active_users_7d: number;
  signups_by_day: DayCount[];
  visits_by_day: DayCount[];
};

type UserItem = {
  id: string;
  email: string;
  display_name: string | null;
  is_admin: boolean;
  created_at: string;
  answers_count: number;
  correct_count: number;
  incorrect_count: number;
  reports_count: number;
  visits_count: number;
  last_active: string | null;
};

type UsersResponse = { total: number; items: UserItem[] };

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-white">{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

function MiniBars({ data, color }: { data: DayCount[]; color: string }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="flex h-24 items-end gap-1">
      {data.map((d) => (
        <div key={d.day} className="group relative flex-1" title={`${d.day}: ${d.count}`}>
          <div
            className={`w-full rounded-t ${color} transition-all`}
            style={{ height: `${Math.max(3, (d.count / max) * 100)}%` }}
          />
        </div>
      ))}
    </div>
  );
}

export default function AdminAnalytics() {
  const { t, lang } = useI18n();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [users, setUsers] = useState<UsersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      apiJson<Overview>("/api/admin/analytics/overview"),
      apiJson<UsersResponse>("/api/admin/analytics/users"),
    ])
      .then(([ov, us]) => {
        if (cancelled) return;
        setOverview(ov);
        setUsers(us);
      })
      .catch(() => !cancelled && setError(t("admin.analytics.error")))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [t]);

  const locale = lang === "pl" ? "pl-PL" : "en-GB";
  const fmtDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString(locale, { dateStyle: "medium" });
    } catch {
      return iso;
    }
  };
  const fmtDateTime = (iso: string | null) => {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" });
    } catch {
      return iso;
    }
  };

  const win = (w: CountWindow) =>
    t("admin.analytics.window", { d1: w.last_24h, d7: w.last_7d, d30: w.last_30d });

  const sortedUsers = useMemo(
    () => (users?.items ?? []).slice().sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)),
    [users],
  );

  if (loading) return <p className="text-sm text-slate-400">{t("admin.analytics.loading")}</p>;
  if (error) return <p className="rounded-2xl border border-red-900/70 bg-red-950/40 px-4 py-3 text-sm text-red-100">{error}</p>;
  if (!overview || !users) return null;

  return (
    <div className="grid gap-6">
      {/* Top-line stats */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label={t("admin.analytics.users")} value={overview.users.total} sub={win(overview.users)} />
        <StatCard label={t("admin.analytics.visits")} value={overview.visits.total} sub={win(overview.visits)} />
        <StatCard label={t("admin.analytics.uniqueVisitors")} value={overview.unique_visitors.total} sub={win(overview.unique_visitors)} />
        <StatCard label={t("admin.analytics.activeUsers7d")} value={overview.active_users_7d} />
        <StatCard label={t("admin.analytics.totalAnswers")} value={overview.total_answers} />
        <StatCard label={t("admin.analytics.reports")} value={overview.reports_total} sub={t("admin.analytics.reportsBreakdown", {
          n: overview.reports.NEW ?? 0,
          p: overview.reports.IN_PROGRESS ?? 0,
          r: overview.reports.RESOLVED ?? 0,
          x: overview.reports.REJECTED ?? 0,
        })} />
      </div>

      {/* Daily charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-5">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-cyan-300">{t("admin.analytics.visitsByDay")}</p>
          <MiniBars data={overview.visits_by_day} color="bg-gradient-to-t from-cyan-500 to-cyan-300" />
          <div className="mt-2 flex justify-between text-[10px] text-slate-500">
            <span>{fmtDate(overview.visits_by_day[0]?.day)}</span>
            <span>{fmtDate(overview.visits_by_day[overview.visits_by_day.length - 1]?.day)}</span>
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-5">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-emerald-300">{t("admin.analytics.signupsByDay")}</p>
          <MiniBars data={overview.signups_by_day} color="bg-gradient-to-t from-emerald-500 to-emerald-300" />
          <div className="mt-2 flex justify-between text-[10px] text-slate-500">
            <span>{fmtDate(overview.signups_by_day[0]?.day)}</span>
            <span>{fmtDate(overview.signups_by_day[overview.signups_by_day.length - 1]?.day)}</span>
          </div>
        </div>
      </div>

      {/* Users table */}
      <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-5">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-cyan-300">{t("admin.analytics.usersList")}</p>
          <span className="text-xs text-slate-500">{t("admin.analytics.usersCount", { n: users.total })}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-slate-500">
                <th className="pb-2 pr-3 font-semibold">{t("admin.analytics.colUser")}</th>
                <th className="pb-2 px-3 font-semibold">{t("admin.analytics.colJoined")}</th>
                <th className="pb-2 px-3 text-right font-semibold">{t("admin.analytics.colAnswers")}</th>
                <th className="pb-2 px-3 text-right font-semibold">{t("admin.analytics.colReports")}</th>
                <th className="pb-2 px-3 text-right font-semibold">{t("admin.analytics.colVisits")}</th>
                <th className="pb-2 pl-3 font-semibold">{t("admin.analytics.colLastActive")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {sortedUsers.map((u) => (
                <tr key={u.id} className="text-slate-200">
                  <td className="py-2.5 pr-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-white">{u.display_name || u.email.split("@")[0]}</span>
                      {u.is_admin && (
                        <span className="rounded-full bg-amber-300/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-200">
                          {t("admin.analytics.adminBadge")}
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-slate-500">{u.email}</span>
                  </td>
                  <td className="px-3 text-slate-400">{fmtDate(u.created_at)}</td>
                  <td className="px-3 text-right">
                    <span className="text-slate-200">{u.answers_count}</span>
                    <span className="ml-1 text-xs text-emerald-300">{u.correct_count}✓</span>
                    <span className="ml-1 text-xs text-red-300">{u.incorrect_count}✗</span>
                  </td>
                  <td className="px-3 text-right text-slate-300">{u.reports_count}</td>
                  <td className="px-3 text-right text-slate-300">{u.visits_count}</td>
                  <td className="pl-3 text-slate-400">{fmtDateTime(u.last_active)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-right text-[11px] text-slate-600">
        {t("admin.analytics.generatedAt", { date: fmtDateTime(overview.generated_at) })}
      </p>
    </div>
  );
}
