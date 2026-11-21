import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { OwnedBadge } from "../../../components/BuildView";
import { EntityIcon, Icon } from "../../../components/Icon";
import Dialog from "../../../components/Dialog";
import { ErrorBox } from "../../../components/ui";
import { ArmorCat, CharmCat, DecoCat, OwnedGear, SLOT_ES, SavedBuild, SlotId, loadArmor, loadCharms, loadDecorations } from "../../../build";
import { RANK_LABEL } from "../../../labels";

export const RANKS = ["LR", "HR", "MR"].map((r) => ({ id: r, label: RANK_LABEL[r] }));
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/* ---------------------------------------------------------------- selector modal */
export type Opt = { key: string | number; icon: ReactNode; title: string; sub?: string; right?: ReactNode; owned?: boolean; extra?: ReactNode };
export function PickerModal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog open onClose={onClose} title={title} className="bd-dlg">
      {children}
    </Dialog>
  );
}
/** Buscador del selector: enfoca al abrir solo con puntero fino (en táctil evita abrir el teclado). */
export function SearchBox({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches) return;
    const t = setTimeout(() => ref.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);
  return <input ref={ref} type="search" maxLength={60} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} />;
}
export const cleanName = (s: string) => s.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim().slice(0, 60);

export function RenameDialog({ build, onSave, onClose }: { build: SavedBuild; onSave: (name: string) => void; onClose: () => void }) {
  const [v, setV] = useState(build.name);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches) return;
    const t = setTimeout(() => ref.current?.select(), 0);
    return () => clearTimeout(t);
  }, []);
  const ok = cleanName(v).length > 0;
  return (
    <Dialog open onClose={onClose} title="Renombrar composición" className="bd-dlg bd-dlg--s">
      <form
        className="bd-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) onSave(cleanName(v));
        }}
      >
        <label className="bd-form__f">
          Nombre
          <input ref={ref} value={v} onChange={(e) => setV(e.target.value)} maxLength={60} />
        </label>
        <div className="bd-form__btns">
          <button type="button" className="bd-btn bd-btn--ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="bd-btn" disabled={!ok}>
            Guardar
          </button>
        </div>
      </form>
    </Dialog>
  );
}
export function ConfirmDelete({ build, onConfirm, onClose, title = "Eliminar composición" }: { build: { name: string }; onConfirm: () => void; onClose: () => void; title?: string }) {
  return (
    <Dialog open onClose={onClose} title={title} className="bd-dlg bd-dlg--s">
      <div className="bd-form">
        <p className="bd-form__p">¿Eliminar «{build.name}»? No se puede deshacer.</p>
        <div className="bd-form__btns">
          <button type="button" className="bd-btn bd-btn--ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="bd-btn" onClick={onConfirm}>
            Eliminar
          </button>
        </div>
      </div>
    </Dialog>
  );
}
export function OptList({ opts, onPick, limit = 80 }: { opts: Opt[]; onPick: (k: string | number) => void; limit?: number }) {
  const [more, setMore] = useState(limit);
  useEffect(() => setMore(limit), [opts, limit]);
  if (!opts.length) return <p className="bv-hint bd-none">Nada coincide con el filtro.</p>;
  return (
    <ul className="bd-opts">
      {opts.slice(0, more).map((o) => (
        <li key={o.key}>
          <button type="button" onClick={() => onPick(o.key)}>
            {o.icon}
            <span className="bd-opt__t">
              <b>{o.title}</b>
              {o.sub && <small>{o.sub}</small>}
              {o.extra}
            </span>
            <span className="bd-opt__r">{o.right}</span>
            {o.owned && <OwnedBadge />}
          </button>
        </li>
      ))}
      {opts.length > more && (
        <li>
          <button type="button" className="bd-more" onClick={() => setMore(more + 80)}>
            Mostrar más ({opts.length - more})
          </button>
        </li>
      )}
    </ul>
  );
}

