import { NavLink } from "react-router-dom";

export const NAV_GROUPS: { label: string; items: [string, string][] }[] = [
  {
    label: "Consulta",
    items: [
      ["/monstruos", "Monstruos"],
      ["/objetos", "Materiales"],
      ["/armaduras", "Armaduras"],
      ["/armas", "Armas"],
      ["/superpuestas", "Superpuestas"],
      ["/mapas", "Mapas"],
      ["/misiones", "Misiones"],
      ["/eventos", "Eventos"],
    ],
  },
  {
    label: "Mi cazador",
    items: [
      ["/bestiario", "Bestiario"],
      ["/estadisticas", "Estadísticas"],
      ["/logros", "Logros"],
      ["/constructor", "Constructor"],
    ],
  },
  {
    label: "Herramientas",
    items: [
      ["/calendario", "Calendario"],
      ["/cantina", "Cantina"],
      ["/fusionador", "Maxifusionador"],
      ["/guias", "Guías"],
    ],
  },
  {
    label: "Información",
    items: [["/acerca", "Acerca de"]],
  },
];

const cls = ({ isActive }: { isActive: boolean }) => (isActive ? "nav__a nav__a--on" : "nav__a");

/** Lista del índice: se usa tanto en la columna lateral como dentro del cajón. */
export function NavList({ onNavigate, idPrefix = "nav" }: { onNavigate?: () => void; idPrefix?: string }) {
  return (
    <div className="nav__scroll">
      <NavLink to="/" end className={cls} onClick={onNavigate}>
        Inicio
      </NavLink>
      {NAV_GROUPS.map((g) => (
        <section key={g.label} className="nav__group" aria-labelledby={`${idPrefix}-${g.label}`}>
          <h2 className="nav__label" id={`${idPrefix}-${g.label}`}>
            {g.label}
          </h2>
          <ul className="nav__list">
            {g.items.map(([to, label]) => (
              <li key={to}>
                <NavLink to={to} className={cls} onClick={onNavigate}>
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Columna fija de escritorio (>=1100px). */
export default function AppNav() {
  return (
    <nav className="nav" aria-label="Índice">
      <NavList idPrefix="nav-side" />
    </nav>
  );
}
