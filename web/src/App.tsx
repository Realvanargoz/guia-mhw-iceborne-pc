import { FormEvent, ReactNode, Suspense, lazy, useEffect, useId, useRef, useState } from "react";
import { Link, Route, Routes, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import Home from "./pages/Home";
import { Loading } from "./components/ui";
import { FestProvider } from "./calendar";
import { FestPill } from "./components/FestBanner";
import { Corners } from "./components/book";
import ErrorBoundary from "./components/ErrorBoundary";
import AppNav, { NavList } from "./components/AppNav";
import Dialog from "./components/Dialog";
import FloatingNav, { IconBack, useCanGoBack } from "./components/FloatingNav";
import { usePageTitle } from "./usePageTitle";
const Search = lazy(() => import("./pages/Search"));
const About = lazy(() => import("./pages/About"));
const MonsterList = lazy(() => import("./pages/Monsters").then((m) => ({ default: m.MonsterList })));
const MonsterPage = lazy(() => import("./pages/Monsters").then((m) => ({ default: m.MonsterPage })));
const ItemList = lazy(() => import("./pages/Items").then((m) => ({ default: m.ItemList })));
const ItemPage = lazy(() => import("./pages/Items").then((m) => ({ default: m.ItemPage })));
const ArmorPiecePage = lazy(() => import("./pages/Armor").then((m) => ({ default: m.ArmorPiecePage })));
const ArmorSetList = lazy(() => import("./pages/Armor").then((m) => ({ default: m.ArmorSetList })));
const ArmorSetPage = lazy(() => import("./pages/Armor").then((m) => ({ default: m.ArmorSetPage })));
const CharmPage = lazy(() => import("./pages/Gear").then((m) => ({ default: m.CharmPage })));
const DecorationPage = lazy(() => import("./pages/Gear").then((m) => ({ default: m.DecorationPage })));
const SkillPage = lazy(() => import("./pages/Gear").then((m) => ({ default: m.SkillPage })));
const WeaponList = lazy(() => import("./pages/Gear").then((m) => ({ default: m.WeaponList })));
const WeaponPage = lazy(() => import("./pages/Gear").then((m) => ({ default: m.WeaponPage })));
const LayeredList = lazy(() => import("./pages/Layered").then((m) => ({ default: m.LayeredList })));
const LayeredPage = lazy(() => import("./pages/Layered").then((m) => ({ default: m.LayeredPage })));
const AchievementList = lazy(() => import("./pages/Achievements").then((m) => ({ default: m.AchievementList })));
const AchievementPage = lazy(() => import("./pages/Achievements").then((m) => ({ default: m.AchievementPage })));
const LocationList = lazy(() => import("./pages/Locations").then((m) => ({ default: m.LocationList })));
const LocationPage = lazy(() => import("./pages/Locations").then((m) => ({ default: m.LocationPage })));
const EventList = lazy(() => import("./pages/Quests").then((m) => ({ default: m.EventList })));
const QuestList = lazy(() => import("./pages/Quests").then((m) => ({ default: m.QuestList })));
const QuestPage = lazy(() => import("./pages/Quests").then((m) => ({ default: m.QuestPage })));
const GuideList = lazy(() => import("./pages/Guides").then((m) => ({ default: m.GuideList })));
const GuidePage = lazy(() => import("./pages/Guides").then((m) => ({ default: m.GuidePage })));
const CanteenPage = lazy(() => import("./pages/canteen/CanteenPage"));
const MelderPage = lazy(() => import("./pages/Melder"));
const CalendarPage = lazy(() => import("./pages/Calendar"));
const Bestiary = lazy(() => import("./pages/Bestiary"));
const StatsPage = lazy(() => import("./pages/Stats"));
const Builder = lazy(() => import("./pages/builder/index"));
const DesignSystem = lazy(() => import("./pages/DesignSystem"));

/** Páginas que usan el ancho --page-max-wide (clase .main--wide). */
const WIDE = ["/bestiario", "/constructor", "/calendario", "/estadisticas", "/cantina"];

const svgProps = {
  viewBox: "0 0 24 24",
  width: 20,
  height: 20,
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  "aria-hidden": true,
};
const IconSearch = () => (
  <svg {...svgProps}>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="m16 16 5 5" />
  </svg>
);
const IconMenu = () => (
  <svg {...svgProps}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);
const IconClose = () => (
  <svg {...svgProps}>
    <path d="m6 6 12 12M18 6 6 18" />
  </svg>
);

/** Fija el título de pestaña de una ruta de lista; las páginas de detalle fijan el suyo. */
function Titled({ title, children }: { title: string | null; children: ReactNode }) {
  usePageTitle(title);
  return <>{children}</>;
}
const page = (title: string | null, el: ReactNode) => <Titled title={title}>{el}</Titled>;

function NotFound() {
  usePageTitle("Página no encontrada");
  return (
    <div className="empty">
      <h1>Página no encontrada</h1>
      <p>
        <Link to="/">Volver al inicio</Link>
      </p>
    </div>
  );
}

function HeaderSearch() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const loc = useLocation();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const formId = useId();
  useEffect(() => {
    if (loc.pathname === "/buscar") setQ(params.get("q") ?? "");
  }, [loc.pathname, params]);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  const close = () => {
    setOpen(false);
    toggle.current?.focus();
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (q.trim()) {
      nav(`/buscar?q=${encodeURIComponent(q.trim())}`);
      setOpen(false);
    }
  };
  return (
    <>
      <button
        ref={toggle}
        type="button"
        className="hbtn hbtn--search"
        aria-label="Abrir búsqueda"
        aria-expanded={open}
        aria-controls={formId}
        onClick={() => setOpen(true)}
      >
        <IconSearch />
      </button>
      <form
        id={formId}
        className={open ? "hsearch hsearch--open" : "hsearch"}
        onSubmit={submit}
        role="search"
        aria-label="Buscar"
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) close();
        }}
      >
        <input
          ref={input}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Busca material, monstruo, armadura, logro…"
          aria-label="Buscar"
        />
        <button type="button" className="hbtn hsearch__close" aria-label="Cerrar búsqueda" onClick={close}>
          <IconClose />
        </button>
      </form>
    </>
  );
}

