import { useCallback, useEffect, useState } from "react";

export async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`/api${path}`, { signal });
  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export async function putProgress(type: string, id: string | number, done: boolean, notes?: string) {
  const res = await fetch(`/api/progress/${type}/${encodeURIComponent(String(id))}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-MHW-Client": "1" },
    body: JSON.stringify({ done, notes }),
  });
  if (!res.ok) throw new Error(`No se pudo guardar (${res.status})`);
}

export type ApiState<T> = { data?: T; error?: string; loading: boolean; reload: () => void };

export function useApi<T>(path: string | null): ApiState<T> {
  const [tick, setTick] = useState(0);
  // El estado guarda a qué ruta pertenece: nunca se devuelven datos de una ruta anterior como si fueran los actuales.
  const [state, setState] = useState<{ path: string | null; data?: T; error?: string; loading: boolean }>({
    path,
    loading: !!path,
  });
  useEffect(() => {
    if (!path) return;
    const ctrl = new AbortController();
    // mantiene los datos de la misma ruta durante un reload(); los de otra ruta se descartan
    setState((s) => ({ path, data: s.path === path ? s.data : undefined, loading: true }));
    getJson<T>(path, ctrl.signal)
      .then((data) => setState({ path, data, loading: false }))
      .catch((e: Error) => {
        if (e.name !== "AbortError") setState({ path, error: e.message, loading: false });
      });
    return () => ctrl.abort();
  }, [path, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  if (state.path !== path) return { loading: !!path, reload }; // primer render tras cambiar de ruta, antes del efecto
  return { data: state.data, error: state.error, loading: state.loading, reload };
}

export async function sendJson<T = unknown>(method: "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? { "X-MHW-Client": "1" } : { "Content-Type": "application/json", "X-MHW-Client": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = `Error ${res.status}`;
    try {
      const j = await res.json();
      detail = Array.isArray(j.detail) ? j.detail.map((d: { msg: string }) => d.msg.replace(/^Value error, /, "")).join(" · ") : j.detail ?? detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export async function uploadFile<T = unknown>(path: string, file: File, field = "file"): Promise<T> {
  const fd = new FormData();
  fd.append(field, file);
  const res = await fetch(`/api${path}`, { method: "POST", headers: { "X-MHW-Client": "1" }, body: fd });
  if (!res.ok) {
    let detail = res.status === 413 ? "El archivo es demasiado grande." : `Error ${res.status}`;
    try {
      const j = await res.json();
      detail = Array.isArray(j.detail) ? j.detail.map((d: { msg: string }) => d.msg).join(" · ") : j.detail ?? detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}
