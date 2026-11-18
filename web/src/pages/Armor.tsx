/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useApi } from "../api";
import { EntityIcon } from "../components/Icon";
import { Check, ELink, Empty, ErrorBox, Loading, Name, ProgressBar, Rarity, RankBadge, Section, Tabs } from "../components/ui";
import { ARMOR_TYPE, RANK_LABEL } from "../labels";
import { Guides } from "./Monsters";
import { ArmorProfile, ReadHint } from "../profileData";
import { usePageTitle } from "../usePageTitle";
import "../stats.css";

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");

export function ArmorSetList() {
  const [rank, setRank] = useState("MR");
  const [filter, setFilter] = useState("");
  const [own, setOwn] = useState<"all" | "some" | "complete" | "missing">("all");
  const { data, error, loading } = useApi<any[]>(`/armor-sets?rank=${rank}`);
  const prof = useApi<ArmorProfile>("/profile/armor");
  const ap = prof.data && prof.data.available !== false && !prof.data.empty ? prof.data : null;
  const bySet = useMemo(() => new Map((ap?.sets ?? []).map((x) => [x.id, x])), [ap]);
  const rows = useMemo(
    () =>
      (data ?? [])
        .filter((s) => !filter || norm(`${s.name_es ?? ""} ${s.name_en}`).includes(norm(filter)))
        .filter((s) => {
          if (!ap || own === "all") return true;
          const o = bySet.get(s.id)?.pieces_owned ?? 0;
          const complete = !!bySet.get(s.id)?.complete || !!s.done;
          if (own === "some") return o > 0;
          if (own === "complete") return complete;
          return !complete;
        }),
    [data, filter, own, ap, bySet],
  );
  const done = (data ?? []).filter((s) => s.done).length;
  const rs = ap?.by_rank?.[rank];
  return (
    <div>
      <h1 className="page-title">Sets de armadura</h1>
      <p className="muted">
        Las armaduras superpuestas (solo apariencia) están en <Link to="/superpuestas">Superpuestas</Link>.
      </p>
      <div className="toolbar">
        <Tabs tabs={["LR", "HR", "MR"].map((r) => ({ id: r, label: RANK_LABEL[r] }))} value={rank} onChange={setRank} />
        <input className="filter" placeholder="Filtrar…" aria-label="Filtrar…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <span className="muted small">
          {done}/{data?.length ?? 0} marcados
        </span>
      </div>
      {ap && rs ? (
        <div className="st-summary" role="status">
          <span>
            Armaduras ({RANK_LABEL[rank]}): <b>{rs.pieces_owned} piezas</b> de {rs.pieces_total} ({rs.percent} %) · <b>{rs.sets_complete} sets completos</b> de{" "}
            {rs.sets_total}
          </span>
          <ProgressBar done={rs.pieces_owned} total={rs.pieces_total} />
          <span className="muted small">
            En total: {ap.pieces_owned} piezas ({ap.percent} %) · {ap.sets_complete} sets completos. Cuenta las piezas que hay ahora en tu cofre de equipo; las
            vendidas o fundidas no cuentan. Las casillas «Completo» son tuyas y no se tocan.
          </span>
          <div className="chips" role="group" aria-label="Filtrar por lo que tienes">
            {(
              [
                ["all", "Todos"],
                ["some", "Con piezas"],
                ["complete", "Completos"],
                ["missing", "Me faltan"],
              ] as const
            ).map(([k, l]) => (
              <button key={k} className={own === k ? "chip chip--on" : "chip"} aria-pressed={own === k} onClick={() => setOwn(k)}>
                {l}
              </button>
            ))}
          </div>
        </div>
      ) : (
        !prof.loading && <ReadHint text="Aún no hay armaduras leídas de tu partida. Pulsa Actualizar perfil para leer este dato (siempre es manual)." />
      )}
      {loading && <Loading />}
      {error && <ErrorBox error={error} />}
      <div className="cards">
        {rows.map((s) => (
          <div key={s.id} className={ap ? "card card--own" : "card"}>
            {ap && bySet.get(s.id)?.complete && <span className="st-ribbon">Completo</span>}
            <Link to={`/armaduras/${s.id}`} className="card__link card__link--icon">
              <EntityIcon type="armor_set" rarity={s.rarity} size="lg" />
              <Name es={s.name_es} en={s.name_en} />
              <span className="card__badges">
                <Rarity value={s.rarity} />
                {s.monster_id && <span className="muted small">{s.monster_es || s.monster_en}</span>}
              </span>
            </Link>
            {ap && (
              <div className={bySet.get(s.id) ? "st-own" : "st-own st-own--none"}>
                {bySet.get(s.id) ? (
                  <>
                    <span>
                      Tienes {bySet.get(s.id)!.pieces_owned}/{bySet.get(s.id)!.pieces_total} piezas
                    </span>
                    <ProgressBar done={bySet.get(s.id)!.pieces_owned} total={bySet.get(s.id)!.pieces_total} />
                  </>
                ) : (
                  <span>Sin piezas en tu cofre</span>
                )}
              </div>
            )}
            <div className="card__checks">
              <Check type="armor_set" id={s.id} done={s.done} label="Completo" />
            </div>
          </div>
        ))}
      </div>
      {!loading && data && !rows.length && filter.trim() && <Empty>Sin resultados para «{filter.trim()}»</Empty>}
    </div>
  );
}

