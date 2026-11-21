/* Paso 7 «Probar»: editor del equipo + cobertura en vivo + registro de pruebas + versiones + composiciones guardadas. */
import { useCallback, useEffect, useMemo, useState } from "react";
import { OrnateHeader } from "../../../components/ui";
import { fromRow } from "../../../build";
import EvalPanel from "../editor/EvalPanel";
import type { Editor, PlanBridge } from "../editor/EditorPage";
import LoadoutEditor from "../editor/LoadoutEditor";
import SavedPanel from "../editor/SavedPanel";
import { TestLog, VersionFull, getVersion, patchVersion, planBody as makePlanBody, versionMessage } from "../planApi";
import CoverageChecklist from "./CoverageChecklist";
import TestLogForm from "./TestLogForm";
import VersionsPanel from "./VersionsPanel";

const MAX_TESTS = 10;

export default function Probar({ ed, plan }: { ed: Editor; plan: PlanBridge }) {
  const [active, setActive] = useState<{ savedId: string; vid: number } | null>(null);
  const [tests, setTests] = useState<TestLog[]>([]);
  const [live, setLive] = useState("");
  const savedId = ed.curId;
  const activeVid = active && active.savedId === savedId ? active.vid : null;
  const planBody = useMemo(() => makePlanBody(plan.state), [plan.state]);
  const announce = useCallback((t: string) => setLive(t), []);

  /* versión indicada por la URL (?guardado=…&v=…) o por el equipo recién cargado */
  useEffect(() => {
    const sv = ed.seedVersion;
    if (!sv || sv.id == null || !ed.curId) return;
    const sid = ed.curId;
    let alive = true;
    getVersion(sid, sv.id)
      .then((v) => {
        if (!alive) return;
        setActive({ savedId: sid, vid: v.id });
        setTests(v.tests ?? []);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [ed.seedVersion, ed.curId]);

  /* si cambia el equipo vinculado, las pruebas de la versión anterior ya no se aplican */
  useEffect(() => {
    if (active && active.savedId !== savedId) setTests([]);
  }, [savedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const onActivate = (v: VersionFull, label: string) => {
    if (!savedId) return;
    ed.applyState(fromRow({ id: 0, name: label, payload: v.payload }).state, `Versión ${label} cargada.`);
    setActive({ savedId, vid: v.id });
    setTests(v.tests ?? []);
  };

  const persistTests = async (next: TestLog[], what: string) => {
    const prev = tests;
    setTests(next);
    if (savedId && activeVid != null) {
      try {
        await patchVersion(savedId, activeVid, { tests: next });
        setLive(`${what} Guardado en la versión actual.`);
      } catch (e) {
        setTests(prev);
        setLive(`No se pudo guardar en la versión (se deshizo el cambio): ${versionMessage(e)}`);
      }
    } else {
      setLive(`${what} Se adjuntará a la próxima versión que guardes.`);
    }
  };
  const addTest = (t: TestLog) => void persistTests([...tests, t].slice(-MAX_TESTS), "Prueba registrada.");
  const removeTest = (i: number) => void persistTests(tests.filter((_, k) => k !== i), "Prueba quitada.");

  const rows = ed.ev?.coverage;

  return (
    <div className="pl-probar">
      <div className="bd-grid">
        <LoadoutEditor
          st={ed.st}
          setSt={ed.setSt}
          owned={ed.owned}
          gotPieces={ed.gotPieces}
          usedCount={ed.usedCount}
          decoInfo={ed.decoInfo}
          setPicking={ed.setPicking}
          setPiece={ed.setPiece}
          setDeco={ed.setDeco}
          weaponTxt={ed.weaponTxt}
          onWeapon={ed.onWeapon}
        />
        <EvalPanel ev={ed.ev} evErr={ed.evErr} evBusy={ed.evBusy} />
      </div>

      <section className="pl-card pl-livecov" aria-labelledby="pl-livecov-h">
        <OrnateHeader as="h2" className="ohead--sm">
          <span id="pl-livecov-h">Cobertura del plan</span>
        </OrnateHeader>
        {plan.state.targets.length === 0 ? (
          <p className="pl-empty pl-empty--s">Tu plan no tiene habilidades objetivo. Añádelas en el paso «Habilidades» para ver aquí si el equipo las cumple.</p>
        ) : !rows ? (
          <p className="pl-muted" role="status">{ed.evBusy ? "Calculando cobertura…" : "Elige piezas, amuleto o joyas para ver la cobertura de tu plan."}</p>
        ) : (
          <CoverageChecklist rows={rows} />
        )}
      </section>

      <TestLogForm defaultMonster={plan.state.objective.monster_id} tests={tests} hasVersion={activeVid != null} onAdd={addTest} onRemove={removeTest} />

      <VersionsPanel
        savedId={savedId}
        st={ed.st}
        plan={plan.state}
        planBody={planBody}
        dispatch={plan.dispatch}
        activeVid={activeVid}
        pendingTests={tests}
        hasPieces={ed.gotPieces > 0 || !!ed.st.charm}
        busy={ed.busy}
        onSaveBuild={() => void ed.save(planBody)}
        onActivate={onActivate}
        onActiveDeleted={() => {
          setActive(null);
          setTests([]);
        }}
        onImported={(state, label) => {
          if (state) ed.applyState(state, label);
        }}
        announce={announce}
      />

      <SavedPanel
        saved={ed.saved}
        setSaved={ed.setSaved}
        savedError={ed.savedError}
        onRetry={ed.onRetry}
        storeErr={ed.storeErr}
        busy={ed.busy}
        guard={ed.guard}
        st={ed.st}
        gotPieces={ed.gotPieces}
        name={ed.name}
        setName={ed.setName}
        curId={ed.curId}
        setCurId={ed.setCurId}
        save={() => void ed.save(planBody)}
        loadSaved={ed.loadSaved}
        onRename={ed.onRename}
        onDelete={ed.onDelete}
      />

      <p className={live ? "pl-msg pl-msg--ok" : "pl-sr"} role="status" aria-live="polite" aria-atomic="true">
        {live}
      </p>
    </div>
  );
}
