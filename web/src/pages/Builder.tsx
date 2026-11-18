import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getJson, useApi } from "../api";
import { RankSelector } from "../components/book";
import { DecoChip, DefenseBox, OwnedBadge, Resistances, SkillList, SlotRow } from "../components/BuildView";
import { EntityIcon, Icon } from "../components/Icon";
import Dialog from "../components/Dialog";
import { Empty, ErrorBox, OrnateHeader } from "../components/ui";
import {
  ArmorCat,
  CharmCat,
  DecoCat,
  EvalResult,
  LoadoutState,
  MonsterBuilds,
  OwnedGear,
  PieceInfo,
  SLOTS,
  SLOT_ES,
  SavedBuild,
  SlotId,
  emptyLoadout,
  evaluate,
  fitDecos,
  loadArmor,
  loadCharms,
  loadDecorations,
  loadOwned,
  loadoutFromBuild,
  monsterBuildsPath,
  goalBuildsPath,
  SAVED_PATH,
  SavedRow,
  createSaved,
  deleteSaved,
  fromRow,
  migrateLocalSaved,
  parseImport,
  savedErrorMessage,
  updateSaved,
} from "../build";
import { RANK_LABEL } from "../labels";

type ListRow = { id: number; name_es: string | null; name_en: string; has_ranks: string[] };
const RANKS = ["LR", "HR", "MR"].map((r) => ({ id: r, label: RANK_LABEL[r] }));
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/* ---------------------------------------------------------------- selector modal */
type Opt = { key: string | number; icon: ReactNode; title: string; sub?: string; right?: ReactNode; owned?: boolean; extra?: ReactNode };
function PickerModal({
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
function SearchBox({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches) return;
    const t = setTimeout(() => ref.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);
  return <input ref={ref} type="search" maxLength={60} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} />;
}
const cleanName = (s: string) => s.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim().slice(0, 60);

function RenameDialog({ build, onSave, onClose }: { build: SavedBuild; onSave: (name: string) => void; onClose: () => void }) {
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
function ConfirmDelete({ build, onConfirm, onClose }: { build: SavedBuild; onConfirm: () => void; onClose: () => void }) {
  return (
    <Dialog open onClose={onClose} title="Eliminar composición" className="bd-dlg bd-dlg--s">
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
function OptList({ opts, onPick, limit = 80 }: { opts: Opt[]; onPick: (k: string | number) => void; limit?: number }) {
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

const skillsText = (s: { name_es: string | null; level: number }[]) => s.map((x) => `${x.name_es ?? "?"} ${x.level}`).join(" · ");

function ArmorPicker({ slot, rankInit, owned, onPick, onClose }: { slot: SlotId; rankInit: string; owned: OwnedGear | null; onPick: (p: ArmorCat) => void; onClose: () => void }) {
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

function CharmPicker({ owned, onPick, onClose }: { owned: OwnedGear | null; onPick: (c: CharmCat) => void; onClose: () => void }) {
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

function DecoPicker({ size, owned, usedCount, onPick, onClose }: { size: number; owned: OwnedGear | null; usedCount: Map<number, number>; onPick: (d: DecoCat | null) => void; onClose: () => void }) {
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

/* ---------------------------------------------------------------- page */
type Picking = { kind: "armor"; slot: SlotId } | { kind: "charm" } | { kind: "deco"; piece: string; idx: number; size: number } | null;

export default function Builder() {
  const [sp, setSp] = useSearchParams();
  const monsters = useApi<ListRow[]>("/bestiary");
  const [st, setSt] = useState<LoadoutState>(emptyLoadout);
  const [rank, setRank] = useState(sp.get("rank") && ["LR", "HR", "MR"].includes(sp.get("rank")!) ? sp.get("rank")! : "HR");
  const [monster, setMonster] = useState<number | null>(sp.get("monster") ? Number(sp.get("monster")) : null);
  const [picking, setPicking] = useState<Picking>(null);
  const [owned, setOwned] = useState<OwnedGear | null>(null);
  const [decoCat, setDecoCat] = useState<DecoCat[]>([]);
  const extraDecos = useRef(new Map<number, { name: string; size: number; difficulty?: string }>());
  const [weaponTxt, setWeaponTxt] = useState("");
  const [loadMsg, setLoadMsg] = useState<{ tone: "ok" | "warn" | "err"; text: string } | null>(null);
  const [loadingRec, setLoadingRec] = useState(false);
  const [disclaimer, setDisclaimer] = useState<string | null>(null);

  const [ev, setEv] = useState<EvalResult | null>(null);
  const [evErr, setEvErr] = useState<string | null>(null);
  const [evBusy, setEvBusy] = useState(false);

  const savedApi = useApi<SavedRow[]>(SAVED_PATH);
  const [saved, setSaved] = useState<SavedBuild[]>([]);
  const [busy, setBusy] = useState(false);
  const [curId, setCurId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [ioText, setIoText] = useState("");
  const [ioMsg, setIoMsg] = useState<string | null>(null);
  const [storeErr, setStoreErr] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<SavedBuild | null>(null);
  const [deleting, setDeleting] = useState<SavedBuild | null>(null);

  useEffect(() => {
    loadOwned().then(setOwned);
    loadDecorations().then(setDecoCat).catch(() => undefined);
  }, []);
  /* lista de composiciones desde la API + migración única desde localStorage */
  const migratedRef = useRef(false);
  useEffect(() => {
    if (!savedApi.data) return;
    const list = savedApi.data.map(fromRow);
    setSaved(list);
    if (migratedRef.current) return;
    migratedRef.current = true;
    migrateLocalSaved(list)
      .then((created) => {
        if (created.length) setSaved((cur) => [...created, ...cur]);
      })
      .catch((e: Error) => {
        const created = (e as Error & { created?: SavedBuild[] }).created;
        if (created?.length) setSaved((cur) => [...created, ...cur]);
        setStoreErr(`No se pudieron migrar las composiciones antiguas: ${e.message}`);
      });
  }, [savedApi.data]);
  const decoMap = useMemo(() => new Map(decoCat.map((d) => [d.id, d])), [decoCat]);
  const decoInfo = useCallback(
    (id: number) => {
      const c = decoMap.get(id);
      if (c) return { name: c.name_es || c.name_en, size: c.slot, difficulty: undefined as string | undefined };
      return extraDecos.current.get(id) ?? { name: `Joya #${id}`, size: 1 };
    },
    [decoMap],
  );

  /* -- evaluación en vivo (con retardo y cancelación) */
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
      evaluate(st, ctrl.signal)
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
  }, [st]);

  /* -- cargar recomendación */
  const loadRec = useCallback(
    async (mId: number, r: string, buildIdx: number, ownedOnly: boolean, cap: string, weapon: number[], goal?: string) => {
      setLoadingRec(true);
      setLoadMsg(null);
      try {
        const data = await getJson<MonsterBuilds>(goal ? goalBuildsPath(goal, r, ownedOnly, cap) : monsterBuildsPath(mId, r, ownedOnly, cap, weapon));
        setDisclaimer(data.disclaimer_es);
        if (data.available === false || !data.builds.length) {
          setLoadMsg({
            tone: "warn",
            text:
              data.available === false
                ? `${data.monster.name_es || data.monster.name_en} no aparece en ${RANK_LABEL[r]}.${data.related?.length ? ` Prueba con ${data.related.map((x) => x.name_es || x.name_en).join(", ")}.` : ""}`
                : "No hay recomendación para ese monstruo y rango con las restricciones actuales.",
          });
          return;
        }
        const b = data.builds[Math.min(Math.max(buildIdx, 0), data.builds.length - 1)];
        for (const d of b.decorations) extraDecos.current.set(d.decoration_id, { name: d.name_es || d.name_en, size: d.size, difficulty: d.difficulty });
        setSt(loadoutFromBuild(b, weapon));
        setWeaponTxt(weapon.join(","));
        setCurId(null);
        setLoadMsg({ tone: "ok", text: `Cargado: ${data.monster.name_es || data.monster.name_en} · ${RANK_LABEL[r]} · ${b.name_es}` });
        if (data.owned_mode && data.owned_available === false) setLoadMsg({ tone: "warn", text: "Tu partida aún no incluye el cofre de equipo: se cargó la recomendación general." });
      } catch (e) {
        setLoadMsg({ tone: "err", text: `No se pudo cargar la recomendación: ${(e as Error).message}` });
      } finally {
        setLoadingRec(false);
      }
    },
    [],
  );
  const bootRef = useRef(false);
  useEffect(() => {
    if (bootRef.current) return;
    bootRef.current = true;
    const m = Number(sp.get("monster"));
    const goal = sp.get("goal");
    if (goal === "recoleccion" || goal === "botin") loadRec(-1, rank, Number(sp.get("build") ?? 0) || 0, sp.get("owned") === "1", sp.get("cap") === "full" ? "full" : "progress", [], goal);
    else if (m) loadRec(m, rank, Number(sp.get("build") ?? 0) || 0, sp.get("owned") === "1", sp.get("cap") === "full" ? "full" : "progress", []);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* -- edición */
  const setPiece = (slot: SlotId, p: PieceInfo | null) =>
    setSt((s) => ({
      ...s,
      pieces: { ...s.pieces, [slot]: p },
      decos: { ...s.decos, [slot]: p ? fitDecos(s.pieces[slot]?.id === p.id ? s.decos[slot] : undefined, p.slots.length) : [] },
    }));
  const setDeco = (piece: string, idx: number, id: number | null) =>
    setSt((s) => {
      const len = piece === "weapon" ? s.weapon.length : s.pieces[piece as SlotId]?.slots.length ?? 0;
      const arr = fitDecos(s.decos[piece], len);
      arr[idx] = id;
      return { ...s, decos: { ...s.decos, [piece]: arr } };
    });
  const onWeapon = (txt: string) => {
    setWeaponTxt(txt);
    const sizes = txt.split(/[\s,;]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 4).slice(0, 3);
    setSt((s) => ({ ...s, weapon: sizes, decos: { ...s.decos, weapon: fitDecos(s.decos.weapon, sizes.length) } }));
  };
  const clearAll = () => {
    setSt(emptyLoadout());
    setWeaponTxt("");
    setCurId(null);
    setLoadMsg(null);
    setEv(null);
  };

  const usedCount = useMemo(() => {
    const m = new Map<number, number>();
    for (const a of Object.values(st.decos)) for (const id of a) if (id != null) m.set(id, (m.get(id) ?? 0) + 1);
    return m;
  }, [st.decos]);

  /* -- guardado en la API */
  const guard = async (f: () => Promise<void>) => {
    setBusy(true);
    setStoreErr(null);
    try {
      await f();
    } catch (e) {
      setStoreErr(savedErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const save = () =>
    guard(async () => {
      const nm = cleanName(name) || `Equipo ${saved.length + 1}`;
      const snapshot = JSON.parse(JSON.stringify(st)) as LoadoutState;
      if (curId && saved.some((b) => b.id === curId)) {
        const row = await updateSaved(curId, { name: nm, state: snapshot });
        setSaved((cur) => cur.map((b) => (b.id === curId ? row : b)));
      } else {
        const row = await createSaved(nm, snapshot);
        setCurId(row.id);
        setSaved((cur) => [row, ...cur]);
      }
      setName(nm);
    });
  const renameSaved = (b: SavedBuild, n: string) =>
    guard(async () => {
      const row = await updateSaved(b.id, { name: n });
      setSaved((cur) => cur.map((x) => (x.id === b.id ? row : x)));
      if (curId === b.id) setName(row.name);
    });
  const removeSaved = (b: SavedBuild) =>
    guard(async () => {
      await deleteSaved(b.id);
      setSaved((cur) => cur.filter((x) => x.id !== b.id));
      if (curId === b.id) setCurId(null);
    });
  const loadSaved = (b: SavedBuild) => {
    setSt(JSON.parse(JSON.stringify(b.state)));
    setWeaponTxt((b.state.weapon ?? []).join(","));
    setCurId(b.id);
    setName(b.name);
    setLoadMsg({ tone: "ok", text: `Cargado «${b.name}».` });
  };
  const exportAll = () => setIoText(JSON.stringify(saved, null, 1));
  const exportCurrent = () => setIoText(JSON.stringify([{ name: name.trim() || "Mi equipo", state: st }], null, 1));
  const doImport = () => {
    let list: SavedBuild[];
    try {
      list = parseImport(ioText);
    } catch (e) {
      setIoMsg((e as Error).message);
      return;
    }
    guard(async () => {
      const made: SavedBuild[] = [];
      try {
        // de la última a la primera, para que el orden del archivo se conserve (la API lista la más nueva primero)
        for (const b of [...list].reverse()) made.unshift(await createSaved(b.name, b.state));
        setIoMsg(`Importadas ${made.length} composiciones.`);
        setIoText("");
      } catch (e) {
        setIoMsg(`Importadas ${made.length} de ${list.length}. ${savedErrorMessage(e)}`);
      } finally {
        if (made.length) setSaved((cur) => [...made, ...cur]);
      }
    });
  };

  const gotPieces = SLOTS.filter((s) => st.pieces[s]).length;
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
    <div className="bd">
      <h1 className="page-title">Constructor de equipo</h1>
      <p className="bd-lead">
        Monta tu propio set: elige piezas, amuleto y joyas, y las habilidades, la defensa y las resistencias se recalculan al momento. Parte de la
        recomendación para cazar en solitario de un monstruo y modifícala a tu gusto.
      </p>

      <section className="bd-card bd-load">
        <OrnateHeader as="h2" className="ohead--sm">
          Cargar recomendación
        </OrnateHeader>
        <div className="bd-load__row">
          <select aria-label="Monstruo" value={monster ?? ""} onChange={(e) => setMonster(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Elige un monstruo…</option>
            {(monsters.data ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name_es || m.name_en}
              </option>
            ))}
          </select>
          <RankSelector ranks={RANKS} value={rank} onChange={setRank} keys={false} />
          <button
            className="bd-btn"
            disabled={!monster || loadingRec}
            onClick={() => {
              if (!monster) return;
              const n = new URLSearchParams();
              n.set("monster", String(monster));
              n.set("rank", rank);
              setSp(n, { replace: true });
              loadRec(monster, rank, 0, false, "progress", st.weapon);
            }}
          >
            {loadingRec ? "Cargando…" : "Cargar recomendación"}
          </button>
          <button className="bd-btn bd-btn--ghost" onClick={clearAll}>
            Limpiar
          </button>
        </div>
        {monsters.error && <ErrorBox error={monsters.error} />}
        {loadMsg && (
          <p className={`bd-msg bd-msg--${loadMsg.tone}`} role="status">
            {loadMsg.text}
          </p>
        )}
        {disclaimer && <p className="bg-disc bd-disc" role="note"><b>Importante.</b> {disclaimer}</p>}
        {!disclaimer && (
          <p className="bg-disc bd-disc" role="note">
            <b>Importante.</b> Esto es una calculadora: no valora tu arma ni tu estilo de juego. Las recomendaciones del Bestiario son una sugerencia defensiva para cazar en solitario, no la única forma correcta.
          </p>
        )}
      </section>

      <div className="bd-grid">
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

        <aside className="bd-res" aria-live="polite">
          <OrnateHeader as="h2" className="ohead--red" aside={evBusy ? <span className="bd-spin" aria-label="Calculando" /> : undefined}>
            Resultado
          </OrnateHeader>
          {!ev && !evErr && !evBusy && <Empty>Elige alguna pieza o carga una recomendación para ver las habilidades.</Empty>}
          {evErr && <ErrorBox error={evErr} />}
          {!ev && evBusy && (
            <div className="bg-skel">
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="bg-skel__row bg-skel__row--s" />
              ))}
            </div>
          )}
          {ev && (
            <div className={evBusy ? "bd-res__in bd-res__in--busy" : "bd-res__in"}>
              <h3 className="bd-h">Habilidades</h3>
              <SkillList skills={ev.skills.map((s) => ({ ...s, name_es: s.name_es }))} empty="Sin habilidades activas." />
              {ev.set_bonuses.length > 0 && (
                <>
                  <h3 className="bd-h">Bonos de set</h3>
                  <ul className="bg-bonus">
                    {ev.set_bonuses.map((b, i) => (
                      <li key={i} className={b.active ? "on" : ""}>
                        <b>{b.name_es}</b> · {b.skill_es}{" "}
                        <small>
                          ({b.pieces}/{b.required} piezas{b.active ? ", activo" : ""})
                        </small>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <h3 className="bd-h">Defensa</h3>
              <DefenseBox d={ev.defense} />
              <h3 className="bd-h">Resistencias</h3>
              <Resistances res={ev.resistances} />
              <h3 className="bd-h">Ranuras</h3>
              <p className="bd-slotsum">
                {typeof ev.slots_used === "number" ? ev.slots_used : ev.slots_used.length} usadas de {ev.slots_total.length}.{" "}
                {ev.slots_free.length ? (
                  <>
                    Libres:{" "}
                    {ev.slots_free.map((s, i) => (
                      <i key={i} className={`bv-gem bv-gem--${s.size} bv-gem--sm`} title={SLOT_ES[s.piece]}>
                        {s.size}
                      </i>
                    ))}
                  </>
                ) : (
                  "Sin ranuras libres."
                )}
              </p>
              {ev.warnings.length > 0 && (
                <div className="bg-warn">
                  <b>Avisos</b>
                  <ul>
                    {ev.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </aside>
      </div>

      <section className="bd-card bd-store">
        <OrnateHeader as="h2" className="ohead--sm">
          Mis composiciones
        </OrnateHeader>
        {savedApi.error && <ErrorBox error={savedApi.error} onRetry={savedApi.reload} />}
        {storeErr && <p className="bd-msg bd-msg--warn" role="alert">{storeErr}</p>}
        <div className="bd-store__save">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre de la composición" aria-label="Nombre de la composición" maxLength={60} />
          <button className="bd-btn" onClick={save} disabled={busy || (!gotPieces && !st.charm)}>
            {curId ? "Guardar cambios" : "Guardar como nueva"}
          </button>
          {curId && (
            <button className="bd-btn bd-btn--ghost" onClick={() => { setCurId(null); }}>
              Desvincular
            </button>
          )}
        </div>
        {saved.length === 0 ? (
          <p className="bv-hint">Todavía no has guardado ninguna composición. Se guardan en tu equipo, en la base de datos local de la aplicación.</p>
        ) : (
          <ul className="bd-saved">
            {saved.map((b) => (
              <li key={b.id} className={b.id === curId ? "on" : ""}>
                <div className="bd-saved__ic">
                  {SLOTS.map((s) => (b.state.pieces?.[s] ? <EntityIcon key={s} type="armor" sub={s} rarity={b.state.pieces[s]!.rarity} size="xs" /> : <span key={s} className="bd-saved__e" />))}
                </div>
                <span className="bd-saved__n">{b.name}</span>
                <small>{new Date(b.updated).toLocaleDateString("es-ES")}</small>
                <button className="bd-btn bd-btn--s" onClick={() => loadSaved(b)}>
                  Cargar
                </button>
                <button className="bd-btn bd-btn--s bd-btn--ghost" onClick={() => setRenaming(b)}>
                  Renombrar
                </button>
                <button className="bd-btn bd-btn--s bd-btn--ghost" onClick={() => setDeleting(b)}>
                  Borrar
                </button>
              </li>
            ))}
          </ul>
        )}
        <details className="bd-io">
          <summary>Exportar / importar (JSON)</summary>
          <div className="bd-io__btns">
            <button className="bd-btn bd-btn--s" onClick={exportCurrent}>
              Exportar el equipo actual
            </button>
            <button className="bd-btn bd-btn--s" onClick={exportAll} disabled={!saved.length}>
              Exportar todas
            </button>
            <button className="bd-btn bd-btn--s" onClick={doImport} disabled={!ioText.trim()}>
              Importar el texto
            </button>
          </div>
          <textarea value={ioText} onChange={(e) => { setIoText(e.target.value); setIoMsg(null); }} rows={6} maxLength={500000} placeholder="Pega aquí un JSON exportado para importarlo, o pulsa Exportar para copiarlo." aria-label="JSON de composiciones" />
          {ioMsg && <p className="bv-hint" role="status">{ioMsg}</p>}
        </details>
      </section>

      <p className="bv-hint bd-back">
        ¿Buscas una recomendación? Mira la pestaña «Equipo» del <Link to="/bestiario">Bestiario</Link>.
      </p>

      {renaming && (
        <RenameDialog
          build={renaming}
          onClose={() => setRenaming(null)}
          onSave={(n) => {
            void renameSaved(renaming, n);
            setRenaming(null);
          }}
        />
      )}
      {deleting && (
        <ConfirmDelete
          build={deleting}
          onClose={() => setDeleting(null)}
          onConfirm={() => {
            void removeSaved(deleting);
            setDeleting(null);
          }}
        />
      )}
      {picking?.kind === "armor" && (
        <ArmorPicker
          slot={picking.slot}
          rankInit={st.pieces[picking.slot]?.rank ?? rank}
          owned={owned}
          onClose={() => setPicking(null)}
          onPick={(p) => {
            setPiece(picking.slot, p);
            setPicking(null);
          }}
        />
      )}
      {picking?.kind === "charm" && (
        <CharmPicker
          owned={owned}
          onClose={() => setPicking(null)}
          onPick={(c) => {
            setSt((s) => ({ ...s, charm: { id: c.id, name_es: c.name_es, name_en: c.name_en, rarity: c.rarity, skills: c.skills } }));
            setPicking(null);
          }}
        />
      )}
      {picking?.kind === "deco" && (
        <DecoPicker
          size={picking.size}
          owned={owned}
          usedCount={usedCount}
          onClose={() => setPicking(null)}
          onPick={(d) => {
            if (d) extraDecos.current.set(d.id, { name: d.name_es || d.name_en, size: d.slot });
            setDeco(picking.piece, picking.idx, d ? d.id : null);
            setPicking(null);
          }}
        />
      )}
    </div>
  );
}