export const skillsText = (s: { name_es: string | null; level: number }[]) => s.map((x) => `${x.name_es ?? "?"} ${x.level}`).join(" · ");

export function ArmorPicker({ slot, rankInit, owned, onPick, onClose }: { slot: SlotId; rankInit: string; owned: OwnedGear | null; onPick: (p: ArmorCat) => void; onClose: () => void }) {
  const [rank, setRank] = useState(rankInit);
  const [q, setQ] = useState("");
  const [mine, setMine] = useState(false);
  const [all, setAll] = useState<ArmorCat[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [prog, setProg] = useState<[number, number]>([0, 0]);
  useEffect(() => {
    let live = true;
    setAll(null);
    setErr(null);
    loadArmor(rank, (n, t) => live && setProg([n, t]))
      .then((r) => live && setAll(r))
      .catch((e: Error) => live && setErr(e.message));
    return () => {
      live = false;
    };
  }, [rank]);
  const opts = useMemo<Opt[]>(() => {
    const t = norm(q.trim());
    return (all ?? [])
      .filter((p) => p.type === slot)
      .filter((p) => !mine || owned?.armor.has(p.id))
      .filter((p) => !t || norm(`${p.name_es ?? ""} ${p.name_en} ${p.set_name_es ?? ""} ${p.skills.map((s) => s.name_es).join(" ")}`).includes(t))
      .sort((a, b) => b.rarity - a.rarity || (b.defense_max ?? 0) - (a.defense_max ?? 0))
      .map((p) => ({
        key: p.id,
        icon: <EntityIcon type="armor" sub={p.type} rarity={p.rarity} size="md" />,
        title: p.name_es || p.name_en,
        sub: `${p.set_name_es ?? ""} · R${p.rarity}`,
        extra: <small className="bd-opt__sk">{skillsText(p.skills) || "Sin habilidades"}</small>,
        right: (
          <span className="bd-opt__sl">
            <span className="bd-opt__def">{p.defense_base}→{p.defense_max}</span>
            {p.slots.map((s, i) => (
              <i key={i} className={`bv-gem bv-gem--${s} bv-gem--sm`}>{s}</i>
            ))}
          </span>
        ),
        owned: owned?.armor.has(p.id),
      }));
  }, [all, q, slot, mine, owned]);
  return (
    <PickerModal title={`Elegir ${SLOT_ES[slot].toLowerCase()}`} onClose={onClose}>
      <div className="bd-filters">
        <SearchBox placeholder="Buscar pieza, set o habilidad…" value={q} onChange={setQ} label="Buscar pieza" />
        <select value={rank} onChange={(e) => setRank(e.target.value)} aria-label="Rango">
          {RANKS.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
        <label className={`bd-chk${owned?.available ? "" : " bd-chk--off"}`} title={owned?.available ? "" : "Pulsa Actualizar perfil para leer tu cofre"}>
          <input type="checkbox" checked={mine} disabled={!owned?.available} onChange={(e) => setMine(e.target.checked)} /> Solo las mías
        </label>
      </div>
      {err && <ErrorBox error={err} />}
      {!all && !err && (
        <p className="bv-hint bd-none" aria-busy="true">
          Cargando piezas de {RANK_LABEL[rank].toLowerCase()}… {prog[1] ? `${prog[0]}/${prog[1]}` : ""}
        </p>
      )}
      {all && <OptList opts={opts} onPick={(k) => onPick(all.find((p) => p.id === k)!)} />}
    </PickerModal>
  );
}

export function CharmPicker({ owned, onPick, onClose }: { owned: OwnedGear | null; onPick: (c: CharmCat) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [mine, setMine] = useState(false);
  const [all, setAll] = useState<CharmCat[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadCharms()
      .then((r) => live && setAll(r))
      .catch((e: Error) => live && setErr(e.message));
    return () => {
      live = false;
    };
  }, []);
  const opts = useMemo<Opt[]>(() => {
    const t = norm(q.trim());
    return (all ?? [])
      .filter((c) => !mine || owned?.charms.has(c.id))
      .filter((c) => !t || norm(`${c.name_es ?? ""} ${c.name_en} ${c.skills.map((s) => s.name_es).join(" ")}`).includes(t))
      .map((c) => ({
        key: c.id,
        icon: <EntityIcon type="charm" rarity={c.rarity} size="md" />,
        title: c.name_es || c.name_en,
        sub: `R${c.rarity}`,
        extra: <small className="bd-opt__sk">{skillsText(c.skills)}</small>,
        owned: owned?.charms.has(c.id),
      }));
  }, [all, q, mine, owned]);
  return (
    <PickerModal title="Elegir amuleto" onClose={onClose}>
      <div className="bd-filters">
        <SearchBox placeholder="Buscar amuleto o habilidad…" value={q} onChange={setQ} label="Buscar amuleto" />
        <label className={`bd-chk${owned?.available ? "" : " bd-chk--off"}`}>
          <input type="checkbox" checked={mine} disabled={!owned?.available} onChange={(e) => setMine(e.target.checked)} /> Solo los míos
        </label>
      </div>
      {err && <ErrorBox error={err} />}
      {!all && !err && <p className="bv-hint bd-none" aria-busy="true">Cargando amuletos…</p>}
      {all && <OptList opts={opts} onPick={(k) => onPick(all.find((c) => c.id === k)!)} />}
    </PickerModal>
  );
}

export function DecoPicker({ size, owned, usedCount, onPick, onClose }: { size: number; owned: OwnedGear | null; usedCount: Map<number, number>; onPick: (d: DecoCat | null) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [mine, setMine] = useState(false);
  const [all, setAll] = useState<DecoCat[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadDecorations()
      .then((r) => live && setAll(r))
      .catch((e: Error) => live && setErr(e.message));
    return () => {
      live = false;
    };
  }, []);
  const opts = useMemo<Opt[]>(() => {
    const t = norm(q.trim());
    return (all ?? [])
      .filter((d) => d.slot <= size)
      .filter((d) => !mine || owned?.decorations.has(d.id))
      .filter((d) => !t || norm(`${d.name_es ?? ""} ${d.name_en} ${d.skills.map((s) => s.name_es).join(" ")}`).includes(t))
      .sort((a, b) => b.slot - a.slot || a.id - b.id)
      .map((d) => {
        const have = owned?.decorations.get(d.id);
        const used = usedCount.get(d.id) ?? 0;
        return {
          key: d.id,
          icon: <Icon kind="decoration" id={d.id} size="md" />,
          title: d.name_es || d.name_en,
          sub: `Tamaño ${d.slot} · R${d.rarity}`,
          extra: <small className="bd-opt__sk">{skillsText(d.skills)}</small>,
          right: have != null ? <span className={`bd-opt__cnt${used >= have ? " bd-opt__cnt--low" : ""}`}>×{have}</span> : undefined,
          owned: have != null,
        };
      });
  }, [all, q, size, mine, owned, usedCount]);
  return (
    <PickerModal title={`Joya para ranura de tamaño ${size}`} onClose={onClose}>
      <div className="bd-filters">
        <SearchBox placeholder="Buscar joya o habilidad…" value={q} onChange={setQ} label="Buscar joya" />
        <label className={`bd-chk${owned?.available ? "" : " bd-chk--off"}`}>
          <input type="checkbox" checked={mine} disabled={!owned?.available} onChange={(e) => setMine(e.target.checked)} /> Solo las mías
        </label>
        <button className="bd-btn bd-btn--ghost" onClick={() => onPick(null)}>
          Dejar libre
        </button>
      </div>
      {err && <ErrorBox error={err} />}
      {!all && !err && <p className="bv-hint bd-none" aria-busy="true">Cargando joyas…</p>}
      {all && <OptList opts={opts} onPick={(k) => onPick(all.find((d) => d.id === k)!)} />}
    </PickerModal>
  );
}
