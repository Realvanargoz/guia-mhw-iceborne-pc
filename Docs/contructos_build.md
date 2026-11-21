# Guía Paso a Paso y Análisis para un Constructor de Builds (*Build Planner*)

> **Créditos:** la idea y el método de este constructor son de **Dem**, canal de YouTube [youtube.com/@Demsito](https://www.youtube.com/@Demsito). Vídeo base: [«DEJA de COPIAR Builds y EMPIEZA a CREARLAS con ESTE Método»](https://www.youtube.com/watch?v=ozzSBPNg5aw) (26-may-2026). Este documento es un resumen de diseño propio y no está afiliado a su canal.

Basado en el método estructurado del video **"DEJA de COPIAR Builds y EMPIEZA a CREARLAS con ESTE Método"** (@Demsito), este documento presenta:
1. El **paso a paso** para armar una *build* base (iterativa y ajustable, no definitiva).
2. El **análisis de flujos** necesarios para construir una herramienta o *build planner* que guíe al usuario desde la idea inicial hasta una *build* base probada.
3. Un **diagrama de flujo** del proceso y de los flujos del sistema.

> **Nota sobre alcance de la fuente:** La transcripción completa del audio sí fue leída (subtítulos automáticos en español, vía el panel de transcripción de YouTube). Los detalles verificados se recogen en la sección 4. La estructura de pasos y flujos se adapta como marco de diseño para una herramienta interactiva de creación de *builds* base.

---

## 1. Paso a Paso para Crear una Build Base (Enfoque Iterativo)

El objetivo de este flujo no es encontrar un set "perfecto" e inmutable desde el primer segundo, sino generar una **base funcional** que el usuario pueda probar, medir en campo y refinar después.

1. **Definir el objetivo de la Build (`2:03`)**
   - Establecer el propósito principal del set (ej. daño sostenido, supervivencia/comodidad, contramedida contra un monstruo/mecánica concreta, farmeo o rol de soporte/control).
   - Acotar el contexto (arma principal, fase del juego/progreso y si es para solitario o multijugador).

2. **Elegir habilidades en la Build (`3:23`)**
   - Listar todas las habilidades que apoyan el objetivo definido, separando necesidades ofensivas, defensivas/utilitarias y de calidad de vida.

3. **Activar habilidad de set (`5:58`)**
   - Determinar si el objetivo requiere un *Set Bonus* (bonificación por *N* piezas de un mismo conjunto/monstruo).
   - Definir cuántas piezas bloquean esta bonificación para conocer la libertad restante de combinación.

4. **Clasificar habilidades según su importancia (`7:32`)**
   - Priorizar las habilidades en niveles (ej. *Críticas/Obligatorias* $\rightarrow$ *Deseables* $\rightarrow$ *Opcionales/Relleno*).
   - Definir el nivel mínimo o ideal deseado para cada habilidad antes de buscar piezas.

5. **Buscar piezas de armadura (`9:29`)**
   - Seleccionar piezas que satisfagan primero la habilidad de set (si aplica) y aporten los mayores rangos de habilidades prioritarias y ranuras útiles.
   - Evaluar compromisos (defensa, resistencias elementales/de estado y disponibilidad real de materiales para forjarlas).

6. **Usar Ciguas y Joyas disponibles (`10:52`)**
   - Cruzar el esqueleto de armadura con el **inventario real del usuario** (amuletos/*ciguas* disponibles y adornos/*joyas* poseídos, evitando depender de joyas inexistentes como única solución).
   - Rellenar huecos y ajustar rangos hasta alcanzar una configuración viable.

7. **Probar la Build (`12:58`)**
   - Exportar o equipar la *build* base y probarla en entorno de prueba o cacería real.
   - Registrar fricciones (falta de supervivencia, cortes de afilado, estados molestos, falta de espacio) para alimentar un **ciclo de iteración y ajustes posteriores**.

---

## 2. Análisis de Flujos para un Constructor de Builds (*Build Builder*)

Para que el constructor entregue una **build base útil y editable** —y no un callejón sin salida cuando falten joyas o piezas—, conviene dividir el sistema en **6 flujos principales**:

### Flujo A: Configuración de Contexto y Objetivo
- **Entrada:** Tipo de *build* (objetivo), arma, etapa/rango disponible y preferencia de enfoque.
- **Salida:** Perfil de restricciones iniciales que filtra opciones inviables o fuera de rango.
- **Punto clave de UX:** Permitir cambiar el objetivo en cualquier momento sin perder el borrador actual.

### Flujo B: Selección y Priorización de Habilidades + Bono de Set
- **Entrada:** Catálogo de habilidades y bonos de set; selección del usuario + asignación de prioridades (Alta / Media / Baja) y *Set Bonus* deseado.
- **Salida:** Matriz ponderada de requisitos (*Hard constraints* vs. *Soft preferences*).
- **Punto clave de UX:** Advertir si un *Set Bonus* elegido limita demasiado el espacio para habilidades de alta prioridad, ofreciendo alternativas.

### Flujo C: Inventario y Disponibilidad del Jugador (Ciguas, Joyas y Materiales)
- **Entrada:** Inventario del usuario (joyas poseídas y sus cantidades, amuletos/*ciguas* disponibles, y opcionalmente si quiere restringir a piezas forjables ya).
- **Salida:** Modo de cálculo (`Inventario Real` vs. `Teórico / Ideal`).
- **Punto clave de UX:** Diferenciar visualmente entre *habilidad cubierta por armadura*, *cubierta por amuleto* y *cubierta por joya disponible*, marcando faltantes sin bloquear la generación de la *build* base.

### Flujo D: Motor de Combinación y Generación de *Build Base*
- **Entrada:** Matriz de prioridades + reglas de *Set Bonus* + inventario/catálogo de piezas y ranuras.
- **Salida:** 1 o varias propuestas de **Build Base** (armadura + amuleto + distribución de joyas + resumen de habilidades alcanzadas vs. objetivo).
- **Lógica recomendada:** Optimizar primero *Set Bonus* y habilidades de prioridad máxima; luego maximizar habilidades secundarias con las ranuras libres; finalmente presentar trade-offs claros (ej. *"Se logró Nivel 2 de X en vez de 3 por falta de 1 joya"*).

### Flujo E: Revisión, Simulación y Ajuste Manual (Modo "No Definitiva")
- **Entrada:** La *build* base generada + ediciones manuales del usuario (intercambiar una pieza, cambiar una joya, subir/bajar prioridad).
- **Salida:** Recálculo instantáneo de habilidades totales, ranuras libres y alertas de pérdida de *Set Bonus*.
- **Punto clave de UX:** Tratar la salida como **borrador vivo**: permitir "fijar" (*lock*) piezas o joyas que el usuario quiera conservar y recalcular solo el resto.

### Flujo F: Prueba en Juego, Retroalimentación e Iteración
- **Entrada:** Notas o resultados del usuario tras probar la *build* base en combate (ej. *"me matan de un golpe"*, *"me duermo mucho"*, *"me falta daño/afilado"*).
- **Salida:** Nueva versión de la *build* (`v1.1`, `v1.2`...) ajustando prioridades, defensas o utilidades.
- **Punto clave de UX:** Guardar historial de versiones o "antes/después" para que el usuario pueda comparar cambios y volver atrás si un ajuste empeora otra faceta.

---

## 3. Diagrama de Flujos del Constructor de Builds

```mermaid
flowchart TD
    A["1. Definir Objetivo y Contexto<br/>(Propósito, arma, etapa)"] --> B["2. Elegir Habilidades<br/>y Activar Bono de Set"]
    B --> C["3. Clasificar Prioridades<br/>(Obligatorias / Secundarias / Opcionales)"]
    C --> D{"4. Configurar Disponibilidad<br/>(Ciguas, Joyas y Equipo)"}

    D -->|Modo Inventario Real| E["Motor de Combinación<br/>(Usa solo recursos disponibles)"]
    D -->|Modo Ideal / Libre| F["Motor de Combinación<br/>(Usa catálogo completo)"]

    E --> G["Generar Build Base<br/>(Piezas + Amuleto + Joyas + Resumen)"]
    F --> G

    G --> H{"5. Ajuste Manual en Editor<br/>(Bloquear piezas / Cambiar joyas)"}
    H -->|Sí, editar| I["Recalcular Habilidades<br/>y Alertas de Set Bonus"]
    I --> G

    H -->|No, lista para probar| J["6. Probar Build Base en Juego<br/>(Práctica / Cacería)"]
    J --> K{"¿Funcionó como esperaba?"}

    K -->|Sí| L["Guardar como Build Base Validada<br/>(Versionado v1.0)"]
    K -->|No / Requiere cambios| M["Registrar Feedback de Prueba<br/>(Supervivencia, estados, daño, comodidad)"]
    M --> C

---

## 4. Detalles verificados de la transcripción

**Metadatos del video**
- Canal: Dem
- Duración: 16:32
- Fecha de publicación: 26-may-2026
- Fuente de la transcripción: subtítulos automáticos en español (panel de transcripción de YouTube)

**Ejemplo real del video**
- Arma: hacha cargada de Brachydios, con viales de impacto.
- Afinidad: descartada.
- Artillería núcleo.
- Guardia mejorada 5 por jugar bloqueando.

**Habilidades por nivel de prioridad**
- **Primarias:** Esencia Zorah Magdaros, Artillería 5, Guardia mejorada 5, Bonus salud 3, Anti aturdimiento 3, Bonus punto débil 3, Carga prolongada 3.
- **Secundarias:** Escudo, Bonus capacidad.
- **Terciarias:** Bloqueo agresivo, Bonus al aturdir 3.

**Bono de set**
- Se activa con 3 piezas del mismo set.
- Yelmo + Cota dan Artillería 4.
- La tercera pieza solo sirve para activar el bono.

**Armadura y amuleto**
- Brazales: Anti aturdimiento 2.
- Faja: Bonus salud 2.
- Amuleto Cigua férrea IV: Guardia mejorada 4.

**Joyas (orden de colocación)**
- 1 joya de Voluntad.
- 1 joya de Fuerza.
- 3 joyas Ablandadoras.
- 3 joyas de Aumento.
- 1 joya de Guardia.
- 1 joya de Artillería en el arma.
- Sobrantes: joya de Escudo y joya de Guardián.

**Quedaron fuera**
- Bonus capacidad.
- Bonus al aturdir.

**Prueba recomendada**
- Probar primero contra monstruos normales y después contra monstruos curtidos.
- Regla: 15-20 minutos cómodos de cacería antes de decidir si la build funciona.

### Correspondencia con los pasos del asistente

| Paso del método (sección 1) | Tiempo en el video | Paso del asistente (wizard) |
|---|---|---|
| 1. Definir el objetivo de la build | 2:03 | objetivo |
| 2. Elegir habilidades | 3:23 | habilidades |
| 3. Activar habilidad de set | 5:58 | bono |
| 4. Clasificar habilidades por importancia | 7:32 | prioridades |
| 5. Buscar piezas de armadura | 9:29 | armadura |
| 6. Usar ciguas y joyas disponibles | 10:52 | joyas |
| 7. Probar la build | 12:58 | probar |