export default function App() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const canGoBack = useCanGoBack();
  const [navOpen, setNavOpen] = useState(false);
  const first = useRef(true);
  const wide = WIDE.some((p) => pathname === p || pathname.startsWith(p + "/"));
  useEffect(() => {
    window.scrollTo(0, 0); // en bloque: Chrome reciente devuelve una Promise y React no admite retornos que no sean función
    setNavOpen(false);
    if (first.current) {
      first.current = false;
      return;
    }
    let id2 = 0;
    const id1 = requestAnimationFrame(() => {
      id2 = requestAnimationFrame(() => {
        const main = document.getElementById("contenido");
        const target = main?.querySelector<HTMLElement>("h1") ?? main;
        if (!target) return;
        if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
        target.focus({ preventScroll: true });
      });
    });
    return () => {
      cancelAnimationFrame(id1);
      cancelAnimationFrame(id2);
    };
  }, [pathname]);
  return (
    <FestProvider>
      <div className="app">
        <a
          className="skip"
          href="#contenido"
          onClick={(e) => {
            e.preventDefault();
            const m = document.getElementById("contenido");
            m?.focus();
            m?.scrollIntoView();
          }}
        >
          Saltar al contenido
        </a>
        <header className="topbar">
          <div className="topbar__row">
            <button
              type="button"
              className="hbtn hbtn--menu"
              aria-expanded={navOpen}
              aria-controls="indice-drawer"
              onClick={() => setNavOpen(true)}
            >
              <IconMenu />
              <span>Índice</span>
            </button>
            {canGoBack && (
              <button type="button" className="hbtn hbtn--back" onClick={() => navigate(-1)} aria-label="Volver a la página anterior" title="Volver (Alt + ←)">
                <IconBack />
              </button>
            )}
            <Link to="/" className="brand">
              <svg className="brand__mark" viewBox="0 0 32 32" width="22" height="22" aria-hidden>
                <path d="M16 2 4 9v14l12 7 12-7V9z" fill="currentColor" />
              </svg>
              <span className="brand__text">
                Guía MHW <em>Iceborne · PC</em>
              </span>
            </Link>
            <HeaderSearch />
            <FestPill />
          </div>
        </header>
        <div className="app__body">
          <AppNav />
          <Dialog open={navOpen} onClose={() => setNavOpen(false)} title="Índice" variant="drawer" className="navdrawer">
            <nav aria-label="Índice" id="indice-drawer" className="nav nav--drawer">
              <NavList idPrefix="nav-drawer" onNavigate={() => setNavOpen(false)} />
            </nav>
          </Dialog>
          <div className="app__col">
            <main className={wide ? "main main--wide" : "main"} id="contenido" tabIndex={-1}>
              <Corners />
              <ErrorBoundary key={pathname}>
                <Suspense fallback={<Loading />}>
                  <Routes>
                    <Route path="/" element={page(null, <Home />)} />
                    <Route path="/buscar" element={page("Búsqueda", <Search />)} />
                    <Route path="/monstruos" element={page("Monstruos", <MonsterList />)} />
                    <Route path="/monstruos/:id" element={<MonsterPage />} />
                    <Route path="/bestiario" element={page("Bestiario", <Bestiary />)} />
                    <Route path="/bestiario/:id" element={page("Bestiario", <Bestiary />)} />
                    <Route path="/constructor" element={page("Constructor", <Builder />)} />
                    <Route path="/estadisticas" element={page("Estadísticas", <StatsPage />)} />
                    <Route path="/objetos" element={page("Materiales", <ItemList />)} />
                    <Route path="/objetos/:id" element={<ItemPage />} />
                    <Route path="/armaduras" element={page("Armaduras", <ArmorSetList />)} />
                    <Route path="/armaduras/:id" element={<ArmorSetPage />} />
                    <Route path="/armaduras/piezas/:id" element={<ArmorPiecePage />} />
                    <Route path="/armas" element={page("Armas", <WeaponList />)} />
                    <Route path="/armas/:id" element={<WeaponPage />} />
                    <Route path="/habilidades/:id" element={<SkillPage />} />
                    <Route path="/adornos/:id" element={<DecorationPage />} />
                    <Route path="/amuletos/:id" element={<CharmPage />} />
                    <Route path="/superpuestas" element={page("Superpuestas", <LayeredList />)} />
                    <Route path="/superpuestas/:slug" element={<LayeredPage />} />
                    <Route path="/logros" element={page("Logros", <AchievementList />)} />
                    <Route path="/logros/:slug" element={<AchievementPage />} />
                    <Route path="/mapas" element={page("Mapas", <LocationList />)} />
                    <Route path="/mapas/:id" element={<LocationPage />} />
                    <Route path="/misiones" element={page("Misiones", <QuestList />)} />
                    <Route path="/misiones/:id" element={<QuestPage />} />
                    <Route path="/eventos" element={page("Eventos", <EventList />)} />
                    <Route path="/calendario" element={page("Calendario", <CalendarPage />)} />
                    <Route path="/diseno" element={<DesignSystem />} />
                    <Route path="/cantina" element={page("Cantina", <CanteenPage />)} />
                    <Route path="/fusionador" element={page("Maxifusionador", <MelderPage />)} />
                    <Route path="/guias" element={page("Guías", <GuideList />)} />
                    <Route path="/acerca" element={<About />} />
                    <Route path="/guias/:slug" element={<GuidePage />} />
                    <Route path="*" element={<NotFound />} />
                  </Routes>
                </Suspense>
              </ErrorBoundary>
            </main>
            <footer className="footer">
              Datos: MHWorldData (MIT) · mhw-db.com · investigación propia con fuentes enlazadas. Monster Hunter es
              marca de Capcom. Proyecto personal sin fines comerciales.
            </footer>
          </div>
        </div>
        <FloatingNav />
      </div>
    </FestProvider>
  );
}
