/* Versiones del equipo (v1.0, v1.1…): guardar, cargar, renombrar, borrar, restaurar y comparar; exportar / importar el plan. */
import { Dispatch, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Dialog from "../../../components/Dialog";
import { ErrorBox } from "../../../components/ui";
import { EvalResult, LoadoutState, evaluate, fromRow, toPayload } from "../../../build";
import { ConfirmDelete } from "../editor/pickers";
import { LABEL_RE, VersionDiff, diffEvals, exportPlan, parsePlanImport, suggestLabel } from "../coverage";
import { TestLog, VersionFull, VersionMeta, createVersion, deleteVersion, getVersion, listVersions, patchVersion, restoreVersion, versionMessage } from "../planApi";
import { Action, PlanState } from "../planState";
import { VERDICT_ES } from "./TestLogForm";

type Props = {
  /** id del equipo guardado (null = aún sin guardar) */
  savedId: string | null;
  st: LoadoutState;
  plan: PlanState;
  planBody: unknown;
  dispatch: Dispatch<Action>;
  activeVid: number | null;
  /** pruebas sin versión donde guardarlas: se adjuntan a la próxima versión */
  pendingTests: TestLog[];
  hasPieces: boolean;
  busy: boolean;
  onSaveBuild: () => void;
  /** una versión pasa a ser la activa y su contenido se carga en el editor */
  onActivate: (v: VersionFull, label: string) => void;
  onActiveDeleted: () => void;
  onImported: (state: LoadoutState | null, label: string) => void;
  announce: (text: string) => void;
};

const dateEs = (s: string) => {
  const t = Date.parse(s.includes("T") || s.endsWith("Z") ? s : `${s.replace(" ", "T")}Z`);
  return Number.isFinite(t) ? new Date(t).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" }) : s;
};
const stateOf = (v: VersionFull) => fromRow({ id: 0, name: v.label, payload: v.payload }).state;

function RenameVersion({ cur, taken, onSave, onClose }: { cur: string; taken: string[]; onSave: (l: string) => void; onClose: () => void }) {
  const [v, setV] = useState(cur);
  const t = v.trim();
  const err = !LABEL_RE.test(t) ? "Usa el formato vN.N, por ejemplo v1.2 (hasta 3 cifras en cada parte)." : t !== cur && taken.includes(t) ? "Ya existe una versión con esa etiqueta." : "";
  return (
    <Dialog open onClose={onClose} title="Renombrar versión" className="bd-dlg bd-dlg--s">
      <form
        className="bd-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!err) onSave(t);
        }}
      >
        <label className="bd-form__f">
          Etiqueta
          <input value={v} onChange={(e) => setV(e.target.value)} maxLength={8} aria-invalid={!!err} aria-describedby="pl-ren-err" autoFocus />
        </label>
        <p id="pl-ren-err" className="pl-muted" role="status" aria-live="polite">{err}</p>
        <div className="bd-form__btns">
          <button type="button" className="bd-btn bd-btn--ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="bd-btn" disabled={!!err}>
            Guardar
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function DiffView({ d, a, b }: { d: VersionDiff; a: string; b: string }) {
  if (d.same) return <p className="pl-empty pl-empty--s">Las versiones {a} y {b} dan el mismo resultado: mismas habilidades, defensa, resistencias, piezas y joyas.</p>;
  const sk = (x: { name: string; from: number; to: number }) => `${x.name}: ${x.from} → ${x.to}`;
  const num = (x: { label: string; from: number; to: number }) => `${x.label}: ${x.from} → ${x.to} (${x.to > x.from ? "+" : ""}${x.to - x.from})`;
  return (
    <div className="pl-diff">
      <p className="pl-muted">Antes: <b>{a}</b> · Después: <b>{b}</b></p>
      {d.skillsUp.length > 0 && (
        <>
          <h5 className="pl-h4">Habilidades que suben</h5>
          <ul>{d.skillsUp.map((x) => <li key={x.skill_id}><span aria-hidden>▲</span> <span className="pl-sr">Sube. </span>{sk(x)}</li>)}</ul>
        </>
      )}
      {d.skillsDown.length > 0 && (
        <>
          <h5 className="pl-h4">Habilidades que bajan</h5>
          <ul>{d.skillsDown.map((x) => <li key={x.skill_id}><span aria-hidden>▼</span> <span className="pl-sr">Baja. </span>{sk(x)}</li>)}</ul>
        </>
      )}
      {d.defense.length > 0 && (
        <>
          <h5 className="pl-h4">Defensa</h5>
          <ul>{d.defense.map((x) => <li key={x.label}>{num(x)}</li>)}</ul>
        </>
      )}
      {d.resistances.length > 0 && (
        <>
          <h5 className="pl-h4">Resistencias</h5>
          <ul>{d.resistances.map((x) => <li key={x.label}>{num(x)}</li>)}</ul>
        </>
      )}
      {d.pieces.length > 0 && (
        <>
          <h5 className="pl-h4">Piezas cambiadas</h5>
          <ul>{d.pieces.map((x) => <li key={x.label}>{x.label}: {x.from} → {x.to}</li>)}</ul>
        </>
      )}
      {d.jewels.length > 0 && (
        <>
          <h5 className="pl-h4">Joyas</h5>
          <ul>{d.jewels.map((x) => <li key={x.name}>{x.delta > 0 ? `Se añade${x.delta > 1 ? `n ${x.delta}` : ""}` : `Se quita${x.delta < -1 ? `n ${-x.delta}` : ""}`}: {x.name}</li>)}</ul>
        </>
      )}
    </div>
  );
}

export default function VersionsPanel({ savedId, st, planBody, dispatch, activeVid, pendingTests, hasPieces, busy, onSaveBuild, onActivate, onActiveDeleted, onImported, announce }: Props) {
  const [list, setList] = useState<VersionMeta[]>([]);
  const [verdicts, setVerdicts] = useState<Record<number, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [label, setLabel] = useState("");
  const [major, setMajor] = useState(false);
  const [renaming, setRenaming] = useState<VersionMeta | null>(null);
  const [deleting, setDeleting] = useState<VersionMeta | null>(null);
  const [cmpA, setCmpA] = useState("");
  const [cmpB, setCmpB] = useState("");
  const [diff, setDiff] = useState<{ d: VersionDiff; a: string; b: string } | null>(null);
  const [ioText, setIoText] = useState("");
  const [ioMsg, setIoMsg] = useState("");
  const labelRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    if (!savedId) {
      setList([]);
      setVerdicts({});
      return;
    }
    setLoading(true);
    try {
      const rows = await listVersions(savedId);
      setList(rows);
      setErr(null);
      const ver: Record<number, string> = {};
      await Promise.all(
        rows
          .filter((r) => r.has_tests)
          .map(async (r) => {
            try {
              const v = await getVersion(savedId, r.id);
              const last = v.tests?.[v.tests.length - 1];
              if (last) ver[r.id] = VERDICT_ES[last.verdict] ?? last.verdict;
            } catch {
              /* el veredicto es solo informativo */
            }
          }),
      );
      setVerdicts(ver);
    } catch (e) {
      setErr(versionMessage(e));
    } finally {
      setLoading(false);
    }
  }, [savedId]);
  useEffect(() => {
    setDiff(null);
    void reload();
  }, [reload]);

  useEffect(() => {
    if (list.length >= 2) {
      setCmpA((a) => (list.some((v) => String(v.id) === a) ? a : String(list[list.length - 2].id)));
      setCmpB((b) => (list.some((v) => String(v.id) === b) ? b : String(list[list.length - 1].id)));
    } else {
      setCmpA("");
      setCmpB("");
    }
  }, [list]);

  const labels = useMemo(() => list.map((v) => v.label), [list]);
  const trimmed = label.trim();
  const labelErr = trimmed && !LABEL_RE.test(trimmed) ? "Usa el formato vN.N, por ejemplo v1.2." : trimmed && labels.includes(trimmed) ? "Ya existe una versión con esa etiqueta." : "";
  const preview = trimmed || suggestLabel(labels, major);

  const run = async (f: () => Promise<void>) => {
    setWorking(true);
    setErr(null);
    try {
      await f();
    } catch (e) {
      const m = versionMessage(e);
      setErr(m);
      announce(`Error: ${m}`);
    } finally {
      setWorking(false);
    }
  };

  const saveVersion = () =>
    run(async () => {
      if (!savedId || labelErr) return;
      const v = await createVersion(savedId, {
        label: trimmed || undefined,
        major: !trimmed && major,
        payload: toPayload(st),
        plan: planBody,
        tests: activeVid == null ? pendingTests : [],
        parent_id: activeVid,
      });
      onActivate(v, v.label);
      setLabel("");
      setMajor(false);
      announce(`Versión ${v.label} guardada.`);
      await reload();
    });
  const load = (m: VersionMeta) =>
    run(async () => {
      if (!savedId) return;
      const v = await getVersion(savedId, m.id);
      onActivate(v, v.label);
      if (v.plan) dispatch({ type: "loadDraft", draft: { plan: v.plan as never, step: "probar" } });
      announce(`Versión ${v.label} cargada en el editor.`);
    });
  const restore = (m: VersionMeta) =>
    run(async () => {
      if (!savedId) return;
      const v = await restoreVersion(savedId, m.id);
      onActivate(v, v.label);
      if (v.plan) dispatch({ type: "loadDraft", draft: { plan: v.plan as never, step: "probar" } });
      announce(`Restaurada ${m.label}: se creó la versión nueva ${v.label}.`);
      await reload();
    });
  const rename = (m: VersionMeta, l: string) =>
    run(async () => {
      if (!savedId) return;
      await patchVersion(savedId, m.id, { label: l });
      announce(`Versión ${m.label} renombrada a ${l}.`);
      await reload();
    });
  const remove = (m: VersionMeta) =>
    run(async () => {
      if (!savedId) return;
      await deleteVersion(savedId, m.id);
      if (m.id === activeVid) onActiveDeleted();
      announce(`Versión ${m.label} eliminada.`);
      await reload();
    });
  const compare = () =>
    run(async () => {
      if (!savedId || !cmpA || !cmpB) return;
      if (cmpA === cmpB) {
        setDiff(null);
        setErr("Elige dos versiones distintas para compararlas.");
        return;
      }
      const [va, vb] = await Promise.all([getVersion(savedId, Number(cmpA)), getVersion(savedId, Number(cmpB))]);
      const ev = (v: VersionFull): Promise<EvalResult> => evaluate(stateOf(v));
      const [ea, eb] = await Promise.all([ev(va), ev(vb)]);
      setDiff({ d: diffEvals(ea, eb), a: va.label, b: vb.label });
      announce(`Comparación de ${va.label} y ${vb.label} lista.`);
    });

  const doExport = () => {
    setIoText(exportPlan(planBody, hasPieces ? st : null, "Mi plan"));
    setIoMsg("Plan exportado: copia el texto para guardarlo.");
  };
  const doImport = () => {
    try {
      const r = parsePlanImport(ioText);
      dispatch({ type: "loadDraft", draft: { plan: r.plan, step: "probar" } });
      onImported(r.state, r.state ? `Plan «${r.name}» importado con su equipo.` : `Plan «${r.name}» importado.`);
      setIoMsg(`Plan «${r.name}» importado: ${r.plan.targets.length} habilidades${r.state ? " y equipo" : ""}.`);
      setIoText("");
    } catch (e) {
      setIoMsg((e as Error).message);
    }
  };

  return (
    <section className="pl-card pl-versions" aria-labelledby="pl-ver-h">
      <h3 id="pl-ver-h" className="pl-h3">Versiones del equipo</h3>
      {!savedId ? (
        <div className="pl-note" role="note">
          <p>
            <b>Guarda primero el equipo.</b> Las versiones cuelgan de un equipo guardado: pulsa «Guardar con el plan» (o «Guardar como nueva» en Mis composiciones, más abajo) y aquí podrás crear v1.0, v1.1…
          </p>
          <button type="button" className="bd-btn" onClick={onSaveBuild} disabled={busy || !hasPieces}>
            Guardar con el plan
          </button>
          {!hasPieces && <span className="pl-muted"> Elige alguna pieza antes de guardar.</span>}
        </div>
      ) : (
        <>
          <div className="pl-row pl-row--act">
            <label className="pl-field">
              Etiqueta (opcional)
              <input ref={labelRef} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={8} placeholder={suggestLabel(labels, major)} aria-invalid={!!labelErr} aria-describedby="pl-ver-err" className="pl-num pl-num--w" />
            </label>
            <label className="pl-check">
              <input type="checkbox" checked={major} onChange={(e) => setMajor(e.target.checked)} disabled={!!trimmed} />
              <span>Versión mayor (sube al siguiente vN.0)</span>
            </label>
            <button type="button" className="bd-btn" onClick={saveVersion} disabled={working || !!labelErr || !hasPieces}>
              Guardar versión {preview}
            </button>
          </div>
          <p id="pl-ver-err" className="pl-muted" role="status" aria-live="polite">{labelErr}</p>
          {pendingTests.length > 0 && activeVid == null && <p className="pl-muted">Se adjuntarán {pendingTests.length} prueba(s) registradas a la nueva versión.</p>}
          {err && <ErrorBox error={err} />}
          {loading && !list.length ? (
            <p className="pl-muted" role="status">Cargando versiones…</p>
          ) : list.length === 0 ? (
            <p className="pl-empty pl-empty--s">Este equipo aún no tiene versiones. Guarda la primera (v1.0) cuando estés contento con la base.</p>
          ) : (
            <ul className="pl-vlist">
              {[...list].reverse().map((m) => (
                <li key={m.id} className={`pl-row-item pl-vrow${m.id === activeVid ? " is-active" : ""}`}>
                  <span className="pl-row-item__main">
                    <b className="pl-row-item__n">
                      {m.label}
                      {m.id === activeVid && <span className="pl-tag pl-tag--on"> actual</span>}
                    </b>
                    <small className="pl-muted">
                      {dateEs(m.created_at)} · Veredicto: {verdicts[m.id] ?? (m.has_tests ? "…" : "sin pruebas")}
                    </small>
                  </span>
                  <span className="pl-vact">
                    <button type="button" className="bd-btn bd-btn--s" onClick={() => load(m)} disabled={working} aria-label={`Cargar la versión ${m.label}`}>
                      Cargar
                    </button>
                    <button type="button" className="bd-btn bd-btn--s bd-btn--ghost" onClick={() => setRenaming(m)} disabled={working} aria-label={`Renombrar la versión ${m.label}`}>
                      Renombrar
                    </button>
                    <button type="button" className="bd-btn bd-btn--s bd-btn--ghost" onClick={() => restore(m)} disabled={working} aria-label={`Restaurar la versión ${m.label} como versión nueva`}>
                      Restaurar
                    </button>
                    <button type="button" className="bd-btn bd-btn--s bd-btn--ghost" onClick={() => setDeleting(m)} disabled={working} aria-label={`Borrar la versión ${m.label}`}>
                      Borrar
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {list.length >= 2 && (
            <div className="pl-compare">
              <h4 className="pl-h4">Comparar dos versiones</h4>
              <div className="pl-row pl-row--act">
                <label className="pl-field">
                  Antes
                  <select value={cmpA} onChange={(e) => setCmpA(e.target.value)}>
                    {list.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                  </select>
                </label>
                <label className="pl-field">
                  Después
                  <select value={cmpB} onChange={(e) => setCmpB(e.target.value)}>
                    {list.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                  </select>
                </label>
                <button type="button" className="bd-btn bd-btn--ghost" onClick={compare} disabled={working}>
                  Comparar
                </button>
              </div>
              {diff && <DiffView d={diff.d} a={diff.a} b={diff.b} />}
            </div>
          )}
        </>
      )}

      <details className="bd-io pl-io">
        <summary>Exportar / importar el plan (JSON)</summary>
        <div className="bd-io__btns">
          <button type="button" className="bd-btn bd-btn--s" onClick={doExport}>
            Exportar el plan actual
          </button>
          <button type="button" className="bd-btn bd-btn--s" onClick={doImport} disabled={!ioText.trim()}>
            Importar el texto
          </button>
        </div>
        <textarea
          value={ioText}
          onChange={(e) => {
            setIoText(e.target.value);
            setIoMsg("");
          }}
          rows={6}
          maxLength={200000}
          className="pl-ta"
          placeholder="Pega aquí un plan exportado para importarlo, o pulsa Exportar."
          aria-label="JSON del plan"
        />
        <p className="bv-hint" role="status" aria-live="polite">{ioMsg}</p>
      </details>

      {renaming && (
        <RenameVersion
          cur={renaming.label}
          taken={labels}
          onClose={() => setRenaming(null)}
          onSave={(l) => {
            void rename(renaming, l);
            setRenaming(null);
          }}
        />
      )}
      {deleting && (
        <ConfirmDelete
          title="Eliminar versión"
          build={{ name: deleting.label }}
          onClose={() => setDeleting(null)}
          onConfirm={() => {
            void remove(deleting);
            setDeleting(null);
          }}
        />
      )}
    </section>
  );
}
