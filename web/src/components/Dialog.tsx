import { ReactNode, useEffect, useId, useRef } from "react";
import "../dialog.css";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  /** "modal" = diálogo centrado / hoja inferior; "drawer" = cajón lateral izquierdo. */
  variant?: "modal" | "drawer";
  className?: string;
  /** Oculta el título visualmente (sigue siendo el nombre accesible). */
  hideTitle?: boolean;
  children: ReactNode;
};

/**
 * Diálogo basado en <dialog>.showModal(): el fondo queda inerte, Escape cierra, el foco queda
 * atrapado y se devuelve al disparador al cerrar. El scroll de la página se bloquea desde dialog.css.
 */
export default function Dialog({ open, onClose, title, variant = "modal", className = "", hideTitle, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      opener.current = document.activeElement;
      d.showModal();
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);

  useEffect(
    () => () => {
      const o = opener.current;
      if (o instanceof HTMLElement && document.contains(o)) o.focus();
    },
    [],
  );

  const handleClose = () => {
    const o = opener.current;
    if (o instanceof HTMLElement && document.contains(o)) o.focus();
    onClose();
  };

  return (
    <dialog
      ref={ref}
      className={`dlg dlg--${variant} ${className}`.trim()}
      aria-labelledby={titleId}
      onClose={handleClose}
      onClick={(e) => {
        // clic en el fondo (::backdrop) = el propio <dialog>
        if (e.target === ref.current) ref.current?.close();
      }}
    >
      {open && (
        <div className="dlg__body">
          <div className="dlg__head">
            <h2 id={titleId} className={hideTitle ? "sr-only" : "dlg__title"}>
              {title}
            </h2>
            <button type="button" className="dlg__x" aria-label="Cerrar" onClick={() => ref.current?.close()}>
              ✕
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
