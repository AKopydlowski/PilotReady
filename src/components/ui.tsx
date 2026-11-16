// PilotReady
// Copyright (c) 2026 Aleksander Kopydłowski. All rights reserved.
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//
// NOTE: licensing stub - to be reviewed/refined later.

// Small shared building blocks: class-name helper, safe rich text for question
// content, icons, progress ring/bar, spinner and a modal dialog.

import { useEffect, useRef, useState, type ReactNode } from "react";

export function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(" ");
}

// --------------------------------------------------------------------------- //
// RichText — question/answer text with <sub>/<sup> indices
// --------------------------------------------------------------------------- //
const INDEX_TAG = /<(sub|sup)>(.*?)<\/\1>/g;

/**
 * Render question-bank text. The parser leaves exactly two kinds of markup in
 * it — `<sub>` and `<sup>` (e.g. `V<sub>NE</sub>`). Everything else is plain
 * text, including literal `<` and `>` in formulas such as `α<0`, so we tokenize
 * instead of injecting HTML.
 */
export function RichText({ text }: { text: string }) {
  if (!text.includes("<su")) return <>{text}</>;
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(INDEX_TAG)) {
    const index = match.index ?? 0;
    if (index > last) parts.push(text.slice(last, index));
    parts.push(match[1] === "sub" ? <sub key={index}>{match[2]}</sub> : <sup key={index}>{match[2]}</sup>);
    last = index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

// --------------------------------------------------------------------------- //
// Icons — 24×24 stroke icons, inherit color from text
// --------------------------------------------------------------------------- //
const ICON_PATHS = {
  book: ["M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z", "M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"],
  exam: [
    "M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z",
    "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2",
    "m9 14 2 2 4-4",
  ],
  help: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3", "M12 17h.01"],
  shield: ["M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"],
  scale: ["M12 3v18", "M7 21h10", "M5 7h14", "M5 7l-3 7a3 3 0 0 0 6 0z", "M19 7l-3 7a3 3 0 0 0 6 0z"],
  plane: [
    "M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z",
  ],
  chart: ["M3 3v18h18", "m7 15 4-5 4 3 5-7"],
  user: ["M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M4 21a8 8 0 0 1 16 0"],
  cloud: ["M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 1 1 0 9z"],
  compass: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "m16.2 7.8-2.1 6.3-6.3 2.1 2.1-6.3z"],
  checklist: ["M10 6h11", "M10 12h11", "M10 18h11", "m3 6 1 1 2-2", "m3 12 1 1 2-2", "m3 18 1 1 2-2"],
  wind: ["M17.7 7.7A2.5 2.5 0 1 1 19.5 12H2", "M9.6 4.6A2 2 0 1 1 11 8H2", "M12.6 19.4A2 2 0 1 0 14 16H2"],
  radio: [
    "M4.9 19.1C1 15.2 1 8.8 4.9 4.9",
    "M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.4",
    "M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
    "M16.2 7.8c2.3 2.3 2.3 6.1 0 8.4",
    "M19.1 4.9C23 8.8 23 15.2 19.1 19.1",
  ],
  flag: ["M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z", "M4 22v-7"],
  check: ["M20 6 9 17l-5-5"],
  x: ["M18 6 6 18", "m6 6 12 12"],
  chevronRight: ["m9 18 6-6-6-6"],
  chevronLeft: ["m15 18-6-6 6-6"],
  arrowLeft: ["M19 12H5", "m12 19-7-7 7-7"],
  clock: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M12 6v6l4 2"],
  refresh: ["M3 12a9 9 0 1 0 3-6.7L3 8", "M3 3v5h5"],
  logout: ["M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4", "m16 17 5-5-5-5", "M21 12H9"],
  grid: ["M3 3h7v7H3z", "M14 3h7v7h-7z", "M14 14h7v7h-7z", "M3 14h7v7H3z"],
  alert: ["M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z", "M12 9v4", "M12 17h.01"],
  target: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12z", "M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"],
  trophy: [
    "M6 9H4.5a2.5 2.5 0 0 1 0-5H6",
    "M18 9h1.5a2.5 2.5 0 0 0 0-5H18",
    "M6 4h12v5a6 6 0 0 1-12 0z",
    "M12 15v4",
    "M8 21h8",
  ],
  settings: ["M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M12 2v3", "M12 19v3", "M2 12h3", "M19 12h3", "m4.9 4.9 2.1 2.1", "m17 17 2.1 2.1", "m4.9 19.1 2.1-2.1", "m17 7 2.1-2.1"],
} as const;

export type IconName = keyof typeof ICON_PATHS;

