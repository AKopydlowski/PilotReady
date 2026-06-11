// PilotReady
// Copyright (c) 2026 Aleksander Kopydłowski. All rights reserved.
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//
// NOTE: licensing stub - to be reviewed/refined later.

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, apiJson } from "../api";
import { useI18n } from "../i18n";
import AdminAnalytics from "./AdminAnalytics";

type AdminTab = "reports" | "analytics";

type SupportStatus = "NEW" | "IN_PROGRESS" | "RESOLVED" | "REJECTED";
type SupportKind = "BUG" | "SUGGESTION" | "OTHER";

type AdminReport = {
  id: string;
  kind: SupportKind;
  status: SupportStatus;
  message: string;
  context: string | null;
  created_at: string;
  updated_at: string;
  user_id: string;
  user_email: string;
  user_display_name: string | null;
};

type ListResponse = {
  total: number;
  counts: Record<SupportStatus, number>;
  items: AdminReport[];
};

const STATUSES: SupportStatus[] = ["NEW", "IN_PROGRESS", "RESOLVED", "REJECTED"];

function classNames(...names: Array<string | false | null | undefined>) {
  return names.filter(Boolean).join(" ");
}

const STATUS_STYLE: Record<SupportStatus, string> = {
  NEW: "bg-cyan-300/15 text-cyan-200 border-cyan-300/40",
  IN_PROGRESS: "bg-amber-400/15 text-amber-200 border-amber-300/40",
  RESOLVED: "bg-emerald-400/15 text-emerald-200 border-emerald-400/40",
  REJECTED: "bg-red-500/15 text-red-300 border-red-400/40",
};

const KIND_STYLE: Record<SupportKind, string> = {
  BUG: "bg-red-500/15 text-red-300",
  SUGGESTION: "bg-cyan-300/15 text-cyan-200",
  OTHER: "bg-white/10 text-slate-300",
};

