# Política de seguridad

## Versiones con soporte

Solo se corrigen fallos de seguridad en la **última versión publicada de la rama 0.1.x**. Si usas una versión anterior, actualiza antes de informar.

| Versión | Soporte |
|---|---|
| 0.1.x (la última) | Sí |
| Anteriores | No |

## Cómo informar de una vulnerabilidad

**No abras una incidencia pública.** Usa uno de estos canales:

1. **GitHub, informe privado de vulnerabilidades:** en la pestaña *Security* del repositorio, pulsa *Report a vulnerability*.
2. **Correo:** info@asesoriatics.com

### Qué incluir

- Versión de la aplicación y de Windows, e instalador o zip portable.
- Descripción del problema y su impacto.
- Pasos para reproducirlo o una prueba de concepto mínima.
- Cualquier sugerencia de solución.

**No adjuntes tu partida de Steam ni tu `user.db`.** Si un fichero es imprescindible, descríbelo y lo acordamos por el canal privado.

## Alcance

Dentro del alcance:

- La aplicación (servidor local, lanzador, interfaz web).
- El instalador y el zip portable.
- Los scripts de compilación y empaquetado del repositorio.

Fuera del alcance:

- El propio juego, Steam, Microsoft Edge y Windows.
- Sitios y servicios de terceros enlazados (mhw-db.com, YouTube, wikis).
- Ataques que requieren acceso de administrador o control total de la cuenta de Windows del usuario.
- Avisos de SmartScreen por no estar firmados los ejecutables.

## Plazos

Es un proyecto personal y gratuito, así que los plazos son de mejor esfuerzo: acuse de recibo **en un máximo de 7 días**, y después te mantendremos informado de la valoración y de la corrección.

## Divulgación

Pedimos divulgación coordinada: no publiques los detalles hasta que haya una versión corregida o hayan pasado 90 días sin respuesta. Cuando se publique la corrección, se mencionará en `CHANGELOG.txt` y, si lo deseas, se te reconocerá.

Más información sobre el diseño de seguridad: [Docs/SEGURIDAD-MODELO.md](Docs/SEGURIDAD-MODELO.md).
