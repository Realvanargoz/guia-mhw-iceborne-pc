# Modelo de seguridad

Este documento describe contra qué se ha diseñado la aplicación y qué controles existen. Para informar de una vulnerabilidad, mira [SECURITY.md](../SECURITY.md).

**Aviso honesto:** lo descrito aquí procede de revisiones internas (código, pruebas con entradas maliciosas, dependencias y huella en el sistema) siguiendo criterios de OWASP. **No es una certificación ni una auditoría externa.**

## Qué se protege

- Tus datos locales (`user.db`, composiciones, calendario) y la copia de tu partida.
- Tu equipo: la aplicación no debe poder usarse como puerta de entrada.
- La carpeta del juego y la de Steam, que nunca se modifican.

## Superficie

Servidor HTTP local en `127.0.0.1` (puertos 8765 a 8775) + ventana de Edge. No hay cuentas, no hay servicio en la nube propio y no hay telemetría. La única red saliente son imágenes de mhw-db.com y vídeos de YouTube, cargados por el navegador solo cuando hay conexión y los abres.

## Amenazas y controles

| Amenaza | Control |
|---|---|
| **Web maliciosa abierta en tu navegador** que intenta llamar a `127.0.0.1` (CSRF, DNS rebinding) | Sin CORS (solo mismo origen). `TrustedHostMiddleware` solo acepta `localhost`, `127.0.0.1` y `::1` (rechaza nombres rebindeados). Las escrituras (`POST/PUT/PATCH/DELETE`) exigen la cabecera `X-MHW-Client: 1`, que un sitio externo no puede enviar sin permiso CORS, y, si llevan `Origin`, este debe ser un host permitido. Cookie `HttpOnly` y `SameSite=Strict`. Cabeceras `X-Frame-Options: DENY` y `frame-ancestors 'none'` contra clickjacking. |
| **Otros usuarios o procesos locales** | Token de sesión aleatorio por ejecución, comparado en tiempo constante. Se entrega una vez en la URL de arranque y se cambia por una cookie. Toda `/api` (salvo `GET /api/health`) responde 401 sin esa cookie. Mutex y perfil de Edge propios. Nota: un proceso del mismo usuario de Windows con acceso a la lista de procesos podría ver la URL de arranque; ese nivel de acceso queda fuera del modelo. |
| **Partida o archivo subido malformado** | Límites de tamaño (JSON de hasta 256 KiB, subidas de hasta 33 MiB en la petición y 16 MiB para la partida), rechazo de cuerpos sin `Content-Length` (411) o con `Transfer-Encoding`, validación de entradas con Pydantic (los errores 422 no reflejan la entrada), lector de partidas probado con fuzzing y que trabaja sobre una copia en memoria. |
| **Escritura o lectura fuera de lugar en el sistema de archivos** | Toda escritura pasa por `safepath.ensure_writable`: solo dentro de la carpeta de datos (resuelve enlaces simbólicos y `..`). La partida de Steam y la carpeta del juego se abren en solo lectura. Los archivos estáticos se resuelven con `safe_join` (rechaza `..`, `\`, NUL y codificaciones dobles). |
| **Paquete con contenido inesperado** | El script de empaquetado verifica una lista de permitidos antes de crear el zip y el instalador (hay pruebas para ello), y las sumas SHA-256 se publican con cada release. |
| **Escalada de privilegios y persistencia** | Sin administrador, sin servicios, sin tareas programadas, sin arranque automático, sin reglas de firewall y sin escrituras en el registro. El instalador es por usuario. |
| **Cadena de suministro** | Dependencias de Python fijadas con hashes (`requirements.lock.txt`) y de npm con `package-lock.json`; fuentes de datos con commit fijado; `npm audit` en CI; Dependabot y CodeQL activados en GitHub. |
| **Privacidad** | Sin telemetría ni publicidad. Los registros (`logs/guiamhw.log`) son locales. |

## Fuera del alcance del modelo

- Un atacante con control total de tu cuenta de Windows o con permisos de administrador.
- Malware ya presente en el equipo.
- El propio juego, Steam, Edge y los sitios de terceros que se enlazan.

## Resumen de las revisiones internas S1 a S4

- **S1, diseño y superficie:** revisión del modelo de amenazas, de la escucha solo en el bucle local, del token de sesión y de las cabeceras y comprobaciones de origen.
- **S2, sistema de archivos y datos:** confinamiento de escrituras a la carpeta de datos, lectura solo de la partida y del juego, rutas por defecto fuera de la unidad y copias de seguridad de `user.db`.
- **S3, entradas maliciosas:** pruebas con peticiones malformadas, cuerpos grandes, números fuera de rango, recorrido de rutas y partidas corruptas (fuzzing del lector).
- **S4, empaquetado y dependencias:** lista de permitidos del paquete, dependencias fijadas y revisadas, componentes nativos incluidos, y huella en el sistema (sin servicios, tareas ni registro).

Estas revisiones las ha realizado el propio proyecto con ayuda de IA (ver README). Se repiten cuando cambian componentes sensibles, pero **no sustituyen a una auditoría independiente**.
