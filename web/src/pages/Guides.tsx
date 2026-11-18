/* eslint-disable @typescript-eslint/no-explicit-any */
import { safeHref } from "../safeUrl";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useApi } from "../api";
import { Icon } from "../components/Icon";
import "../builder.css";
import { ELink, Empty, ErrorBox, Loading, ReviewNote, Section, Sources, Steps } from "../components/ui";
import { GUIDE_KIND } from "../labels";
import { VideoList } from "../components/YouTube";
import { GoalBuild } from "../components/GoalBuild";
import { Rules } from "../components/Rules";
import { usePageTitle } from "../usePageTitle";

const KIND_ORDER = ["cooking", "gathering", "loot"];
const KIND_LINK: Record<string, { to: string; label: string }[]> = {
  cooking: [{ to: "/cantina", label: "Abrir la Cantina y su constructor de comida" }],
  gathering: [
    { to: "/cantina?tab=recoleccion", label: "Equipo y reglas de recolección" },
    { to: "/constructor?goal=recoleccion&rank=MR&build=0&cap=full", label: "Equipo de recolección en el Constructor" },
  ],
  loot: [
    { to: "/cantina?tab=recoleccion", label: "Equipo y reglas de botín" },
    { to: "/constructor?goal=botin&rank=MR&build=0&cap=full", label: "Equipo de botín en el Constructor" },
  ],
};

type BeastRow = { id: number; name_es: string | null; name_en: string; has_ranks: string[] };
function HuntGuides() {
  const { data, error } = useApi<BeastRow[]>("/bestiary");
  if (error || !data?.length) return null;
  return (
    <Section title="Guías de caza por monstruo">
      <p className="muted small">
        Para cada monstruo grande: el set y las joyas recomendados para cazarlo en solitario con seguridad. Puedes abrirlo en el{" "}
        <Link to="/constructor">Constructor</Link> y adaptarlo.
      </p>
      <ul className="hguides">
        {data.map((m) => (
          <li key={m.id}>
            <Link to={`/bestiario/${m.id}?tab=equipo`}>
              <Icon kind="monster" id={m.id} size="md" />
              <span>{m.name_es || m.name_en}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function GuideList() {
  const { data, error, loading } = useApi<any[]>("/guides");
  const groups = (data ?? []).reduce((acc: Record<string, any[]>, g) => {
    (acc[g.kind] ??= []).push(g);
    return acc;
  }, {});
  return (
    <div>
      <h1 className="page-title">Guías</h1>
      <HuntGuides />
      {loading && <Loading />}
      {error && <ErrorBox error={error} />}
      {!loading && !data?.length && <Empty>Todavía no se han cargado las guías de investigación.</Empty>}
      {[...KIND_ORDER, ...Object.keys(groups).filter((k) => !KIND_ORDER.includes(k))]
        .filter((k) => groups[k]?.length)
        .map((kind) => (
          <Section key={kind} title={GUIDE_KIND[kind] ?? kind}>
            {KIND_LINK[kind] && (
              <p className="small">
                {KIND_LINK[kind].map((l, i) => (
                  <span key={l.to}>
                    {i > 0 && " · "}
                    <Link to={l.to}>{l.label}</Link>
                  </span>
                ))}
              </p>
            )}
            <ul className="rows">
              {groups[kind].map((g: any) => (
                <li key={g.slug}>
                  <Link to={`/guias/${g.slug}`} className="name__es">
                    {g.title_es}
                  </Link>
                  <span className="muted small">{g.summary_es}</span>
                  {g.video_count > 0 && <span className="badge">{g.video_count} vídeo{g.video_count > 1 ? "s" : ""}</span>}
                  {g.needs_review && <span className="badge badge--warn">Revisar</span>}
                </li>
              ))}
            </ul>
          </Section>
        ))}
    </div>
  );
}

let hooked = false;
function sanitizeGuide(html: string): string {
  if (!hooked) {
    hooked = true;
    DOMPurify.addHook("afterSanitizeAttributes", (node) => {
      if (node instanceof HTMLAnchorElement) {
        const href = safeHref(node.getAttribute("href"));
        if (href) {
          node.setAttribute("href", href);
          node.setAttribute("target", "_blank");
          node.setAttribute("rel", "noopener noreferrer");
        } else if (!node.getAttribute("href")?.startsWith("/")) node.removeAttribute("href");
      }
    });
  }
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ["style", "form", "input", "button", "iframe", "object", "embed", "svg", "math"],
    FORBID_ATTR: ["style", "srcset"],
  });
}

export function GuidePage() {
  const { slug } = useParams();
  const { data: g, error, loading } = useApi<any>(`/guides/${slug}`);
  const html = useMemo(
    () => (g?.body_md_es ? sanitizeGuide(marked.parse(g.body_md_es, { async: false }) as string) : ""),
    [g],
  );
  usePageTitle(g ? g.title_es || g.title_en : null);
  if (loading && !g) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!g) return null;
  return (
    <article>
      <header className="ehead">
        <h1 className="name name--h1">
          <span className="name__es">{g.title_es}</span>
          {g.title_en && <span className="name__en">{g.title_en}</span>}
        </h1>
        <div className="ehead__meta">
          <span className="badge">{GUIDE_KIND[g.kind] ?? g.kind}</span>
        </div>
      </header>
      <ReviewNote show={g.needs_review} />
      <p className="lead">{g.summary_es}</p>
      {g.steps_es?.length > 0 && (
        <Section title="Pasos">
          <Steps steps={g.steps_es} />
        </Section>
      )}
      {html && <div className="prose" dangerouslySetInnerHTML={{ __html: html }} />}
      {g.kind === "cooking" && (
        <p>
          <Link className="bg-btn" to="/cantina">
            Abrir el constructor de comida
          </Link>
        </p>
      )}
      {g.videos?.length > 0 && (
        <Section title="Vídeos">
          <VideoList videos={g.videos} />
        </Section>
      )}
      {(g.kind === "gathering" || g.kind === "loot") && (
        <>
          <Section title={g.kind === "gathering" ? "Equipo recomendado para recolección" : "Equipo recomendado para botín"}>
            <GoalBuild goal={g.kind === "gathering" ? "recoleccion" : "botin"} />
          </Section>
          <Section title={g.kind === "gathering" ? "Reglas de recolección" : "Reglas de botín y partes"}>
            <Rules path={g.kind === "gathering" ? "/gathering-rules" : "/loot-rules"} />
          </Section>
        </>
      )}
      {g.related?.length > 0 && (
        <Section title="Relacionado">
          <ul className="inline-list">
            {g.related.map((r: any, i: number) => (
              <li key={i}>
                {r.type === "guide" ? <Link to={`/guias/${r.name_en}`}>{r.name_es || r.name_en}</Link> : r.id ? <ELink type={r.type} id={r.id} en={r.name_en} /> : <span>{r.name_en}</span>}
                {r.note_es && <span className="muted small"> · {r.note_es}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Sources sources={g.sources} />
    </article>
  );
}
