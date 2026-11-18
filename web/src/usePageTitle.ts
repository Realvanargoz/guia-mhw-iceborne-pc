import { useEffect } from "react";

const BASE = "Guía MHW";

/** Escribe document.title = "<título> · Guía MHW" (solo la marca si no hay título). */
export function usePageTitle(title?: string | null) {
  useEffect(() => {
    document.title = title ? `${title} · ${BASE}` : BASE;
  }, [title]);
}
