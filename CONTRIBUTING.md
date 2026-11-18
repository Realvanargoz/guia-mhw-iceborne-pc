# Cómo contribuir

Gracias por querer ayudar. Este proyecto es una guía gratuita y no oficial de *Monster Hunter: World + Iceborne* para PC. Al participar aceptas el [Código de conducta](CODE_OF_CONDUCT.md), y tus aportaciones se publican bajo la licencia [MIT](LICENSE).

## Preparar el entorno

Requisitos: Windows 10/11 (el lanzador, el empaquetado y la detección de Steam son solo para Windows), Python 3.14, Node 22 y, opcionalmente, Inno Setup 6.

```powershell
pwsh scripts/dev.ps1          # crea .venv, compila la web, genera el catálogo y arranca en http://127.0.0.1:8765
```

Para trabajar solo con las pruebas:

```powershell
pip install -r api/requirements.txt -r api/requirements-dev.txt -r etl/requirements.txt
cd etl; python -m mhw_etl all --out ../build/catalog.db; cd ..
pytest tests
```

La web se desarrolla en `web/` (`npm ci`, `npm run build`).

## Partes que solo funcionan en Windows

El lanzador (`api/app/launcher.py`, `winutil.py`), `scripts/*.ps1`, el instalador y la detección de Steam usan el registro y las API de Windows. Las pruebas y el ETL también se ejecutan en Linux (es lo que hace la integración continua), pero cualquier cambio en esas partes debe probarse en Windows.

## Estilo de código

- **Python:** 4 espacios, tipos donde aporten claridad, sin dependencias nuevas si no son necesarias.
- **TypeScript/React:** 2 espacios.
- Textos de la interfaz y documentación en **español**; nombres de código en inglés.
- Mantén los cambios pequeños y centrados. Si cambias comportamiento, añade o ajusta pruebas.

## Mensajes de commit

Una línea de resumen en imperativo (por ejemplo, «Corrige el filtro de rango en el bestiario»), y si hace falta una línea en blanco y una explicación del porqué. Referencia la incidencia con `#123` cuando exista.

## Historial de cambios

Si el cambio afecta a quien usa la aplicación, añade una línea en `CHANGELOG.txt` bajo la sección de la versión en curso (`## x.y.z`, una línea `- ...` por mejora). El instalador la muestra como «Novedades».

## Lo que NUNCA debe entrar en un commit

- **Recursos del juego**: iconos, imágenes, texturas, `.tex`, `chunk*.bin` ni nada extraído del juego (son de Capcom). Tampoco WorldChunkTool compilado ni la biblioteca Oodle.
- **Partidas de Steam**, `user.db` (ni `-wal`/`-shm`) ni copias de seguridad.
- **Datos personales**: rutas de tu equipo, nombre de usuario de Windows, identificadores de cuenta, claves, tokens o archivos `.env`.
- Carpetas generadas: `data/`, `build/`, `dist/`, `node_modules/`, `.venv/`.

Revisa `git status` y el diff antes de subir.

## Datos y fuentes

Los datos de `research/` llevan `sources[]` con sus fuentes y deben cumplir el esquema de `research/schemas/`. Resume con tus palabras; no copies textos de otras webs.

## Pull requests

1. Haz un fork y una rama por cambio.
2. Ejecuta `pytest tests` (y `npm run build` si tocas `web/`).
3. Rellena la plantilla del pull request.

## Seguridad

No abras una incidencia pública para vulnerabilidades. Sigue las instrucciones de [SECURITY.md](SECURITY.md).
