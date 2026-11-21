import { useMemo, useState } from "react";
import { ErrorBox } from "../../../components/ui";
import { Icon } from "../../../components/Icon";
import PieceTile from "./PieceTile";
import { SLOT_ES } from "../../../build";
import { BonusPiece, BonusRow, loadBonusDetail, loadSetBonuses, useCatalog } from "../planApi";
import { StepProps, skillLabel } from "./common";

const SLOT_ORDER = ["head", "chest", "arms", "waist", "legs"] as const;

export default function BonoSet({ state, dispatch, skills, go }: StepProps) {
  const rank = state.objective.rank;
  const list = useCatalog(() => loadSetBonuses(rank), [rank]);
  const [openId, setOpenId] = useState<number | null>(state.set_bonus?.bonus_id ?? null);
  const targetIds = useMemo(() => new Set(state.targets.map((t) => t.skill_id)), [state.targets]);
  const suggested = new Set(state.hints?.bonus?.bonus_ids ?? []);

  const unlocksTarget = (b: BonusRow) =>
    state.targets.some((t) => skills?.get(t.skill_id)?.unlocked_by?.some((u) => u.bonus_id === b.id)) ||
    b.ranks.some((r) => targetIds.has(r.unlocks_skill_id ?? -1) || targetIds.has(r.skill_id));
  const rows = useMemo(() => {
    const all = list.data ?? [];
    return [...all].sort(
      (a, b) =>
        Number(suggested.has(b.id)) - Number(suggested.has(a.id)) ||
        Number(unlocksTarget(b)) - Number(unlocksTarget(a)) ||
        (a.name || a.name_es || a.name_en).localeCompare(b.name || b.name_es || b.name_en, "es"),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.data, targetIds, state.hints]);

  const chosen = state.set_bonus;
  const nameOf = (b: BonusRow) => b.name || b.name_es || b.name_en || "Bono de set";
  const chosenRow = chosen ? (list.data ?? []).find((r) => r.id === chosen.bonus_id) : undefined;
  const grantTags = (b: BonusRow): string[] => {
    const out = new Set<string>();
    for (const r of b.ranks) {
      for (const id of [r.skill_id, r.unlocks_skill_id ?? -1]) if (targetIds.has(id)) out.add(skillLabel(skills, id));
    }
    return [...out];
  };
  const raisesCap = (b: BonusRow): string[] =>
    state.targets
      .filter((t) => {
        const s = skills?.get(t.skill_id);
        return !!s && t.level > s.cap && (s.unlocked_by ?? []).some((u) => u.bonus_id === b.id);
      })
      .map((t) => skillLabel(skills, t.skill_id));
  return (
    <div className="pl-stack">
      <p className="pl-lead">
        Un bono de set es opcional: obliga a llevar N piezas del mismo set. Se eligen las piezas que más aportan a tus objetivos y la última puede
        servir solo para activar el bono.
      </p>
      {state.hints?.bonus && (
        <p className="pl-callout" role="note">
          <b>Sugerido:</b> {state.hints.bonus.reason_es}
        </p>
      )}
      <div className={chosen ? "pl-bonostrip pl-bonostrip--on" : "pl-bonostrip"} role="status">
        <span className="pl-bonostrip__t">
          {chosen ? (
            <>
              <span aria-hidden>◆ </span>Bono elegido: <b>«{chosenRow ? nameOf(chosenRow) : `bono #${chosen.bonus_id}`}»</b> · {chosen.required} piezas
            </>
          ) : (
            "Ningún bono elegido (opcional)"
          )}
        </span>
        {chosen && (
          <button type="button" className="bd-btn bd-btn--ghost bd-btn--s" onClick={() => dispatch({ type: "setSetBonus", bonus: null })}>
            Quitar bono
          </button>
        )}
      </div>
      {list.error && <ErrorBox error={list.error} />}
      {!list.data && !list.error && <p className="pl-muted" role="status">Cargando bonos de set…</p>}
      <ul className="pl-bonolist">
        {rows.map((b) => {
          const expanded = openId === b.id;
          const panel = `pl-bono-${b.id}`;
          const gives = grantTags(b);
          const raises = raisesCap(b);
          const isChosen = chosen?.bonus_id === b.id;
          const cls = ["pl-bono", isChosen ? "pl-bono--on" : "", expanded ? "pl-bono--open" : ""].filter(Boolean).join(" ");
          return (
            <li key={b.id} className={cls}>
              <button type="button" className="pl-bono__h" aria-expanded={expanded} aria-controls={panel} onClick={() => setOpenId(expanded ? null : b.id)}>
                <span className="pl-bono__ico" aria-hidden>
                  {b.monster_id ? <Icon kind="monster" id={b.monster_id} size="md" /> : <Icon kind="ui" name="armor-armorset" tile size="md" />}
                </span>
                <span className="pl-bono__body">
                  <b className="pl-bono__n">{nameOf(b)}</b>
                  <span className="pl-tags">
                    {gives.map((g) => (
                      <span key={`g${g}`} className="pl-tag pl-tag--bonus">Da «{g}»</span>
                    ))}
                    {raises.map((g) => (
                      <span key={`r${g}`} className="pl-tag pl-tag--bonus">Sube el tope de «{g}»</span>
                    ))}
                    {suggested.has(b.id) && <span className="pl-tag">Sugerido</span>}
                    {isChosen && <span className="pl-tag pl-tag--on">Elegido</span>}
                  </span>
                  <span className="pl-bono__ranks">
                    {b.ranks.map((r) => (
                      <span key={r.required} className="pl-bono__rank">
                        <b>{r.required} piezas</b> · {r.skill_name || r.skill_es || "Habilidad"}
                        {r.skill_desc ? ` — ${r.skill_desc}` : ""}
                      </span>
                    ))}
                  </span>
                </span>
                <span className="pl-bono__chev" aria-hidden>{expanded ? "▾" : "▸"}</span>
              </button>
              {expanded && (
                <div id={panel}>
                  <BonusDetailPanel bonus={b} rank={rank} state={state} dispatch={dispatch} targetIds={targetIds} skills={skills} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="pl-skip">
        <button type="button" className="pl-linkbtn" onClick={() => go("prioridades")}>
          Siguiente: prioridades
        </button>
      </p>
    </div>
  );
}

function BonusDetailPanel({ bonus, rank, state, dispatch, targetIds, skills }: { bonus: BonusRow; rank: StepProps["state"]["objective"]["rank"] } & Pick<StepProps, "state" | "dispatch" | "skills"> & { targetIds: Set<number> }) {
  const det = useCatalog(() => loadBonusDetail(bonus.id, rank), [bonus.id, rank]);
  const reqs = [...new Set(bonus.ranks.map((r) => r.required))].sort((a, b) => a - b);
  const sel = state.set_bonus?.bonus_id === bonus.id ? state.set_bonus.required : null;
  const pieces = det.data?.pieces;
  const pieceSkill = (s: BonusPiece["skills"][number]) => s.name || s.name_es || skillLabel(skills, s.skill_id);
  return (
    <div className="pl-bono__d">
      <div className="pl-bono__pick" role="group" aria-label="Elegir este bono">
        {reqs.map((n) => {
          const on = sel === n;
          const rk = bonus.ranks.filter((r) => r.required === n);
          return (
            <div key={n} className="pl-bono__opt">
              <button
                type="button"
                className={on ? "bd-btn pl-bono__choose pl-bono__choose--on" : "bd-btn pl-bono__choose"}
                aria-pressed={on}
                onClick={() => dispatch({ type: "setSetBonus", bonus: { bonus_id: bonus.id, required: n } })}
              >
                {on ? `✓ Elegido (${n} piezas)` : `Elegir este bono (${n} piezas)`}
              </button>
              <span className="pl-muted pl-bono__optd">{rk.map((r) => r.skill_name || r.skill_es || "Habilidad").join(" · ")}</span>
            </div>
          );
        })}
      </div>
      {det.error && <ErrorBox error={det.error} />}
      {!det.data && !det.error && <p className="pl-muted" role="status">Cargando piezas…</p>}
      {pieces && (
        <div className="pl-bono__parts">
          {SLOT_ORDER.map((slot) => (
            <section key={slot} aria-label={SLOT_ES[slot]}>
              <h4 className="pl-h4 pl-bono__part">
                <Icon kind="ui" name={`armor-${slot}`} tile size="sm" />
                {SLOT_ES[slot]}
              </h4>
              <ul className="pl-pieces pl-pieces--tiles">
                {pieces[slot].map((p) => {
                  const hits = p.skills.filter((s) => targetIds.has(s.skill_id));
                  return (
                    <li key={p.id}>
                      <PieceTile
                        slot={slot}
                        rarity={p.rarity}
                        name={p.name_es || `Pieza #${p.id}`}
                        meta={`Defensa máx. ${p.defense_max}`}
                        slots={p.slots}
                        skills={p.skills.map((s) => ({ name: pieceSkill(s), level: s.level, hit: targetIds.has(s.skill_id) }))}
                        role={hits.length ? "aporta" : "activa"}
                      />
                    </li>
                  );
                })}
                {pieces[slot].length === 0 && <li className="pl-muted">Sin piezas en este rango.</li>}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
