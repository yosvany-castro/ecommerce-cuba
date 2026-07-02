"use client";
import { useEffect, useRef } from "react";
import { track } from "@/lib/client/track";

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
    track("search", { raw_query: query, results_count: resultsCount, method: "hybrid_rrf" });
  }, [query, resultsCount]);
  return null;
}
