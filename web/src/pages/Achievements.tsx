/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useApi } from "../api";
import {
  Check,
  ELink,
  Empty,
  ErrorBox,
  Loading,
  Name,
  ProgressBar,
  ReviewNote,
  Section,
  Sources,
  Steps,
} from "../components/ui";
import { ACH_CATEGORY } from "../labels";
import { usePageTitle } from "../usePageTitle";

type Prog = { current: number | null; target: number; unit: string; pct: number | null; note?: string; needs_review?: boolean };

function useAchProgress(): Record<string, Prog> {
  const { data } = useApi<any>("/profile/achievement-progress");
  return data?.progress ?? {};
}

function AchProgress({ p, done }: { p?: Prog; done: boolean }) {
  if (!p || p.current == null) return null;
  const cur = done ? Math.max(p.current, p.target) : p.current;
  const pct = done ? 100 : p.pct ?? 0;
  const left = Math.max(0, p.target - cur);
  const f = (n: number) => n.toLocaleString("es");
  return (
    <span className="ach__prog" title={p.note ?? undefined}>
      <span className="ach__track">
        <span className="ach__fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="small">
        {done ? "Completado" : `${f(Math.min(cur, p.target))} / ${f(p.target)} ${p.unit} · ${pct}% · faltan ${f(left)}`}
        {p.needs_review && !done ? " (objetivo estimado)" : ""}
      </span>
    </span>
  );
}

export function AchievementList() {
  const prog = useAchProgress();
  const { data, error, loading } = useApi<any[]>("/achievements");
  const [hideDone, setHideDone] = useState(false);
  const [doneMap, setDoneMap] = useState<Record<string, boolean>>({});
  const rows = useMemo(
    () => (data ?? []).map((a) => ({ ...a, done: doneMap[a.slug] ?? a.done })),
    [data, doneMap],
  );
  const done = rows.filter((r) => r.done).length;
  return (
    <div>
      <h1 className="page-title">Logros de Steam</h1>
      {rows.length > 0 && <ProgressBar done={done} total={rows.length} label="Completados" />}
      <div className="toolbar">
        <label className="check">
          <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} />
          <span>Ocultar completados</span>
        </label>
      </div>
      {loading && <Loading />}
      {error && <ErrorBox error={error} />}
      {!loading && !rows.length && <Empty>Todavía no se ha cargado la investigación de logros.</Empty>}
      <ul className="ach-list">
        {rows
          .filter((a) => !hideDone || !a.done)
          .map((a) => (
            <li key={a.slug} className={a.done ? "ach ach--done" : "ach"}>
              <Check
                type="achievement"
                id={a.slug}
                done={a.done}
                label=""
                onChange={(v) => setDoneMap((m) => ({ ...m, [a.slug]: v }))}
              />
              <Link to={`/logros/${a.slug}`} className="ach__body">
                <Name es={a.name_es} en={a.name_en} />
                <span className="muted small">{a.description_es || a.description_en}</span>
                <AchProgress p={prog[String(a.sort_order)]} done={a.done} />
              </Link>
              <span className="ach__meta">
                {a.category && <span className="badge">{ACH_CATEGORY[a.category] ?? a.category}</span>}
                {a.hidden && <span className="badge">Oculto</span>}
                {a.needs_review && <span className="badge badge--warn">Revisar</span>}
              </span>
            </li>
          ))}
      </ul>
    </div>
  );
}

export function AchievementPage() {
  const { slug } = useParams();
  const { data: a, error, loading } = useApi<any>(`/achievements/${slug}`);
  const prog = useAchProgress();
  usePageTitle(a ? a.name_es || a.name_en : null);
  if (loading && !a) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!a) return null;
  return (
    <article>
      <header className="ehead">
        <Name as="h1" es={a.name_es} en={a.name_en} />
        <div className="ehead__meta">
          {a.category && <span className="badge">{ACH_CATEGORY[a.category] ?? a.category}</span>}
          {a.hidden && <span className="badge">Oculto</span>}
        </div>
        <div className="ehead__checks">
          <Check type="achievement" id={a.slug} done={a.done} label="Completado" />
        </div>
      </header>
      <p className="lead">
        {a.description_es || a.description_en}
        {a.description_es && a.description_en && <span className="name__en"> {a.description_en}</span>}
      </p>
      <AchProgress p={prog[String(a.sort_order)]} done={!!a.done} />
      {prog[String(a.sort_order)]?.note && <p className="muted small">{prog[String(a.sort_order)].note}</p>}
      <ReviewNote show={a.needs_review} />
      <Section title="Cómo conseguirlo">
        <p>{a.guide_es}</p>
        <Steps steps={a.steps_es} />
      </Section>
      {a.related?.length > 0 && (
        <Section title="Relacionado">
          <ul className="inline-list">
            {a.related.map((r: any, i: number) => (
              <li key={i}>
                {r.id ? <ELink type={r.type} id={r.id} en={r.name_en} /> : <span>{r.name_en}</span>}
                {r.note_es && <span className="muted small"> · {r.note_es}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Sources sources={a.sources} />
    </article>
  );
}
