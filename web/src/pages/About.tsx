import type { ReactNode } from "react";
import { useApi } from "../api";
import { Section } from "../components/ui";
import { safeHref } from "../safeUrl";
import { usePageTitle } from "../usePageTitle";
import "../about.css";

const CONTACT = "info@asesoriatics.com";

type Credit = { name: string; url: string; what: string; license?: string };

const CREDITS: Credit[] = [
  { name: "Dem · canal de YouTube (@Demsito)", url: "https://www.youtube.com/@Demsito", what: "Idea y método del constructor de builds por fases, tomados de su vídeo «DEJA de COPIAR Builds y EMPIEZA a CREARLAS con ESTE Método» (youtube.com/watch?v=ozzSBPNg5aw). Los pasos son suyos; esta guía solo los convierte en una herramienta y no está afiliada a su canal." },
  { name: "MHWorldData (Gathering Hall Studios)", url: "https://github.com/gatheringhallstudios/MHWorldData", what: "Monstruos, objetos, armaduras, armas, misiones y recolección, con traducción al español.", license: "MIT" },
  { name: "mhw-db.com", url: "https://mhw-db.com", what: "Eventos, campamentos e imágenes de armaduras (se cargan desde su servidor cuando hay conexión)." },
  { name: "Kiranico", url: "https://mhworld.kiranico.com", what: "Datos de armaduras superpuestas y objetos, consultados y resumidos." },
  { name: "Fextralife · Monster Hunter World Wiki", url: "https://monsterhunterworld.wiki.fextralife.com", what: "Notas de guía y de armaduras superpuestas." },
  { name: "Monster Hunter Wiki", url: "https://monsterhunterwiki.org", what: "Información de monstruos y mecánicas." },
  { name: "PowerPyx", url: "https://www.powerpyx.com", what: "Guías de logros y de coronas." },
  { name: "mhw.poedb.tw", url: "https://mhw.poedb.tw", what: "Códigos de iconos y de monstruos." },
  { name: "Capcom · calendario oficial de eventos", url: "https://game.capcom.com/world", what: "Disponibilidad de misiones de evento en PC." },
  { name: "Steam", url: "https://store.steampowered.com/app/582010", what: "Textos oficiales de los logros del juego." },
];

const TECH: [string, string][] = [
  ["Python, FastAPI, Starlette, Pydantic, Uvicorn", "PSF · MIT · BSD"],
  ["PyCryptodome, python-multipart", "BSD · Apache-2.0"],
  ["SQLite", "Dominio público"],
  ["React, React Router, marked", "MIT"],
  ["DOMPurify", "MPL-2.0 / Apache-2.0"],
  ["Inter, Cinzel, Noto Serif (tipografías)", "SIL OFL 1.1"],
  ["PyInstaller (cargador del ejecutable)", "GPL-2.0 con excepción para programas empaquetados"],
];

function Ext({ href, children }: { href: string; children: ReactNode }) {
  const h = safeHref(href);
  if (!h) return <>{children}</>;
  return (
    <a href={h} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  );
}