export default function AdminView() {
  const { t, lang } = useI18n();
  const [tab, setTab] = useState<AdminTab>("reports");
  const [data, setData] = useState<ListResponse | null>(null);
  const [filter, setFilter] = useState<SupportStatus | "ALL">("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = useCallback(
    (status: SupportStatus | "ALL") => {
      setLoading(true);
      setError(null);
      const query = status === "ALL" ? "" : `?status=${status}`;
      apiJson<ListResponse>(`/api/admin/support${query}`)
        .then(setData)
        .catch(() => setError(t("admin.error")))
        .finally(() => setLoading(false));
    },
    [t],
  );

  useEffect(() => {
    load(filter);
    setSelected(new Set()); // selection doesn't carry across filters
  }, [filter, load]);

  const visibleIds = useMemo(() => (data?.items ?? []).map((it) => it.id), [data]);

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectAllVisible = () => setSelected(new Set(visibleIds));
  const clearSelection = () => setSelected(new Set());

  const deleteReport = async (report: AdminReport) => {
    if (!window.confirm(t("admin.deleteConfirm"))) return;
    setUpdatingId(report.id);
    setError(null);
    try {
      await apiFetch(`/api/admin/support/${report.id}`, { method: "DELETE" });
      load(filter);
      clearSelection();
    } catch {
      setError(t("admin.actionError"));
    } finally {
      setUpdatingId(null);
    }
  };

  const runBulk = async (action: "set_status" | "delete", status?: SupportStatus) => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (action === "delete" && !window.confirm(t("admin.bulkDeleteConfirm", { n: ids.length }))) return;
    setBulkBusy(true);
    setError(null);
    try {
      await apiJson<{ affected: number }>("/api/admin/support/bulk", {
        method: "POST",
        body: JSON.stringify(action === "set_status" ? { ids, action, status } : { ids, action }),
      });
      load(filter);
      clearSelection();
    } catch {
      setError(t("admin.actionError"));
    } finally {
      setBulkBusy(false);
    }
  };

  const changeStatus = async (report: AdminReport, status: SupportStatus) => {
    if (report.status === status) return;
    setUpdatingId(report.id);
    setError(null);
    try {
      const updated = await apiJson<AdminReport>(`/api/admin/support/${report.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setData((prev) => {
        if (!prev) return prev;
        // Update counts and either replace or drop the item if it no longer matches the filter.
        const counts = { ...prev.counts };
        counts[report.status] = Math.max(0, (counts[report.status] ?? 0) - 1);
        counts[status] = (counts[status] ?? 0) + 1;
        const stillVisible = filter === "ALL" || filter === status;
        const items = stillVisible
          ? prev.items.map((it) => (it.id === report.id ? updated : it))
          : prev.items.filter((it) => it.id !== report.id);
        return { ...prev, counts, items };
      });
    } catch {
      setError(t("admin.updateError"));
    } finally {
      setUpdatingId(null);
    }
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleString(lang === "pl" ? "pl-PL" : "en-GB", { dateStyle: "medium", timeStyle: "short" });
    } catch {
      return iso;
    }
  };

  const counts = data?.counts ?? { NEW: 0, IN_PROGRESS: 0, RESOLVED: 0, REJECTED: 0 };
  const totalAll = data?.total ?? 0;

  return (
    <section className="mx-auto max-w-4xl">
      <header className="mb-6">
        <h1 className="text-3xl font-bold text-white">{t("admin.title")}</h1>
        <p className="mt-2 text-slate-400">{t("admin.subtitle")}</p>
      </header>

      {/* Tab switcher: reports queue vs. analytics dashboard */}
      <div className="mb-6 flex gap-2 border-b border-white/10">
        {(["reports", "analytics"] as AdminTab[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={classNames(
              "-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold transition",
              tab === key ? "border-cyan-300 text-white" : "border-transparent text-slate-400 hover:text-white",
            )}
          >
            {t(`admin.tab.${key}`)}
          </button>
        ))}
      </div>

      {tab === "analytics" && <AdminAnalytics />}

      {tab === "reports" && (
        <>
      {/* Status filter chips with counts */}
      <div className="mb-6 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setFilter("ALL")}
          className={classNames(
            "rounded-2xl border px-4 py-2 text-sm font-semibold transition",
            filter === "ALL" ? "border-cyan-300/70 bg-cyan-300/15 text-cyan-100" : "border-white/10 bg-white/[0.035] text-slate-300 hover:border-cyan-300/40",
          )}
        >
          {t("admin.filterAll")} ({totalAll})
        </button>
        {STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => setFilter(status)}
            className={classNames(
              "rounded-2xl border px-4 py-2 text-sm font-semibold transition",
              filter === status ? STATUS_STYLE[status] : "border-white/10 bg-white/[0.035] text-slate-300 hover:border-cyan-300/40",
            )}
          >
            {t(`admin.status.${status}`)} ({counts[status] ?? 0})
          </button>
        ))}
      </div>

      {/* Select-visible / clear helpers */}
      {data && data.items.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-slate-400">
          <button type="button" onClick={selectAllVisible} className="rounded-lg border border-white/10 px-3 py-1.5 font-semibold text-slate-300 hover:border-cyan-300/40">
            {t("admin.selectAll")}
          </button>
          {selected.size > 0 && (
            <button type="button" onClick={clearSelection} className="rounded-lg border border-white/10 px-3 py-1.5 font-semibold text-slate-300 hover:border-cyan-300/40">
              {t("admin.clearSelection")}
            </button>
          )}
        </div>
      )}

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="sticky top-2 z-10 mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-cyan-300/30 bg-slate-900/90 p-3 shadow-lg shadow-black/40 backdrop-blur">
          <span className="mr-1 text-sm font-bold text-cyan-200">{t("admin.selected", { n: selected.size })}</span>
          <span className="text-[11px] uppercase tracking-wider text-slate-500">{t("admin.bulkSetStatus")}</span>
          {STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              disabled={bulkBusy}
              onClick={() => runBulk("set_status", status)}
              className={classNames("rounded-xl border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50", STATUS_STYLE[status])}
            >
              {t(`admin.status.${status}`)}
            </button>
          ))}
          <button
            type="button"
            disabled={bulkBusy}
            onClick={() => runBulk("delete")}
            className="ml-auto rounded-xl border border-red-400/50 px-3 py-1.5 text-xs font-bold text-red-200 transition hover:bg-red-500/15 disabled:opacity-50"
          >
            {t("admin.bulkDelete")}
          </button>
        </div>
      )}

      {error && <p className="mb-4 rounded-2xl border border-red-900/70 bg-red-950/40 px-4 py-3 text-sm text-red-100">{error}</p>}

      {loading ? (
        <p className="text-sm text-slate-400">{t("admin.loading")}</p>
      ) : !data || data.items.length === 0 ? (
        <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-sm text-slate-400">{t("admin.empty")}</p>
      ) : (
        <ul className="grid gap-3">
          {data.items.map((report) => (
            <li
              key={report.id}
              className={classNames(
                "rounded-2xl border bg-slate-950/50 p-5 transition",
                selected.has(report.id) ? "border-cyan-300/50 ring-1 ring-cyan-300/30" : "border-white/10",
              )}
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selected.has(report.id)}
                    onChange={() => toggleSelect(report.id)}
                    className="h-4 w-4 cursor-pointer accent-cyan-400"
                    aria-label="select report"
                  />
                  <span className={classNames("rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider", KIND_STYLE[report.kind])}>
                    {t(`support.kind.${report.kind}`)}
                  </span>
                  <span className={classNames("rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-wider", STATUS_STYLE[report.status])}>
                    {t(`admin.status.${report.status}`)}
                  </span>
                </div>
                <span className="text-xs text-slate-500">{formatDate(report.created_at)}</span>
              </div>

              <p className="mb-1 text-xs text-slate-400">
                {t("admin.from")}: <span className="text-slate-200">{report.user_display_name || report.user_email}</span>{" "}
                <span className="text-slate-500">({report.user_email})</span>
              </p>
              <p className="mb-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-100">{report.message}</p>
              {report.context && <p className="mb-3 break-all text-[11px] text-slate-600">{report.context}</p>}

              {/* Status actions */}
              <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t("admin.statusLabel")}:</span>
                {STATUSES.map((status) => (
                  <button
                    key={status}
                    type="button"
                    disabled={updatingId === report.id || report.status === status}
                    onClick={() => changeStatus(report, status)}
                    className={classNames(
                      "rounded-xl border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50",
                      report.status === status ? STATUS_STYLE[status] : "border-white/10 text-slate-300 hover:border-cyan-300/40",
                    )}
                  >
                    {t(`admin.status.${status}`)}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={updatingId === report.id}
                  onClick={() => deleteReport(report)}
                  className="ml-auto rounded-xl border border-red-400/40 px-3 py-1.5 text-xs font-semibold text-red-200 transition hover:bg-red-500/10 disabled:opacity-50"
                >
                  {t("admin.delete")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
        </>
      )}
    </section>
  );
}
