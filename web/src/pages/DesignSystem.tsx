import { useState } from "react";
import { Book, BookTabs, Crown, Gem, KeyCap, Page, Parchment, RankSelector, ResearchBar, Stars } from "../components/book";
import { OrnateHeader, ProgressBar, Section, Tabs } from "../components/ui";

const SWATCHES: [string, string, string][] = [
  ["--parchment", "#d9c296", "Pergamino (página)"],
  ["--parchment-hi", "#e6d5ae", "Pergamino claro (tarjetas)"],
  ["--parchment-lo", "#c9ab76", "Pergamino oscuro"],
  ["--parchment-mid", "#be955c", "Pergamino medio"],
  ["--parchment-aged", "#a07c57", "Envejecido"],
  ["--ink-900", "#3b2717", "Tinta"],
  ["--ink-700", "#503628", "Tinta 2"],
  ["--ink-500", "#5f452c", "Tinta apagada"],
  ["--wood-900", "#201808", "Madera 900"],
  ["--wood-800", "#2c1a12", "Madera 800"],
  ["--wood-700", "#4b2b1f", "Marco"],
  ["--gold", "#d8b25a", "Dorado (pestaña activa)"],
  ["--gold-hi", "#f0cf7e", "Dorado claro"],
  ["--gold-lo", "#a8802e", "Dorado oscuro"],
  ["--bookmark", "#a32a1f", "Marcapáginas"],
  ["--research", "#f29500", "Investigación"],
  ["--star", "#eaa62e", "Estrellas"],
  ["--gem", "#00d7e2", "Gemas de rango"],
  ["--weak", "#ba613e", "Punto débil"],
  ["--select", "#57d34a", "Selección"],
  ["--link", "#6e3210", "Enlace"],
  ["--ok", "#1f5a1c", "OK"],
  ["--no", "#8a2616", "Error"],
  ["--warn", "#6e4600", "Aviso"],
];

const ASSETS = [
  "parchment.webp",
  "parchment-dark.webp",
  "wood.webp",
  "corner.png",
  "divider.png",
  "header-frame.png",
  "tab.png",
  "tab-active.png",
  "ribbon.png",
  "star.svg",
  "star-empty.svg",
  "crown-mini.svg",
  "crown-silver.svg",
  "crown-gold.svg",
  "gem.svg",
  "gem-active.svg",
  "fest-spring.png",
  "fest-summer.png",
  "fest-autumn.png",
  "fest-winter.png",
  "fest-appreciation.png",
];
const ANIMS = ["anim/page-turn.webm", "anim/crown-shine.webm", "anim/fest-seal.webm"];

function Asset({ file }: { file: string }) {
  const [missing, setMissing] = useState(false);
  const isVideo = file.endsWith(".webm");
  return (
    <figure className="ds-asset">
      <div className={`ds-asset__box ${file.startsWith("wood") || file.includes("tab") || file.includes("header") ? "ds-asset__box--dark" : ""}`}>
        {missing ? (
          <span className="ds-asset__missing">falta</span>
        ) : isVideo ? (
          <video src={`/ui/${file}`} autoPlay loop muted playsInline onError={() => setMissing(true)} />
        ) : (
          <img src={`/ui/${file}`} alt={file} onError={() => setMissing(true)} loading="lazy" />
        )}
      </div>
      <figcaption>{file}</figcaption>
    </figure>
  );
}

const TABS = [
  { id: "eco", label: "Ecología" },
  { id: "fis", label: "Fisiología" },
  { id: "rec", label: "Recompensas" },
];
const RANKS = [
  { id: "low", label: "Rango bajo" },
  { id: "high", label: "Rango alto" },
  { id: "master", label: "Rango maestro" },
];

