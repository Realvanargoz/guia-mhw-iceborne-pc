import { ChangeEvent, ReactNode, useRef, useState } from "react";
import Dialog from "./Dialog";
import { Icon } from "./Icon";
import { sendJson, uploadFile, useApi } from "../api";
import "../profile.css";

type Slot = {
  slot: number;
  name: string;
  hr: number;
  mr: number;
  zenny: number;
  research_points: number;
  playtime_seconds: number;
  monsters: { hunted: number; captured: number; crown?: { gold?: boolean } }[];
  weapon_usage?: { total?: Record<string, number> };
};
type Profile =
  | { empty: true }
  | {
      empty?: false;
      snapshot: { id: number; taken_at: string; source: string };
      taken_at: string;
      data: {
        slots: Slot[];
        steam_achievements?: { count_total?: number; achievements?: Record<string, { unlocked: boolean }> };
      };
    };
type Status = {
  save_mounted: boolean;
  reader_installed: boolean;
  save_path?: string;
  save_source?: "mount" | "override" | "auto" | null;
  candidates?: number;
};
type SaveCandidates = {
  selected: string | null;
  candidates: { account_id: string; path: string; size: number; mtime: string }[];
};
type HistoryRow = { id: number; taken_at: string; source: string; hr?: string; mr?: string };
type SyncResult = {
  changed: boolean;
  message?: string;
  marked?: { monster_hunted?: number; monster_captured?: number; achievement?: number };
};

const WEAPONS: Record<string, string> = {
  great_sword: "Gran espada", long_sword: "Espada larga", sword_and_shield: "Espada y escudo",
  dual_blades: "Dagas dobles", hammer: "Martillo", hunting_horn: "Cuerno de caza", lance: "Lanza",
  gunlance: "Lanza-pistola", switch_axe: "Hacha espada", charge_blade: "Hacha de carga",
  insect_glaive: "Guja insecto", light_bowgun: "Ballesta ligera", heavy_bowgun: "Ballesta pesada", bow: "Arco",
};
const srcLabel = (s: string) => (s === "steam-local" ? "desde Steam" : s.startsWith("upload") ? "archivo cargado" : s);
const fmtDate = (iso: string) => new Date(iso).toLocaleString("es-ES", { dateStyle: "long", timeStyle: "short" });
const nf = new Intl.NumberFormat("es-ES");

function summarize(r: SyncResult, prev?: string): string {
  if (!r.changed) return `Sin cambios${prev ? ` desde ${fmtDate(prev)}` : ""}. Tu partida no ha cambiado.`;
  const m = r.marked ?? {};
  const parts: string[] = [];
  if (m.monster_hunted) parts.push(`${m.monster_hunted} monstruo(s) cazado(s) nuevo(s)`);
  if (m.monster_captured) parts.push(`${m.monster_captured} capturado(s) nuevo(s)`);
  if (m.achievement) parts.push(`${m.achievement} logro(s) marcado(s)`);
  return `Perfil actualizado${parts.length ? `: ${parts.join(", ")}` : ": sin novedades de progreso que marcar"}.`;
}

