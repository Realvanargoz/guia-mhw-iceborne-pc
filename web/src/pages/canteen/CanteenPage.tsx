import { useCallback, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useApi } from "../../api";
import { ErrorBox, Loading, Tabs } from "../../components/ui";
import { Catalog } from "./Catalog";
import { createEngine, type EData } from "./engine";
import { Recipes } from "./Recipes";
import { Simulator } from "./Simulator";
import { GatherLoot, Skills } from "./Skills";
import type { Canteen, Ing } from "./types";
import "../../builder.css";
import "../../canteen.css";

export { GatherLoot };

const TABS = [
  { id: "simulador", label: "Simulador" },
  { id: "recetario", label: "Recetario" },
  { id: "ingredientes", label: "Ingredientes" },
  { id: "habilidades", label: "Habilidades" },
  { id: "recoleccion", label: "Recolección y botín" },
] as const;
type TabId = (typeof TABS)[number]["id"];
/** Old links: ?tab=constructor opens the simulator. */
const ALIAS = new Map<string, TabId>([["constructor", "simulador"]]);

export default function CanteenPage() {
  const [sp, setSp] = useSearchParams();
  const raw = sp.get("tab") ?? "";
  const tab: TabId = TABS.find((t) => t.id === raw)?.id ?? ALIAS.get(raw) ?? "simulador";
  const { data, error, loading } = useApi<Canteen>("/canteen");

  // "Conseguido" overrides from the Ingredientes tab, shared with the simulator ("Solo los que tengo").
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const isDone = useCallback((i: Ing) => overrides[i.id] ?? i.done, [overrides]);
  // Base ingredients are always owned by the engine, so the set holds only what the player has marked (or the profile
  // update deduced): an empty set means "nothing marked yet" and the hints in the matrix and the Recetario show.
  const owned = useMemo(
    () => new Set((data?.ingredients ?? []).filter((i) => i.unlock_type !== "base" && isDone(i)).map((i) => i.id)),
    [data, isDone],
  );
  const engine = useMemo(() => (data ? createEngine(data as unknown as EData) : null), [data]);

  const go = (v: TabId) =>
    setSp(
      (prev) => {
        const n = new URLSearchParams(prev);
        n.set("tab", v);
        return n;
      },
      { replace: true },
    );

  return (
    <div>
      <h1 className="page-title">Cantina</h1>
      <p className="lead">
        Monta tu plato y mira qué habilidades felyne y estadísticas te da. Guías con vídeos: <Link to="/guias/cooking">Cantina</Link>,{" "}
        <Link to="/guias/gathering">Recolección</Link>, <Link to="/guias/loot">Botín</Link>. ¿Cómo se combinan las ramas?{" "}
        <Link to="/guias/cantina-combinaciones">Combinaciones y mezclas</Link>.
      </p>
      <Tabs tabs={TABS.map((t) => ({ id: t.id, label: t.label }))} value={tab} onChange={go} />
      {tab === "recoleccion" ? (
        <GatherLoot />
      ) : (
        <>
          {loading && !data && <Loading />}
          {error && <ErrorBox error={error} />}
          {data && engine && tab === "simulador" && <Simulator data={data} engine={engine} owned={owned} />}
          {data && engine && tab === "recetario" && <Recipes data={data} engine={engine} owned={owned} anyMarked={owned.size > 0} />}
          {data && engine && tab === "ingredientes" && <Catalog data={data} engine={engine} isDone={isDone} onToggle={(id, v) => setOverrides((o) => ({ ...o, [id]: v }))} />}
          {data && engine && tab === "habilidades" && <Skills data={data} engine={engine} />}
        </>
      )}
    </div>
  );
}
