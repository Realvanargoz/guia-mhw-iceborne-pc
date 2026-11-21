import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getJson, useApi } from "../../../api";
import { RankSelector } from "../../../components/book";
import { ErrorBox, OrnateHeader } from "../../../components/ui";
import {
  DecoCat,
  EvalResult,
  LoadoutState,
  MonsterBuilds,
  OwnedGear,
  PieceInfo,
  SLOTS,
  SlotId,
  SavedBuild,
  SavedRow,
  SAVED_PATH,
  emptyLoadout,
  fitDecos,
  fromRow,
  goalBuildsPath,
  loadDecorations,
  loadOwned,
  loadoutFromBuild,
  migrateLocalSaved,
  monsterBuildsPath,
  savedErrorMessage,
  createSaved,
  deleteSaved,
  updateSaved,
} from "../../../build";
import { RANK_LABEL } from "../../../labels";
import { ArmorPicker, CharmPicker, ConfirmDelete, DecoPicker, RANKS, RenameDialog, cleanName } from "./pickers";
import type { Picking } from "./LoadoutEditor";
import Probar from "../steps/Probar";
import type { Dispatch, SetStateAction } from "react";
import type { Action, PlanState } from "../planState";
import type { SkillCat } from "../planApi";
import { useLiveEvaluate } from "./useLiveEvaluate";

type ListRow = { id: number; name_es: string | null; name_en: string; has_ranks: string[] };

/** Base que el asistente entrega al editor: cada `nonce` nuevo sustituye el equipo actual. */
export type EditorSeed = {
  nonce: number;
  state: LoadoutState;
  decos?: { id: number; name: string; size: number; difficulty?: string }[];
  label?: string;
  /** equipo guardado de origen (?guardado=): el editor queda vinculado a él */
  savedId?: string;
  name?: string;
  versionId?: number | null;
};

/** Estado del plan que el paso «Probar» necesita (viene del contenedor). */
export type PlanBridge = {
  state: PlanState;
  dispatch: Dispatch<Action>;
  skills: Map<number, SkillCat> | undefined;
  /** id de la versión cargada desde la URL (?v=) */
  bootVersion: number | null;
};

/** Id de monstruo de la URL: entero positivo en rango razonable o null. */
const monsterParam = (v: string | null): number | null => {
  const n = v && /^\d{1,6}$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 100000 ? n : null;
};

