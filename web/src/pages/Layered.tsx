/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import { Link, useParams } from "react-router-dom";
import { useApi } from "../api";
import {
  Check,
  ELink,
  Empty,
  ErrorBox,
  Loading,
  Name,
  PcBadge,
  ReviewNote,
  Section,
  Sources,
  Steps,
} from "../components/ui";
import { ARMOR_TYPE, LAYERED_CATEGORY, OWNER_LABEL } from "../labels";
import { usePageTitle } from "../usePageTitle";

export function LayeredList() {
  const { data, error, loading } = useApi<any[]>("/layered");
  const [cat, setCat] = useState<string | null>(null);
  const [owner, setOwner] = useState<string | null>(null);
  const [pcOnly, setPcOnly] = useState(true);
  const rows = useMemo(
    () =>
      (data ?? []).filter(
        (r) => (!cat || r.category === cat) && (!owner || r.owner === owner) && (!pcOnly || r.pc_available !== false),
      ),
    [data, cat, owner, pcOnly],
  );
  const cats = Array.from(new Set((data ?? []).map((r) => r.category)));
  const done = (data ?? []).filter((r) => r.done).length;

  return (
    <div>
      <h1 className="page-title">Armaduras superpuestas</h1>
      <p className="lead small">
        Las superpuestas solo cambian la apariencia. Una receta no aparece en la Herrería hasta que tienes el material o
        ticket que pide, así que cada ficha indica qué tienes que conseguir primero.
      </p>
      <div className="chips">
        <button className={!cat ? "chip chip--on" : "chip"} onClick={() => setCat(null)}>
          Todas
        </button>
        {cats.map((c) => (
          <button key={c} className={cat === c ? "chip chip--on" : "chip"} onClick={() => setCat(c)}>
            {LAYERED_CATEGORY[c] ?? c}
          </button>
        ))}
      </div>
      <div className="toolbar">
        <div className="chips">
          {[null, "hunter", "palico", "handler"].map((o) => (
            <button key={String(o)} className={owner === o ? "chip chip--on" : "chip"} onClick={() => setOwner(o)}>
              {o ? OWNER_LABEL[o] : "Cualquiera"}
            </button>
          ))}
        </div>
        <label className="check">
          <input type="checkbox" checked={pcOnly} onChange={(e) => setPcOnly(e.target.checked)} />
          <span>Ocultar lo que no existe en PC</span>
        </label>
        <span className="muted small">
          {done}/{data?.length ?? 0} obtenidas
        </span>
      </div>
      {loading && <Loading />}
      {error && <ErrorBox error={error} />}
      {!loading && !data?.length && (
        <Empty>Todavía no se han cargado los datos de investigación de armaduras superpuestas.</Empty>
      )}
      <div className="cards">
        {rows.map((r) => (
          <div key={r.slug} className="card">
            <Link to={`/superpuestas/${r.slug}`} className="card__link">
              <Name es={r.name_es} en={r.name_en} />
              <span className="card__badges">
                <span className="badge">{LAYERED_CATEGORY[r.category] ?? r.category}</span>
                {r.owner !== "hunter" && <span className="badge">{OWNER_LABEL[r.owner]}</span>}
                {r.pc_available === false && <PcBadge value={false} />}
                {r.needs_review && <span className="badge badge--warn">Revisar</span>}
              </span>
            </Link>
            <div className="card__checks">
              <Check type="layered" id={r.slug} done={r.done} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function LayeredPage() {
  const { slug } = useParams();
  const { data: l, error, loading } = useApi<any>(`/layered/${slug}`);
  usePageTitle(l ? l.name_es || l.name_en : null);
  if (loading && !l) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!l) return null;
  return (
    <article>
      <header className="ehead">
        <Name as="h1" es={l.name_es} en={l.name_en} />
        <div className="ehead__meta">
          <span className="badge">{LAYERED_CATEGORY[l.category] ?? l.category}</span>
          <span className="badge">{OWNER_LABEL[l.owner] ?? l.owner}</span>
          <PcBadge value={l.pc_available} />
        </div>
        <div className="ehead__checks">
          <Check type="layered" id={l.slug} done={l.done} />
        </div>
      </header>
      <ReviewNote show={l.needs_review} />
      {l.pc_notes_es && <div className="callout">{l.pc_notes_es}</div>}

      <Section title="Cómo desbloquearla">
        <p className="lead">{l.unlock_es}</p>
        <Steps steps={l.steps_es} />
      </Section>

      {l.quests?.length > 0 && (
        <Section title="Misiones">
          <ul className="rows">
            {l.quests.map((q: any, i: number) => (
              <li key={i}>
                {q.quest_id ? (
                  <ELink type="quest" id={q.quest_id} en={q.name_en} />
                ) : (
                  <span className="name__es">{q.name_en}</span>
                )}
                {q.kind && <span className="badge">{q.kind}</span>}
                {q.note_es && <span className="muted small">{q.note_es}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {l.materials?.length > 0 && (
        <Section title="Materiales">
          <ul className="recipe">
            {l.materials.map((m: any, i: number) => (
              <li key={i}>
                {m.item_id ? <ELink type="item" id={m.item_id} en={m.item_en} /> : <span>{m.item_en}</span>}
                <span className="muted">
                  ×{m.qty}
                  {m.per_piece ? " por pieza" : ""}
                  {m.piece ? ` (${m.piece})` : ""}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {l.pieces?.length > 0 && (
        <Section title="Piezas">
          <ul className="inline-list">
            {l.pieces.map((p: any, i: number) => (
              <li key={i}>
                <Icon kind="ui" name={`armor-${p.type}`} tile size="sm" /> <span className="muted small">{ARMOR_TYPE[p.type] ?? p.type}</span> <Name es={p.name_es} en={p.name_en} />
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Sources sources={l.sources} />
    </article>
  );
}
