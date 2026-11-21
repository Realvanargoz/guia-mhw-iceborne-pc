import { Dispatch, SetStateAction } from "react";
import { DecoChip, OwnedBadge, SlotRow } from "../../../components/BuildView";
import { EntityIcon, Icon } from "../../../components/Icon";
import { OrnateHeader } from "../../../components/ui";
import { LoadoutState, OwnedGear, PieceInfo, SLOTS, SLOT_ES, SlotId } from "../../../build";
import { RANK_LABEL } from "../../../labels";
import { skillsText } from "./pickers";

export type Picking = { kind: "armor"; slot: SlotId } | { kind: "charm" } | { kind: "deco"; piece: string; idx: number; size: number } | null;

type Props = {
  st: LoadoutState;
  setSt: Dispatch<SetStateAction<LoadoutState>>;
  owned: OwnedGear | null;
  gotPieces: number;
  usedCount: Map<number, number>;
  decoInfo: (id: number) => { name: string; size: number; difficulty?: string };
  setPicking: (p: Picking) => void;
  setPiece: (slot: SlotId, p: PieceInfo | null) => void;
  setDeco: (piece: string, idx: number, id: number | null) => void;
  weaponTxt: string;
  onWeapon: (txt: string) => void;
};

export default function LoadoutEditor({ st, setSt, owned, gotPieces, usedCount, decoInfo, setPicking, setPiece, setDeco, weaponTxt, onWeapon }: Props) {
  const decoRowFor = (piece: string, sizes: number[]) =>
    sizes.map((sz, i) => {
      const id = st.decos[piece]?.[i] ?? null;
      const info = id != null ? decoInfo(id) : null;
      const overUse = id != null && owned?.available && (owned.decorations.get(id) ?? 0) < (usedCount.get(id) ?? 0);
      return (
        <SlotRow key={i} size={sz}>
          {id != null && info ? (
            <span className="bd-decorow">
              <DecoChip id={id} name={info.name} size={info.size} difficulty={info.difficulty} owned={owned?.available ? owned.decorations.has(id) : undefined} onClick={() => setPicking({ kind: "deco", piece, idx: i, size: sz })} title="Cambiar joya" />
              <button className="bd-x bd-x--s" onClick={() => setDeco(piece, i, null)} aria-label="Quitar joya">×</button>
              {overUse && <small className="bd-warnsm">{(owned?.decorations.get(id) ?? 0) === 0 ? "No la tienes en el cofre" : "Usas más de las que tienes"}</small>}
            </span>
          ) : (
            <button type="button" className="bd-add" onClick={() => setPicking({ kind: "deco", piece, idx: i, size: sz })}>
              + Joya
            </button>
          )}
        </SlotRow>
      );
    });

  return (
        <div className="bd-edit">
      <OrnateHeader as="h2" className="ohead--red">
        Tu equipo ({gotPieces}/5 piezas)
      </OrnateHeader>
      <ul className="bd-slots">
        {SLOTS.map((slot) => {
          const p = st.pieces[slot];
          return (
            <li key={slot} className={p ? "bd-slot bd-slot--on" : "bd-slot"}>
              <div className="bd-slot__head">
                {p ? <EntityIcon type="armor" sub={slot} rarity={p.rarity} size="lg" alt={SLOT_ES[slot]} /> : <Icon kind="ui" name={`armor-${slot}`} tile size="lg" />}
                <div className="bd-slot__t">
                  <span className="bg-piece__slot">{SLOT_ES[slot]}</span>
                  {p ? (
                    <>
                      <b>{p.name_es || p.name_en}</b>
                      <small>
                        {p.set_name_es} · {RANK_LABEL[p.rank] ?? p.rank} · {p.defense_base}→{p.defense_max}
                      </small>
                    </>
                  ) : (
                    <small>Sin elegir</small>
                  )}
                </div>
                {p && owned?.available && owned.armor.has(p.id) && <OwnedBadge />}
                <div className="bd-slot__btns">
                  <button className="bd-btn bd-btn--s" onClick={() => setPicking({ kind: "armor", slot })}>
                    {p ? "Cambiar" : "Elegir"}
                  </button>
                  {p && (
                    <button className="bd-x" onClick={() => setPiece(slot, null)} aria-label={`Quitar ${SLOT_ES[slot]}`}>
                      ×
                    </button>
                  )}
                </div>
              </div>
              {p && p.slots.length > 0 && <div className="bg-piece__slots">{decoRowFor(slot, p.slots)}</div>}
              {p && p.slots.length === 0 && <p className="bv-hint bd-noslot">Esta pieza no tiene ranuras de joya.</p>}
            </li>
          );
        })}
        <li className={st.charm ? "bd-slot bd-slot--on" : "bd-slot"}>
          <div className="bd-slot__head">
            {st.charm ? <EntityIcon type="charm" rarity={st.charm.rarity} size="lg" alt="Amuleto" /> : <Icon kind="ui" name="armor-charm" tile size="lg" />}
            <div className="bd-slot__t">
              <span className="bg-piece__slot">Amuleto</span>
              {st.charm ? (
                <>
                  <b>{st.charm.name_es || st.charm.name_en}</b>
                  <small>{st.charm.generic_es ?? skillsText((st.charm.skills ?? []).map((s) => ({ name_es: s.name_es ?? null, level: s.level })))}</small>
                </>
              ) : (
                <small>Sin elegir</small>
              )}
            </div>
            {st.charm && owned?.available && owned.charms.has(st.charm.id) && <OwnedBadge />}
            <div className="bd-slot__btns">
              <button className="bd-btn bd-btn--s" onClick={() => setPicking({ kind: "charm" })}>
                {st.charm ? "Cambiar" : "Elegir"}
              </button>
              {st.charm && (
                <button className="bd-x" onClick={() => setSt((s) => ({ ...s, charm: null }))} aria-label="Quitar amuleto">
                  ×
                </button>
              )}
            </div>
          </div>
        </li>
        <li className={st.weapon.length ? "bd-slot bd-slot--on" : "bd-slot"}>
          <div className="bd-slot__head">
            <Icon kind="ui" name="weapon-great-sword" tile size="lg" />
            <div className="bd-slot__t">
              <span className="bg-piece__slot">Ranuras del arma</span>
              <label className="bd-weapon">
                <input value={weaponTxt} onChange={(e) => onWeapon(e.target.value)} placeholder="p. ej. 2,1" inputMode="numeric" maxLength={8} aria-label="Tamaños de las ranuras del arma, separados por comas" />
                <small>Tamaños 1-4 separados por comas (máx. 3). Vacío si no cuentas el arma.</small>
              </label>
            </div>
          </div>
          {st.weapon.length > 0 && <div className="bg-piece__slots">{decoRowFor("weapon", st.weapon)}</div>}
        </li>
      </ul>
    </div>
  );
}