export default function About() {
  usePageTitle("Acerca de");
  const { data } = useApi<{ version?: string }>("/app/info");
  const version = data?.version ?? "—";

  return (
    <article className="about">
      <h1 className="page-title">Acerca de</h1>
      <p className="lead">
        Guía de <em>Monster Hunter: World + Iceborne</em> para PC. Todo funciona en tu equipo, sin conexión a una cuenta ni a un servidor propio.
      </p>

      <ul className="about__badges" aria-label="Resumen">
        <li className="badge">Versión {version}</li>
        <li className="badge">Gratuita</li>
        <li className="badge">Software libre (MIT)</li>
        <li className="badge">Sin publicidad ni telemetría</li>
        <li className="badge">Proyecto no oficial</li>
      </ul>

      <Section title="Gratuita y libre">
        <p>
          Esta aplicación es <strong>gratuita y sin ánimo de lucro</strong>: no se vende, no cobra suscripciones ni compras y no muestra publicidad.
          Si alguien te la ha vendido, no procede del proyecto original.
        </p>
        <p>
          El código y los textos originales del proyecto se publican como <strong>software libre bajo la licencia MIT</strong>: puedes usarlos,
          copiarlos, modificarlos y compartirlos conservando el aviso de copyright y la licencia. Texto completo:{" "}
          <a href="/legal/LICENSE.txt" target="_blank" rel="noreferrer noopener">
            LICENSE
          </a>
          .
        </p>
        <p className="about__note">
          La licencia MIT <strong>no cubre material de terceros</strong>: el contenido de Capcom (nombres, iconos, imágenes), los datos de otras
          fuentes y las librerías y tipografías mantienen sus propias licencias, descritas más abajo.
        </p>
      </Section>

      <Section title="Contenido de Capcom y marcas">
        <p>
          Monster Hunter, Monster Hunter: World, Iceborne, sus personajes, monstruos, nombres, iconos e imágenes son marcas y obras protegidas de{" "}
          <strong>CAPCOM CO., LTD.</strong> © CAPCOM CO., LTD. ALL RIGHTS RESERVED. Steam es una marca de Valve Corporation.
        </p>
        <p>
          Este proyecto es una guía de aficionados: <strong>no está afiliado, patrocinado ni respaldado por Capcom, Valve ni Steam</strong>. Las
          imágenes del juego se usan con fines informativos y no comerciales, como referencia para identificar objetos, monstruos y equipo. La
          aplicación no modifica el juego ni sus archivos y no es una herramienta de trampas ni de mods.
        </p>
        <p>
          Si eres titular de derechos y quieres que se retire o se cambie algún contenido, escribe a{" "}
          <a href={`mailto:${CONTACT}`}>{CONTACT}</a> y se atenderá de inmediato.
        </p>
      </Section>

      <Section title="Créditos y fuentes">
        <p>
          Los nombres y cifras del juego son datos publicados por el propio juego y por la comunidad. Las guías y textos de ayuda son resúmenes
          propios y cada ficha enlaza sus fuentes. Los datos marcados como «por revisar» aún no están contrastados con dos fuentes.
        </p>
        <ul className="about__credits">
          {CREDITS.map((c) => (
            <li key={c.name}>
              <Ext href={c.url}>
                <strong>{c.name}</strong>
              </Ext>
              {c.license && <span className="badge">{c.license}</span>}
              <span className="about__what"> — {c.what}</span>
            </li>
          ))}
          <li>
            <strong>Vídeos de YouTube</strong>
            <span className="about__what"> — pertenecen a sus autores; solo se cargan cuando pulsas «reproducir».</span>
          </li>
        </ul>
      </Section>

      <Section title="Tecnologías de terceros">
        <table className="table about__tech">
          <thead>
            <tr>
              <th scope="col">Componente</th>
              <th scope="col">Licencia</th>
            </tr>
          </thead>
          <tbody>
            {TECH.map(([n, l]) => (
              <tr key={n}>
                <td>{n}</td>
                <td>{l}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          Avisos completos de licencias:{" "}
          <a href="/legal/THIRD_PARTY_NOTICES.txt" target="_blank" rel="noreferrer noopener">
            THIRD_PARTY_NOTICES
          </a>
          .
        </p>
      </Section>

      <Section title="Privacidad">
        <ul className="about__list">
          <li>No hay cuentas, registro, telemetría ni publicidad. Tus datos (progreso, composiciones, calendario) se guardan <strong>solo en tu equipo</strong>.</li>
          <li>
            La partida de Steam se <strong>lee en modo solo lectura</strong>, únicamente cuando pulsas «Actualizar perfil». Nunca se modifica ni se
            envía a ningún sitio.
          </li>
          <li>
            Algunas imágenes (renders de armaduras de mhw-db.com) y los vídeos de YouTube se cargan desde sus servidores cuando tienes conexión y
            los abres; esos servicios pueden ver tu dirección IP según sus propias políticas.
          </li>
        </ul>
      </Section>

      <Section title="Seguridad">
        <p>
          La aplicación se ha diseñado con buenas prácticas de seguridad: solo escucha en tu propio equipo (127.0.0.1), protege cada sesión con un
          token aleatorio, valida las entradas, accede a tu partida y a la carpeta del juego únicamente en lectura, no pide permisos de
          administrador y no instala servicios, tareas ni arranque automático.
        </p>
        <p>
          Ha pasado revisiones internas de seguridad (revisión de código, pruebas con entradas maliciosas, comprobación de dependencias y de la
          huella en el sistema) siguiendo criterios de OWASP. Son revisiones propias: <strong>no constituyen una certificación ni una auditoría
          externa</strong>. Si encuentras un fallo, escríbenos a <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
        </p>
      </Section>

      <Section title="Desarrollo con inteligencia artificial">
        <p>
          Esta aplicación se ha desarrollado con la ayuda de <strong>inteligencia artificial</strong> (Claude, de Anthropic) bajo supervisión
          humana: programación, pruebas, revisión de seguridad y organización de la investigación. El código se probó y se revisó, pero la IA
          puede cometer errores: contrasta los datos importantes con el juego.
        </p>
      </Section>

      <Section title="Garantía y responsabilidad">
        <p>
          El software se ofrece «tal cual», sin garantía de ningún tipo. Los autores no se hacen responsables de daños derivados de su uso. Haz
          copia de tus datos si son importantes (están en la carpeta de datos de la aplicación). Úsalo bajo tu responsabilidad.
        </p>
      </Section>

      <Section title="Contacto">
        <p>
          Dudas, errores, sugerencias o solicitudes legales: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
        </p>
        <p className="about__fine">
          Guía MHW Iceborne · PC — versión {version} · © 2026 Proyecto Guía MHW. Licencia MIT para el código y textos originales.
        </p>
      </Section>
    </article>
  );
}
