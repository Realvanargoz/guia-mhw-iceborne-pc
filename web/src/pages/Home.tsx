import { FormEvent, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import "../stats.css";
import { useApi } from "../api";
import { ProgressBar } from "../components/ui";
import { FestBanner } from "../components/FestBanner";
import { HunterProfile } from "../components/HunterProfile";

type Stats = {
  counts: Record<string, number>;
  progress: Record<string, { done: number; total: number }>;
};

const TILES: [string, string, string, string][] = [
  ["/objetos", "Materiales", "items", "Dónde sale cada material: monstruo, rango, % y punto del mapa."],
  ["/monstruos", "Monstruos", "large_monsters", "Debilidades, hábitat por área, roturas y recompensas."],
  ["/bestiario", "Bestiario", "large_monsters", "Libro de monstruos como el del juego: ecología, fisiología y recompensas."],
  ["/armaduras", "Armaduras", "armor_sets", "Sets por rango, habilidades y materiales totales."],
  ["/superpuestas", "Superpuestas", "layered", "Cómo desbloquear cada armadura superpuesta en PC."],
  ["/logros", "Logros", "achievements", "Lista de logros de Steam con guía paso a paso."],
  ["/mapas", "Mapas", "locations", "Áreas, campamentos, recolección y monstruos por zona."],
  ["/misiones", "Misiones", "quests", "Misiones con objetivos y recompensas."],
  ["/guias", "Guías", "guides", "Progresión, desbloqueos y rutas de farmeo."],
  ["/calendario", "Calendario", "festivals", "Festivales, asedios y recordatorios con fechas."],
];

const PROGRESS_LABEL: Record<string, string> = {
  achievement: "Logros",
  layered: "Superpuestas",
  armor_set: "Sets de armadura",
  monster_hunted: "Monstruos cazados",
  monster_captured: "Monstruos capturados",
};

export default function Home() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const { data, reload } = useApi<Stats>("/stats");
  const { hash } = useLocation();
  useEffect(() => {
    if (hash === "#perfil") setTimeout(() => document.getElementById("perfil")?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
  }, [hash]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (q.trim()) nav(`/buscar?q=${encodeURIComponent(q.trim())}`);
  };
  return (
    <div className="home">
      <section className="hero">
        <h1>¿Qué necesitas encontrar?</h1>
        <p>
          Monster Hunter: World + Iceborne en PC. Escribe en español o en inglés, con o sin tildes.
        </p>
        <form onSubmit={submit} className="hero__search" role="search">
          <input
            autoFocus
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ej.: rubí de rathalos, Fatalis, Guiding Lands, gema de…"
            aria-label="Buscar en la guía"
          />
          <button type="submit">Buscar</button>
        </form>
        <div className="divider" aria-hidden />
      </section>

      <FestBanner />

      <HunterProfile onUpdated={reload} />

      <Link to="/estadisticas" className="tile tile--stats">
        <span className="tile__label">Estadísticas del cazador</span>
        <span className="tile__text">
          Tu partida en cifras: progreso, armaduras y misiones completadas, combate, Tierras Guía, camarada y equipo.
        </span>
      </Link>

      <section className="tiles">
        {TILES.map(([to, label, key, text]) => (
          <Link key={to} to={to} className="tile">
            <span className="tile__count">{data?.counts?.[key] ?? "·"}</span>
            <span className="tile__label">{label}</span>
            <span className="tile__text">{text}</span>
          </Link>
        ))}
      </section>

      {data?.progress && (
        <section className="section">
          <header className="section__head">
            <h2>Tu progreso</h2>
          </header>
          <div className="progress-grid">
            {Object.entries(data.progress)
              .filter(([, v]) => v.total > 0)
              .map(([k, v]) => (
                <ProgressBar key={k} label={PROGRESS_LABEL[k] ?? k} done={v.done} total={v.total} />
              ))}
          </div>
        </section>
      )}
    </div>
  );
}
