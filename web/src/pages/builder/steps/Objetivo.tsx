import { useMemo, useState } from "react";
import { useApi } from "../../../api";
import { loadOwned } from "../../../build";
import { RankSelector } from "../../../components/book";
import { Icon } from "../../../components/Icon";
import { YouTube } from "../../../components/YouTube";
import { ErrorBox } from "../../../components/ui";
import { WEAPON_TYPE } from "../../../labels";
import { RANKS } from "../editor/pickers";
import { Archetype, loadRules, loadTemplate, useCatalog } from "../planApi";
import { Rank } from "../planState";
import { StepProps } from "./common";

type MonsterRow = { id: number; name_es: string | null; name_en: string };
const STYLE_HINT: Record<string, string> = {
  bloqueo: "Añade Guardia",
  esquiva: "Añade ventana de esquiva",
  aprendiendo: "Añade vida y margen de error",
  multijugador: "Pensado para cazar en grupo",
};

export default function Objetivo({ state, dispatch, go }: StepProps) {
  const o = state.objective;
  const rules = useCatalog(loadRules, []);
  const owned = useCatalog(loadOwned, []);
  const monsters = useApi<MonsterRow[]>("/bestiary");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "warn" | "err"; text: string } | null>(null);

  const r = rules.data;
  const archetypes = useMemo(() => {
    if (!r) return [] as [string, Archetype][];
    const all = Object.entries(r.archetypes);
    const allowed = o.weapon_type ? r.weapon_types[o.weapon_type]?.archetypes : null;
    return allowed ? all.filter(([id]) => allowed.includes(id)) : all;
  }, [r, o.weapon_type]);
  const weaponTypes = r ? Object.keys(r.weapon_types) : Object.keys(WEAPON_TYPE);
  const video = useMemo(() => {
    const src = Object.values(r?.sources ?? {}).find((s) => /youtube\.com\/watch\?v=[\w-]{11}/.test(s.url));
    const id = src?.url.match(/[?&]v=([\w-]{11})/)?.[1];
    return src && id ? { youtube_id: id, title: src.title, url: `https://www.youtube.com/watch?v=${id}` } : null;
  }, [r]);
  const canTemplate = !!(o.monster_id || o.goal || o.archetype || o.styles.length);
  const ownedOk = owned.data?.available === true;

  const applyTemplate = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const t = await loadTemplate({ monster: o.monster_id, goal: o.goal, rank: o.rank, cap: o.cap, archetype: o.archetype, styles: o.styles });
      dispatch({ type: "applyTemplate", template: t });
      setMsg({ tone: "ok", text: `Plantilla aplicada: ${t.targets.length} habilidades. Revísalas en el paso siguiente.` });
    } catch (e) {
      setMsg({ tone: "err", text: `No se pudo cargar la plantilla: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  };
  const toggleStyle = (id: string) =>
    dispatch({ type: "setObjective", patch: { styles: o.styles.includes(id) ? o.styles.filter((x) => x !== id) : [...o.styles, id] } });
  const setSlot = (i: number, v: number) => {
    const a = [0, 1, 2].map((k) => o.weapon_slots[k] ?? 0);
    a[i] = v;
    dispatch({ type: "setObjective", patch: { weapon_slots: a.filter((n) => n > 0) } });
  };

  return (
    <div className="pl-stack">
      <p className="pl-lead">
        Empieza por lo que quieres hacer: arma, tipo de daño y estilo de juego. Con eso el asistente propone las habilidades que importan y descarta las
        que no sirven para tu arma.
      </p>

      <section className="pl-card" aria-labelledby="pl-o-arma">
        <h3 id="pl-o-arma" className="pl-h3">Arma</h3>
        <div className="pl-grid pl-grid--weapons" role="radiogroup" aria-label="Tipo de arma">
          {weaponTypes.map((w) => (
            <button
              key={w}
              type="button"
              role="radio"
              aria-checked={o.weapon_type === w}
              className={o.weapon_type === w ? "pl-tile pl-tile--on" : "pl-tile"}
              onClick={() => dispatch({ type: "setObjective", patch: { weapon_type: o.weapon_type === w ? null : w, archetype: null } })}
            >
              <Icon kind="ui" name={`weapon-${w}`} tile size="md" />
              <span>{WEAPON_TYPE[w] ?? r?.weapon_types[w]?.label_es ?? w}</span>
            </button>
          ))}
        </div>
        <fieldset className="pl-slots">
          <legend>Ranuras de joya del arma (opcional)</legend>
          {[0, 1, 2].map((i) => (
            <select key={i} aria-label={`Ranura ${i + 1} del arma`} value={o.weapon_slots[i] ?? 0} onChange={(e) => setSlot(i, Number(e.target.value))}>
              <option value={0}>Sin ranura</option>
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  Tamaño {n}
                </option>
              ))}
            </select>
          ))}
        </fieldset>
      </section>

      <section className="pl-card" aria-labelledby="pl-o-arq">
        <h3 id="pl-o-arq" className="pl-h3">Tipo de daño</h3>
        {rules.error && <ErrorBox error={rules.error} />}
        {!r && !rules.error && <p className="pl-muted" role="status">Cargando arquetipos…</p>}
        <div className="pl-grid pl-grid--cards" role="radiogroup" aria-label="Arquetipo">
          {archetypes.map(([id, a]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={o.archetype === id}
              className={o.archetype === id ? "pl-arch pl-arch--on" : "pl-arch"}
              onClick={() => dispatch({ type: "setObjective", patch: { archetype: o.archetype === id ? null : id } })}
            >
              <b>{a.label_es}</b>
              {a.needs_review && <span className="pl-muted"><small>Pendiente de revisión</small></span>}
              {a.skills.length > 0 && <span className="pl-arch__sk">{a.skills.slice(0, 4).map((s) => s.name_es).join(", ")}</span>}
              {a.discard.length > 0 && (
                <span className="pl-arch__no">
                  <i>Descartar:</i> {a.discard.map((d) => d.name_es).join(", ")}
                </span>
              )}
            </button>
          ))}
        </div>
        {o.archetype && r?.archetypes[o.archetype]?.notes_es && <p className="pl-note">{r.archetypes[o.archetype].notes_es}</p>}
      </section>

      <section className="pl-card" aria-labelledby="pl-o-est">
        <h3 id="pl-o-est" className="pl-h3">Estilo de juego</h3>
        <div className="pl-chips">
          {Object.entries(r?.play_styles ?? {}).map(([id, s]) => (
            <button key={id} type="button" className="pl-chip" aria-pressed={o.styles.includes(id)} title={STYLE_HINT[id]} onClick={() => toggleStyle(id)}>
              {s.label_es}
              {s.needs_review && <small className="pl-muted"> · Pendiente de revisión</small>}
            </button>
          ))}
        </div>
      </section>

      <section className="pl-card" aria-labelledby="pl-o-rango">
        <h3 id="pl-o-rango" className="pl-h3">Rango y equipo</h3>
        <div className="pl-row">
          <RankSelector ranks={RANKS} value={o.rank} onChange={(v) => dispatch({ type: "setObjective", patch: { rank: v as Rank } })} keys={false} />
        </div>
        <div className="pl-seg" role="radiogroup" aria-label="Con qué equipo contar">
          <button type="button" role="radio" aria-checked={state.mode === "ideal"} className={state.mode === "ideal" ? "pl-seg__b pl-seg__b--on" : "pl-seg__b"} onClick={() => dispatch({ type: "setMode", mode: "ideal" })}>
            Catálogo completo (ideal)
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={state.mode === "owned"}
            disabled={!ownedOk}
            className={state.mode === "owned" ? "pl-seg__b pl-seg__b--on" : "pl-seg__b"}
            onClick={() => dispatch({ type: "setMode", mode: "owned" })}
          >
            Solo mis cosas
          </button>
        </div>
        {!ownedOk && <p className="pl-muted">«Solo mis cosas» necesita que importes tu partida en el perfil del cazador.</p>}
      </section>

      <section className="pl-card" aria-labelledby="pl-o-plt">
        <h3 id="pl-o-plt" className="pl-h3">Plantilla (opcional)</h3>
        <p className="pl-muted">Parte de la recomendación de un monstruo o de un objetivo general y mézclala con el arquetipo y el estilo elegidos.</p>
        <div className="pl-row">
          <label className="pl-field">
            <span>Monstruo</span>
            <select
              value={o.monster_id ?? ""}
              onChange={(e) => dispatch({ type: "setObjective", patch: { monster_id: e.target.value ? Number(e.target.value) : null, goal: null } })}
            >
              <option value="">Ninguno</option>
              {(monsters.data ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name_es || m.name_en}
                </option>
              ))}
            </select>
          </label>
          <label className="pl-field">
            <span>Objetivo general</span>
            <select
              value={o.goal ?? ""}
              onChange={(e) => dispatch({ type: "setObjective", patch: { goal: (e.target.value || null) as "recoleccion" | "botin" | null, monster_id: null } })}
            >
              <option value="">Ninguno</option>
              <option value="recoleccion">Recolección</option>
              <option value="botin">Botín</option>
            </select>
          </label>
          <button type="button" className="bd-btn" disabled={!canTemplate || busy} onClick={applyTemplate}>
            {busy ? "Cargando…" : state.targets.length ? "Reemplazar objetivos con la plantilla" : "Aplicar plantilla"}
          </button>
        </div>
        {monsters.error && <ErrorBox error={monsters.error} onRetry={monsters.reload} />}
        {msg && (
          <p className={`pl-msg pl-msg--${msg.tone}`} role="status">
            {msg.text}
          </p>
        )}
      </section>

      <p className="pl-credit">
        Este constructor sigue el método de <strong>Dem</strong>, creador de contenido de Monster Hunter en YouTube:{" "}
        <a href="https://www.youtube.com/@Demsito" target="_blank" rel="noreferrer noopener">
          youtube.com/@Demsito
        </a>
        . La idea de crear la build por pasos es suya; la guía solo la convierte en una herramienta.
      </p>

      {video && (
        <details className="pl-card pl-video">
          <summary>Método en el que se basa esto (vídeo de Dem)</summary>
          <YouTube v={video} />
        </details>
      )}

      <p className="pl-skip">
        ¿Ya sabes lo que quieres?{" "}
        <button type="button" className="pl-linkbtn" onClick={() => go("probar")}>
          Ir directo al editor
        </button>
      </p>
    </div>
  );
}
