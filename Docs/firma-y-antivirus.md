# Firma de código, antivirus y SmartScreen

Objetivo: que quien instale Guía MHW vea el menor número posible de avisos («Windows protegió su PC», falsos positivos del antivirus). Se hace con medidas **gratuitas**; la firma de código es lo único que quita el aviso de raíz y tiene su propio problema (ver más abajo).

## Qué ya está hecho (versión 0.1.5)

- **Empaquetado de bajo riesgo:** PyInstaller en modo `onedir` (muchos menos falsos positivos que `onefile`), sin UPX, aplicación con ventana, instalador por usuario sin administrador, sin servicios, tareas, arranque automático ni cambios de firewall.
- **Metadatos de editor** en el instalador (`installer/GuiaMHW.iss`: editor, URL del proyecto, soporte, contacto, copyright) y en el `.exe` (`installer/guiamhw.spec`: empresa, copyright y comentarios con el repositorio). Antes figuraba «Proyecto personal».
- **Cargador de PyInstaller compilado desde su código fuente** (`scripts/build-bootloader.ps1`, opción `-OwnBootloader` de `scripts/build-windows.ps1`). El cargador precompilado es lo que más detectan los antivirus; compilarlo uno mismo da otra huella.
  - Descarga el código fuente de PyInstaller 6.22.3 y **comprueba su SHA256** (`05eb2f56…362d`, el que publica PyPI) antes de compilar.
  - Se compila con MinGW-w64 (`winget install BrechtSanders.WinLibs.POSIX.UCRT`, ya instalado en este PC).
  - Solo escribe dentro de `.venv-build` y de `build/bootloader`.
  - Si se actualiza PyInstaller hay que fijar la nueva suma en el script.
- **Hashes y autoprueba:** `dist/SHA256SUMS.txt` y `GuiaMHW.exe --smoke` (correcto). 26 pruebas del paquete pasan.

Comando de construcción completo:

```
pwsh scripts/build-windows.ps1 -Version 0.1.5 -OptimizeIcons -OwnBootloader
```

## Resultado de VirusTotal (2026-11-21, versión 0.1.5 con cargador propio)

| Archivo | Resultado | Informe |
|---|---|---|
| `GuiaMHW-0.1.5-setup.exe` | **0 de 69** motores | <https://www.virustotal.com/gui/file/c64f379a8579a084c93090ae4205ca820bee856f423335f1d2dcebf65f6939f8> |
| `GuiaMHW-0.1.5-portable.zip` | **1 de 65**: solo Bkav Pro, «W32.Malware.FA6237BA» | <https://www.virustotal.com/gui/file/37f539e24c126b271c81403e37d36b92471328643c597f41cdc693119a0db59e> |

La detección de Bkav Pro es una firma genérica de un motor menor, el falso positivo típico de los empaquetados. Ni Microsoft Defender ni los motores principales marcan ninguno de los dos archivos. Se puede enviar a Bkav como falso positivo (opcional) y volver a comprobar tras unos días.

## Pasos que haces tú antes de publicar (gratis)

1. **VirusTotal.** Sube `GuiaMHW-0.1.5-setup.exe` y `GuiaMHW-0.1.5-portable.zip` en <https://www.virustotal.com/gui/home/upload> (arrastrar y soltar; cuentan menos de 32 MB). Todo lo que se sube queda visible para la comunidad y los motores antivirus. Copia la dirección de cada informe: se enlaza en las notas de la versión. Si solo 1 o 2 motores menores lo marcan, es el falso positivo típico de los empaquetados; si lo marcan Microsoft, Kaspersky, ESET o similares, hay que investigar antes de publicar.
   - Mi herramienta de navegador no puede subir estos archivos (el límite es de 10 MB), por eso este paso es manual. Cuando tengas los informes, puedo leerlos desde Chrome y resumirlos.
2. **Microsoft (falso positivo).** Si Defender marca algo: <https://www.microsoft.com/en-us/wdsi/filesubmission>. Elegir «Software developer», categoría «Incorrectly detected as malware», producto «Microsoft Defender Antivirus» o «SmartScreen», adjuntar el archivo (máximo 50 MB; los zip protegidos con la contraseña «infected») y completar el captcha. No exige cuenta. La respuesta suele tardar unos días.
3. **Sumas de comprobación** en la nota de la versión (ya se generan) y el enlace al informe de VirusTotal.
4. **Texto para los usuarios** (ya en `README.md` y `SECURITY.md`): el aviso de SmartScreen y cómo continuar tras comprobar el hash.

## Firma de código gratuita (SignPath Foundation)

Condiciones leídas en <https://signpath.org/terms> (pueden cambiar; consultar el formulario de solicitud):

- Licencia aprobada por la OSI en **todos** los componentes, sin código propietario ni dual comercial.
- Sin malware ni programas potencialmente no deseados; proyecto activo y ya publicado en la forma que se firmará.
- El binario debe ser **«una compilación automática y válida a partir del código fuente»** del repositorio, verificada automáticamente (en la práctica, compilada en la nube del repositorio, p. ej. GitHub Actions). Si se admite firmar compilaciones locales: **no consta**.
- Autenticación multifactor obligatoria para todos los miembros, en SignPath y en el repositorio. Roles de autor, revisor y aprobador; cada firma la aprueba manualmente un miembro.
- Texto obligatorio en la página principal y de descarga bajo «Code signing policy»: «Free code signing provided by SignPath.io, certificate by SignPath Foundation», enlace a los roles del equipo y política de privacidad.
- El editor del certificado figura como «SignPath Foundation». No se pide identificación personal.
- Plazo de aprobación y reputación inmediata de SmartScreen: **no constan**.

**El obstáculo:** la versión actual lleva los iconos de Capcom y se construye en local, porque la nube del repositorio no los tiene. Eso choca con «sin componentes propietarios» y con «compilación automática desde el código público». Por eso se decidió el plan de **dos versiones**:

1. **Versión con iconos, sin firmar** (la actual): se publica con VirusTotal, envío a Microsoft, metadatos y cargador propio.
2. **Versión sin iconos, compilada en GitHub Actions** desde el código público, que sí podría solicitar la firma de SignPath. Cada usuario extrae los iconos de su propio juego (ya documentado en el README). Pendiente de hacer:
   - flujo de GitHub Actions que construya el instalador y el zip sin iconos;
   - activar la autenticación multifactor en GitHub y en SignPath;
   - añadir la sección «Code signing policy» al README y la política de privacidad;
   - presentar la solicitud en <https://signpath.org/apply>, que pide los datos y la identidad del solicitante y no puedo rellenar yo.

## Qué no se puede prometer

Incluso firmado, SmartScreen puede avisar los primeros días mientras se acumula reputación. Y los antivirus pueden marcar versiones nuevas: se envían los falsos positivos y se vuelve a comprobar con cada versión.
