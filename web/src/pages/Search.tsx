import { Link, useSearchParams } from "react-router-dom";
import { EntityIcon } from "../components/Icon";
import { useApi } from "../api";
import { Empty, ErrorBox, Loading, Name, TypeBadge } from "../components/ui";
import { TYPE_LABEL, entityPath } from "../labels";

type Result = { type: string; id: string; name_es: string | null; name_en: string | null; subtitle: string };

export default function Search() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const type = params.get("tipo");
  const path = q ? `/search?q=${encodeURIComponent(q)}&limit=80${type ? `&type=${type}` : ""}` : null;
  const { data, error, loading } = useApi<{ results: Result[] }>(path);
  const results = data?.results ?? [];
  const types = Array.from(new Set(results.map((r) => r.type)));

  return (
    <div>
      <h1 className="page-title">Resultados para «{q}»</h1>
      <div className="chips">
        <button className={!type ? "chip chip--on" : "chip"} onClick={() => setParams({ q })}>
          Todo
        </button>
        {(type ? [type] : types).map((t) => (
          <button key={t} className={type === t ? "chip chip--on" : "chip"} onClick={() => setParams({ q, tipo: t })}>
            {TYPE_LABEL[t] ?? t}
          </button>
        ))}
      </div>
      {loading && <Loading />}
      {error && <ErrorBox error={error} />}
      {!loading && !error && results.length === 0 && (
        <Empty>Sin resultados. Prueba con el nombre en inglés o con menos palabras.</Empty>
      )}
      <ul className="results">
        {results.map((r) => (
          <li key={`${r.type}-${r.id}`}>
            <Link to={entityPath(r.type, r.id)} className="result">
              <TypeBadge type={r.type} />
              <EntityIcon type={r.type} id={r.id} size="md" />
              <Name es={r.name_es} en={r.name_en} />
              {r.subtitle && <span className="muted result__sub">{r.subtitle}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
