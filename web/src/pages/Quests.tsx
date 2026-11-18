/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useApi } from "../api";
import { ELink, Empty, ErrorBox, Loading, Name, Pct, ProgressBar, RankBadge, Section } from "../components/ui";
import { LAYERED_CATEGORY, QUEST_CATEGORY, RANK_LABEL } from "../labels";
import { Guides } from "./Monsters";
import { QuestsProfile, ReadHint } from "../profileData";
import { usePageTitle } from "../usePageTitle";
import "../stats.css";

const PARTIAL = ["event", "challenge"];
const PARTIAL_NOTE =
  "Las misiones de evento y desafío no se pueden deducir bien de la partida y el catálogo solo las lista en parte: este porcentaje es orientativo.";

/** Misiones completadas: las leídas de la partida si hay detalle por misión; si no, las marcadas a mano. */
function useCleared() {
  const qp = useApi<QuestsProfile>("/profile/quests");
  const manual = useApi<{ entity_type: string; entity_id: string; done: boolean }[]>("/progress");
  const q = qp.data && !qp.data.empty ? qp.data : null;
  const fromSave = !!q?.per_quest_available;
  const set = useMemo(() => {
    if (fromSave) return new Set<number>(q!.cleared);
    return new Set<number>((manual.data ?? []).filter((r) => r.entity_type === "quest" && r.done).map((r) => Number(r.entity_id)));
  }, [fromSave, q, manual.data]);
  return { q, fromSave, set, loading: qp.loading };
}

