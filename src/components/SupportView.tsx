// PilotReady
// Copyright (c) 2026 Aleksander Kopydłowski. All rights reserved.
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//
// NOTE: licensing stub - to be reviewed/refined later.

import { useEffect, useState, type FormEvent } from "react";
import { ApiError, apiJson } from "../api";
import { useI18n } from "../i18n";

type SupportKind = "BUG" | "SUGGESTION" | "OTHER";

type SupportReport = {
  id: string;
  kind: SupportKind;
  message: string;
  context: string | null;
  created_at: string;
};

const KINDS: SupportKind[] = ["BUG", "SUGGESTION", "OTHER"];
const MAX_LEN = 4000;

function classNames(...names: Array<string | false | null | undefined>) {
  return names.filter(Boolean).join(" ");
}

export default function SupportView() {
  const { t, lang } = useI18n();
  const [kind, setKind] = useState<SupportKind>("BUG");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [reports, setReports] = useState<SupportReport[]>([]);
  const [loadingReports, setLoadingReports] = useState(true);

  const loadReports = () => {
    setLoadingReports(true);
    apiJson<SupportReport[]>("/api/support/mine")
      .then(setReports)
      .catch(() => setReports([]))
      .finally(() => setLoadingReports(false));
  };

  useEffect(() => {
    let cancelled = false;
    setLoadingReports(true);
    apiJson<SupportReport[]>("/api/support/mine")
      .then((data) => {
        if (!cancelled) setReports(data);
      })
      .catch(() => {
        if (!cancelled) setReports([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingReports(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = message.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    setSent(false);
    try {
      await apiJson<SupportReport>("/api/support", {
        method: "POST",
        body: JSON.stringify({
          kind,
          message: trimmed,
          context: navigator.userAgent.slice(0, 400),
        }),
      });
      setSent(true);
      setMessage("");
      setKind("BUG");
      loadReports();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail || t("support.error") : t("support.error"));
    } finally {
      setSubmitting(false);
    }
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleString(lang === "pl" ? "pl-PL" : "en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
      });
    } catch {
      return iso;
    }
  };

  return (
    <section className="mx-auto max-w-3xl">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-white">{t("support.title")}</h1>
        <p className="mt-2 text-slate-400">{t("support.subtitle")}</p>
      </header>

      <form
        onSubmit={handleSubmit}
        className="rounded-[2rem] border border-white/10 bg-slate-950/60 p-6 shadow-xl shadow-black/20"
      >
        {/* Kind selector */}
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">{t("support.kindLabel")}</p>
        <div className="mb-5 flex flex-wrap gap-2">
          {KINDS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setKind(option)}
              className={classNames(
                "rounded-2xl border px-4 py-2 text-sm font-semibold transition",
                kind === option
                  ? "border-cyan-300/70 bg-cyan-300/15 text-cyan-100"
                  : "border-white/10 bg-white/[0.035] text-slate-300 hover:border-cyan-300/40",
              )}
            >
              {t(`support.kind.${option}`)}
            </button>
          ))}
        </div>

        {/* Message */}
        <label className="grid gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">{t("support.messageLabel")}</span>
          <textarea
            value={message}
            onChange={(e) => {
              setMessage(e.target.value.slice(0, MAX_LEN));
              setSent(false);
            }}
            required
            rows={6}
            placeholder={t("support.messagePlaceholder")}
            className="resize-y rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition focus:border-cyan-300/70 focus:bg-white/10"
          />
          <span className="justify-self-end text-xs text-slate-500">{t("support.charCount", { n: message.length })}</span>
        </label>

        {sent && (
          <p className="mt-3 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">
            {t("support.success")}
          </p>
        )}
        {error && (
          <p className="mt-3 rounded-2xl border border-red-900/70 bg-red-950/40 px-4 py-3 text-sm text-red-100">{error}</p>
        )}

        <button
          type="submit"
          disabled={submitting || !message.trim()}
          className="mt-5 rounded-2xl bg-cyan-300 px-6 py-3 text-sm font-bold text-slate-950 shadow-lg shadow-cyan-950/40 transition hover:bg-cyan-200 disabled:opacity-50"
        >
          {submitting ? t("support.submitting") : t("support.submit")}
        </button>
      </form>

      {/* Past reports */}
      <section className="mt-10">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300">{t("support.yourReports")}</h2>
        {loadingReports ? (
          <p className="text-sm text-slate-400">{t("support.loadingReports")}</p>
        ) : reports.length === 0 ? (
          <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-sm text-slate-400">{t("support.empty")}</p>
        ) : (
          <ul className="grid gap-3">
            {reports.map((report) => (
              <li key={report.id} className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span
                    className={classNames(
                      "rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider",
                      report.kind === "BUG"
                        ? "bg-red-500/15 text-red-300"
                        : report.kind === "SUGGESTION"
                          ? "bg-cyan-300/15 text-cyan-200"
                          : "bg-white/10 text-slate-300",
                    )}
                  >
                    {t(`support.kind.${report.kind}`)}
                  </span>
                  <span className="text-xs text-slate-500">{t("support.sentAt", { date: formatDate(report.created_at) })}</span>
                </div>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-200">{report.message}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
