// PilotReady
// Copyright (c) 2026 Aleksander Kopydłowski. All rights reserved.
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//
// NOTE: licensing stub - to be reviewed/refined later.

// Tiny hash router. Keeping the current screen in the URL means a refresh stays
// where you were, the browser Back button works, and screens can be linked to —
// without adding a routing dependency or any server-side rewrites.

import { useCallback, useEffect, useState } from "react";

export type Route =
  | { kind: "dashboard" }
  | { kind: "study"; categoryId: string }
  | { kind: "review"; categoryId?: string }
  | { kind: "exam" }
  | { kind: "support"; questionRef?: string }
  | { kind: "admin" };

const CATEGORY_RE = /^[A-Z_]{3,40}$/;

export function parseRoute(hash: string): Route {
  const [path, query = ""] = hash.replace(/^#\/?/, "").split("?");
  const [head, arg] = path.split("/");
  switch (head) {
    case "study":
      return arg && CATEGORY_RE.test(arg) ? { kind: "study", categoryId: arg } : { kind: "dashboard" };
    case "review":
      return arg && CATEGORY_RE.test(arg) ? { kind: "review", categoryId: arg } : { kind: "review" };
    case "exam":
      return { kind: "exam" };
    case "support": {
      const ref = new URLSearchParams(query).get("q") ?? undefined;
      return { kind: "support", questionRef: ref && /^[A-Z0-9-]{4,20}$/.test(ref) ? ref : undefined };
    }
    case "admin":
      return { kind: "admin" };
    default:
      return { kind: "dashboard" };
  }
}

export function routeHref(route: Route): string {
  switch (route.kind) {
    case "study":
      return `#/study/${route.categoryId}`;
    case "review":
      return route.categoryId ? `#/review/${route.categoryId}` : "#/review";
    case "exam":
      return "#/exam";
    case "support":
      return route.questionRef ? `#/support?q=${route.questionRef}` : "#/support";
    case "admin":
      return "#/admin";
    default:
      return "#/";
  }
}

export function useRoute(): [Route, (route: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));

  useEffect(() => {
    const onChange = () => {
      setRoute(parseRoute(window.location.hash));
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const navigate = useCallback((next: Route) => {
    const href = routeHref(next);
    if (window.location.hash === href || (href === "#/" && window.location.hash === "")) {
      setRoute(next);
      window.scrollTo({ top: 0 });
    } else {
      window.location.hash = href;
    }
  }, []);

  return [route, navigate];
}
