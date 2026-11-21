# Preguntas abiertas: reglas de build de supervivencia en solitario

Todas las fuentes citadas están registradas en el notebook de investigación.
Mientras no se respondan, el motor (`api/app/builds.py`) usa el valor por defecto indicado, y `research/builds/solo_rules.json` lo marca con `needs_review`.
Para aplicar una respuesta, edita `solo_rules.json` y pulsa `POST /api/builds/rebuild`.

1. **Pesos relativos.** ¿Coinciden con lo que recomiendan las guías los pesos Bonus salud 10, Intervalo de evasión 7, Protección divina 6, Recuperación rápida 4, Bonus defensa 4, Bonus curación 3 y Distancia de evasión 2? *Por defecto:* esos valores.
2. **Aturdimiento de Rathalos, Kushala Daora y Kulu-Ya-Ku.** Solo Fextralife lo indica en su ficha. ¿Hay una segunda fuente, o el aturdimiento sale simplemente de recibir varios golpes seguidos? *Por defecto:* se añade `stun` con peso 5.
3. **Elemento de Safi'jiiva.** Fextralife dice fuego/fuegoplaga y MHWorldData no tiene datos. ¿Lo confirma otra fuente, o es dracónico? *Por defecto:* fuego.
4. **Blastscourge de Brachydios Furioso.** ¿Anti nitro 3 la evita, o solo evita la nitroplaga normal? Fextralife propone el manto ignífugo «si no tienes Anti nitro 3». *Por defecto:* Anti nitro con peso 7.
5. **Dificultad de las joyas.** Ahora se deduce de la rareza: en rango alto, la rareza 7 es «rara» y la 8 «difícil»; en rango maestro, la 11 es «rara» y la 12 «difícil». ¿Cuadra con las tablas de geodas (gastados, distorsionados y sellados)? *Por defecto:* esos umbrales.
6. **Mezcla de piezas en los bonus de set.** ¿Las piezas de rango alto y de rango maestro que comparten bonus (por ejemplo, Teostra α y Teostra α+, ambas con «Técnica de Teostra») suman juntas? *Por defecto:* sí, porque en MHWorldData comparten `bonus_id`.
7. **Filtro de progreso.** El orden se basa en las actualizaciones gratuitas (TU1 Rajang, TU2 Zinogre Estigio y Safi'jiiva, TU3 Rajang Furioso y Brachydios Furioso, 13.50 Kulve Taroth MR, TU4 Alatreon y Barioth Colmillo Helado, TU5 Fatalis). Los sets γ+ y los de evento de rareza 12 sin monstruo se tratan como TU5. ¿Hay una lista mejor de cuándo se puede fabricar cada set de evento? *Por defecto:* ese orden.
8. **Anti rugidos parcial.** ¿Cuánto vale Anti rugidos 1-4 contra un rugido fuerte? El juego solo lo anula a nivel 5. *Por defecto:* curva 0,12 / 0,25 / 0,45 / 0,7 / 1.
9. **Estados de Rise.** Fuego infernal (Hellfire), burbujas y telaraña no existen en MHW: Iceborne. Hay que confirmarlo para cerrar la lista de estados. *Por defecto:* no hay reglas para ellos.

## Perfiles por objetivo (recoleccion y botin)
- `gathering_rules.json` y `loot_rules.json` son perfiles de pesos para `GET /api/builds/goal/{recoleccion|botin}` (mismo motor que `/monster/{id}`, sin monstruo ni elementos). Los pesos son prioridades relativas decididas a partir de las semillas de `research/loot`; no son números del juego.
- Solo puntúan habilidades de equipo. El Manto de bandido, el Plunderblade, las bebidas calientes (Arrecife Escarchado) y las habilidades de cantina (Felyne Harvester, Lucky Cat, Felyne Carver Hi) no entran en la recomendación de armadura.
- Good Luck / Great Luck: se puntúan ambas aunque no se sabe si se acumulan.
- El Arma y el estilo de juego no cuentan (igual que en los perfiles de monstruo).

## Reglas y plantillas del planificador (`planner_rules.json`)
- `planner_rules.json` define arquetipos por tipo de arma (daño físico, elemental, estados, fiolas de impacto del Hacha de carga, disparos de Lanza pistola, munición, bloqueo, supervivencia) y estilos de juego (bloqueo, esquiva, aprendiendo, multijugador). Alimenta `GET /api/builds/plan/rules` y `GET /api/builds/plan/template`. Todo está marcado `needs_review`.
- **Pesos y niveles.** Los niveles de cada habilidad por arquetipo son propuestas de diseño, no números del juego. ¿Coinciden con lo que usas? *Por defecto:* los del JSON.
- **Tiers.** En la plantilla de monstruo/objetivo el tier sale del peso del perfil: peso >= 6 primaria, 3 <= peso < 6 secundaria, resto terciaria; las habilidades que vienen de un estado alterado o plaga son al menos secundarias. Es una decisión de diseño a confirmar.
- **Hacha de carga (impacto).** Sigue el vídeo de Dem (https://www.youtube.com/watch?v=ozzSBPNg5aw): Artillery 5, Health Boost 3, Stun Resistance 3, Weakness Exploit 3 y Power Prolonger 3 como primarias; Guard 5 llega del estilo «bloqueo». ¿Es correcto descartar Critical Eye, Critical Boost y Agitator porque el daño de la fiola ignora afinidad y filo? *Por defecto:* sí.
- **Artillery 5.** Requiere el bonus «Zorah Magdaros Essence» (3 piezas) o «Fatalis Legend» (Inheritance). *Por defecto:* ambos.
- **Heavy Artillery en Lanza pistola.** ¿Aplica al fuego de wyvern de la Lanza pistola? *Por defecto:* nivel 2 secundaria.