export default function DesignSystem() {
  const [tab, setTab] = useState("eco");
  const [simple, setSimple] = useState("a");
  const [rank, setRank] = useState("high");
  return (
    <div className="ds">
      <h1 className="page-title">Libro del cazador · guía de estilo</h1>
      <p className="lead">
        Sistema de diseño de la guía: marco de madera, páginas de pergamino, cabeceras ornamentadas, estrellas, barras de investigación y gemas de
        rango. Todo sale de los tokens de <code>theme.css</code>.
      </p>

      <Section title="Colores">
        <div className="ds-swatches">
          {SWATCHES.map(([v, hex, name]) => (
            <div key={v} className="ds-swatch">
              <span className="ds-swatch__chip" style={{ background: `var(${v})` }} />
              <span>
                <strong>{name}</strong>
                <br />
                <code>{v}</code> {hex}
              </span>
            </div>
          ))}
        </div>
        <p className="small muted">
          Contraste AA: tinta sobre pergamino 8,1:1, tinta 2 6,4:1, tinta apagada 5,1:1, enlace 5,7:1; texto claro sobre madera 13:1, dorado sobre madera 8,7:1.
        </p>
      </Section>

      <Section title="Tipografía">
        <div className="ds-type">
          <p style={{ fontFamily: "var(--font-display)", fontSize: "var(--fs-2xl)", margin: 0 }}>Cinzel 34 · Rathalos</p>
          <p style={{ fontFamily: "var(--font-display)", fontSize: "var(--fs-xl)", margin: 0 }}>Cinzel 26 · Hábitats y elementos</p>
          <p style={{ fontFamily: "var(--font-display)", fontSize: "var(--fs-lg)", margin: 0 }}>Cinzel 20 · Cabecera de sección</p>
          <p style={{ fontFamily: "var(--font-read)", fontSize: "var(--fs-md)", margin: "8px 0 0" }}>
            Noto Serif 17 · Texto de lectura sobre el pergamino: descripciones, consejos y notas del cazador.
          </p>
          <p style={{ fontFamily: "var(--font-read)", fontSize: "var(--fs-base)", margin: 0 }}>
            Noto Serif 15 · Cuerpo base. Wyvern volador que domina el cielo del Bosque Antiguo.
          </p>
          <p style={{ fontFamily: "var(--font-data)", fontSize: "var(--fs-sm)", margin: 0 }}>Inter 13 · Datos densos: 28,5 % · Rango alto · ×3</p>
          <p style={{ fontFamily: "var(--font-data)", fontSize: "var(--fs-xs)", margin: 0 }} className="muted">
            Inter 12 · Pie de tabla y metadatos
          </p>
        </div>
      </Section>

      <Section title="Libro: dos páginas con lomo">
        <BookTabs tabs={TABS} value={tab} onChange={setTab} />
        <Book>
          <Page title="Ecología">
            <p>
              Pestaña activa: <strong>{TABS.find((t) => t.id === tab)?.label}</strong>. Prueba las teclas <KeyCap>Q</KeyCap> y <KeyCap>E</KeyCap>.
            </p>
            <ResearchBar level={7} />
            <p style={{ marginTop: 16 }}>
              Tamaño: <Crown kind="mini" /> <Crown kind="silver" /> <Crown kind="gold" />
            </p>
          </Page>
          <Page title="Fisiología">
            <p>
              Debilidad al corte <Stars n={3} /> · impacto <Stars n={2} /> · disparo <Stars n={1} />
            </p>
            <RankSelector ranks={RANKS} value={rank} onChange={setRank} />
          </Page>
        </Book>
        <p className="small muted">En pantallas de menos de 900 px las dos páginas se apilan en una columna.</p>
      </Section>

      <Section title="Componentes">
        <div className="ds-grid">
          <Parchment>
            <h3 className="sub" style={{ marginTop: 0 }}>OrnateHeader</h3>
            <OrnateHeader>Hábitats</OrnateHeader>
            <OrnateHeader aside={<span>aside</span>} as="h3">
              Con acción
            </OrnateHeader>
          </Parchment>
          <Parchment tone="aged">
            <h3 className="sub" style={{ marginTop: 0 }}>Parchment (aged)</h3>
            <p>Tarjeta de pergamino envejecido con sombra de papel.</p>
          </Parchment>
          <Parchment tone="dark">
            <h3 className="sub" style={{ marginTop: 0 }}>Parchment (dark)</h3>
            <p>Tarjeta sobre madera, texto claro.</p>
          </Parchment>
          <Parchment>
            <h3 className="sub" style={{ marginTop: 0 }}>Tabs (sin teclas)</h3>
            <Tabs
              tabs={[
                { id: "a", label: "Grandes", count: 64 },
                { id: "b", label: "Pequeños" },
              ]}
              value={simple}
              onChange={setSimple}
            />
          </Parchment>
          <Parchment>
            <h3 className="sub" style={{ marginTop: 0 }}>Stars n/max</h3>
            <Stars n={0} /> <Stars n={1} /> <Stars n={2} /> <Stars n={3} /> <Stars n={4} max={5} size={22} />
          </Parchment>
          <Parchment>
            <h3 className="sub" style={{ marginTop: 0 }}>Crown</h3>
            <Crown kind="mini" size={32} /> <Crown kind="silver" size={32} /> <Crown kind="gold" size={32} />
          </Parchment>
          <Parchment>
            <h3 className="sub" style={{ marginTop: 0 }}>ResearchBar / ProgressBar</h3>
            <ResearchBar level={3} />
            <ResearchBar level={10} />
            <ProgressBar label="Logros" done={42} total={90} />
          </Parchment>
          <Parchment>
            <h3 className="sub" style={{ marginTop: 0 }}>KeyCap y Gem</h3>
            <KeyCap>Q</KeyCap> <KeyCap>E</KeyCap> <KeyCap>A</KeyCap> <KeyCap>D</KeyCap> <Gem /> <Gem active />
          </Parchment>
          <Parchment>
            <h3 className="sub" style={{ marginTop: 0 }}>Botones, chips, insignias</h3>
            <p style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <button className="btn">Botón</button>
              <button className="btn btn--ghost">Ghost</button>
              <button className="chip chip--on">Chip activo</button>
              <button className="chip">Chip</button>
              <span className="badge badge--lr">RB</span>
              <span className="badge badge--hr">RA</span>
              <span className="badge badge--mr">RM</span>
            </p>
          </Parchment>
        </div>
      </Section>

      <Section title="Espacios, radios y sombras">
        <div className="ds-spacing">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
            <span key={n} className="ds-spacing__bar" style={{ width: `var(--sp-${n})` }}>
              {n}
            </span>
          ))}
        </div>
        <div className="ds-grid" style={{ marginTop: 12 }}>
          <div className="ds-box" style={{ borderRadius: "var(--radius-sm)", boxShadow: "var(--shadow-paper)" }}>radio-sm · sombra papel</div>
          <div className="ds-box" style={{ borderRadius: "var(--radius)", boxShadow: "var(--shadow-paper)" }}>radio · sombra papel</div>
          <div className="ds-box" style={{ borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-paper)" }}>radio-lg · sombra papel</div>
        </div>
      </Section>

      <Section title="Recursos /ui">
        <div className="ds-assets">
          {ASSETS.concat(ANIMS).map((f) => (
            <Asset key={f} file={f} />
          ))}
        </div>
      </Section>
    </div>
  );
}
