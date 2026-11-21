/* Registro de pruebas del paso «Probar»: lista de comprobación del método de Dem (comodidad, ritmo…) y veredicto. */
import { useEffect, useMemo, useState } from "react";
import { useApi } from "../../../api";
import { CheckKey, TestLog } from "../planApi";

export const CHECKS: { key: CheckKey; label: string }[] = [
  { key: "comodidad", label: "Comodidad" },
  { key: "ritmo", label: "Ritmo de la cacería" },
  { key: "habilidades", label: "Las habilidades aportan" },
  { key: "supervivencia", label: "Supervivencia" },
  { key: "estados", label: "Estados alterados" },
  { key: "dano", label: "Daño" },
  { key: "afilado", label: "Afilado" },
  { key: "movilidad", label: "Movilidad" },
];
const GAP_MAX = 7; // el servidor acepta como mucho 7 huecos (TestLogIn.gaps)
const TIERS: { id: TestLog["tier"]; label: string }[] = [
  { id: "normal", label: "Normal" },
  { id: "templado", label: "Curtido (templado)" },
  { id: "arch_templado", label: "Archicurtido" },
];
const GRADES: { id: "bien" | "regular" | "mal"; label: string }[] = [
  { id: "bien", label: "Bien" },
  { id: "regular", label: "Regular" },
  { id: "mal", label: "Mal" },
];
const VERDICTS: { id: TestLog["verdict"]; label: string }[] = [
  { id: "lista", label: "Lista" },
  { id: "ajustar", label: "Ajustar" },
  { id: "descartar", label: "Descartar" },
];
export const VERDICT_ES: Record<TestLog["verdict"], string> = { lista: "Lista", ajustar: "Ajustar", descartar: "Descartar" };
export const TIER_ES: Record<TestLog["tier"], string> = { normal: "Normal", templado: "Curtido", arch_templado: "Archicurtido" };

type ListRow = { id: number; name_es: string | null; name_en: string };

/** Regla del vídeo: lista si una cacería curtida duró 20 min o menos, sin carros y sin ningún «mal». */
export function suggestsReady(t: { tier: TestLog["tier"]; minutes: number; carts: number; checklist: TestLog["checklist"] }): boolean {
  return t.tier !== "normal" && t.minutes >= 1 && t.minutes <= 20 && t.carts === 0 && !Object.values(t.checklist).includes("mal");
}

type Props = {
  defaultMonster: number | null;
  tests: TestLog[];
  /** true si hay una versión activa donde guardar las pruebas */
  hasVersion: boolean;
  onAdd: (t: TestLog) => void;
  onRemove: (index: number) => void;
};

