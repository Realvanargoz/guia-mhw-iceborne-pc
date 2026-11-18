import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/** ¿Hay una página anterior dentro de la app? (react-router guarda el índice de la entrada en history.state.idx) */
export function useCanGoBack(): boolean {
  useLocation(); // vuelve a evaluar en cada navegación
  const idx = (window.history.state as { idx?: number } | null)?.idx;
  return typeof idx === "number" && idx > 0;
}

export function IconBack() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden focusable="false">
      <path d="M14.5 5 7.5 12l7 7M8 12h11" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconUp() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden focusable="false">
      <path d="M5 14.5 12 7.5l7 7M12 8v11" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const SHOW_AFTER = 480; // px de scroll a partir de los que aparece «Subir»

/**
 * Dock flotante abajo a la derecha: «Volver» (si hay historial) y «Subir» (tras bajar bastante).
 * La barra superior también lleva «Volver», pero aquí queda al alcance cuando la página es larga.
 */
export default function FloatingNav() {
  const navigate = useNavigate();
  const canBack = useCanGoBack();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > SHOW_AFTER);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const goTop = () => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    // el foco no debe quedarse en un botón que desaparece
    document.getElementById("contenido")?.focus({ preventScroll: true });
  };

  if (!canBack && !scrolled) return null;
  return (
    <div className="fnav" role="group" aria-label="Navegación rápida">
      {scrolled && (
        <button type="button" className="fnav__btn" onClick={goTop} aria-label="Subir al inicio de la página" title="Subir">
          <IconUp />
        </button>
      )}
      {canBack && (
        <button type="button" className="fnav__btn" onClick={() => navigate(-1)} aria-label="Volver a la página anterior" title="Volver (Alt + ←)">
          <IconBack />
        </button>
      )}
    </div>
  );
}