function Slots({ p }: { p: any }) {
  const s = [p.slot_1, p.slot_2, p.slot_3].filter((x) => x);
  if (!s.length) return <span className="muted">—</span>;
  return (
    <span className="slots">
      {s.map((n: number, i: number) => (
        <span key={i} className={`slot slot--${n}`} title={`Ranura nivel ${n}`}>
          {n}
        </span>
      ))}
    </span>
  );
}

function Recipe({ recipe }: { recipe: any[] }) {
  return (
    <ul className="recipe">
      {recipe.map((r, i) => (
        <li key={i}>
          <ELink type="item" id={r.item_id} es={r.name_es} en={r.name_en} />
          <span className="muted">×{r.quantity}</span>
        </li>
      ))}
    </ul>
  );
}

function PieceTable({ pieces, owned }: { pieces: any[]; owned?: Set<number> | null }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Pieza</th>
            <th>Defensa</th>
            <th>Ranuras</th>
            <th>Habilidades</th>
            <th>Materiales</th>
          </tr>
        </thead>
        <tbody>
          {pieces.map((p) => (
            <tr key={p.id} className={owned?.has(p.id) ? "st-row--own" : undefined}>
              <td>
                <span className="muted small">{ARMOR_TYPE[p.type]}</span>
                {owned && <span className={owned.has(p.id) ? "st-have" : "st-have st-have--no"}> {owned.has(p.id) ? "La tienes" : "Te falta"}</span>}
                <br />
                <ELink type="armor" id={p.id} es={p.name_es} en={p.name_en} sub={p.type} rarity={p.rarity} iconSize="md" />
              </td>
              <td>
                {p.defense_base}
                <span className="muted small"> → {p.defense_augment_max ?? p.defense_max}</span>
              </td>
              <td>
                <Slots p={p} />
              </td>
              <td>
                {p.skills.map((s: any) => (
                  <div key={s.skill_id}>
                    <ELink type="skill" id={s.skill_id} es={s.name_es} en={s.name_en} />{" "}
                    <span className="muted">Nv{s.level}</span>
                  </div>
                ))}
              </td>
              <td>
                <Recipe recipe={p.recipe} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ArmorSetPage() {
  const { id } = useParams();
  const { data: s, error, loading } = useApi<any>(`/armor-sets/${id}`);
  const prof = useApi<ArmorProfile>("/profile/armor");
  const ap = prof.data && prof.data.available !== false && !prof.data.empty ? prof.data : null;
  const owned = ap ? new Set(ap.owned_piece_ids) : null;
  usePageTitle(s ? s.name_es || s.name_en : null);
  if (loading && !s) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!s) return null;
  return (
    <article>
      <header className="ehead">
        <div className="iconrow iconrow--h1">
          <EntityIcon type="armor_set" rarity={s.pieces?.[0]?.rarity ?? undefined} size="xl" />
          <Name as="h1" es={s.name_es} en={s.name_en} />
        </div>
        <div className="ehead__meta">
          <RankBadge rank={s.rank} />
          {s.monster_id && <ELink type="monster" id={s.monster_id} es={s.monster_es} en={s.monster_en} />}
        </div>
        <div className="ehead__checks">
          <Check type="armor_set" id={s.id} done={s.done} label="Set completo" />
        </div>
      </header>

      <Section title="Materiales totales del set">
        <ul className="totals">
          {s.total_materials.map((t: any) => (
            <li key={t.item_id}>
              <ELink type="item" id={t.item_id} es={t.name_es} en={t.name_en} />
              <b>×{t.quantity}</b>
            </li>
          ))}
        </ul>
        <p className="muted small">Pulsa un material para ver de qué monstruo o punto del mapa sale.</p>
      </Section>

      <Section title="Piezas">
        {owned && (
          <div className="st-summary">
            <span>
              Tienes <b>{s.pieces.filter((p: any) => owned.has(p.id)).length}/{s.pieces.length}</b> piezas en tu cofre
              {s.pieces.length > 0 && s.pieces.every((p: any) => owned.has(p.id)) ? " · set completo" : ""}
            </span>
            <ProgressBar done={s.pieces.filter((p: any) => owned.has(p.id)).length} total={s.pieces.length} />
          </div>
        )}
        {!ap && !prof.loading && <ReadHint text="Aún no se ha leído tu cofre. Pulsa Actualizar perfil para ver qué piezas tienes." />}
        <PieceTable pieces={s.pieces} owned={owned} />
      </Section>

      {s.bonus_id && (
        <Section title="Bonus de set">
          <p>
            <Name es={s.bonus_es} en={s.bonus_en} />
          </p>
          <ul className="rows">
            {s.bonus_ranks.map((b: any) => (
              <li key={b.skill_id}>
                <span className="badge">{b.required} piezas</span>
                <ELink type="skill" id={b.skill_id} es={b.name_es} en={b.name_en} />
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Guides guides={s.guides} />
    </article>
  );
}

export function ArmorPiecePage() {
  const { id } = useParams();
  const { data: p, error, loading } = useApi<any>(`/armor/${id}`);
  const eq = useApi<any>("/profile/equipment");
  const have = eq.data?.available ? (eq.data.armor ?? []).find((a: any) => String(a.id) === String(id)) : null;
  const [brokenImg, setBrokenImg] = useState<{ male?: boolean; female?: boolean }>({});
  usePageTitle(p ? p.name_es || p.name_en : null);
  if (loading && !p) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!p) return null;
  const res = [
    ["Fuego", p.res_fire],
    ["Agua", p.res_water],
    ["Trueno", p.res_thunder],
    ["Hielo", p.res_ice],
    ["Dragón", p.res_dragon],
  ];
  return (
    <article>
      <header className="ehead">
        <div className="iconrow iconrow--h1">
          <EntityIcon type="armor" sub={p.type} rarity={p.rarity} size="xl" />
          <Name as="h1" es={p.name_es} en={p.name_en} />
        </div>
        <div className="ehead__meta">
          <span className="badge">{ARMOR_TYPE[p.type]}</span>
          <RankBadge rank={p.rank} />
          <Rarity value={p.rarity} />
          {p.set && <ELink type="armor_set" id={p.set.id} es={p.set.name_es} en={p.set.name_en} rarity={p.rarity} />}
        </div>
        {eq.data?.available && (
          <p className={have ? "st-have" : "st-have st-have--no"}>
            {have ? `La tienes (x${have.count}) en tu cofre` : "No la tienes ahora mismo en tu cofre"}
          </p>
        )}
      </header>
      <div className="split">
        <div>
          <Section title="Materiales">
            <Recipe recipe={p.recipe} />
          </Section>
          <Section title="Habilidades">
            {p.skills.map((s: any) => (
              <div key={s.skill_id}>
                <ELink type="skill" id={s.skill_id} es={s.name_es} en={s.name_en} /> <span className="muted">Nv{s.level}</span>
              </div>
            ))}
          </Section>
          <Section title="Estadísticas">
            <p>
              Defensa {p.defense_base} → {p.defense_max} (aumentada {p.defense_augment_max ?? "—"}) · Ranuras <Slots p={p} />
            </p>
            <p className="small">
              {res.map(([l, v]) => (
                <span key={String(l)} className="res">
                  {l} {Number(v) > 0 ? `+${v}` : v}
                </span>
              ))}
            </p>
          </Section>
        </div>
        {(p.image_male || p.image_female) && (
          <div className="renders">
            {p.image_male && (
              <img
                src={p.image_male}
                alt="Render masculino"
                loading="lazy"
                style={brokenImg.male ? { display: "none" } : undefined}
                onError={() => setBrokenImg((b) => ({ ...b, male: true }))}
              />
            )}
            {p.image_female && (
              <img
                src={p.image_female}
                alt="Render femenino"
                loading="lazy"
                style={brokenImg.female ? { display: "none" } : undefined}
                onError={() => setBrokenImg((b) => ({ ...b, female: true }))}
              />
            )}
          </div>
        )}
      </div>
    </article>
  );
}