export default function TestLogForm({ defaultMonster, tests, hasVersion, onAdd, onRemove }: Props) {
  const monsters = useApi<ListRow[]>("/bestiary");
  const nameOf = useMemo(() => new Map((monsters.data ?? []).map((m) => [m.id, m.name_es || m.name_en])), [monsters.data]);
  const [monster, setMonster] = useState<number | "">(defaultMonster ?? "");
  const [tier, setTier] = useState<TestLog["tier"]>("normal");
  const [checklist, setChecklist] = useState<TestLog["checklist"]>({});
  const [gaps, setGaps] = useState<CheckKey[]>([]);
  const [minutes, setMinutes] = useState("15");
  const [carts, setCarts] = useState("0");
  const [notes, setNotes] = useState("");
  const [verdict, setVerdict] = useState<TestLog["verdict"]>("ajustar");
  const [touched, setTouched] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (monster === "" && defaultMonster != null) setMonster(defaultMonster);
  }, [defaultMonster]); // eslint-disable-line react-hooks/exhaustive-deps

  const mins = Number(minutes);
  const cts = Number(carts);
  const minutesOk = Number.isInteger(mins) && mins >= 1 && mins <= 120;
  const cartsOk = Number.isInteger(cts) && cts >= 0 && cts <= 3;
  const ready = minutesOk && cartsOk && suggestsReady({ tier, minutes: mins, carts: cts, checklist });
  const lastTemp = [...tests].reverse().find((t) => t.tier !== "normal");
  /* mientras el usuario no elija veredicto a mano, se sigue la regla del vídeo */
  useEffect(() => {
    if (!touched) setVerdict(ready ? "lista" : "ajustar");
  }, [ready, touched]);

  const canSave = monster !== "" && minutesOk && cartsOk;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    const clean: TestLog["checklist"] = {};
    for (const c of CHECKS) if (checklist[c.key]) clean[c.key] = checklist[c.key];
    onAdd({ monster_id: monster as number, tier, checklist: clean, gaps, minutes: mins, carts: cts, notes: notes.trim().slice(0, 2000), verdict });
    setMsg(`Prueba registrada contra ${nameOf.get(monster as number) ?? "el monstruo"} (${TIER_ES[tier]}, ${mins} min, ${cts} carros): ${VERDICT_ES[verdict]}.`);
    setChecklist({});
    setGaps([]);
    setNotes("");
    setTouched(false);
  };
  const toggleGap = (k: CheckKey) => setGaps((g) => (g.includes(k) ? g.filter((x) => x !== k) : g.length < GAP_MAX ? [...g, k] : g));

  return (
    <section className="pl-card pl-test" aria-labelledby="pl-test-h">
      <h3 id="pl-test-h" className="pl-h3">Registro de pruebas</h3>
      <p className="pl-note">
        <b>Método del vídeo:</b> prueba primero contra monstruos normales y luego contra los curtidos. La build está lista cuando aguanta cacerías cómodas de 15 a 20 minutos sin jugar en serio.
      </p>
      <form className="pl-stack" onSubmit={submit}>
        <div className="pl-row">
          <label className="pl-field">
            Monstruo
            <select value={monster} onChange={(e) => setMonster(e.target.value ? Number(e.target.value) : "")} required>
              <option value="">Elige un monstruo…</option>
              {(monsters.data ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name_es || m.name_en}
                </option>
              ))}
            </select>
          </label>
          <label className="pl-field">
            Tipo de monstruo
            <select value={tier} onChange={(e) => setTier(e.target.value as TestLog["tier"])}>
              {TIERS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="pl-field">
            Minutos (1-120)
            <input type="number" inputMode="numeric" min={1} max={120} value={minutes} onChange={(e) => setMinutes(e.target.value)} aria-invalid={!minutesOk} className="pl-num" />
          </label>
          <label className="pl-field">
            Carros (0-3)
            <input type="number" inputMode="numeric" min={0} max={3} value={carts} onChange={(e) => setCarts(e.target.value)} aria-invalid={!cartsOk} className="pl-num" />
          </label>
        </div>
        {monsters.error && <p className="pl-msg pl-msg--warn" role="alert">No se pudo cargar la lista de monstruos: {monsters.error}</p>}

        <div className="pl-checks">
          {CHECKS.map((c) => (
            <fieldset key={c.key} className="pl-fs">
              <legend>{c.label}</legend>
              <div className="pl-radios">
                {GRADES.map((g) => (
                  <label key={g.id} className={`pl-radio${checklist[c.key] === g.id ? " is-on" : ""}`}>
                    <input type="radio" name={`pl-chk-${c.key}`} checked={checklist[c.key] === g.id} onChange={() => setChecklist((x) => ({ ...x, [c.key]: g.id }))} />
                    <span>{g.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>

        <fieldset className="pl-fs">
          <legend>¿Qué faltó en los momentos críticos? (máx. {GAP_MAX})</legend>
          <div className="pl-radios">
            {CHECKS.map((c) => (
              <label key={c.key} className={`pl-radio${gaps.includes(c.key) ? " is-on" : ""}`}>
                <input type="checkbox" checked={gaps.includes(c.key)} onChange={() => toggleGap(c.key)} disabled={!gaps.includes(c.key) && gaps.length >= GAP_MAX} />
                <span>{c.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="pl-field">
          Notas
          <textarea rows={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} className="pl-ta" />
        </label>

        <fieldset className="pl-fs">
          <legend>Veredicto</legend>
          <div className="pl-radios">
            {VERDICTS.map((v) => (
              <label key={v.id} className={`pl-radio${verdict === v.id ? " is-on" : ""}`}>
                <input
                  type="radio"
                  name="pl-verdict"
                  checked={verdict === v.id}
                  onChange={() => {
                    setVerdict(v.id);
                    setTouched(true);
                  }}
                />
                <span>{v.label}</span>
              </label>
            ))}
          </div>
          <p className={`pl-hint${ready ? " pl-hint--ok" : ""}`}>
            {ready
              ? "Sugerencia: «Lista». La última prueba contra un monstruo curtido duró 20 minutos o menos, sin carros y sin ningún «mal»."
              : "Se sugiere «Lista» cuando la prueba contra un monstruo curtido dura 20 minutos o menos, con 0 carros y sin ningún «mal» en la lista."}
            {lastTemp && ` Última prueba curtida registrada: ${lastTemp.minutes} min, ${lastTemp.carts} carros, ${VERDICT_ES[lastTemp.verdict]}.`}
          </p>
        </fieldset>

        <div className="pl-row pl-row--act">
          <button type="submit" className="bd-btn" disabled={!canSave}>
            Registrar prueba
          </button>
          {!hasVersion && <span className="pl-muted">Aún no hay versión activa: la prueba se adjuntará a la próxima versión que guardes.</span>}
        </div>
        <p className="pl-msg pl-msg--ok" role="status" aria-live="polite" hidden={!msg}>
          {msg}
        </p>
      </form>

      {tests.length > 0 && (
        <>
          <h4 className="pl-h4">Pruebas de esta versión ({tests.length})</h4>
          <ul className="pl-testlist">
            {tests.map((t, i) => (
              <li key={i} className="pl-row-item pl-row-item--ex">
                <span className="pl-row-item__main">
                  <b className="pl-row-item__n">{nameOf.get(t.monster_id) ?? `Monstruo #${t.monster_id}`} · {TIER_ES[t.tier]}</b>
                  <small className="pl-muted">
                    {t.minutes} min · {t.carts} carros · Veredicto: {VERDICT_ES[t.verdict]}
                    {Object.values(t.checklist).includes("mal") ? ` · Mal en: ${CHECKS.filter((c) => t.checklist[c.key] === "mal").map((c) => c.label.toLowerCase()).join(", ")}` : ""}
                  </small>
                </span>
                <button type="button" className="bd-btn bd-btn--s bd-btn--ghost" onClick={() => onRemove(i)} aria-label={`Quitar la prueba ${i + 1}`}>
                  Quitar
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
