import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Lang = "pl" | "en";

// Flat dictionary keyed by "namespace.key". {var} placeholders are interpolated.
const DICT: Record<Lang, Record<string, string>> = {
  pl: {
    "app.tagline": "PPL(A)",
    "nav.learn": "Nauka",
    "nav.exam": "Egzamin ULC",

    "dashboard.title": "Twoje przedmioty",
    "dashboard.subtitle": "Ucz się pytaniami z banku PPL(A) lub podejdź do pełnej symulacji egzaminu ULC.",
    "dashboard.loading": "Ładowanie…",
    "dashboard.questionsInBank": "{n} pytań w banku",
    "dashboard.progress": "{a}/{t} przerobionych · {c} poprawnych",
    "dashboard.error": "Nie udało się pobrać kategorii ({status})",

    "learn.back": "← Wróć do przedmiotów",
    "learn.kicker": "PilotReady · Nauka",
    "learn.questionCounter": "Pytanie {i} / {n} · {p}%",
    "learn.previous": "Poprzednie",
    "learn.next": "Następne",
    "learn.footer": "Odpowiedzi zapisują się natychmiast na tym urządzeniu i cicho synchronizują z kontem.",
    "learn.loading": "Ładowanie pokładu…",
    "learn.empty": "Brak pytań.",
    "learn.correct": "Dobrze!",
    "learn.incorrect": "Błędnie",
    "learn.mistakesTitle": "Twoje błędy",
    "learn.mistakesSubtitle": "Pytania, w których pomyliłeś się — kliknij, aby wrócić.",
    "learn.mistakesEmpty": "Brak błędów w tym przedmiocie. Tak trzymaj! 🎉",
    "learn.mistakesCount": "{n} do powtórki",
    "learn.jumpToFirstMistake": "Przejdź do pierwszego błędu",

    "sync.idle": "",
    "sync.queued": "zapisywanie…",
    "sync.syncing": "synchronizacja…",
    "sync.synced": "zapisano",
    "sync.failed": "zapisano lokalnie · ponowię",

    "exam.kicker": "Symulacja egzaminu ULC",
    "exam.timeLeft": "Pozostały czas",
    "exam.assembling": "Składanie egzaminu ULC…",
    "exam.startError": "Nie udało się rozpocząć egzaminu ({status})",
    "exam.submitError": "Nie udało się wysłać egzaminu ({status})",
    "exam.errorBack": "Powrót do panelu",
    "exam.questionCounter": "Pytanie {i} / {n}",
    "exam.clear": "Wyczyść zaznaczenie",
    "exam.submit": "Zakończ egzamin",
    "exam.submitting": "Wysyłanie…",
    "exam.reviewSheet": "Arkusz przeglądu",
    "exam.answeredSkipped": "{answered} odpowiedzianych · {skipped} pominiętych",
    "exam.legendAnswered": "Odpowiedziane",
    "exam.legendSkipped": "Pominięte",
    "exam.legendCurrent": "Bieżące",

    "result.kicker": "Wynik egzaminu",
    "result.passed": "ZDANY",
    "result.failed": "NIEZDANY",
    "result.overall": "Wynik ogólny {p}% · {c}/{t} poprawnych",
    "result.threshold": "Zaliczenie wymaga min. {p}% w każdym przedmiocie.",
    "result.sectionStats": "{correct}/{count} poprawnych · {answered} udzielonych",
    "result.reviewTitle": "Przegląd odpowiedzi",
    "result.reviewSummary": "{wrong} błędnych / pominiętych z {total} pytań",
    "result.onlyWrong": "Tylko błędne",
    "result.all": "Wszystkie",
    "result.allCorrect": "Komplet poprawnych odpowiedzi — brak błędów do przejrzenia. 🎉",
    "result.badgeCorrect": "DOBRZE",
    "result.badgeWrong": "ŹLE",
    "result.badgeSkipped": "POMINIĘTE",
    "result.correctTag": "✓ poprawna",
    "result.yourChoice": "Twój wybór",
    "result.notAnswered": "Nie udzielono odpowiedzi.",
    "result.back": "Powrót do panelu",

    "subject.AIR_LAW": "Prawo lotnicze",
    "subject.AIRCRAFT_GENERAL_KNOWLEDGE": "Ogólna wiedza o samolocie",
    "subject.FLIGHT_PERFORMANCE_AND_PLANNING": "Osiągi i planowanie lotu",
    "subject.HUMAN_PERFORMANCE": "Człowiek - możliwości",
    "subject.METEOROLOGY": "Meteorologia",
    "subject.NAVIGATION": "Nawigacja",
    "subject.OPERATIONAL_PROCEDURES": "Procedury operacyjne",
    "subject.PRINCIPLES_OF_FLIGHT": "Zasady lotu",
    "subject.COMMUNICATIONS": "Łączność",
    "subject.GENERAL_SAFETY": "Bezpieczeństwo i sytuacje awaryjne",
    "subject.UNKNOWN": "Pozostałe",
  },
  en: {
    "app.tagline": "PPL(A)",
    "nav.learn": "Study",
    "nav.exam": "ULC Exam",

    "dashboard.title": "Your subjects",
    "dashboard.subtitle": "Study with the PPL(A) question bank or take a full ULC exam simulation.",
    "dashboard.loading": "Loading…",
    "dashboard.questionsInBank": "{n} questions in bank",
    "dashboard.progress": "{a}/{t} attempted · {c} correct",
    "dashboard.error": "Could not load categories ({status})",

    "learn.back": "← Back to subjects",
    "learn.kicker": "PilotReady · Study",
    "learn.questionCounter": "Question {i} / {n} · {p}%",
    "learn.previous": "Previous",
    "learn.next": "Next",
    "learn.footer": "Answers save instantly on this device, then sync quietly to your account.",
    "learn.loading": "Loading flight deck…",
    "learn.empty": "No questions found.",
    "learn.correct": "Correct!",
    "learn.incorrect": "Incorrect",
    "learn.mistakesTitle": "Your mistakes",
    "learn.mistakesSubtitle": "Questions you got wrong — click to revisit.",
    "learn.mistakesEmpty": "No mistakes in this subject. Keep it up! 🎉",
    "learn.mistakesCount": "{n} to review",
    "learn.jumpToFirstMistake": "Jump to first mistake",

    "sync.idle": "",
    "sync.queued": "saving…",
    "sync.syncing": "syncing…",
    "sync.synced": "saved",
    "sync.failed": "saved locally · will retry",

    "exam.kicker": "ULC Exam Simulation",
    "exam.timeLeft": "Time left",
    "exam.assembling": "Assembling ULC exam…",
    "exam.startError": "Could not start exam ({status})",
    "exam.submitError": "Could not submit exam ({status})",
    "exam.errorBack": "Back to dashboard",
    "exam.questionCounter": "Question {i} / {n}",
    "exam.clear": "Clear selection",
    "exam.submit": "Submit Exam",
    "exam.submitting": "Submitting…",
    "exam.reviewSheet": "Review sheet",
    "exam.answeredSkipped": "{answered} answered · {skipped} skipped",
    "exam.legendAnswered": "Answered",
    "exam.legendSkipped": "Skipped",
    "exam.legendCurrent": "Current",

    "result.kicker": "Exam Result",
    "result.passed": "PASSED",
    "result.failed": "NOT PASSED",
    "result.overall": "Overall score {p}% · {c}/{t} correct",
    "result.threshold": "Passing requires at least {p}% in every subject.",
    "result.sectionStats": "{correct}/{count} correct · {answered} answered",
    "result.reviewTitle": "Answer review",
    "result.reviewSummary": "{wrong} wrong / skipped of {total} questions",
    "result.onlyWrong": "Wrong only",
    "result.all": "All",
    "result.allCorrect": "A perfect score — no mistakes to review. 🎉",
    "result.badgeCorrect": "CORRECT",
    "result.badgeWrong": "WRONG",
    "result.badgeSkipped": "SKIPPED",
    "result.correctTag": "✓ correct",
    "result.yourChoice": "Your choice",
    "result.notAnswered": "Not answered.",
    "result.back": "Back to dashboard",

    "subject.AIR_LAW": "Air Law",
    "subject.AIRCRAFT_GENERAL_KNOWLEDGE": "Aircraft General Knowledge",
    "subject.FLIGHT_PERFORMANCE_AND_PLANNING": "Flight Performance and Planning",
    "subject.HUMAN_PERFORMANCE": "Human Performance",
    "subject.METEOROLOGY": "Meteorology",
    "subject.NAVIGATION": "Navigation",
    "subject.OPERATIONAL_PROCEDURES": "Operational Procedures",
    "subject.PRINCIPLES_OF_FLIGHT": "Principles of Flight",
    "subject.COMMUNICATIONS": "Communications",
    "subject.GENERAL_SAFETY": "General Safety & Emergencies",
    "subject.UNKNOWN": "Other",
  },
};

type Vars = Record<string, string | number>;

type I18nValue = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string, vars?: Vars) => string;
};

const I18nContext = createContext<I18nValue | null>(null);
const STORAGE_KEY = "pilotready:lang";

function interpolate(template: string, vars?: Vars) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name) => (name in vars ? String(vars[name]) : `{${name}}`));
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    if (typeof window === "undefined") return "pl";
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "en" || stored === "pl" ? stored : "pl";
  });

  useEffect(() => {
    if (typeof document !== "undefined") document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const t = useCallback(
    (key: string, vars?: Vars) => interpolate(DICT[lang][key] ?? DICT.en[key] ?? key, vars),
    [lang],
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
