# Reglas de build defensiva para cazar en solitario (MHW: Iceborne, PC)

Versión legible de `solo_rules.json`. El motor (`api/app/builds.py`) lee solo el JSON. Todas las fuentes están registradas en el notebook de investigación. Las dudas pendientes están en `open_questions.md`.

## Criterio

El set ideal es el que te deja sobrevivir cazando en solitario, sin depender del arma. Después puedes cambiar piezas y joyas para hacer más daño. Los efectos de cada nivel salen del texto del juego (MHWorldData `skill_levels`) y se contrastan con Monster Hunter Wiki (MHWI) o Fextralife. Por qué importa cada habilidad se justifica con guías (GameWith, Game8 y las fichas de monstruo de Fextralife).

## Prioridades base (cualquier monstruo)

| Habilidad | Peso | Por qué | Fuentes |
|---|---|---|---|
| Bonus salud (máx. 3) | 10 | +15/+30/+50 de vida | juego, MHWiki, GameWith, Game8, Fextralife (Fatalis, Namielle) |
| Intervalo de evasión (máx. 5) | 7 | más fotogramas invulnerables al rodar | juego, Fextralife, MHWiki, GameWith, Fextralife (Brachydios Furioso) |
| Protección divina (3, o 5 con la clave) | 6 | 25 % (40 % a nivel 5) de reducir el daño un 15/30/50/60 % | juego, Fextralife, MHWiki, Fextralife (Fatalis, Velkhana) |
| Recuperación rápida | 4 | la vida roja vuelve ×2/×3/×4 | juego, MHWiki |
| Bonus defensa | 4 | defensa, y +3/+5 a todas las resistencias desde el nivel 4 | juego, MHWiki |
| Bonus curación | 3 | +10/20/30 % de curación | juego, MHWiki |
| Distancia de evasión | 2 | ruedas más lejos | juego, Game8 |
| Anti aturdimiento | 2 (+5 si el monstruo aturde, +2 con rayoplaga) | evita el aturdimiento por golpes seguidos | juego, Kiranico, MHWiki |
| Bonus evasión / Bonus de adrenalina | 1,5 (+2 con hieloplaga / aguaplaga) | aguante | juego, MHWiki, Kiranico |
| Duración de objetos, Bonus esprint, Mejora de balance | 1 / 0,5 / 0,4 | comodidad; Mejora de balance casi no sirve en solitario | juego, MHWiki |
| Arrojo, Regeneración, Superrecuperación (bonus de set) | 4 / 3 / 2 | supervivencia | juego |
| Guardia mejorada, Escudo | 0 | dependen del arma: el evaluador las muestra, pero el recomendador no las puntúa | juego, Game8 |

## Según el monstruo (`monster_ailments` de MHWorldData, más correcciones con fuente)

- **Envenena:** Anti veneno (6). **Paraliza:** Anti parálisis (9). **Duerme:** Anti sueño (9). **Aturde:** Anti aturdimiento (+5). **Sangrado:** Anti sangrado (6). **Nitroplaga:** Anti nitro (7). **Reduce la defensa:** Anti reducción de defensa (5). **Efluvio:** Experto en efluvio (6) y Anti efluvio (2). **Barro:** Anti fango (3). **Aura de calor** (Teostra): Anti calor (4). Fuentes: juego, Kiranico (guía de estados) y fichas de Fextralife.
- **Rugido débil:** Anti rugidos 3 lo anula (peso 4). **Rugido fuerte:** hace falta Anti rugidos 5 (peso 6). **Viento débil/fuerte:** Anti viento 3 o 5 (peso 3 o 5). **Viento extremo** (Kushala Daora): solo el bonus de set Anti ráfagas lo anula del todo. **Temblor leve/fuerte:** Anti temblores 1 o 3. Fuentes: juego, MHWiki, Fextralife (Teostra, Kushala) y GameWith.
- **Plagas elementales.** Con 20 puntos de resistencia a un elemento no sufres su plaga (Fextralife: Elemental Resistances y Status Effects). La puntuación premia la resistencia al elemento del monstruo, entre −15 y 20 (peso 5), y evitar la plaga, ya sea con resistencia ≥20 o con Anti plagas (peso: fuego 5, rayo 5, hielo 4, agua 3, dragón 1,5). Las habilidades Anti fuego, Anti agua, etc. suman +6/+12/+20 de resistencia (y +10 de defensa a nivel 3). Anti plagas 3 anula las cinco plagas elementales, pero no la nitroplaga, el veneno ni el efluvio (Fextralife: Blight Resistance).
- **Correcciones por monstruo:**
  - Rathalos, Kushala y Kulu-Ya-Ku: aturdimiento.
  - Teostra: aura de calor.
  - Brachydios Furioso: nitroplaga y rugido fuerte.
  - Rajang Furioso: rayoplaga, aturdimiento y rugido fuerte.
  - Safi'jiiva: fuegoplaga.
  - Fatalis: Bonus salud y Protección divina reforzadas.
  - Alatreon y Namielle: Bonus salud reforzada.
  - Velkhana: Protección divina reforzada.
- **Sin datos** (MHWorldData vacío: Gran Jagras y Kulu-Ya-Ku): se usan las prioridades genéricas y se avisa en `notes`.
- Fuego infernal, burbujas y telaraña son de Monster Hunter Rise, no de World.

## Rango, rareza y progreso

- **Rango bajo:** rareza 1-4 y ningún adorno, porque los adornos salen de los geodas a partir de rango alto (Fextralife Decorations, GamerGuides Feystones).
- **Rango alto:** rareza 5-8 y joyas de tamaño 1-3.
- **Rango maestro:** rareza 9-12, con joyas de tamaño 4.
- **Modo `progress`** (por defecto): solo piezas y amuletos de rareza ≤ la del set del propio monstruo en ese rango. En rango maestro, además, nada de monstruos de actualizaciones gratuitas posteriores, ni sets γ+ o de evento de rareza 12. Fuentes: MHWiki Iceborne, GameSpot TU4, Siliconera.
- **Modo `full`:** todo el rango.

## Lo que las reglas no pueden saber

- El arma y su estilo: Guardia, munición, elemento del arma y ranuras del arma, si no se indican.
- Mecánicas de templados arcaicos o de evento: daño fijo, Juicio Escatón de Alatreon, fases de asedio.
- La habilidad del jugador.
- Los aumentos (augments) y la personalización de armas.
- Los mantos (manto de vitalidad, ignífugo...), que suelen cubrir lo que no cabe en el set.
- Los amuletos que tienes de verdad: el save actual no los incluye.
