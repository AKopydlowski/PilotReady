// PilotReady
// Copyright (c) 2026 Aleksander Kopydłowski. All rights reserved.
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//
// NOTE: licensing stub - to be reviewed/refined later.

import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { failed: boolean };

/**
 * Last line of defence: if a screen throws while rendering, show a way out
 * instead of a blank page. Study answers and a running exam live in
 * localStorage / on the server, so a reload loses nothing.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("PilotReady crashed:", error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    const polish = document.documentElement.lang !== "en";
    return (
      <div className="grid min-h-screen place-items-center px-6 text-center">
        <div className="max-w-sm">
          <img src="/pilotready-logo.png" alt="" width={56} height={56} className="mx-auto h-14 w-14 rounded-2xl" />
          <h1 className="mt-5 text-xl font-bold text-white">{polish ? "Coś poszło nie tak" : "Something went wrong"}</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">
            {polish
              ? "Aplikacja napotkała nieoczekiwany błąd. Twój postęp jest zapisany — odśwież stronę, żeby wrócić."
              : "The app hit an unexpected error. Your progress is saved — reload the page to get back."}
          </p>
          <button type="button" onClick={() => window.location.reload()} className="btn btn-primary mt-6">
            {polish ? "Odśwież stronę" : "Reload the page"}
          </button>
        </div>
      </div>
    );
  }
}
