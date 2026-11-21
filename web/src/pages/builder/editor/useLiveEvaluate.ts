import { useEffect, useState } from "react";
import { EvalResult, EvalTarget, LoadoutState, evaluate } from "../../../build";

/** Evaluación en vivo del equipo (con retardo de 250 ms y cancelación). */
export function useLiveEvaluate(st: LoadoutState, targets?: EvalTarget[]) {
  const [ev, setEv] = useState<EvalResult | null>(null);
  const [evErr, setEvErr] = useState<string | null>(null);
  const [evBusy, setEvBusy] = useState(false);
  const tkey = targets?.length ? JSON.stringify(targets) : "";
  useEffect(() => {
    const has = Object.values(st.pieces).some(Boolean) || st.charm || Object.values(st.decos).some((a) => a.some((x) => x != null));
    if (!has) {
      setEv(null);
      setEvErr(null);
      setEvBusy(false);
      return;
    }
    setEvBusy(true);
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      evaluate(st, ctrl.signal, tkey ? (JSON.parse(tkey) as EvalTarget[]) : undefined)
        .then((r) => {
          setEv(r);
          setEvErr(null);
          setEvBusy(false);
        })
        .catch((e: Error) => {
          if (e.name === "AbortError") return;
          setEvErr(e.message);
          setEvBusy(false);
        });
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [st, tkey]);
  return { ev, evErr, evBusy, clearEv: () => setEv(null) };
}
