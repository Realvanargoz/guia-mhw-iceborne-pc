import { Component, ErrorInfo, ReactNode } from "react";
import { Link } from "react-router-dom";

type Props = { children: ReactNode };
type Probe = "idle" | "checking" | "up" | "down";
type State = { error: Error | null; probe: Probe };

/** ¿El fallo es de carga de una página (trozo de la app) y no de render? Pasa si el servidor local se paró
 *  o si el paquete se actualizó con la ventana abierta. */
export function isLoadFailure(error: Error | null): boolean {
  const m = `${error?.name ?? ""} ${error?.message ?? ""}`;
  return /dynamically imported module|Importing a module script failed|Loading chunk|error loading dynamically/i.test(m);
}

async function serverIsUp(): Promise<boolean> {
  try {
    const ctl = new AbortController();
    const t = window.setTimeout(() => ctl.abort(), 4000);
    const r = await fetch("/api/health", { cache: "no-store", signal: ctl.signal });
    window.clearTimeout(t);
    return r.ok;
  } catch {
    return false;
  }
}

/** Evita la pantalla en blanco: un fallo de render en una página muestra un aviso en lugar de desmontar toda la app.
 *  Se usa con `key={pathname}` para reiniciarse al cambiar de ruta.
 *  Si el fallo es de carga, comprueba el servidor: si responde recarga la ventana (una vez); si no, lo explica. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, probe: "idle" };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error, probe: "idle" };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
    if (isLoadFailure(error)) void this.check(true);
  }

  private check = async (auto: boolean) => {
    this.setState({ probe: "checking" });
    const up = await serverIsUp();
    if (up) {
      this.setState({ probe: "up" });
      // Trozo obsoleto o carga interrumpida: una recarga lo resuelve. Una sola vez automática para no entrar en bucle.
      let doReload = !auto;
      if (auto) {
        try {
          const last = Number(sessionStorage.getItem("mhw.chunkReload") ?? 0);
          if (Date.now() - last > 15_000) {
            sessionStorage.setItem("mhw.chunkReload", String(Date.now()));
            doReload = true;
          }
        } catch {
          doReload = false;
        }
      }
      if (doReload) window.location.reload();
    } else {
      this.setState({ probe: "down" });
    }
  };

  render() {
    const { error, probe } = this.state;
    if (!error) return this.props.children;

    if (isLoadFailure(error)) {
      return (
        <div className="errorpage parchment" role="alert">
          <h2>{probe === "down" ? "La aplicación dejó de responder" : "No se pudo cargar esta página"}</h2>
          {probe === "down" ? (
            <p>
              El servidor local de la aplicación ya no está activo (por ejemplo, tras mucho tiempo en segundo plano). Cierra esta ventana y vuelve a
              abrir «Guía MHW» desde el menú Inicio; tus datos están a salvo.
            </p>
          ) : probe === "up" ? (
            <p>Recargando…</p>
          ) : (
            <p>Comprobando la conexión con la aplicación…</p>
          )}
          <p className="errorpage__actions">
            <button type="button" className="btn" disabled={probe === "checking"} onClick={() => void this.check(false)}>
              Reintentar
            </button>{" "}
            <button type="button" className="btn" onClick={() => window.location.reload()}>
              Recargar la ventana
            </button>
          </p>
          <details>
            <summary>Detalle técnico</summary>
            <pre>{String(error.stack ?? error.message ?? error)}</pre>
          </details>
        </div>
      );
    }

    return (
      <div className="errorpage parchment" role="alert">
        <h2>Algo falló al mostrar esta página</h2>
        <p>Puedes reintentar o volver al inicio. Si se repite, avisa con el detalle técnico de abajo.</p>
        <p className="errorpage__actions">
          <button type="button" className="btn" onClick={() => this.setState({ error: null, probe: "idle" })}>
            Reintentar
          </button>{" "}
          <Link to="/" className="btn">
            Ir al inicio
          </Link>
        </p>
        <details>
          <summary>Detalle técnico</summary>
          <pre>{String(error.stack ?? error.message ?? error)}</pre>
        </details>
      </div>
    );
  }
}
