"use client";
// src/app/(tuki)/search/page.tsx — página de búsqueda Tuki. useSearchParams exige <Suspense> en Next 16.
// Lee ?q= y ejecuta la búsqueda two-phase cuando q cambia (re-búsquedas del navbar = cambio del query param).
import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { SearchView } from "@/components/tuki/SearchView";
import { useTukiSearch } from "@/components/tuki/useTukiSearch";

function SearchPageInner() {
  const q = useSearchParams().get("q")?.trim() ?? "";
  const search = useTukiSearch();
  const { run } = search;
  useEffect(() => {
    if (q) run(q);
  }, [q, run]);
  return <SearchView q={q} search={search} />;
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchPageInner />
    </Suspense>
  );
}
