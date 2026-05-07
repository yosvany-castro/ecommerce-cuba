"use client";
import { useEffect, useRef } from "react";

async function trackEvent(body: Record<string, unknown>) {
  return fetch("/api/track", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
}

function hashKey(q: string): string {
  // Minute-bucket hash so client-side double-renders don't double-emit.
  const bucket = Math.floor(Date.now() / 60_000);
  return `${q}|${bucket}`;
}

const seen = new Set<string>();

export function SearchTracker({ query, resultsCount }: { query: string; resultsCount: number }) {
  const sentRef = useRef(false);
  useEffect(() => {
    if (sentRef.current || !query) return;
    const key = hashKey(query);
    if (seen.has(key)) return;
    seen.add(key);
    sentRef.current = true;
    void trackEvent({
      event_type: "search",
      occurred_at: new Date().toISOString(),
      payload: { raw_query: query, results_count: resultsCount, method: "like" },
    });
  }, [query, resultsCount]);
  return null;
}
