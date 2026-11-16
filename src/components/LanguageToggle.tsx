// PilotReady
// Copyright (c) 2026 Aleksander Kopydłowski. All rights reserved.
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//
// NOTE: licensing stub - to be reviewed/refined later.

import { useI18n, type Lang } from "../i18n";
import { cx } from "./ui";

const LANGS: Lang[] = ["pl", "en"];

export default function LanguageToggle() {
  const { lang, setLang, t } = useI18n();
  return (
    <div role="group" aria-label={t("app.language")} className="flex gap-0.5 rounded-xl border border-white/10 bg-white/5 p-0.5 text-xs font-bold">
      {LANGS.map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => setLang(code)}
          aria-pressed={lang === code}
          className={cx(
            "rounded-[0.6rem] px-2.5 py-1.5 uppercase transition",
            lang === code ? "bg-cyan-300 text-slate-950" : "text-slate-400 hover:text-white",
          )}
        >
          {code}
        </button>
      ))}
    </div>
  );
}