export function HunterProfile({ onUpdated }: { onUpdated?: () => void }) {
  const profile = useApi<Profile>("/profile");
  const status = useApi<Status>("/profile/status");
  const [histOpen, setHistOpen] = useState(false);
  const history = useApi<HistoryRow[]>(histOpen ? "/profile/history" : null);
  const [busy, setBusy] = useState<null | "sync" | "upload">(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [slotIdx, setSlotIdx] = useState(0);
  const [confirmAll, setConfirmAll] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const cands = useApi<SaveCandidates>("/profile/save-candidates");
  const [manualPath, setManualPath] = useState("");
  const [pathBusy, setPathBusy] = useState(false);
  const usePath = async (path: string | null) => {
    setPathBusy(true);
    setMsg(null);
    try {
      await sendJson("PUT", "/profile/save-path", { path });
      setMsg({ ok: true, text: path ? "Ruta de la partida guardada." : "Se usará la detección automática." });
      setManualPath("");
      status.reload();
      cands.reload();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setPathBusy(false);
    }
  };
  const refreshAll = () => {
    profile.reload();
    status.reload();
    if (histOpen) history.reload();
    onUpdated?.();
  };
  const prevDate = profile.data && !profile.data.empty ? profile.data.taken_at : undefined;

  const run = async (kind: "sync" | "upload", fn: () => Promise<SyncResult>) => {
    setBusy(kind);
    setMsg(null);
    try {
      const r = await fn();
      setMsg({ ok: true, text: summarize(r, prevDate) });
      refreshAll();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };
  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) run("upload", () => uploadFile<SyncResult>("/profile/upload", f));
  };
  const delOne = async (id: number) => {
    try {
      await sendJson("DELETE", `/profile/history/${id}`);
      refreshAll();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };
  const delAll = async () => {
    try {
      await sendJson("DELETE", "/profile/history");
      setConfirmAll(false);
      refreshAll();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };

  const canSync = !!status.data?.save_mounted && !!status.data?.reader_installed;
  const p = profile.data && !profile.data.empty ? profile.data : null;
  const slots = p ? p.data.slots.filter((s) => s.name || s.hr || s.playtime_seconds) : [];
  const slot = slots[Math.min(slotIdx, slots.length - 1)];

  const stats: [string, ReactNode][] = [];
  if (p && slot) {
    const mons = slot.monsters ?? [];
    const total = mons.length || 71;
    const top = Object.entries(slot.weapon_usage?.total ?? {}).sort((a, b) => b[1] - a[1])[0];
    stats.push(["Monstruos cazados", `${mons.filter((m) => m.hunted > 0).length}/${total}`]);
    stats.push(["Capturados", `${mons.filter((m) => m.captured > 0).length}/${total}`]);
    stats.push([
      "Coronas de oro",
      <span className="iconrow" key="c">
        <Icon kind="ui" name="crown-gold" size="sm" />
        {String(mons.filter((m) => m.crown?.gold).length)}
      </span>,
    ]);
    const ach = p.data.steam_achievements;
    if (ach?.achievements) {
      const un = Object.values(ach.achievements).filter((a) => a.unlocked).length;
      stats.push(["Logros de Steam", `${un}/${ach.count_total ?? 100}`]);
    }
    if (top && top[1] > 0) stats.push([
        "Arma más usada",
        <span className="iconrow" key="w">
          <Icon kind="ui" name={`weapon-${top[0].replace(/_/g, "-")}`} tile size="md" />
          {`${WEAPONS[top[0]] ?? top[0]} (${nf.format(top[1])})`}
        </span>,
      ]);
  }

  return (
    <section className="hprof" id="perfil" aria-labelledby="hprof-title">
      <header className="hprof__head">
        <h2 id="hprof-title">Perfil del cazador</h2>
        {slots.length > 1 && (
          <label className="hprof__slot">
            Ranura
            <select value={slotIdx} onChange={(e) => setSlotIdx(Number(e.target.value))}>
              {slots.map((s, i) => (
                <option key={s.slot} value={i}>
                  {s.slot}: {s.name || "sin nombre"}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>

      {profile.loading && !profile.data ? (
        <p className="hprof__note">Cargando…</p>
      ) : p && slot ? (
        <>
          <div className="hprof__name">{slot.name || "Cazador sin nombre"}</div>
          <dl className="hprof__grid">
            <div><dt>Rango de cazador</dt><dd>RC {slot.hr}</dd></div>
            <div><dt>Rango maestro</dt><dd>RM {slot.mr}</dd></div>
            <div><dt>Zenis</dt><dd>{nf.format(slot.zenny)} z</dd></div>
            <div><dt>Puntos de investigación</dt><dd>{nf.format(slot.research_points)}</dd></div>
            <div>
              <dt>Horas jugadas</dt>
              <dd>
                {(slot.playtime_seconds / 3600).toLocaleString("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} h
              </dd>
            </div>
          </dl>
          <dl className="hprof__grid hprof__grid--stats">
            {stats.map(([k, v]) => (
              <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
            ))}
          </dl>
          <p className="hprof__note">
            Última actualización: {fmtDate(p.taken_at)} ({srcLabel(p.snapshot.source)})
          </p>
        </>
      ) : (
        <p className="hprof__empty">
          Todavía no hay ningún perfil guardado. La guía no lee tu partida por su cuenta: solo lo hace cuando pulsas
          «Actualizar perfil» o «Cargar save».
        </p>
      )}

      <div className="hprof__actions">
        <button
          type="button"
          className="btn"
          onClick={() => run("sync", () => sendJson<SyncResult>("POST", "/profile/sync"))}
          disabled={!canSync || busy !== null}
        >
          {busy === "sync" && <span className="hprof__spin" aria-hidden />}
          {busy === "sync" ? "Leyendo partida…" : "Actualizar perfil"}
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => { setUnderstood(false); setGuideOpen(true); }} disabled={busy !== null}>
          {busy === "upload" && <span className="hprof__spin" aria-hidden />}
          {busy === "upload" ? "Procesando archivo…" : "Cargar save"}
        </button>
        <input ref={fileRef} type="file" hidden onChange={onFile} aria-label="Elegir archivo de partida" />
      </div>


      <Dialog open={guideOpen} onClose={() => setGuideOpen(false)} title="Cargar tu partida" className="hprof-dlg">
          <div className="hprof-modal__box">
            <p className="hprof-modal__warn" role="alert">
              <b>Ten cuidado.</b> Nunca cargues, muevas, renombres ni edites el archivo original de la carpeta de Steam: si
              se daña, puedes perder tu perfil. Trabaja siempre con una <b>copia</b>. La guía solo lee el archivo que le
              das; no puede escribir en tu partida.
            </p>
            <h3>1. Dónde está</h3>
            <p>Archivo <code>SAVEDATA1000</code> (sin extensión), dentro de la carpeta de tu cuenta de Steam:</p>
            <ul>
              <li>
                Windows: <code>C:\Program Files (x86)\Steam\userdata\&lt;TU_ID_DE_STEAM&gt;\582010\remote</code>
              </li>
              <li>
                Linux / Steam Deck: <code>~/.local/share/Steam/userdata/&lt;TU_ID_DE_STEAM&gt;/582010/remote</code>
              </li>
              <li>
                <code>&lt;TU_ID_DE_STEAM&gt;</code> es una carpeta numérica dentro de <code>userdata</code>. Si hay varias, abre la
                que tenga <code>582010</code> (Monster Hunter: World) o la modificada más recientemente.
              </li>
              <li>Si instalaste Steam en otro disco, busca la carpeta <code>userdata</code> allí.</li>
            </ul>
            <h3>2. Haz una copia primero</h3>
            <ol>
              <li>Cierra el juego (o espera a que termine de guardar).</li>
              <li>Copia <code>SAVEDATA1000</code> a otra carpeta, por ejemplo el Escritorio (copiar, no mover).</li>
              <li>En el siguiente paso elige <b>esa copia</b>, no el original.</li>
            </ol>
            <p className="muted small">
              Para mayor seguridad, haz también una copia de la carpeta <code>remote</code> completa antes de empezar.
            </p>
            <label className="hprof-modal__ack">
              <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
              Entiendo: voy a cargar una copia, no el archivo original.
            </label>
            <div className="hprof-modal__btns">
              <button type="button" className="btn btn--ghost" onClick={() => setGuideOpen(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn"
                disabled={!understood}
                onClick={() => {
                  setGuideOpen(false);
                  fileRef.current?.click();
                }}
              >
                Elegir la copia…
              </button>
            </div>
          </div>
      </Dialog>
      <div role="status" aria-live="polite" className={`hprof__msg ${msg ? (msg.ok ? "hprof__msg--ok" : "hprof__msg--err") : ""}`}>
        {msg?.text}
      </div>

      {status.data && !status.data.save_mounted && (
        <div className="hprof__path">
          <p className="hprof__note">
            No se ha encontrado tu partida de Monster Hunter: World. Escribe la ruta completa del archivo{" "}
            <code>SAVEDATA1000</code> (carpeta <code>userdata\&lt;ID&gt;\582010\remote</code> de Steam). Solo se comprueba
            que existe; no se lee ni se modifica.
          </p>
          <div className="hprof__pathrow">
            <label className="hprof__pathlabel">
              Ruta de SAVEDATA1000
              <input
                type="text"
                maxLength={400}
                value={manualPath}
                onChange={(e) => setManualPath(e.target.value)}
                placeholder="C:\Program Files (x86)\Steam\userdata\…\582010\remote\SAVEDATA1000"
                spellCheck={false}
                autoComplete="off"
              />
            </label>
            <button type="button" className="btn" disabled={pathBusy || !manualPath.trim()} onClick={() => usePath(manualPath.trim())}>
              Usar esta ruta
            </button>
          </div>
        </div>
      )}
      {status.data && status.data.save_mounted && (cands.data?.candidates.length ?? 0) > 1 && (
        <div className="hprof__path">
          <label className="hprof__pathlabel">
            Cuenta de Steam con partida
            <select
              value={cands.data?.selected ?? ""}
              disabled={pathBusy}
              onChange={(e) => e.target.value && usePath(e.target.value)}
            >
              {cands.data!.candidates.map((c) => (
                <option key={c.path} value={c.path}>
                  Cuenta {c.account_id} · modificada {fmtDate(c.mtime)} · {nf.format(Math.round(c.size / 1024))} KB
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {status.data && status.data.save_mounted && status.data.save_source === "override" && (
        <p className="hprof__note">
          Usas una ruta indicada a mano.{" "}
          <button type="button" className="btn btn--ghost" disabled={pathBusy} onClick={() => usePath(null)}>
            Volver a la detección automática
          </button>
        </p>
      )}
      {status.data && status.data.save_mounted && !status.data.reader_installed && (
        <p className="hprof__note">«Actualizar perfil» no está disponible: falta el lector de partidas.</p>
      )}
      <p className="hprof__note">
        «Cargar save» sirve si usas la plataforma en línea o sin acceso a la carpeta de partidas. El archivo solo se lee,
        nunca se modifica, y se conserva una única copia.
      </p>

      <details className="hprof__hist" onToggle={(e) => setHistOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary>Historial</summary>
        <p className="hprof__note">
          El historial guarda solo el resultado interpretado (unos pocos KB), no el archivo de la partida.
        </p>
        {history.loading && !history.data ? (
          <p className="hprof__note">Cargando…</p>
        ) : history.data && history.data.length > 0 ? (
          <>
            <ul className="hprof__list">
              {history.data.map((h) => (
                <li key={h.id}>
                  <span>
                    {fmtDate(h.taken_at)} · {srcLabel(h.source)} · RC {h.hr ?? "?"} / RM {h.mr ?? "?"}
                  </span>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => delOne(h.id)}
                    aria-label={`Borrar registro del ${fmtDate(h.taken_at)}`}
                  >
                    Borrar
                  </button>
                </li>
              ))}
            </ul>
            {confirmAll ? (
              <span className="hprof__confirm">
                ¿Seguro?{" "}
                <button type="button" className="btn" onClick={delAll}>Sí, vaciar</button>{" "}
                <button type="button" className="btn btn--ghost" onClick={() => setConfirmAll(false)}>Cancelar</button>
              </span>
            ) : (
              <button type="button" className="btn btn--ghost" onClick={() => setConfirmAll(true)}>
                Vaciar historial
              </button>
            )}
          </>
        ) : (
          <p className="hprof__note">No hay registros.</p>
        )}
      </details>

      <p className="hprof__safe">Tu partida solo se lee desde una copia; el archivo original no se modifica.</p>
    </section>
  );
}
