import { useState } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../api";
import { BuildPages, Skeleton } from "../pages/BestiaryGear";
import { ErrorBox } from "./ui";
import { MonsterBuilds, goalBuildsPath } from "../build";

const GOAL_ES: Record<string, string> = { recoleccion: "recolección", botin: "botín" };

/** Tarjeta «Equipo recomendado para recolección / botín» (API /builds/goal). */
export function GoalBuild({ goal }: { goal: "recoleccion" | "botin" }) {
  const [rank, setRank] = useState("MR");
  const { data, error, loading } = useApi<MonsterBuilds>(goalBuildsPath(goal, rank, false, "full"));
  const build = data?.builds?.[0];
  return (
    <div className="gb">
      <div className="gb__bar" role="radiogroup" aria-label="Rango">
        {["HR", "MR"].map((r) => (
          <button key={r} role="radio" aria-checked={rank === r} className={rank === r ? "on" : ""} onClick={() => setRank(r)}>
            {r === "HR" ? "Rango alto" : "Rango maestro"}
          </button>
        ))}
      </div>
      {error && <ErrorBox error={error} />}
      {loading && !data && <Skeleton />}
      {data && !build && <p className="empty">No hay una recomendación para este rango.</p>}
      {data && build && (
        <>
          <BuildPages data={data} build={build} monsterName={`Equipo para ${GOAL_ES[goal]}`} heading="Recomendación" />
          <div className="bg-actions">
            <Link className="bg-btn" to={`/constructor?goal=${goal}&rank=${rank}&build=0&cap=full`}>
              Abrir en el constructor
            </Link>
            <span className="bv-hint">{data.disclaimer_es}</span>
          </div>
        </>
      )}
    </div>
  );
}
