"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { observeSeen } from "@/lib/client/seen-reporter";

/**
 * Marks the wrapped card as SEEN (viewport ≥50% × ≥1s, once per pageload)
 * against its slate position (E3). Without slateId/position it renders
 * children untouched — carousels and fallback paths cost nothing.
 */
export function SeenTracker({
  slateId,
  position,
  children,
}: {
  slateId: string | null | undefined;
  position: number | null | undefined;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ref.current || !slateId || !position) return;
    return observeSeen(ref.current, slateId, position);
  }, [slateId, position]);

  if (!slateId || !position) return <>{children}</>;
  return <div ref={ref}>{children}</div>;
}