export default function EditorPage({ embedded = false, seed, plan }: { embedded?: boolean; seed?: EditorSeed | null; plan: PlanBridge }) {
  const [sp, setSp] = useSearchParams();
  const monsters = useApi<ListRow[]>("/bestiary");
  const [st, setSt] = useState<LoadoutState>(emptyLoadout);
  const [rank, setRank] = useState(sp.get("rank") && ["LR", "HR", "MR"].includes(sp.get("rank")!) ? sp.get("rank")! : (["LR", "HR", "MR"].includes(plan.state.objective.rank) ? plan.state.objective.rank : "HR"));
  const [monster, setMonster] = useState<number | null>(monsterParam(sp.get("monster")));
  const [picking, setPicking] = useState<Picking>(null);
  const [owned, setOwned] = useState<OwnedGear | null>(null);
  const [decoCat, setDecoCat] = useState<DecoCat[]>([]);
  const extraDecos = useRef(new Map<number, { name: string; size: number; difficulty?: string }>());
  const [weaponTxt, setWeaponTxt] = useState("");
  const [loadMsg, setLoadMsg] = useState<{ tone: "ok" | "warn" | "err"; text: string } | null>(null);
  const [loadingRec, setLoadingRec] = useState(false);
  const [disclaimer, setDisclaimer] = useState<string | null>(null);
  const [seedVersion, setSeedVersion] = useState<{ nonce: number; id: number | null } | null>(null);

  const savedApi = useApi<SavedRow[]>(SAVED_PATH);
  const [saved, setSaved] = useState<SavedBuild[]>([]);
  const [busy, setBusy] = useState(false);
  const [curId, setCurId] = useState<string | null>(null);
  const [name, setName] = useState("");
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

  // El selector de rango del editor sigue al del plan (p. ej. al restaurar el borrador tras montar el paso).
  const planRank = plan.state.objective.rank;
  useEffect(() => {
    if (!sp.get("rank") && ["LR", "HR", "MR"].includes(planRank)) setRank(planRank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planRank]);
  const evalTargets = useMemo(() => plan.state.targets.map((t) => ({ skill_id: t.skill_id, level: t.level, tier: t.tier })), [plan.state.targets]);
  const { ev, evErr, evBusy, clearEv } = useLiveEvaluate(st, evalTargets);

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
  /* base entregada por el asistente («Usar esta base»): sustituye al equipo y evita que un enlace antiguo la pise */
  const seedRef = useRef(0);
  useEffect(() => {
    if (!seed || seed.nonce === seedRef.current) return;
    seedRef.current = seed.nonce;
    bootRef.current = true;
    for (const d of seed.decos ?? []) extraDecos.current.set(d.id, { name: d.name, size: d.size, difficulty: d.difficulty });
    setSt(JSON.parse(JSON.stringify(seed.state)));
    setWeaponTxt(seed.state.weapon.join(","));
    setCurId(seed.savedId ?? null);
    setName(seed.savedId ? seed.name ?? "" : "");
    setSeedVersion({ nonce: seed.nonce, id: seed.versionId ?? null });
    clearEv();
    setLoadMsg({ tone: "ok", text: seed.label ?? "Base cargada desde el asistente." });
  }, [seed]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (bootRef.current) return;
    bootRef.current = true;
    const m = monsterParam(sp.get("monster"));
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
    clearEv();
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
  const save = (planBody?: unknown) =>
    guard(async () => {
      const nm = cleanName(name) || `Equipo ${saved.length + 1}`;
      const snapshot = JSON.parse(JSON.stringify(st)) as LoadoutState;
      if (curId && saved.some((b) => b.id === curId)) {
        const row = await updateSaved(curId, { name: nm, state: snapshot, plan: planBody });
        setSaved((cur) => cur.map((b) => (b.id === curId ? row : b)));
      } else {
        const row = await createSaved(nm, snapshot, planBody);
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
  const gotPieces = SLOTS.filter((s) => st.pieces[s]).length;
  /** sustituye el equipo del editor (cargar versión, importar, restaurar) */
  const applyState = (state: LoadoutState, label: string) => {
    setSt(JSON.parse(JSON.stringify(state)));
    setWeaponTxt((state.weapon ?? []).join(","));
    clearEv();
    setLoadMsg({ tone: "ok", text: label });
  };
  const ed = {
    st, setSt, owned, gotPieces, usedCount, decoInfo, setPicking, setPiece, setDeco, weaponTxt, onWeapon, ev, evErr, evBusy,
    saved, setSaved, savedError: savedApi.error, onRetry: savedApi.reload, storeErr, busy, guard, name, setName, curId, setCurId,
    save, loadSaved, onRename: setRenaming, onDelete: setDeleting, applyState, seedVersion,
  };

  return (
    <div className="bd">
      {!embedded && <h1 className="page-title">Constructor de equipo</h1>}
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
              const n = new URLSearchParams(sp);
              n.delete("goal");
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


      <Probar ed={ed} plan={plan} />

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

/** Todo lo que el editor expone al paso «Probar». */
export type Editor = {
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
  ev: EvalResult | null;
  evErr: string | null;
  evBusy: boolean;
  saved: SavedBuild[];
  setSaved: Dispatch<SetStateAction<SavedBuild[]>>;
  savedError: string | undefined;
  onRetry: () => void;
  storeErr: string | null;
  busy: boolean;
  guard: (f: () => Promise<void>) => Promise<void>;
  name: string;
  setName: (n: string) => void;
  curId: string | null;
  setCurId: (id: string | null) => void;
  save: (planBody?: unknown) => Promise<void>;
  loadSaved: (b: SavedBuild) => void;
  onRename: (b: SavedBuild) => void;
  onDelete: (b: SavedBuild) => void;
  applyState: (state: LoadoutState, label: string) => void;
  seedVersion: { nonce: number; id: number | null } | null;
};