export function QuestList() {
  const [category, setCategory] = useState("event");
  const [rank, setRank] = useState<string | null>(null);
  const [status, setStatus] = useState<"all" | "done" | "todo">("all");
  const { data, error, loading } = useApi<any[]>(`/quests?category=${category}${rank ? `&rank=${rank}` : ""}`);
  const { q, fromSave, set, loading: pl } = useCleared();
  const block = q?.by_category?.[category];
  const rb = rank && block ? block.by_rank?.[rank] : null;
  const rows = (data ?? []).filter((x) => status === "all" || (status === "done") === set.has(x.id));
  return (
    <div>
      <h1 className="page-title">Misiones</h1>
      <div className="chips">
        {Object.entries(QUEST_CATEGORY).map(([k, l]) => (
          <button key={k} className={k === category ? "chip chip--on" : "chip"} onClick={() => setCategory(k)}>
            {l}
          </button>
        ))}
      </div>
      <div className="chips">
        {[null, "LR", "HR", "MR"].map((r) => (
          <button key={String(r)} className={rank === r ? "chip chip--on" : "chip"} onClick={() => setRank(r)}>
            {r ? RANK_LABEL[r] : "Todos los rangos"}
          </button>
        ))}
      </div>
      <div className="chips" role="group" aria-label="Filtrar por estado">
        {(
          [
            ["all", "Todas"],
            ["done", "Completadas"],
            ["todo", "Pendientes"],
          ] as const
        ).map(([k, l]) => (
          <button key={k} className={status === k ? "chip chip--on" : "chip"} aria-pressed={status === k} onClick={() => setStatus(k)}>
            {l}
          </button>
        ))}
      </div>
      {q && fromSave && block ? (
        <div className="st-summary" role="status">
          <span>
            {QUEST_CATEGORY[category]}: <b>{block.cleared}</b> de {block.total} completadas ({block.percent} %)
            {rb ? (
              <>
                {" "}
                · {RANK_LABEL[rank!]}: <b>{rb.cleared}</b> de {rb.total}
              </>
            ) : null}
          </span>
          <ProgressBar done={rb ? rb.cleared : block.cleared} total={rb ? rb.total : block.total} />
          <span className="muted small">
            {Object.entries(block.by_rank)
              .map(([r, v]) => `${RANK_LABEL[r]} ${v.cleared}/${v.total}`)
              .join(" · ")}
          </span>
          {PARTIAL.includes(category) && <span className="st-note">{PARTIAL_NOTE}</span>}
          <span className="muted small">
            Total en la guía: {q.cleared_count} de {q.catalog_total} ({q.percent} %).
          </span>
        </div>
      ) : (
        !pl && (
          <ReadHint text="Aún no se ha leído qué misiones has completado (se muestran solo las que marcaste a mano). Pulsa Actualizar perfil para leer este dato." />
        )
      )}
      {loading && <Loading />}
      {error && <ErrorBox error={error} />}
      <ul className="rows">
        {rows.map((q) => (
          <li key={q.id}>
            {set.has(q.id) ? <span className="st-done">Completada</span> : null}
            <RankBadge rank={q.rank} />
            <span className="badge">{q.stars}★</span>
            <ELink type="quest" id={q.id} es={q.name_es} en={q.name_en} />
            <span className="muted small">{q.location_es || q.location_en}</span>
            {q.pc_available === false && <span className="badge badge--no">No en PC</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function QuestPage() {
  const { id } = useParams();
  const { data: q, error, loading } = useApi<any>(`/quests/${id}`);
  const cl = useCleared();
  usePageTitle(q ? q.name_es || q.name_en : null);
  if (loading && !q) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!q) return null;
  const groups = q.rewards.reduce((acc: Record<string, any[]>, r: any) => {
    (acc[r.group ?? "A"] ??= []).push(r);
    return acc;
  }, {});
  const pcEvent = q.events.find((e: any) => e.platform === "pc");
  return (
    <article>
      <header className="ehead">
        <Name as="h1" es={q.name_es} en={q.name_en} />
        <div className="ehead__meta">
          <RankBadge rank={q.rank} />
          <span className="badge">{q.stars}★</span>
          <span className="badge">{QUEST_CATEGORY[q.category] ?? q.category}</span>
          {q.location_id && <ELink type="location" id={q.location_id} es={q.location_es} en={q.location_en} />}
          {q.zenny && <span className="badge">{q.zenny} z</span>}
          {cl.set.has(q.id) && <span className="st-done">{cl.fromSave ? "Completada (según tu partida)" : "Completada (marcada a mano)"}</span>}
        </div>
        {cl.fromSave && !cl.set.has(q.id) && PARTIAL.includes(q.category) && <p className="st-note">{PARTIAL_NOTE}</p>}
      </header>
      {q.pc_notes_es && <div className="callout">{q.pc_notes_es}</div>}
      {(q.objective_es || q.objective_en) && (
        <p className="lead">
          <b>Objetivo:</b> {q.objective_es || q.objective_en}
        </p>
      )}
      {(q.description_es || q.description_en) && <p className="muted">{q.description_es || q.description_en}</p>}
      {pcEvent && (
        <div className="callout">
          <b>Evento en PC.</b> Requisito: {pcEvent.requirements ?? "—"}. {pcEvent.description_en}
        </div>
      )}
      <Section title="Monstruos">
        <ul className="inline-list">
          {q.monsters.map((m: any) => (
            <li key={m.id}>
              <ELink type="monster" id={m.id} es={m.name_es} en={m.name_en} />
              {m.quantity > 1 && <span className="muted"> ×{m.quantity}</span>}
              {m.is_objective && <span className="badge">Objetivo</span>}
            </li>
          ))}
        </ul>
      </Section>
      {q.layered.length > 0 && (
        <Section title="Desbloquea superpuestas">
          <ul className="inline-list">
            {q.layered.map((l: any) => (
              <li key={l.slug}>
                <ELink type="layered" id={l.slug} es={l.name_es} en={l.name_en} />{" "}
                <span className="muted small">{LAYERED_CATEGORY[l.category]}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section title="Recompensas">
        <div className="rewards">
          {Object.entries(groups).map(([g, rows]: [string, any]) => (
            <div key={g} className="rewards__group">
              <h3>Grupo {g}</h3>
              <ul>
                {rows.map((r: any, i: number) => (
                  <li key={i}>
                    <ELink type="item" id={r.item_id} es={r.name_es} en={r.name_en} />
                    <span className="rewards__nums">
                      {r.stack > 1 && <span className="muted">×{r.stack}</span>}
                      <Pct value={r.percentage} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>
      <Guides guides={q.guides} />
    </article>
  );
}

export function EventList() {
  const { data, error, loading } = useApi<any[]>("/events?platform=pc");
  const [filter, setFilter] = useState("");
  const rows = (data ?? []).filter((e) => !filter || e.name_en.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div>
      <h1 className="page-title">Misiones de evento (PC)</h1>
      <p className="lead small">
        Listado de misiones de evento y desafío de PC según mhw-db. Las fechas son del último ciclo registrado. Las
        superpuestas y tickets que da cada evento están en su ficha.
      </p>
      <input className="filter" placeholder="Filtrar…" aria-label="Filtrar…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      {loading && <Loading />}
      {error && <ErrorBox error={error} />}
      <ul className="events">
        {rows.map((e) => (
          <li key={e.id} className="event">
            <div className="event__head">
              {e.quest_id ? (
                <Link to={`/misiones/${e.quest_id}`} className="name__es">
                  {e.quest_es || e.name_en}
                </Link>
              ) : (
                <span className="name__es">{e.name_en}</span>
              )}
              <span className="badge">{e.master_rank ? "RM" : "RA"}</span>
              {e.quest_rank && <span className="badge">{e.quest_rank}★</span>}
              <span className="badge">{e.type}</span>
              {e.location_id && <span className="muted small">{e.location_es || e.location_en}</span>}
            </div>
            <p className="small">{e.description_en}</p>
            <p className="muted small">
              {e.requirements} · {e.success_conditions}
            </p>
          </li>
        ))}
      </ul>
      {!loading && data && !rows.length && filter.trim() && <Empty>Sin resultados para «{filter.trim()}»</Empty>}
    </div>
  );
}
