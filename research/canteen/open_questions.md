# Cantina (Iceborne PC) - preguntas abiertas

Fuentes: Kiranico (v15.11 Iceborne), monsterhunterwiki.org (MHWI/Canteen), Fextralife, Game8, PowerPyx. Todas registradas en el cuaderno `9efbfc77-...`.

## Probabilidades (la mas importante)
1. Solo hay datos cualitativos: media estrella de activacion por ingrediente fresco, 3 estrellas = maximo. No hay porcentajes exactos por estrella ni la base con 0 frescos. MW/Fextralife dicen que 3 estrellas = 100% en todas las habilidades; Game8 dice "al menos 2 garantizadas, muy alta probabilidad de todas". Solo se pueden sacar de los datos del juego (tablas de cocina del ejecutable/archivos); `data/raw/game/ui/kitchen` contiene solo GUI. Hasta entonces, el constructor debe mostrar estrellas, no porcentajes.
2. Cuantos ingredientes frescos salen y cuales (rotan al azar entre quests). No consta si todos los ingredientes pueden ser frescos (`can_be_fresh` = null en todos).

## Mecanica
3. RESUELTA (2026-11-26): cada rama da solo su nivel mas alto y las ramas se mezclan libremente (2+2+2 = tres habilidades x1; 4+2 = x2 + x1). Fuente unica (recetario del usuario + Fandom), se mantiene needs_review.
    Bebidas (recetario del usuario y Fextralife): ocupan un hueco de la comida y bajan un nivel la estadistica; 6 bebidas = sin estadistica.
    Pregunta original: combinacion de varios tipos de habilidad en un plato de 6 (p. ej. 2 Coraje + 4 Vigor): como se reparten los 3 huecos y si se pueden activar dos habilidades de ingrediente a la vez.
4. Habilidades diarias: MW dice que el conjunto de 3 se rerrolea al volver de quest; Game8 anade reset diario 00:00 UTC y al comer. Kiranico marca "Daily x1" (Felyne Researcher) y "Daily x2" (Felyne Weathercat) sin explicar el multiplicador. Hay ademas una fila "Unavailable".
5. Aguante: MW "hasta +50 segun el nivel de la cantina" vs Game8 "+50 siempre".
6. Limite entre comidas: 10 min (Fextralife) vs 10-15 min en campamentos (Game8).
7. Huecos/mejoras: MW (con interrogaciones) 3* Tobi-Kadachi = 4 huecos, 6* Tickled Pink = 6 huecos, M1* Hoarfrost investigation = bebidas. PowerPyx (guia del juego base) dice bebidas entre 6* y 7* y "3" huecos. Confirmar con partida/datos.
8. Que recibe el Palico: solo se documenta +4 vida por fresco (max +20). Ninguna fuente lista habilidades de comida que cambien el comportamiento del Palico.
9. Valores numericos de habilidades que solo salen en Fextralife (Defender Lo 13%/Hi 25% de 30%, Escape Artist 50%, Cliffhanger 25%, Black Belt 20%, Rider 25%, Medic 10%, Sharpshooter 10%, Harvester 10%, mejora S/M/L = +5/+10/+15). Heroics: Fextralife +35% ataque/+50% defensa; Game8 solo "35% de vida". Valor de Resistencia elemental por tamano: sin fuente.
10. Vale Gourmet: Fextralife dice "3 habilidades"; MW/Game8 "todos frescos + 3 estrellas". Como se consigue el Gourmet Voucher no esta cubierto.
11. "Cooking Fest" / cocinero de Seliana: no se encontro mecanica con ese nombre. Solo platos de festival del hub (Grand Appreciation Platter). Se pide confirmar con el usuario a que se referia.
12. "Chef's Choice" (Menu del Chef) solo aparece en Fextralife (pagina de 2021).

## Ingredientes
13. Desbloqueo de 114 ingredientes: coinciden Fextralife y Game8 en todos salvo:
    - Herbivore Egg: Game8 dice "Gettin' Yolked in the Forest" (probable error); Fextralife y MW indican "...in the Waste". Se uso Waste.
    - Grand Foie Gras: Fextralife pega "True Beryl" al nombre; se uso Game8 (Beryl Deposit, Elder's Recess).
    - Para los ingredientes por recoleccion, Fextralife da el objeto (Twilight Stone, Wicked Fossil, Deep Pearl...) y Game8 el nodo/zona; se guardan ambos (`fextralife_item` y `detail_en`). Las zonas y eventos (Flourish/Upsurge) solo vienen de Game8.
    - Sin comprobar en pagina de quest de MW: quests de progresion (Flying Sparks: Tobi-Kadachi, Tickled Pink), entregas, bounties y recolecciones. Quedan con una sola pareja de fuentes (FX+G8).
14. `name_es` proviene de Kiranico (es) y puede diferir del texto oficial en la UI (p. ej. "Tesón"). Las paginas de ingredientes individuales de MW no existen, asi que no hay una tercera fuente de desbloqueo.
15. Oven Roast: la tabla de recetas (MW) no se volco al JSON. Pedir si se quiere.
16. Pagina de Canteen Tickets (MW) sin datos; son materiales de forja, sin relacion con la comida.

## Implementacion (API)
- `POST /api/canteen/simulate` no produce porcentajes (ninguna fuente los publica): devuelve estrellas con el texto cualitativo de cada nivel.
- Los 114 ingredientes tienen icono propio (data/icons/ingredients, poedb); item_id solo cruza 19.
