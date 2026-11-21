# Constructor de builds por fases

> **Créditos.** La idea y el método son de **Dem** ([youtube.com/@Demsito](https://www.youtube.com/@Demsito)), del vídeo [«DEJA de COPIAR Builds y EMPIEZA a CREARLAS con ESTE Método»](https://www.youtube.com/watch?v=ozzSBPNg5aw). Esta guía convierte sus pasos en una herramienta y no está afiliada a su canal. El resumen del método y la transcripción verificada están en [contructos_build.md](contructos_build.md).

La página `/constructor` es un asistente de 7 pasos. Cada paso del método de Dem tiene su pantalla, y un buscador automático hace la parte que el propio Dem dice que es la más lenta: probar combinaciones de armadura, amuleto y joyas.

## Los 7 pasos

| # | Paso del asistente | Paso del método (minuto del vídeo) | Qué hace |
|---|---|---|---|
| 1 | Objetivo | Definir el objetivo (2:03) | Tipo de arma, tipo de daño (arquetipo), estilo de juego, rango, ranuras del arma, modo «Catálogo completo» o «Mis cosas». Se puede partir de una plantilla (monstruo u objetivo general). |
| 2 | Habilidades | Elegir habilidades (3:23) | Lista de habilidades con el nivel que quieres. Avisa si el nivel supera el tope normal y ofrece el bono de set que lo desbloquea. |
| 3 | Bono de set | Activar habilidad de set (5:58) | Opcional. Muestra qué piezas aporta cada bono y cuáles solo sirven para activarlo. |
| 4 | Prioridades | Clasificar por importancia (7:32) | Primarias (no se negocian), secundarias (pueden bajar de nivel) y terciarias (solo si sobra ranura). |
| 5 | Armadura | Buscar piezas (9:29) | «Buscar armadura» devuelve de 3 a 5 bases. Puedes fijar o excluir piezas y recalcular. |
| 6 | Joyas y amuleto | Usar ciguas y joyas (10:52) | Cobertura de cada objetivo por origen (armadura, amuleto, joya, bono), joyas que faltan y compromisos. «Usar esta base» pasa el equipo al editor. |
| 7 | Probar | Probar la build (12:58) | Editor de equipo con cobertura en vivo, registro de pruebas (normales y curtidos, regla de 15-20 minutos) y versiones v1.0, v1.1… con comparación y restauración. |

El paso actual va en la URL (`?paso=objetivo|habilidades|bono|prioridades|armadura|joyas|probar`). Los enlaces antiguos siguen funcionando: `?monster=&rank=&build=&owned=&cap=` y `?goal=recoleccion|botin` abren «Probar» con el equipo cargado, y `?guardado=ID&v=VID` abre un equipo guardado y su versión.

## Interfaz (`web/src/pages/builder/`)

- `index.tsx`: contenedor, navegación de pasos, resumen fijo con la cobertura y atajos Q/E.
- `planState.ts` (reductor y arranque desde la URL), `planApi.ts` (llamadas y catálogos en caché), `coverage.ts` (etiquetas, comparación de versiones, importar/exportar el plan).
- `steps/`: un archivo por paso (`Objetivo`, `Habilidades`, `BonoSet`, `Prioridades`, `Armadura`, `JoyasAmuleto`, `Probar`) más `CoverageChecklist`, `TestLogForm`, `VersionsPanel`.
- `editor/`: el editor manual de siempre (`EditorPage`, `LoadoutEditor`, `EvalPanel`, `SavedPanel`, selectores).
- Estilos: `web/src/planner.css` (prefijo `pl-`).
- El borrador del asistente se guarda en el servidor (no en el navegador, porque el puerto del lanzador puede cambiar). Al entrar sin parámetros aparece «Continuar borrador / Empezar de cero».

## API

| Endpoint | Para qué |
|---|---|
| `POST /api/builds/plan/solve` | Buscador automático. Devuelve hasta 5 resultados con `loadout`, `coverage`, `tradeoffs_es`, `missing`, `deficit` y avisos. |
| `GET /api/builds/plan/rules` | Arquetipos y estilos de juego con los nombres ya resueltos a ids. |
| `GET /api/builds/plan/template` | Convierte una recomendación por monstruo u objetivo, un arquetipo y estilos en una lista de objetivos con prioridad. |
| `GET/PUT/DELETE /api/builds/plan/draft` | Borrador del asistente. |
| `GET/POST /api/builds/saved/{id}/versions`, `PUT`, `POST …/restore`, `DELETE` | Versiones de un equipo guardado. Restaurar crea una versión nueva. Máximo 50 por equipo. |
| `GET /api/skills`, `GET /api/set-bonuses[/{id}]` | Catálogos para los selectores: topes, secretos, qué bono los desbloquea, piezas por bono. |
| `POST /api/builds/evaluate` | Calculadora. Si recibe `targets`, añade `coverage` (sin `targets` la salida no cambia). |

Todas las escrituras exigen la cabecera `X-MHW-Client`, igual que el resto de la API.

## El buscador (`api/app/planner.py`)

1. **Entrada:** rango, tope de progreso, ranuras del arma o arma concreta, objetivos con nivel y prioridad (máximo 20), bono de set opcional, piezas y amuleto fijados, exclusiones, modo (`ideal` o `owned`).
2. **Escenarios de desbloqueo:** si un objetivo supera el tope normal (Artillería 5 con tope 3), prueba los bonos que lo permiten: Esencia Zorah Magdaros (3 piezas), Voluntad de Brachydios (4) o Fatalis Legend (2, «Inheritance»). Máximo 6 escenarios.
3. **Búsqueda:** filtra piezas por rango y rareza, descarta las dominadas, y recorre las cinco piezas por capas con una cota inferior del déficit. Después elige el amuleto (primero los que ahorran más ranuras, como dice el vídeo) y reparte las joyas (voraz, y pulido exacto en los mejores).
4. **Orden:** primero el déficit de primarias, luego el de secundarias y el de terciarias; en empate, menos joyas difíciles, más piezas propias, más ranuras libres y más defensa.
5. **Límites:** un cálculo a la vez (si no, 429), presupuesto de unos 1,5 s, memoria de 64 resultados. Si se recorta, la respuesta lleva `truncated`.

Se verifica contra `/api/builds/evaluate`: cada `loadout` devuelto da las mismas habilidades al evaluarlo.

## Datos y persistencia

- `research/builds/planner_rules.json`: arquetipos por tipo de arma y estilos de juego. **Todos los pesos y niveles son decisiones de diseño marcadas `needs_review`**, salvo el arquetipo `cb_impact`, que sigue el ejemplo del vídeo de Dem. La interfaz muestra «Pendiente de revisión» en cada uno. Las preguntas abiertas están en `research/builds/open_questions.md`.
- `user.db` (versión 2 del esquema): tabla `build_versions`, columnas `plan` y `current_version_id` en `saved_builds`. La migración hace una copia de seguridad antes de cambiar nada y los equipos antiguos siguen funcionando.
- El borrador vive en `user_meta` (clave `planner_draft`).

## Correcciones de datos hechas por el camino

- **Inheritance:** el bono de 2 piezas de Fatalis Legend levanta el tope de nivel de todas las habilidades «clave». Antes se ignoraba y `/evaluate` mostraba niveles menores a los reales (`RULES_VERSION` subió a 2).
- **Amuletos propios:** en modo «Solo mis cosas» el recomendador usa ahora los amuletos de tu partida; antes los ignoraba.

## Ronda de diseño (2026-11-21)

Tras la primera prueba se rehízo la presentación, sin cambiar la lógica del asistente:
- **Contraste:** el texto gris pasó a un tono más oscuro dentro del constructor y todos los avisos tienen fondo opaco (antes eran translúcidos sobre la textura). Se midió en pantalla con una auditoría que calcula el contraste de cada texto contra su fondo (mínimo 4,5:1): cero fallos en los siete pasos, incluidos los números sobre las gemas de ranura de tamaño 3 y 4, que se aclararon.
- **Sin bordes laterales de color:** el menú de pasos usa gemas (la del paso actual brilla en cian y los hechos llevan una marca verde); las prioridades usan coronas con el nombre del nivel; los estados llevan icono y texto.
- **Habilidades:** el nivel se ve como en el Bestiario (barras doradas segmentadas con «3/3»), con la descripción de cada habilidad. Los botones de bono dicen «Usar «X» (sustituye a «Y»)» cuando ya hay uno elegido.
- **Bono de set:** lista en dos columnas; el bono abierto ocupa todo el ancho y los demás bajan. Cada bono cerrado muestra el icono del monstruo y, por cada rango, «N piezas · habilidad — qué hace». Hay una franja con el bono elegido y un botón «Elegir este bono (N piezas)»; elegir ya no depende de un control escondido. Las piezas se ven con icono de parte, ranuras y chips de habilidad.
- **Armadura y Joyas:** las piezas usan la misma ficha (`PieceTile`) que «Probar», con las joyas colocadas; los avisos del buscador van agrupados en un único desplegable.
- **Datos nuevos de apoyo:** `/api/skills` y `/api/set-bonuses` devuelven nombre y descripción con respaldo en inglés (Fatalis Legend ya no sale con «?»), y los bonos se filtran por rango.
- El selector de rango del editor de «Probar» ahora sigue al del plan.

Verificado en Chrome a 1440, 884 y 544 px (sin desbordes; dos columnas hasta ~884 px y una por debajo), con teclado (Intro abre un bono, aro de foco azul de 3 px) y con el recorrido completo.

## Cómo probar la versión 0.1.5 en local (sin publicar)

Paquetes generados el 2026-11-21 con `pwsh scripts/build-windows.ps1 -Version 0.1.5 -OptimizeIcons` en `dist/`. **No están subidos a GitHub ni publicados.** Son un paquete local de prueba.

| Archivo | Tamaño | SHA256 |
|---|---|---|
| `GuiaMHW-0.1.5-portable.zip` | 25,65 MB | `37f539e24c126b271c81403e37d36b92471328643c597f41cdc693119a0db59e` |
| `GuiaMHW-0.1.5-setup.exe` | 20,19 MB | `c64f379a8579a084c93090ae4205ca820bee856f423335f1d2dcebf65f6939f8` |

Reconstruidos el 2026-11-21 con el cargador propio de PyInstaller y los metadatos nuevos (las sumas anteriores ya no valen). Ver [firma-y-antivirus.md](firma-y-antivirus.md).

**Opción A: portable (recomendada para probar).** Descomprime el zip en una carpeta y abre `GuiaMHW.exe`. Como lleva `portable.txt`, guarda sus datos en `data/` junto al ejecutable y **no toca** tu instalación ni tu base de datos. Empieza vacío: pulsa «Actualizar perfil» o «Cargar save» para ver tu inventario real («Mis cosas»).

**Opción B: instalador.** Instalar la 0.1.5 actualiza tu 0.1.4 (mismo identificador) y usa tus datos reales en `%LOCALAPPDATA%\GuiaMHW\user.db`. Al abrirla migra esa base a la **versión 2** del esquema y antes hace una copia de seguridad en `backups/` (se conservan las 3 últimas). **No se puede volver a la 0.1.4 con esa base ya migrada** (la 0.1.4 se niega a abrirla): para volver atrás hay que restaurar la copia de `backups/`.

**Qué se comprobó:**
- `pytest tests -q`: 310 pasan, 2 se omiten.
- Autoprueba del ejecutable empaquetado (`GuiaMHW.exe --smoke`, sin ventana y con datos temporales): versión, servidor, búsqueda, web, iconos y token de sesión correctos.
- Recorrido manual en Chrome con el servidor de desarrollo y una copia de `user.db`: los 7 pasos con el ejemplo de Dem, «Catálogo completo» y «Mis cosas», guardar con plan y versión v1.0, y los enlaces antiguos (`?monster=`, `?goal=`).

**Qué no se comprobó:** el instalador en un PC limpio, el recorrido solo con teclado, el modo de alto contraste y las ventanas estrechas, ni `tools/e2e/navigation-smoke.mjs`.

**Qué mirar al probar:**
1. Objetivo → Hacha cargada → «Hacha de carga: impacto» + estilo Bloqueo → «Reemplazar objetivos con la plantilla» (deben salir 10 habilidades) → Armadura → «Buscar armadura».
2. Que el crédito a Dem y su enlace se vean en el paso Objetivo y en «Acerca de».
3. Que el editor de «Probar» marque el mismo rango que el plan (corregido en la ronda de diseño).
4. Que los avisos «la búsqueda se recortó por tiempo o tamaño» no asusten: son correctos aunque el resultado sea completo.
5. El peso descomprimido es de unos 45,2 MB, justo en el límite de 45 MB que fijamos como objetivo.

## Límites conocidos

- No hay datos de habilidades de arma ni despertares (Safi'jiiva), personalización de Kulve o Kjárr, ni aumentos. El tipo de daño (por ejemplo viales de impacto) lo elige el usuario, porque el catálogo no lo trae.
- Con 15 o más objetivos en rango maestro la búsqueda se recorta y puede perder combinaciones algo mejores.
- Algunos nombres de piezas y joyas de la era Fatalis siguen en inglés (hueco ya conocido de traducciones).
- La importación de equipos de tu partida casa por nombre en inglés y puede no reconocer algún objeto.
- Cargar un equipo desde «Mis composiciones» no carga su plan; solo `?guardado=` y las versiones lo hacen.

## Pruebas

- `pytest tests -q`: incluye `test_planner_solver.py` (el ejemplo del vídeo, contraste con fuerza bruta, 422/403/429), `test_planner_rules.py`, `test_build_versions.py`, `test_userdb_migration_v2.py`, `test_catalog_lists.py`, `test_builds_inheritance.py`, `test_builds_owned_charms.py`, `test_builds_evaluate_golden.py` (12 equipos de referencia) y `test_review_fixes.py`.
- `tools/e2e/navigation-smoke.mjs`: recorrido de punta a punta del asistente (omitible con `E2E_SKIP_PLANNER=1`).
- Revisión interna de código y seguridad hecha antes de cerrar la fase; no es una auditoría externa.
