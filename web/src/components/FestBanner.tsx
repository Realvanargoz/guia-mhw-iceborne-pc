import { Link } from "react-router-dom";
import { CalEntry, daysLeft, entryTheme, FEST_ICON, fmtDay, lastDay, progressPct, useFest, utcDate, WEEKDAYS, ymd, addDays } from "../calendar";

function left(e: CalEntry) {
  const n = daysLeft(e);
  return n <= 1 ? "termina hoy" : `quedan ${n} días`;
}

/** Small pill in the top bar while a festival is active. */
export function FestPill() {
  const { data } = useFest();
  const f = data?.festival;
  if (!f) return null;
  return (
    <Link to="/calendario" className={`festpill festpill--${entryTheme(f)}`} title={`${f.title_es}: ${left(f)}`} aria-label={`${f.title_es}: ${left(f)}`}>
      <span aria-hidden>{FEST_ICON[entryTheme(f)]}</span>
      <span className="festpill__text">{f.title_es}</span>
    </Link>
  );
}

function WeekStrip({ entries }: { entries: CalEntry[] }) {
  const today = new Date();
  const days = Array.from({ length: 14 }, (_, i) => ymd(addDays(today, i)));
  return (
    <div className="weekstrip" role="group" aria-label="Próximos 14 días">
      {days.map((d, i) => {
        const on = entries.filter((e) => e.start_at.slice(0, 10) <= d && lastDay(e) >= d);
        const dt = utcDate(d);
        return (
          <div key={d} className={`weekstrip__day ${i === 0 ? "weekstrip__day--today" : ""}`}>
            <span className="weekstrip__wd">{WEEKDAYS[(dt.getUTCDay() + 6) % 7].slice(0, 2)}</span>
            <span className="weekstrip__num">{dt.getUTCDate()}</span>
            <span className="weekstrip__bars">
              {on.slice(0, 3).map((e) => (
                <span key={e.id} className={`weekstrip__bar chip--${entryTheme(e)} ${e.estimated ? "chip--est" : ""}`} title={e.title_es}>
                  <span className="sr-only">{e.title_es}{e.estimated ? " (estimado)" : ""}</span>
                </span>
              ))}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Dashboard block: active festival (themed hero), active siege, what comes next and a 2-week strip. */
export function FestBanner() {
  const { data } = useFest();
  if (!data) return null;
  const f = data.festival;
  const others = data.active.filter((e) => e !== f && e.id !== f?.id);
  const all = [...data.active, ...data.upcoming];

  return (
    <div className="festwrap">
    <section className={`festbanner ${f ? `festbanner--${entryTheme(f)}` : "festbanner--none"}`} aria-label="Festival y próximos eventos">
      <div className="festbanner__main">
        {f ? (
          <>
            <p className="festbanner__kicker">
              <span aria-hidden>{FEST_ICON[entryTheme(f)]}</span> ¡Estamos en festival!
            </p>
            <h2 className="festbanner__title">{f.title_es}</h2>
            {f.festival && (
              <p className="festbanner__sub">
                Astera: {f.festival.astera_en} · Seliana: {f.festival.seliana_en}
              </p>
            )}
            <div className="festbanner__time">
              <span>
                {fmtDay(f.start_at)} – {fmtDay(lastDay(f))} · {left(f)}
              </span>
              <span className="festbanner__track" aria-hidden>
                <span style={{ width: `${progressPct(f)}%` }} />
              </span>
            </div>
            {f.festival && f.festival.tickets.length > 0 && (
              <p className="festbanner__tickets small">
                Aprovecha para conseguir:{" "}
                {f.festival.tickets.map((t, i) => (
                  <span key={t.item_en}>
                    {i > 0 && " · "}
                    {t.item_id ? <Link to={`/objetos/${t.item_id}`}>{t.item_en}</Link> : t.item_en}
                  </span>
                ))}
                {f.festival.layered.length > 0 && (
                  <>
                    {" "}
                    → superpuestas{" "}
                    {f.festival.layered.map((l, i) => (
                      <span key={l.slug}>
                        {i > 0 && ", "}
                        <Link to={`/superpuestas/${l.slug}`}>{l.name_es ?? l.slug}</Link>
                      </span>
                    ))}
                  </>
                )}
              </p>
            )}
          </>
        ) : (
          <>
            <p className="festbanner__kicker">Calendario de eventos</p>
            <h2 className="festbanner__title">Ningún festival registrado ahora</h2>
            <p className="festbanner__sub">
              Cuando el tablón de avisos del juego anuncie un festival, añádelo al calendario: el panel cambiará de tema y te avisará de
              cuántos días quedan.
            </p>
          </>
        )}
        <div className="festbanner__actions">
          <Link to="/calendario" className="btn">
            Abrir calendario
          </Link>
        </div>
      </div>

      <div className="festbanner__side">
        {others.length > 0 && (
          <div>
            <h3 className="festbanner__h">Activo ahora</h3>
            <ul className="festbanner__list">
              {others.map((e) => (
                <li key={e.id}>
                  <span aria-hidden>{FEST_ICON[entryTheme(e)]}</span> {e.title_es}
                  <span className="muted small"> · {left(e)}{e.estimated ? " (estimado)" : ""}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {data.upcoming.length > 0 && (
          <div>
            <h3 className="festbanner__h">Próximamente</h3>
            <ul className="festbanner__list">
              {data.upcoming.slice(0, 3).map((e) => (
                <li key={e.id}>
                  <span aria-hidden>{FEST_ICON[entryTheme(e)]}</span> {e.title_es}
                  <span className="muted small">
                    {" "}
                    · desde el {fmtDay(e.start_at)}
                    {e.estimated ? " (estimado)" : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {!data.siege_rotation && (
          <p className="muted small">
            Configura la rotación de asedios en el <Link to="/calendario">calendario</Link> para ver cuándo toca Safi'jiiva o Kulve Taroth.
          </p>
        )}
        <WeekStrip entries={all} />
      </div>
    </section>
    </div>
  );
}
