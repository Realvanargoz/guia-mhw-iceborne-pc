# Preguntas abiertas sobre el formato de la partida (SAVEDATA1000, Iceborne)

Lo que aparece aquí **no** se entrega como dato: el lector no lo emite, o lo emite sin nombre.
Las posiciones son relativas al inicio de cada espacio de partida y salen de la plantilla `SAVEDATA1000.bt` de EnderHDMC/MHWISaveEditor (commit `31ed450`). El total de esa plantilla cuadra byte a byte con el archivo (2.136.768 bytes por espacio de partida).

| # | Qué falta | Dónde está | Qué sabemos | Qué haría falta para cerrarlo |
|---|---|---|---|---|
| 1 | Nombre de cada región de las Tierras Guía | `guiding_lands.region_level_unlocked[8]` (+216) y `region_levels[8]` (+4, puntos) | Se emiten índice, nivel y puntos. Que el nivel es el de la región está comprobado: los niveles crecen con los puntos y el máximo, 7, cuadra con el logro «Evolving Ecology». | La correspondencia índice→región. Se puede comprobar en el juego viendo qué región está a nivel 2 (índice 3). |
| 2 | Rango del camarada | `guild_card.palico.rank` (+615 desde la tarjeta) | En dos copias con el mismo tiempo de juego salió 49 y luego 29: no es fiable. | Saber qué campo es de verdad. |
| 3 | Superpuestas desbloqueadas | `mhw_progress_flags` (+1756616): la plantilla nombra 272 bits `layered_*` | Los nombres los puso la plantilla; aquí no se han comprobado contra la partida. | Cotejar con la lista de superpuestas que se ven en el juego o con `mhw.layered_armor`. |
| 4 | Observatorio linio | `lynian_observatory.lynian_research_level[40]` | Nueve índices están a nivel 7. No se sabe qué linio corresponde a cada índice. | La tabla índice→linio. |
| 5 | Fauna endémica | `endemic_life.endemic_count[568]` | Hay 59 índices con valor y suman 956; los índices van de 8 en 8. No se sabe qué criatura es cada índice. | La tabla índice→criatura (datos del juego). |
| 6 | Tesoros | No aparecen en la plantilla (está en su lista de pendientes) | Nada. | Investigación nueva. |
| 7 | Tiempos de la Arena | `guild_card.arena_stats[18].records[5].time` | La codificación es desconocida; la plantilla lo marca como TODO. Un récord vacío vale `0xC00000EE`. | Comparar con los tiempos que muestra el juego. |
| 8 | Nombres de las herramientas especiales | `tools[128]` (+1778117) y `tool_unlocks` | Se emiten los índices de herramienta de cada conjunto guardado. No se sabe qué herramienta es cada índice. | La tabla índice→herramienta. |
| 9 | Equipo del camarada | `guild_card.palico.equipment` | Son pares de tipo e id sin tabla de nombres. | Los datos maestros del equipo de camarada. |
| 10 | Opcionales desbloqueadas y vistas | `unlocked_optionals` / `seen_optionals` (+1757607 / +1757735) | Usan el mismo índice que las completadas (`questNoList`). Se sabe que «desbloqueada» no está marcado para la misión 101, aunque está hecha. | Solo se usa el campo de completadas (+1757671), que es el comprobado. |
| 11 | Dos asedios de Safi'jiiva marcados como completados (51604 y 51605) | — | El registro de caza de Safi'jiiva está a 0. Un asedio puede completarse sin abatir al monstruo, pero no se ha comprobado en el juego. | Confirmarlo en el juego. |
| 12 | Nombres de equipo de las últimas actualizaciones | `Data/equipment.json` | Los datos maestros de MHWMasterDataUtils llegan hasta Safi'jiiva; faltan Alatreon, Fatalis y Raging Brachydios. Además, el amuleto con id 199 se llama «Unavailable». | Datos maestros más recientes. |

## Ingredientes de cantina desbloqueados
- El juego recuerda qué ingredientes de cantina están desbloqueados (permanecen para siempre), pero no se ha localizado dónde se guardan en la partida. Por ahora la marca se hace a mano con `PUT /api/progress/ingredient/{id}` (id `ing_*` de `canteen_ingredients`). Si se encuentra el campo, el lector del save podría rellenar `public.progress` con el tipo `ingredient`. El lector no se ha tocado. Mientras tanto `api/app/profile.py::_derived_ingredients` marca los básicos y los desbloqueados por misión completada (47 de 114); entrega, recompensa de investigación y recolección quedan a mano. Pista para localizarlo: comparar dos copias del save antes y después de desbloquear un ingrediente.
