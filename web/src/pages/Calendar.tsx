import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { sendJson, useApi } from "../api";
import {
  addDays,
  CalEntry,
  entryTheme,
  FEST_ICON,
  Festival,
  fmtDay,
  lastDay,
  MONTHS,
  SiegeRotation,
  useFest,
  utcDate,
  WEEKDAYS,
  ymd,
} from "../calendar";
import { ErrorBox, Loading, Section } from "../components/ui";

type CalResp = { start: string; end: string; entries: CalEntry[]; siege_rotation: SiegeRotation | null; festivals: Festival[] };

const KIND_LABEL: Record<string, string> = {
  festival: "Festival",
  siege: "Asedio",
  event: "Evento",
  custom: "Recordatorio",
};
const KIND_ORDER: Record<string, number> = { festival: 0, siege: 1, event: 2, custom: 3 };

function gridStart(year: number, month: number): Date {
  const first = new Date(Date.UTC(year, month, 1));
  const dow = (first.getUTCDay() + 6) % 7; // Monday = 0
  return addDays(first, -dow);
}

function covers(e: CalEntry, day: string): boolean {
  return e.start_at.slice(0, 10) <= day && lastDay(e) >= day;
}

function Chip({ e, day, weekStart }: { e: CalEntry; day: string; weekStart: boolean }) {
  const start = e.start_at.slice(0, 10) === day;
  const end = lastDay(e) === day;
  const label = start || weekStart;
  const cls = [
    "chip",
    `chip--${entryTheme(e)}`,
    start ? "chip--start" : "",
    end ? "chip--end" : "",
    e.estimated ? "chip--est" : "",
  ].join(" ");
  return (
    <div className={cls} aria-hidden>
      {label ? (
        <>
          <span aria-hidden>{FEST_ICON[entryTheme(e)] ?? "●"}</span> {e.title_es}
        </>
      ) : (
        <span className="chip__cont" aria-hidden>
          &nbsp;
        </span>
      )}
    </div>
  );
}

function dayLabel(d: string, list: CalEntry[]): string {
  const dt = utcDate(d);
  const head = `${dt.getUTCDate()} de ${MONTHS[dt.getUTCMonth()].toLowerCase()}`;
  if (!list.length) return `${head}: sin eventos`;
  return `${head}: ${list.map((e) => `${e.title_es}${e.estimated ? " (estimado)" : ""}`).join(", ")}, ${list.length} ${list.length === 1 ? "evento" : "eventos"}`;
}

function PeriodForm({ festivals, onSaved }: { festivals: Festival[]; onSaved: () => void }) {
  const today = ymd(new Date());
  const [kind, setKind] = useState<CalEntry["kind"]>("festival");
  const [fest, setFest] = useState(festivals[0]?.slug ?? "");
  const [title, setTitle] = useState("");
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(ymd(addDays(new Date(), 13)));
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setErr(undefined);
    setBusy(true);
    try {
      await sendJson("POST", "/calendar/periods", {
        kind,
        festival_slug: kind === "festival" ? fest : null,
        title: kind === "festival" ? null : title,
        start_at: `${start}T00:00:00Z`,
        end_at: `${ymd(addDays(utcDate(end), 1))}T00:00:00Z`,
        notes: notes || null,
      });
      setNotes("");
      setTitle("");
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="calform" onSubmit={submit}>
      <label>
        Tipo
        <select value={kind} onChange={(e) => setKind(e.target.value as CalEntry["kind"])}>
          <option value="festival">Festival</option>
          <option value="event">Evento</option>
          <option value="custom">Recordatorio</option>
        </select>
      </label>
      {kind === "festival" ? (
        <label>
          Festival
          <select value={fest} onChange={(e) => setFest(e.target.value)}>
            {festivals.map((f) => (
              <option key={f.slug} value={f.slug}>
                {FEST_ICON[f.theme]} {f.name_es} ({f.astera_en} / {f.seliana_en})
              </option>
            ))}
          </select>
        </label>
      ) : (
        <label>
          Título
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej.: The Evening Star (Alatreon)" />
        </label>
      )}
      <div className="calform__row">
        <label>
          Desde
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} required />
        </label>
        <label>
          Hasta (incluido)
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} required />
        </label>
      </div>
      <label>
        Notas
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
      </label>
      {err && <p className="no small">{err}</p>}
      <button className="btn" type="submit" disabled={busy}>
        {busy ? "Guardando…" : "Añadir al calendario"}
      </button>
      <p className="muted small">
        Copia las fechas del tablón de avisos del juego. Los bloques cambian a las 00:00 UTC (19:00 en Colombia, el día anterior).
      </p>
    </form>
  );
}

