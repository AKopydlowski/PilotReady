// PilotReady
// Copyright (c) 2026 Aleksander Kopydłowski. All rights reserved.
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//
// NOTE: licensing stub - to be reviewed/refined later.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Lang = "pl" | "en";

// Flat dictionary keyed by "namespace.key". {var} placeholders are interpolated.
const DICT: Record<Lang, Record<string, string>> = {
  pl: {
    "app.tagline": "PPL(A)",
    "nav.learn": "Nauka",
    "nav.exam": "Egzamin ULC",
    "nav.support": "Pomoc",
    "nav.admin": "Admin",
    "nav.logout": "Wyloguj",

    "admin.title": "Panel zgłoszeń",
    "admin.subtitle": "Wszystkie zgłoszenia użytkowników. Zmieniaj status i ogarniaj kolejkę.",
    "admin.loading": "Ładowanie zgłoszeń…",
    "admin.error": "Nie udało się pobrać zgłoszeń.",
    "admin.empty": "Brak zgłoszeń w tym widoku.",
    "admin.filterAll": "Wszystkie",
    "admin.from": "Od",
    "admin.statusLabel": "Status",
    "admin.updateError": "Nie udało się zmienić statusu.",
    "admin.status.NEW": "Nowe",
    "admin.status.IN_PROGRESS": "W trakcie",
    "admin.status.RESOLVED": "Rozwiązane",
    "admin.status.REJECTED": "Odrzucone",
    "admin.delete": "Usuń",
    "admin.deleteConfirm": "Usunąć to zgłoszenie? Zniknie też użytkownikowi.",
    "admin.selected": "Zaznaczono: {n}",
    "admin.selectAll": "Zaznacz widoczne",
    "admin.clearSelection": "Odznacz",
    "admin.bulkSetStatus": "Ustaw status zaznaczonych:",
    "admin.bulkDelete": "Usuń zaznaczone",
    "admin.bulkDeleteConfirm": "Usunąć zaznaczone zgłoszenia ({n})? Znikną też użytkownikom.",
    "admin.actionError": "Nie udało się wykonać akcji.",

    "support.title": "Pomoc i zgłoszenia",
    "support.subtitle": "Znalazłeś błąd albo masz pomysł? Napisz — czytamy każde zgłoszenie.",
    "support.kindLabel": "Typ zgłoszenia",
    "support.kind.BUG": "Błąd",
    "support.kind.SUGGESTION": "Sugestia",
    "support.kind.OTHER": "Inne",
    "support.messageLabel": "Opis",
    "support.messagePlaceholder": "Opisz, co się stało, na jakim ekranie i czego się spodziewałeś…",
    "support.charCount": "{n}/4000",
    "support.submit": "Wyślij zgłoszenie",
    "support.submitting": "Wysyłanie…",
    "support.success": "Dzięki! Zgłoszenie zapisane — zajmiemy się nim.",
    "support.error": "Nie udało się wysłać zgłoszenia. Spróbuj ponownie.",
    "support.yourReports": "Twoje zgłoszenia",
    "support.empty": "Nie masz jeszcze żadnych zgłoszeń.",
    "support.loadingReports": "Ładowanie zgłoszeń…",
    "support.sentAt": "Wysłano {date}",
    "support.statusLabel": "Status",
    "support.status.NEW": "Nowe",
    "support.status.IN_PROGRESS": "W trakcie",
    "support.status.RESOLVED": "Rozwiązane",
    "support.status.REJECTED": "Odrzucone",
    "support.cancel": "Anuluj zgłoszenie",
    "support.cancelHint": "Zgłoszenie możesz anulować w ciągu 10 minut od wysłania.",
    "support.cancelError": "Nie udało się anulować zgłoszenia.",

    "auth.loading": "Sprawdzanie sesji…",
    "auth.welcome": "Twój cyfrowy instruktor PPL(A)",
    "auth.loginTitle": "Zaloguj się",
    "auth.registerTitle": "Załóż konto",
    "auth.loginSubtitle": "Wpisz dane, żeby wrócić do nauki.",
    "auth.registerSubtitle": "Załóż konto i zacznij przygotowania do egzaminu ULC.",
    "auth.email": "E-mail",
    "auth.password": "Hasło",
    "auth.displayName": "Nazwa (opcjonalnie)",
    "auth.passwordHint": "Minimum 8 znaków.",
    "auth.loginCta": "Zaloguj się",
    "auth.registerCta": "Załóż konto",
    "auth.submitting": "Chwilkę…",
    "auth.toRegister": "Nie masz konta? Zarejestruj się",
    "auth.toLogin": "Masz już konto? Zaloguj się",
    "auth.errorPasswordShort": "Hasło musi mieć co najmniej 8 znaków.",
    "auth.errorEmailInvalid": "Podaj poprawny adres e-mail.",
    "auth.errorGeneric": "Coś poszło nie tak. Spróbuj ponownie.",
    "auth.secured": "🔒 Hasła są szyfrowane (bcrypt), sesje podpisane tokenem.",

    "dashboard.title": "Twoje przedmioty",
    "dashboard.subtitle": "Ucz się pytaniami z banku PPL(A) lub podejdź do pełnej symulacji egzaminu ULC.",
    "dashboard.loading": "Ładowanie…",
    "dashboard.questionsInBank": "{n} pytań w banku",
    "dashboard.progress": "{a}/{t} przerobionych · {c} poprawnych",
    "dashboard.error": "Nie udało się pobrać kategorii ({status})",
    "dashboard.subjectsHeading": "Przedmioty",
    "dashboard.mistakesCard": "Powtórka błędów",
    "dashboard.mistakesCardCount": "{n} pytań do powtórki",
    "dashboard.mistakesCardEmpty": "Brak błędów — świetna robota!",
    "dashboard.mistakesStart": "Powtórz wszystkie",

    "study.mistakesHeading": "Powtórka błędów",
    "study.mistakesKicker": "PilotReady · Powtórka",
    "study.sessionLabel": "Sesja {n}",
    "study.masteryProgress": "{m}/{t} opanowanych",
    "study.batchCounter": "Pytanie {i} / {n} w sesji",
    "study.seeResult": "Zobacz wynik",
    "study.batchResultTitle": "Wynik sesji",
    "study.batchScore": "{correct}/{total}",
    "study.wrongInBatch": "Do powtórki w kolejnych sesjach:",
    "study.nextBatch": "Następne {n}",
    "study.finish": "Zakończ",
    "study.mastered": "Przedmiot opanowany! 🎉",
    "study.masteredSubtitle": "Wszystkie {total} pytań odpowiedziane poprawnie.",
    "study.noMistakes": "Brak błędów do powtórki — świetnie!",

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
    "nav.support": "Support",
    "nav.admin": "Admin",
    "nav.logout": "Log out",

    "admin.title": "Reports panel",
    "admin.subtitle": "Every user report. Change status and work through the queue.",
    "admin.loading": "Loading reports…",
    "admin.error": "Could not load reports.",
    "admin.empty": "No reports in this view.",
    "admin.filterAll": "All",
    "admin.from": "From",
    "admin.statusLabel": "Status",
    "admin.updateError": "Could not update status.",
    "admin.status.NEW": "New",
    "admin.status.IN_PROGRESS": "In progress",
    "admin.status.RESOLVED": "Resolved",
    "admin.status.REJECTED": "Rejected",
    "admin.delete": "Delete",
    "admin.deleteConfirm": "Delete this report? It disappears for the user too.",
    "admin.selected": "Selected: {n}",
    "admin.selectAll": "Select visible",
    "admin.clearSelection": "Clear",
    "admin.bulkSetStatus": "Set status of selected:",
    "admin.bulkDelete": "Delete selected",
    "admin.bulkDeleteConfirm": "Delete the selected reports ({n})? They disappear for users too.",
    "admin.actionError": "Could not complete the action.",

    "support.title": "Support & feedback",
    "support.subtitle": "Found a bug or have an idea? Tell us — we read every report.",
    "support.kindLabel": "Report type",
    "support.kind.BUG": "Bug",
    "support.kind.SUGGESTION": "Suggestion",
    "support.kind.OTHER": "Other",
    "support.messageLabel": "Message",
    "support.messagePlaceholder": "Describe what happened, on which screen, and what you expected…",
    "support.charCount": "{n}/4000",
    "support.submit": "Send report",
    "support.submitting": "Sending…",
    "support.success": "Thanks! Your report was saved — we'll look into it.",
    "support.error": "Could not send the report. Please try again.",
    "support.yourReports": "Your reports",
    "support.empty": "You haven't sent any reports yet.",
    "support.loadingReports": "Loading reports…",
    "support.sentAt": "Sent {date}",
    "support.statusLabel": "Status",
    "support.status.NEW": "New",
    "support.status.IN_PROGRESS": "In progress",
    "support.status.RESOLVED": "Resolved",
    "support.status.REJECTED": "Rejected",
    "support.cancel": "Cancel report",
    "support.cancelHint": "You can cancel a report within 10 minutes of sending it.",
    "support.cancelError": "Could not cancel the report.",

    "auth.loading": "Checking your session…",
    "auth.welcome": "Your digital PPL(A) instructor",
    "auth.loginTitle": "Log in",
    "auth.registerTitle": "Create account",
    "auth.loginSubtitle": "Enter your details to get back to studying.",
    "auth.registerSubtitle": "Create an account and start prepping for the ULC exam.",
    "auth.email": "Email",
    "auth.password": "Password",
    "auth.displayName": "Name (optional)",
    "auth.passwordHint": "At least 8 characters.",
    "auth.loginCta": "Log in",
    "auth.registerCta": "Create account",
    "auth.submitting": "One sec…",
    "auth.toRegister": "No account yet? Sign up",
    "auth.toLogin": "Already have an account? Log in",
    "auth.errorPasswordShort": "Password must be at least 8 characters.",
    "auth.errorEmailInvalid": "Enter a valid email address.",
    "auth.errorGeneric": "Something went wrong. Please try again.",
    "auth.secured": "🔒 Passwords are encrypted (bcrypt), sessions signed with a token.",

    "dashboard.title": "Your subjects",
    "dashboard.subtitle": "Study with the PPL(A) question bank or take a full ULC exam simulation.",
    "dashboard.loading": "Loading…",
    "dashboard.questionsInBank": "{n} questions in bank",
    "dashboard.progress": "{a}/{t} attempted · {c} correct",
    "dashboard.error": "Could not load categories ({status})",
    "dashboard.subjectsHeading": "Subjects",
    "dashboard.mistakesCard": "Review your mistakes",
    "dashboard.mistakesCardCount": "{n} questions to review",
    "dashboard.mistakesCardEmpty": "No mistakes — great job!",
    "dashboard.mistakesStart": "Review all",

    "study.mistakesHeading": "Mistakes review",
    "study.mistakesKicker": "PilotReady · Review",
    "study.sessionLabel": "Session {n}",
    "study.masteryProgress": "{m}/{t} mastered",
    "study.batchCounter": "Question {i} / {n} in session",
    "study.seeResult": "See result",
    "study.batchResultTitle": "Session result",
    "study.batchScore": "{correct}/{total}",
    "study.wrongInBatch": "To revisit in later sessions:",
    "study.nextBatch": "Next {n}",
    "study.finish": "Finish",
    "study.mastered": "Subject mastered! 🎉",
    "study.masteredSubtitle": "All {total} questions answered correctly.",
    "study.noMistakes": "No mistakes to review — great!",

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
