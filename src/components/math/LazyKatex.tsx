"use client";

import dynamic from "next/dynamic";

// KaTeX diferido: se descarga (JS + CSS) la primera vez que hay una fórmula en pantalla.
export const LazyKatex = dynamic(() => import("./KatexMath").then((m) => m.KatexMath), {
  ssr: false,
  loading: () => (
    <span
      aria-hidden="true"
      className="inline-block h-5 w-28 rounded bg-andros-border/40 animate-pulse motion-reduce:animate-none"
    />
  ),
});
