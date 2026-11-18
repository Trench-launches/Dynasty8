"use client";

import { useEffect, useState } from "react";
import { api, usingMockApi } from "@/lib/api";
import type { MarketSnapshot } from "@/lib/types";

const POLL_MS = 60_000;

/**
 * Fresh market data for one property, seeded with whatever the list already had.
 * Polls while mounted when a real backend is configured. Key the calling component
 * by slug so state resets when the property changes.
 */
export function useMarket(slug: string, initial: MarketSnapshot | null) {
  const [market, setMarket] = useState(initial);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .getPropertyMarket(slug)
        .then((m) => {
          if (cancelled) return;
          setMarket(m);
          setStatus("idle");
        })
        .catch(() => {
          if (!cancelled) setStatus("error");
        });
    load();
    // Background tabs skip refreshes (each one is a Worker request).
    const timer = usingMockApi ? null : setInterval(() => !document.hidden && load(), POLL_MS);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [slug]);

  return { market, status };
}