function SiegeForm({ value, onSaved }: { value: SiegeRotation | null; onSaved: () => void }) {
  const [date, setDate] = useState(value ? value.anchor_at.slice(0, 10) : ymd(new Date()));
  const [siege, setSiege] = useState<"safi" | "kulve">(value?.anchor_siege ?? "safi");
  const [err, setErr] = useState<string>();
  const save = async (ev: FormEvent) => {
    ev.preventDefault();
    setErr(undefined);
    try {
      await sendJson("PUT", "/calendar/siege-rotation", { anchor_at: `${date}T00:00:00Z`, anchor_siege: siege, period_days: 14 });
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const clear = async () => {
    await sendJson("DELETE", "/calendar/siege-rotation");
    onSaved();
  };
  return (
    <form className="calform" onSubmit={save}>
      <p className="small">
        Los asedios se alternan cada dos semanas: Safi'jiiva, y luego Kulve Taroth con «The Eternal Gold Rush». Dime cuál está activo
        en el juego y desde qué día, y el calendario proyecta el resto (las semanas proyectadas salen marcadas como estimadas).
      </p>
      <div className="calform__row">
        <label>
          Asedio activo
          <select value={siege} onChange={(e) => setSiege(e.target.value as "safi" | "kulve")}>
            <option value="safi">Safi'jiiva</option>
            <option value="kulve">Kulve Taroth</option>
          </select>
        </label>
        <label>
          Empezó el
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
      </div>
      {err && <p className="no small">{err}</p>}
      <div className="calform__row">
        <button className="btn" type="submit">
          {value ? "Actualizar rotación" : "Guardar rotación"}
        </button>
        {value && (
          <button className="btn btn--ghost" type="button" onClick={clear}>
            Quitar
          </button>
        )}
      </div>
    </form>
  );
}

function FestivalCard({ f }: { f: Festival }) {
  return (
    <article className={`festcard festcard--${f.theme}`}>
      <header>
        <span className="festcard__icon" aria-hidden>
          {FEST_ICON[f.theme]}
        </span>
        <div>
          <h3>{f.name_es}</h3>
          <p className="muted small">
            Astera: {f.astera_en} · Seliana: {f.seliana_en}
          </p>
        </div>
      </header>
      {f.summary_es && <p className="small">{f.summary_es}</p>}
      <ul className="festcard__list small">
        {f.tickets.map((t) => (
          <li key={t.item_en}>
            {t.item_id ? <Link to={`/objetos/${t.item_id}`}>{t.item_en}</Link> : t.item_en}
            {t.note_es && <span className="muted"> · {t.note_es}</span>}
          </li>
        ))}
      </ul>
      {f.layered.length > 0 && (
        <p className="small">
          Superpuestas:{" "}
          {f.layered.map((l, i) => (
            <span key={l.slug}>
              {i > 0 && ", "}
              <Link to={`/superpuestas/${l.slug}`}>{l.name_es ?? l.slug}</Link>
            </span>
          ))}
        </p>
      )}
    </article>
  );
}

export default function CalendarPage() {
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getUTCFullYear(), m: now.getUTCMonth() });
  const [selected, setSelected] = useState<string>(ymd(now));
  const start = gridStart(ym.y, ym.m);
  const end = addDays(start, 42);
  const { data, error, loading, reload } = useApi<CalResp>(`/calendar?start=${ymd(start)}&end=${ymd(end)}`);
  const fest = useFest();
  const refresh = () => {
    reload();
    fest.reload();
  };

  const days = useMemo(() => Array.from({ length: 42 }, (_, i) => ymd(addDays(start, i))), [start.getTime()]);
  const entries = useMemo(
    () => [...(data?.entries ?? [])].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.start_at.localeCompare(b.start_at)),
    [data],
  );
  const today = ymd(now);
  const gridRef = useRef<HTMLDivElement>(null);
  const focusAfter = useRef(false);
  const inGrid = days.includes(selected);
  const roving = inGrid ? selected : days.find((d) => utcDate(d).getUTCMonth() === ym.m) ?? days[0];
  // after a keyboard move, put focus on the newly selected day once it is rendered
  useEffect(() => {
    if (!focusAfter.current) return;
    focusAfter.current = false;
    gridRef.current?.querySelector<HTMLElement>(`[data-day="${selected}"]`)?.focus();
  }, [selected, ym.m, ym.y]);
  const onGridKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    const cur = utcDate(inGrid ? selected : roving);
    let next: Date | null = null;
    switch (e.key) {
      case "ArrowLeft": next = addDays(cur, -1); break;
      case "ArrowRight": next = addDays(cur, 1); break;
      case "ArrowUp": next = addDays(cur, -7); break;
      case "ArrowDown": next = addDays(cur, 7); break;
      case "Home": next = addDays(cur, -((cur.getUTCDay() + 6) % 7)); break;
      case "End": next = addDays(cur, 6 - ((cur.getUTCDay() + 6) % 7)); break;
      case "PageUp": next = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() - 1, cur.getUTCDate())); break;
      case "PageDown": next = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, cur.getUTCDate())); break;
      default: return;
    }
    e.preventDefault();
    const nd = ymd(next);
    focusAfter.current = true;
    setSelected(nd);
    if (!days.includes(nd) || e.key === "PageUp" || e.key === "PageDown") setYm({ y: next.getUTCFullYear(), m: next.getUTCMonth() });
  };
  const move = (d: number) =>
    setYm(({ y, m }) => {
      const n = new Date(Date.UTC(y, m + d, 1));
      return { y: n.getUTCFullYear(), m: n.getUTCMonth() };
    });
  const dayEntries = entries.filter((e) => covers(e, selected));
  const userPeriods = entries.filter((e) => typeof e.id === "number");

  const remove = async (id: number | string) => {
    await sendJson("DELETE", `/calendar/periods/${id}`);
    refresh();
  };

  return (
    <div className="calwrap">
    <div className="calpage">
      <h1 className="page-title">Calendario de eventos</h1>
      <p className="lead">
        Festivales de Astera y Seliana, asedios y tus recordatorios. Capcom no publica fechas fijas para PC: cuando el tablón de avisos
        del juego anuncie un festival, añádelo aquí y el panel cambiará de tema mientras dure.
      </p>

      <div className="cal">
        <div className="cal__head">
          <button type="button" className="cal__nav" onClick={() => move(-1)} aria-label="Mes anterior">
            <span aria-hidden>◀</span>
          </button>
          <div className="cal__title">
            <span>{MONTHS[ym.m]}</span>
            <small>{ym.y}</small>
          </div>
          <button type="button" className="cal__nav" onClick={() => move(1)} aria-label="Mes siguiente">
            <span aria-hidden>▶</span>
          </button>
          <button
            className="btn btn--ghost cal__today"
            onClick={() => {
              setYm({ y: now.getUTCFullYear(), m: now.getUTCMonth() });
              setSelected(today);
            }}
          >
            Hoy
          </button>
        </div>
        {error && <ErrorBox error={error} onRetry={reload} />}
        <div
          className="cal__grid"
          role="grid"
          aria-label={`Calendario de ${MONTHS[ym.m].toLowerCase()} de ${ym.y}`}
          aria-busy={loading}
          ref={gridRef}
          onKeyDown={onGridKey}
        >
          <div className="cal__row" role="row">
            {WEEKDAYS.map((w) => (
              <div key={w} className="cal__wd" role="columnheader" aria-label={w}>
                <span className="cal__wd-long" aria-hidden>{w}</span>
                <span className="cal__wd-short" aria-hidden>{w.slice(0, 2)}</span>
              </div>
            ))}
          </div>
          {Array.from({ length: 6 }, (_, wk) => (
            <div key={wk} className="cal__row" role="row">
              {days.slice(wk * 7, wk * 7 + 7).map((d, k) => {
                const i = wk * 7 + k;
                const inMonth = utcDate(d).getUTCMonth() === ym.m;
                const list = entries.filter((e) => covers(e, d));
                const main = list.find((e) => e.kind === "festival");
                return (
                  <button
                    key={d}
                    type="button"
                    role="gridcell"
                    data-day={d}
                    tabIndex={d === roving ? 0 : -1}
                    aria-selected={d === selected}
                    aria-current={d === today ? "date" : undefined}
                    className={[
                      "cal__day",
                      inMonth ? "" : "cal__day--out",
                      d === today ? "cal__day--today" : "",
                      d === selected ? "cal__day--sel" : "",
                      main ? `cal__day--${entryTheme(main)}` : "",
                    ].join(" ")}
                    onClick={() => setSelected(d)}
                    aria-label={dayLabel(d, list)}
                  >
                    <span className="cal__num" aria-hidden>{utcDate(d).getUTCDate()}</span>
                    <span className="cal__chips" aria-hidden>
                      {list.slice(0, 3).map((e) => (
                        <Chip key={e.id} e={e} day={d} weekStart={i % 7 === 0} />
                      ))}
                      {list.length > 3 && <span className="chip chip--more">+{list.length - 3}</span>}
                    </span>
                    {list.length > 0 && (
                      <span className="cal__dots" aria-hidden>
                        {list.slice(0, 4).map((e) => (
                          <i key={e.id} className={`cal__dot chip--${entryTheme(e)}${e.estimated ? " cal__dot--est" : ""}`} />
                        ))}
                        <b className="cal__count">{list.length}</b>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="cal__legend small">
          {data?.festivals.map((f) => (
            <span key={f.slug} className={`legend legend--${f.theme}`}>
              {FEST_ICON[f.theme]} {f.name_es}
            </span>
          ))}
          <span className="legend legend--safi">{FEST_ICON.safi} Safi'jiiva</span>
          <span className="legend legend--kulve">{FEST_ICON.kulve} Kulve Taroth</span>
          <span className="legend legend--est">Estimado</span>
        </div>
      </div>

      <div className="cal__side">
        <Section title={`${utcDate(selected).getUTCDate()} de ${MONTHS[utcDate(selected).getUTCMonth()]}`}>
          {loading && !data ? (
            <Loading />
          ) : dayEntries.length === 0 ? (
            <p className="muted">No hay nada registrado este día.</p>
          ) : (
            <ul className="daylist">
              {dayEntries.map((e) => (
                <li key={e.id} className={`daylist__item daylist__item--${entryTheme(e)}`}>
                  <span className="daylist__icon" aria-hidden>
                    {FEST_ICON[entryTheme(e)]}
                  </span>
                  <div>
                    <strong>{e.title_es}</strong>{" "}
                    <span className="badge">{KIND_LABEL[e.kind]}</span> {e.estimated && <span className="badge badge--warn">Estimado</span>}
                    <div className="muted small">
                      {fmtDay(e.start_at)} – {fmtDay(lastDay(e))}
                      {e.festival && ` · ${e.festival.astera_en} / ${e.festival.seliana_en}`}
                    </div>
                    {e.notes && <div className="small">{e.notes}</div>}
                  </div>
                  {typeof e.id === "number" && (
                    <button className="btn btn--ghost btn--sm" onClick={() => remove(e.id)} aria-label={`Quitar ${e.title_es}`}>
                      Quitar
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Añadir periodo">{data && <PeriodForm festivals={data.festivals} onSaved={refresh} />}</Section>

        <Section title="Rotación de asedios">
          {data && <SiegeForm key={data.siege_rotation?.anchor_at ?? "none"} value={data.siege_rotation} onSaved={refresh} />}
        </Section>

        {userPeriods.length > 0 && (
          <Section title="Tus periodos en esta vista">
            <ul className="daylist">
              {userPeriods.map((e) => (
                <li key={e.id} className={`daylist__item daylist__item--${entryTheme(e)}`}>
                  <span className="daylist__icon" aria-hidden>
                    {FEST_ICON[entryTheme(e)]}
                  </span>
                  <div>
                    <strong>{e.title_es}</strong>
                    <div className="muted small">
                      {fmtDay(e.start_at)} – {fmtDay(lastDay(e))}
                    </div>
                  </div>
                  <button className="btn btn--ghost btn--sm" onClick={() => remove(e.id)} aria-label={`Quitar ${e.title_es}`}>
                    Quitar
                  </button>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>

      <Section title="Festivales de temporada">
        <p className="muted small">
          Desde diciembre de 2020 vuelven en bloques de dos semanas a lo largo del año; los de Astera y Seliana de la misma estación van a la
          vez. Desde esa actualización, el Elder Melder también fabrica tickets de festival.
        </p>
        <div className="festcards">{data?.festivals.map((f) => <FestivalCard key={f.slug} f={f} />)}</div>
      </Section>
    </div>
    </div>
  );
}
