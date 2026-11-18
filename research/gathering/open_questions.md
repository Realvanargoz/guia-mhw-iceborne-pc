# Preguntas abiertas - Recolección

1. **Arrecife Escarchado sin porcentajes ni nodos**: Game8 solo da la lista de materiales por zona (1-17, solo MR). `percentage`, `stack` y `nodes` quedan en null. Habría que sacarlos del juego (WorldChunkTool) o de una fuente que los publique.
2. **Elementos no-objeto** en Arrecife Escarchado (Stone, Slinger Torch, Hot Spring Stone, Brightmoss, Watermoss, Wiggly Litchi, Paratoad, Sleeptoad, Poisonlantern, Rime Beetle, King Marlin): no existen en `items`; probablemente vida endémica, munición de resortera o pesca. Marcados con [needs_review] en `notes_es`. El cargador debería ignorarlos o enlazarlos aparte.
3. **Petalcryst** (zona 8): objeto de cuenta que solo aparece en un punto único durante «Flourishing: Frozen Foliage» (Fextralife). No es un nodo permanente.
4. **Tierras Guía, nodos normales** (hierbas, bayas, miel, setas): no hay fuente por zona/región; solo se cubren minerales y huesos por región y nivel de recurso. Las 15 zonas de la BD no se han mapeado a las 6 regiones.
5. **Numeración de zonas de nodos en Tierras Guía** (Fextralife: Bosque 6-7, Wildspire 8-9, Coral 10-11, Rotten 12-13) no cuadra con «dos zonas por región» ni cubre Volcánica/Tundra. Sin verificar.
6. **Cracked Crystal vs «Weathered Crystal»**: Fextralife usa ambos nombres para el cristal nv1 de Wildspire. Se usó Cracked Crystal (tabla de objetos); Weathered Crystal no existe en `items`.
7. **Lista de posiciones de Afloramientos/Montones gigantes** en Tierras Guía: la página dice «Pending completion».
8. No se encontró «Moxie» ni un «manto de recolección» en MHW Iceborne; el único manto relacionado es el Ghillie (sigilo) y Assassin's Hood. Se asume que fue un nombre erróneo del plan.
9. `Felyne Harvester` (habilidad felyne) no verificada: queda para R1/cantina.
