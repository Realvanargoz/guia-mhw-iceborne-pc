import { Dispatch, SetStateAction, useState } from "react";
import { EntityIcon } from "../../../components/Icon";
import { ErrorBox, OrnateHeader } from "../../../components/ui";
import { LoadoutState, SLOTS, SavedBuild, createSaved, parseImport, savedErrorMessage } from "../../../build";

type Props = {
  saved: SavedBuild[];
  setSaved: Dispatch<SetStateAction<SavedBuild[]>>;
  savedError?: string;
  onRetry: () => void;
  storeErr: string | null;
  busy: boolean;
  guard: (f: () => Promise<void>) => Promise<void>;
  st: LoadoutState;
  gotPieces: number;
  name: string;
  setName: (n: string) => void;
  curId: string | null;
  setCurId: (id: string | null) => void;
  save: () => void;
  loadSaved: (b: SavedBuild) => void;
  onRename: (b: SavedBuild) => void;
  onDelete: (b: SavedBuild) => void;
};

export default function SavedPanel({ saved, setSaved, savedError, onRetry, storeErr, busy, guard, st, gotPieces, name, setName, curId, setCurId, save, loadSaved, onRename, onDelete }: Props) {
  const [ioText, setIoText] = useState("");
  const [ioMsg, setIoMsg] = useState<string | null>(null);
  const exportAll = () => setIoText(JSON.stringify(saved, null, 1));
  const exportCurrent = () => setIoText(JSON.stringify([{ name: name.trim() || "Mi equipo", state: st }], null, 1));
  const doImport = () => {
    let list: SavedBuild[];
    try {
      list = parseImport(ioText);
    } catch (e) {
      setIoMsg((e as Error).message);
      return;
    }
    guard(async () => {
      const made: SavedBuild[] = [];
      try {
        // de la última a la primera, para que el orden del archivo se conserve (la API lista la más nueva primero)
        for (const b of [...list].reverse()) made.unshift(await createSaved(b.name, b.state));
        setIoMsg(`Importadas ${made.length} composiciones.`);
        setIoText("");
      } catch (e) {
        setIoMsg(`Importadas ${made.length} de ${list.length}. ${savedErrorMessage(e)}`);
      } finally {
        if (made.length) setSaved((cur) => [...made, ...cur]);
      }
    });
  };

  return (
      <section className="bd-card bd-store">
        <OrnateHeader as="h2" className="ohead--sm">
          Mis composiciones
        </OrnateHeader>
        {savedError && <ErrorBox error={savedError} onRetry={onRetry} />}
        {storeErr && <p className="bd-msg bd-msg--warn" role="alert">{storeErr}</p>}
        <div className="bd-store__save">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre de la composición" aria-label="Nombre de la composición" maxLength={60} />
          <button className="bd-btn" onClick={save} disabled={busy || (!gotPieces && !st.charm)}>
            {curId ? "Guardar cambios" : "Guardar como nueva"}
          </button>
          {curId && (
            <button className="bd-btn bd-btn--ghost" onClick={() => { setCurId(null); }}>
              Desvincular
            </button>
          )}
        </div>
        {saved.length === 0 ? (
          <p className="bv-hint">Todavía no has guardado ninguna composición. Se guardan en tu equipo, en la base de datos local de la aplicación.</p>
        ) : (
          <ul className="bd-saved">
            {saved.map((b) => (
              <li key={b.id} className={b.id === curId ? "on" : ""}>
                <div className="bd-saved__ic">
                  {SLOTS.map((s) => (b.state.pieces?.[s] ? <EntityIcon key={s} type="armor" sub={s} rarity={b.state.pieces[s]!.rarity} size="xs" /> : <span key={s} className="bd-saved__e" />))}
                </div>
                <span className="bd-saved__n">{b.name}</span>
                <small>{new Date(b.updated).toLocaleDateString("es-ES")}</small>
                <button className="bd-btn bd-btn--s" onClick={() => loadSaved(b)}>
                  Cargar
                </button>
                <button className="bd-btn bd-btn--s bd-btn--ghost" onClick={() => onRename(b)}>
                  Renombrar
                </button>
                <button className="bd-btn bd-btn--s bd-btn--ghost" onClick={() => onDelete(b)}>
                  Borrar
                </button>
              </li>
            ))}
          </ul>
        )}
        <details className="bd-io">
          <summary>Exportar / importar (JSON)</summary>
          <div className="bd-io__btns">
            <button className="bd-btn bd-btn--s" onClick={exportCurrent}>
              Exportar el equipo actual
            </button>
            <button className="bd-btn bd-btn--s" onClick={exportAll} disabled={!saved.length}>
              Exportar todas
            </button>
            <button className="bd-btn bd-btn--s" onClick={doImport} disabled={!ioText.trim()}>
              Importar el texto
            </button>
          </div>
          <textarea value={ioText} onChange={(e) => { setIoText(e.target.value); setIoMsg(null); }} rows={6} maxLength={500000} placeholder="Pega aquí un JSON exportado para importarlo, o pulsa Exportar para copiarlo." aria-label="JSON de composiciones" />
          {ioMsg && <p className="bv-hint" role="status">{ioMsg}</p>}
        </details>
      </section>
  );
}
