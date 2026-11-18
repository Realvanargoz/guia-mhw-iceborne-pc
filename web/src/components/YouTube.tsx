import { useState } from "react";

export type VideoInfo = {
  youtube_id: string;
  title: string;
  channel?: string;
  lang?: string;
  views?: number;
  likes?: number;
  published?: string;
  low_confidence?: boolean;
  retrieved_at?: string;
  duration_s?: number;
  url?: string;
};

const LANG: Record<string, string> = { es: "Español", en: "Inglés", fr: "Francés", de: "Alemán", pt: "Portugués", ja: "Japonés" };

function fmtN(n?: number) {
  if (n == null) return null;
  return n.toLocaleString("es-ES");
}
function fmtDur(s?: number) {
  if (!s) return null;
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** Tarjeta de vídeo: el iframe (youtube-nocookie) solo se carga al pulsar. */
export function YouTube({ v }: { v: VideoInfo }) {
  const [play, setPlay] = useState(false);
  const [thumbBroken, setThumbBroken] = useState(false);
  const watch = v.url || `https://www.youtube.com/watch?v=${v.youtube_id}`;
  const dur = fmtDur(v.duration_s);
  return (
    <figure className="yt">
      <div className="yt__frame">
        {play ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.youtube_id)}?autoplay=1&rel=0`}
            title={v.title}
            allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : (
          <button type="button" className="yt__thumb" onClick={() => setPlay(true)} aria-label={`Reproducir vídeo: ${v.title}`}>
            {thumbBroken ? (
              <span className="yt__nopreview">Vista previa no disponible sin conexión</span>
            ) : (
              <img
                src={`https://i.ytimg.com/vi/${encodeURIComponent(v.youtube_id)}/hqdefault.jpg`}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
                onError={() => setThumbBroken(true)}
              />
            )}
            <span className="yt__play" aria-hidden>
              ▶
            </span>
            {dur && <span className="yt__dur">{dur}</span>}
          </button>
        )}
      </div>
      <figcaption className="yt__cap">
        <b className="yt__title">{v.title}</b>
        <span className="yt__meta">
          {v.channel && <span>{v.channel}</span>}
          {v.lang && <span className="badge">{LANG[v.lang] ?? v.lang.toUpperCase()}</span>}
          {v.views != null && <span title="Visitas">{fmtN(v.views)} visitas</span>}
          {v.likes != null && <span title="Me gusta">{fmtN(v.likes)} me gusta</span>}
          {v.published && <span title="Fecha de publicación">{v.published}</span>}
        </span>
        {v.low_confidence && (
          <span className="badge badge--warn yt__warn" role="note">
            Vídeo antiguo o de otra versión: puede no coincidir con Iceborne PC
          </span>
        )}
        <span className="yt__links">
          <a href={watch} target="_blank" rel="noreferrer noopener">
            Ver en YouTube
          </a>
          {!play && <span className="muted small"> · el vídeo no se carga hasta que lo pulsas (privacidad)</span>}
        </span>
      </figcaption>
    </figure>
  );
}

export function VideoList({ videos }: { videos?: VideoInfo[] }) {
  if (!videos?.length) return null;
  return (
    <div className="yt-list">
      {videos.map((v) => (
        <YouTube key={v.youtube_id} v={v} />
      ))}
    </div>
  );
}