export function Icon({ name, className = "h-5 w-5" }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cx("shrink-0", className)}
    >
      {ICON_PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/** Icon for each exam subject / study category. */
export const SUBJECT_ICON: Record<string, IconName> = {
  AIR_LAW: "scale",
  AIRCRAFT_GENERAL_KNOWLEDGE: "plane",
  FLIGHT_PERFORMANCE_AND_PLANNING: "chart",
  HUMAN_PERFORMANCE: "user",
  METEOROLOGY: "cloud",
  NAVIGATION: "compass",
  OPERATIONAL_PROCEDURES: "checklist",
  PRINCIPLES_OF_FLIGHT: "wind",
  COMMUNICATIONS: "radio",
  GENERAL_SAFETY: "shield",
};

// --------------------------------------------------------------------------- //
// Progress
// --------------------------------------------------------------------------- //
type Tone = "cyan" | "emerald" | "red" | "amber";

const TONE_STROKE: Record<Tone, string> = {
  cyan: "#67e8f9",
  emerald: "#34d399",
  red: "#f87171",
  amber: "#fcd34d",
};

/** Circular progress with free content in the middle. `value` is 0–100. */
export function ProgressRing({
  value,
  size = 96,
  stroke = 8,
  tone = "cyan",
  label,
  children,
}: {
  value: number;
  size?: number;
  stroke?: number;
  tone?: Tone;
  label?: string;
  children?: ReactNode;
}) {
  const clamped = Math.min(100, Math.max(0, value));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <div
      className="relative grid shrink-0 place-items-center"
      style={{ width: size, height: size }}
      role="img"
      aria-label={label ?? `${Math.round(clamped)}%`}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={TONE_STROKE[tone]}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped / 100)}
          style={{ transition: "stroke-dashoffset 600ms ease" }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  );
}

/**
 * Horizontal bar. With `secondary` it stacks a second (red) segment after the
 * main one — used for "mastered + still wrong" on subject cards.
 */
export function ProgressBar({
  value,
  secondary = 0,
  marker,
  tone = "cyan",
  className,
}: {
  value: number;
  secondary?: number;
  marker?: number;
  tone?: Tone | "gradient";
  className?: string;
}) {
  const main = Math.min(100, Math.max(0, value));
  const extra = Math.min(100 - main, Math.max(0, secondary));
  const fill =
    tone === "gradient"
      ? "bg-gradient-to-r from-cyan-400 to-emerald-400"
      : tone === "emerald"
        ? "bg-emerald-400"
        : tone === "red"
          ? "bg-red-400"
          : tone === "amber"
            ? "bg-amber-300"
            : "bg-cyan-300";
  return (
    <div className={cx("relative h-2 w-full rounded-full bg-white/10", className)}>
      <div className="flex h-full overflow-hidden rounded-full">
        <div className={cx("h-full transition-all duration-500", fill)} style={{ width: `${main}%` }} />
        {extra > 0 && <div className="h-full bg-red-400/80 transition-all duration-500" style={{ width: `${extra}%` }} />}
      </div>
      {marker !== undefined && (
        <span
          className="absolute -top-1 h-4 w-0.5 rounded bg-white/70"
          style={{ left: `${Math.min(100, Math.max(0, marker))}%` }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}

export function Spinner({ className = "h-8 w-8" }: { className?: string }) {
  return <div className={cx("animate-spin rounded-full border-2 border-cyan-300/25 border-t-cyan-300", className)} role="status" />;
}

// --------------------------------------------------------------------------- //
// Modal
// --------------------------------------------------------------------------- //
export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Move focus into the dialog (first [data-autofocus], else the panel).
    const target = panelRef.current?.querySelector<HTMLElement>("[data-autofocus]") ?? panelRef.current;
    target?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-end bg-slate-950/80 p-0 backdrop-blur-sm sm:place-items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cx(
          "animate-rise max-h-[88vh] w-full overflow-y-auto rounded-t-3xl border border-white/10 bg-slate-900 p-6 shadow-2xl outline-none sm:rounded-3xl",
          wide ? "sm:max-w-2xl" : "sm:max-w-md",
        )}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-lg font-bold text-white">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-xl p-1.5 text-slate-400 hover:bg-white/10 hover:text-white" aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** True once `active` has stayed true for `delayMs` - for "this is taking a while" hints. */
export function useSlow(active: boolean, delayMs = 4000): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (!active) return;
    const handle = window.setTimeout(() => setSlow(true), delayMs);
    return () => window.clearTimeout(handle);
  }, [active, delayMs]);
  return active && slow;
}
