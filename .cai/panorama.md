# Panorama del proyecto

_Generado por `cai panorama` el 2026-10-09 02:23._

## Estado

El proyecto es ambicioso y ya funciona de punta a punta: una CLI `cai` con unos 50 módulos (tutor, notas, gate, review, snapshot, hook) y una extensión de VSCode que la usa como subproceso. Lo central (que la IA solo escriba comentarios @guia y que se revierta lo no permitido) está bien separado en verify/hook/snapshot y tiene una batería de pruebas. Pero la orquestación quedó concentrada en funciones enormes (por ejemplo, `ejecutar` de cli.ts tiene 712 líneas y `activate` tiene 310). Además, hay lógica copiada entre la CLI y la extensión, y el propio medidor de la herramienta marca más de 80 incumplimientos en su código.

## Sugerencias

_Cada una está también en tus tareas (panel → Tareas)._

### 1. Separar los comandos de cli.ts en un registro de comandos

**Por qué:** `ejecutar` tiene 712 líneas y 5 niveles de anidamiento, y cli.ts depende de unos 30 módulos. Cada comando nuevo hace crecer un solo bloque, cualquier cambio puede romper otro comando y no hay forma de probar un comando aislado.

**Cómo:** Crea una carpeta `commands/` con un archivo por comando (o por familia: notas, revisión, tests, setup). Cada archivo exporta su nombre, su ayuda, sus opciones y una función `run(args, root)`. cli.ts queda en unas 50 líneas: lee argv, busca el comando en el registro, valida las opciones (y si faltan, lanza un error que explique cuál falta) y lo ejecuta. Las utilidades `opt`, `log`, `preguntar` y `fmt` pasan a un `cli/io.ts` compartido.

Archivos: `packages/complementairy/src/cli.ts`

### 2. Un solo dueño para el formato de .cai (notas, config, modos)

**Por qué:** comun.ts de la extensión reimplementa `archivoNotas`, `lineaDeDefinicion`, `reanclar`, `todasLasNotas`, `dataDir`, `esModo` y `leerConfig`, y notaView.ts repite `funcionesDe`/`funcionEn`. Si cambias el formato de las notas en la CLI, la extensión lee mal sin avisar, y es justo el dato que el usuario no quiere perder.

**Cómo:** Saca a un paquete `packages/core` (o a un entry `complementairy/core` sin dependencias de IA) los tipos de Nota/Config y las funciones puras de lectura y reanclado. La CLI y la extensión importan desde ahí. Agrega un campo `version` a cada archivo de notas y a config.json para poder migrarlos más adelante.

Archivos: `packages/vscode-complementairy/src/comun.ts`, `packages/vscode-complementairy/src/notaView.ts`, `packages/complementairy/src/notas.ts`, `packages/complementairy/src/notasFuncion.ts`, `packages/complementairy/src/config.ts`, `packages/complementairy/src/modos.ts`

### 3. Mover selftest.ts a test/ y partirlo por garantía

**Por qué:** Son 1774 líneas y 188 funciones dentro de src/, así que probablemente se empaqueta en el .tgz. La mayoría de las funciones exportadas no tiene un test propio, y cuando algo falla cuesta saber qué garantía se rompió. Tu memoria de errores incluye 'tests de casos borde', y esto es lo que más te ayudaría.

**Cómo:** Crea un archivo de test por módulo crítico: verify, hook, snapshot, bash, guard, notas/reanclar, comments.scanComments y config.zoneOf. Las utilidades `project`, `edit`, `write`, `bash` y `denied` pasan a un `test/helpers.ts`. Empieza por los casos borde de las garantías: comentarios al final de línea, CRLF, archivos nuevos, rutas fuera del proyecto y comandos encadenados con `&&` o `;`. Lo que decidas sobre el comando `cai selftest` puede reutilizar estos mismos casos.

Archivos: `packages/complementairy/src/selftest.ts`, `packages/complementairy/test/selftest.test.ts`

### 4. Partir los orquestadores largos en etapas con nombre

**Por qué:** `runGuia` (225 líneas), `runReview` (218), `panorama` (213), `responderNota` (209), `verificar` (125) y `activate` (310) mezclan cuatro cosas: leer el estado, decidir sin IA, llamar a la IA y escribir el resultado. Por eso no puedes probar las decisiones deterministas sin pasar por el LLM.

**Cómo:** Divide cada una en tres pasos: (1) `recolectar` el contexto, una función pura sobre lo que hay en disco; (2) `decidir`, que es determinista y devuelve qué pedir; (3) `pedir` a la IA y `publicar` por salida.ts. Así los pasos 1 y 2 se prueban sin IA. En la extensión, `activate` solo debería llamar a `registrarX(context)` de cada módulo.

Archivos: `packages/complementairy/src/tutor.ts`, `packages/complementairy/src/review.ts`, `packages/complementairy/src/panorama.ts`, `packages/complementairy/src/responder.ts`, `packages/complementairy/src/verificar.ts`, `packages/vscode-complementairy/src/extension.ts`

### 5. Aclarar nombres que chocan: verify/verificar y los dos estados

**Por qué:** verify.ts (la garantía de que solo se tocan comentarios) y verificar.ts (comprobar si una función cumple su objetivo) hacen cosas sin relación pero tienen casi el mismo nombre. Además, acompanante.ts y state.ts exportan los dos `loadEstado` y `saveEstado`, y `funcionEn` está en responder.ts, notasFuncion.ts y notaView.ts. Eso provoca imports equivocados.

**Cómo:** Renombra verify.ts a algo como `soloComentarios.ts` y deja un solo `funcionEn` (en notasFuncion o en core). Renombra el estado del acompañante (por ejemplo, `estadoAcompanante`) o júntalo con state.ts en un único módulo de persistencia con escritura atómica.

Archivos: `packages/complementairy/src/verify.ts`, `packages/complementairy/src/verificar.ts`, `packages/complementairy/src/state.ts`, `packages/complementairy/src/acompanante.ts`, `packages/complementairy/src/responder.ts`

### 6. Activar reglas de lint para promesas sueltas y validar la config

**Por qué:** Ya caíste dos veces en el error de 'async faltante', y la extensión dispara muchos subprocesos y temporizadores donde una promesa sin `await` se pierde sin avisar. Además, config.json y los JSON de .cai se leen sin validar, y tu regla es que los errores expliquen qué pasó.

**Cómo:** Aplica en ambos paquetes la misma configuración de typescript-eslint estricta que ya usas en examples/demo-ts, con `no-floating-promises` y `no-misused-promises`. En `loadConfig` y en la carga de notas, valida la forma de los datos con un esquema y lanza un error que diga el archivo, el campo y el valor esperado, en vez de fallar más adelante.

Archivos: `packages/complementairy/src/config.ts`, `packages/complementairy/src/notas.ts`, `packages/vscode-complementairy/src/comun.ts`

## Otras formas de hacerlo

- **La extensión ejecuta la CLI como subproceso para cada acción, y solo `rapida` usa el servidor `cai servir`:** Convertir `cai servir` en el único canal: un protocolo JSON por línea (o JSON-RPC) con métodos para todos los comandos. Otra opción es que la extensión importe el core como librería y deje los subprocesos solo para lo que llama a la IA. _(Cada subproceso vuelve a cargar config, parser y perfil, lo que suma latencia y estados inconsistentes. Con un solo proceso tienes un único dueño de los bloqueos (ocupado.ts) y de la caché, y además desaparece la duplicación de lectura de notas en comun.ts.)_
- **Lectura manual de argumentos con `opt()` en cli.ts:** Usar una librería pequeña de CLI (commander o el `parseArgs` que trae Node) junto con el registro de comandos. _(Te da ayuda automática, validación de opciones y mensajes de error claros sin escribirlos tú, y reduce mucho el tamaño de cli.ts.)_
- **Un solo archivo selftest con un runner propio:** Usar `node:test` o vitest, con un archivo por módulo y un helper de proyecto temporal. _(Puedes correr un subconjunto, ver la cobertura por módulo y conectarlo con `funcionesSinTests` de metricas.ts, que hoy marca casi todo como sin test aunque selftest lo cubra de forma indirecta.)_

## Riesgos

- Pérdida o corrupción de notas: la CLI, `watch`, el acompañante y la extensión escriben y leen .cai/ al mismo tiempo, y notaView lee archivos a medio escribir. Sin escritura atómica (escribir a un temporal y renombrar) y sin un formato con versión compartido, un guardado simultáneo puede dejar un JSON roto.
- Diferencias entre la CLI y la extensión: hay lógica de reanclado y de modos copiada en comun.ts. Un cambio en un lado hace que las notas aparezcan en la función equivocada sin que salte ningún error.
- Costo y ruido de la IA: `watch` (debounce de 700 ms), el acompañante en cada guardado y `rapida` mientras escribes pueden encadenar llamadas. Revisa que el tope por hora sea global (por usuario, en ~/.cai) y no solo por archivo o proceso.
- Credibilidad del producto: la herramienta enseña buenas prácticas medibles, pero su propio código incumple más de 80. Si un usuario corre `cai` sobre el repositorio, la primera impresión es contradictoria.

## Preguntas para ti

Respóndelas en el panel de VSCode (Proyecto → Preguntas para ti), con `cai memoria responder <n> "..."` o en `.cai/conocimiento.md` (después de "R:"). Se usan en todas las sugerencias.

- ¿selftest.ts es un comando que debe correr el usuario final (`cai selftest`) o solo es tu batería de pruebas interna? (sugerencia: Ambas cosas: los casos van en test/ y el comando los reutiliza.)
- ¿Qué es Files.js y por qué está en la raíz? (sugerencia: Un ejercicio de prueba; moverlo a examples/.)
- ¿La extensión debe funcionar sin tener la CLI instalada globalmente, o siempre depende de `cai`? (sugerencia: Depender de la CLI empaquetada dentro de la extensión.)
- Cuando extiendas a usuarios no técnicos, ¿será por la misma extensión de VSCode o por otra interfaz?
- ¿Qué partes de .cai/ deben ir a git y compartirse con el equipo, y cuáles son personales? (sugerencia: A git: config.json, proyecto.md, reglas.md, conocimiento.md y docs/adr. Fuera de git: notas, cache y ocupado.)
- ¿Aceptas agregar dependencias pequeñas (parser de CLI, validador de esquemas) o prefieres cero dependencias? (sugerencia: Usa `parseArgs` de Node para la CLI y una validación de esquemas hecha a mano; así no sumas dependencias.)

## Mediciones (sin IA)

- 69 archivos de código, 720 funciones.
- Prácticas que no se cumplen (umbrales en `.cai/config.json` → `practicas`):
  - packages/complementairy/src/acompanante.ts: el archivo tiene 16 funciones (práctica: máximo 12)
  - packages/complementairy/src/acompanante.ts: el archivo tiene 527 líneas (práctica: máximo 300)
  - packages/complementairy/src/acompanante.ts: acompanarUnaVez: 58 líneas (máx. 40)
  - packages/complementairy/src/biblioteca.ts: planExpansion: 49 líneas (máx. 40), 6 parámetros (máx. 4)
  - packages/complementairy/src/cli.ts: el archivo tiene 17 funciones (práctica: máximo 12)
  - packages/complementairy/src/cli.ts: el archivo tiene 891 líneas (práctica: máximo 300)
  - packages/complementairy/src/cli.ts: ejecutar: 712 líneas (máx. 40), 5 niveles de anidamiento (máx. 3)
  - packages/complementairy/src/comments.ts: scanComments: 99 líneas (máx. 40), 4 niveles de anidamiento (máx. 3)
  - packages/complementairy/src/conocer.ts: sugerirAutoria: 48 líneas (máx. 40)
  - packages/complementairy/src/conocer.ts: conocer: 99 líneas (máx. 40)
  - packages/complementairy/src/context.ts: projectContext: 4 niveles de anidamiento (máx. 3)
  - packages/complementairy/src/doctor.ts: doctor: 52 líneas (máx. 40), 4 niveles de anidamiento (máx. 3)
  - packages/complementairy/src/gate.ts: parseDiags: 5 parámetros (máx. 4)
  - packages/complementairy/src/gate.ts: runGate: 69 líneas (máx. 40), 4 niveles de anidamiento (máx. 3)
  - packages/complementairy/src/guia.ts: conversation: 4 niveles de anidamiento (máx. 3)
  - packages/complementairy/src/hook.ts: preEdit: 53 líneas (máx. 40)
  - packages/complementairy/src/init.ts: init: 72 líneas (máx. 40)
  - packages/complementairy/src/llm.ts: realLLM: 70 líneas (máx. 40)
  - packages/complementairy/src/notasFuncion.ts: el archivo tiene 13 funciones (práctica: máximo 12)
  - packages/complementairy/src/notasFuncion.ts: consolidar: 4 niveles de anidamiento (máx. 3)
  - packages/complementairy/src/notasFuncion.ts: notaPara: 5 parámetros (máx. 4)
  - packages/complementairy/src/ocupado.ts: el archivo tiene 13 funciones (práctica: máximo 12)
  - packages/complementairy/src/ocupado.ts: ocupar: 41 líneas (máx. 40)
  - packages/complementairy/src/ocupado.ts: ocuparEsperando: 5 parámetros (máx. 4)
  - packages/complementairy/src/ocupado.ts: conBloqueo: 5 parámetros (máx. 4)
  - packages/complementairy/src/panorama.ts: el archivo tiene 432 líneas (práctica: máximo 300)
  - packages/complementairy/src/panorama.ts: panorama: 213 líneas (máx. 40), 4 niveles de anidamiento (máx. 3)
  - packages/complementairy/src/planoArchivo.ts: planoArchivo: 65 líneas (máx. 40)
  - packages/complementairy/src/predict.ts: runPredecir: 83 líneas (máx. 40)
  - packages/complementairy/src/predict.ts: ejecutar: 44 líneas (máx. 40)
  - packages/complementairy/src/predict.ts: runCheck: 55 líneas (máx. 40)
  - packages/complementairy/src/rapida.ts: rapida: 72 líneas (máx. 40)
  - packages/complementairy/src/responder.ts: el archivo tiene 314 líneas (práctica: máximo 300)
  - packages/complementairy/src/responder.ts: responderNota: 209 líneas (máx. 40)
  - packages/complementairy/src/review.ts: el archivo tiene 384 líneas (práctica: máximo 300)
  - packages/complementairy/src/review.ts: runReview: 218 líneas (máx. 40), 5 niveles de anidamiento (máx. 3)
  - packages/complementairy/src/salida.ts: publicar: 64 líneas (máx. 40), 5 niveles de anidamiento (máx. 3)
  - packages/complementairy/src/selftest.ts: el archivo tiene 188 funciones (práctica: máximo 12)
  - packages/complementairy/src/selftest.ts: el archivo tiene 1774 líneas (práctica: máximo 300)
  - packages/complementairy/src/sesion.ts: el archivo tiene 13 funciones (práctica: máximo 12)
  - packages/complementairy/src/sesion.ts: iniciar: 42 líneas (máx. 40)
  - packages/complementairy/src/siguiente.ts: actualizarTareas: 63 líneas (máx. 40)
  - packages/complementairy/src/siguiente.ts: siguiente: 45 líneas (máx. 40)
  - packages/complementairy/src/snapshot.ts: generadosPor: 76 líneas (máx. 40)
  - packages/complementairy/src/snapshot.ts: plantilla: 48 líneas (máx. 40)
  - packages/complementairy/src/snapshot.ts: checkSnapshot: 75 líneas (máx. 40)
  - packages/complementairy/src/tests.ts: el archivo tiene 13 funciones (práctica: máximo 12)
  - packages/complementairy/src/tests.ts: el archivo tiene 307 líneas (práctica: máximo 300)
  - packages/complementairy/src/tests.ts: proponerTests: 76 líneas (máx. 40)
  - packages/complementairy/src/threads.ts: findThreads: 62 líneas (máx. 40), 4 niveles de anidamiento (máx. 3)
  - packages/complementairy/src/tutor.ts: el archivo tiene 436 líneas (práctica: máximo 300)
  - packages/complementairy/src/tutor.ts: runGuia: 225 líneas (máx. 40)
  - packages/complementairy/src/tutor.ts: guiaEnNotas: 6 parámetros (máx. 4)
  - packages/complementairy/src/verificar.ts: verificar: 125 líneas (máx. 40)
  - packages/complementairy/src/verificar.ts: registrar: 8 parámetros (máx. 4)
  - packages/complementairy/src/verify.ts: verifyCommentOnly: 56 líneas (máx. 40)
  - packages/vscode-complementairy/src/acciones.ts: registrar: 51 líneas (máx. 40)
  - packages/vscode-complementairy/src/acciones.ts: revisarConEdiciones: 4 niveles de anidamiento (máx. 3)
  - packages/vscode-complementairy/src/comun.ts: el archivo tiene 28 funciones (práctica: máximo 12)
  - packages/vscode-complementairy/src/comun.ts: el archivo tiene 320 líneas (práctica: máximo 300)
  - packages/vscode-complementairy/src/configuracion.ts: el archivo tiene 13 funciones (práctica: máximo 12)
  - packages/vscode-complementairy/src/configuracion.ts: guardar: 44 líneas (máx. 40)
  - packages/vscode-complementairy/src/configuracion.ts: html: 58 líneas (máx. 40)
  - packages/vscode-complementairy/src/estado.ts: el archivo tiene 17 funciones (práctica: máximo 12)
  - packages/vscode-complementairy/src/extension.ts: el archivo tiene 16 funciones (práctica: máximo 12)
  - packages/vscode-complementairy/src/extension.ts: el archivo tiene 444 líneas (práctica: máximo 300)
  - packages/vscode-complementairy/src/extension.ts: activate: 310 líneas (máx. 40)
  - packages/vscode-complementairy/src/extension.ts: acompanarAhora: 42 líneas (máx. 40)
  - packages/vscode-complementairy/src/extension.ts: revisarActualizacion: 42 líneas (máx. 40)
  - packages/vscode-complementairy/src/notaView.ts: el archivo tiene 23 funciones (práctica: máximo 12)
  - packages/vscode-complementairy/src/notaView.ts: el archivo tiene 498 líneas (práctica: máximo 300)
  - packages/vscode-complementairy/src/notaView.ts: registrar: 42 líneas (máx. 40)
  - packages/vscode-complementairy/src/notaView.ts: recibir: 98 líneas (máx. 40)
  - packages/vscode-complementairy/src/notaView.ts: esqueleto: 68 líneas (máx. 40)
  - packages/vscode-complementairy/src/notaView.ts: render: 91 líneas (máx. 40), 4 niveles de anidamiento (máx. 3)
  - packages/vscode-complementairy/src/notasView.ts: el archivo tiene 27 funciones (práctica: máximo 12)
  - packages/vscode-complementairy/src/notasView.ts: el archivo tiene 505 líneas (práctica: máximo 300)
  - packages/vscode-complementairy/src/notasView.ts: dibujar: 51 líneas (máx. 40)
  - packages/vscode-complementairy/src/notasView.ts: pedir: 51 líneas (máx. 40)
  - packages/vscode-complementairy/src/notasView.ts: registrar: 116 líneas (máx. 40)
  - packages/vscode-complementairy/src/panel.ts: el archivo tiene 496 líneas (práctica: máximo 300)
  - packages/vscode-complementairy/src/panel.ts: irA: 5 parámetros (máx. 4)
  - packages/vscode-complementairy/src/panel.ts: cargar: 59 líneas (máx. 40)
  - packages/vscode-complementairy/src/panel.ts: getTreeItem: 101 líneas (máx. 40)
  - packages/vscode-complementairy/src/panel.ts: getChildren: 58 líneas (máx. 40)
  - packages/vscode-complementairy/src/panel.ts: registrar: 110 líneas (máx. 40)
  - packages/vscode-complementairy/src/rapidas.ts: el archivo tiene 15 funciones (práctica: máximo 12)
- Funciones exportadas sin tests: `syntaxErrors`, `walk`, `acompanar`, `detectAdapters`, `adapterFor`, `checkBash`, `biblioteca`, `key`, `paraLenguaje`, `parseLlamada`, `expandir`, `esc`, `pedidoDe`, `planExpansion`, `aplicarExpansion`, `commentContent`, `kindOf`, `parse`, `scanComments`, `skipTo`, `codeOnly`, `dataDir`, `loadConfig`, `makeZoner`, `rel`, `zoneOf`, `isCritical`, `isIgnored`, `origenDe`, `m`, `notaOrigen`, `sugerirAutoria`, `esMio`, `conContenido`, `conocer`, `projectContext`, `contextBlock`, `loadPatrones`, `registrarPatron`, `cargarDialogos`, `olvidarDialogo`, `conversar`, `doctor`, `instalar`, `listFiles`, `reglasDiags`, `runGate`, `inlineSolutions`, `fileIdentifiers`, `overlap`, `guardReplies`, `conversation`, `removeComments`, `cleanText`, `runHook`, `caiCommand`, `init`, `ensure`, `langFor`, `textoParcial`, `llmActual`, `setLLM`, `ask`, `registrarUso`, `evitada`, `leerUso`, `sinSugerencia`, `sugerenciaDe`, `unaLinea`, `parseMemoria`, `seccion`, `agregarPreguntas`, `sobreElCodigo`, `medir`, `violaciones`, `rutaTest`, `funcionesSinTests`, `esModo`, `modoEfectivo`, `r`, `lineaDeDefinicion`, `reanclar`, `cargarNotas`, `guardarNotas`, `nuevaNota`, `mensaje`, `todasLasNotas`, `funcionesDe`, `funcionEn`, `claveFuncion`, `nombreDeClave`, `funcionPorClave`, `claveDe`, `fuentesDe`, `consolidar`, `notaPara`, `agregar`, `ocupar`, `liberar`, `dejarPendiente`, `tomarPendiente`, `enCurso`, `ocuparEsperando`, `conBloqueo`, `constructor`, `leerMemoria`, `panorama`, `actualizarMemoria`, `preguntasAbiertas`, `responderPregunta`, `estadoPanorama`, `getParser`, `hijos`, `nombrados`, `planoArchivo`, `validoSnippet`, `validarExpresion`, `exportedFunctions`, `runPredecir`, `delata`, `ejecutar`, `coincide`, `runCheck`, `home`, `nivelDe`, `loadPerfil`, `puntaje`, `declarar`, `registrar`, `temasDe`, `add`, `rapida`, `pedirGuia`, `conCodigo`, `eolOf`, `separarListas`, `responderNota`, `n`, `ubicarSnippet`, `palabras`, `aplica`, `runReview`, `numerar`, `guardarCache`, `terminarPerfil`, `markdown`, `markdownGrupo`, `publicar`, `atender`, `servir`, `iniciar`, `entrada`, `preguntar`, `resolver`, `rechazar`, `precalentar`, `cerrar`, `jsonDe`, `fijarPlazo`, `conSesion`, `guardarDiagnosticos`, `rutasDe`, `cargarTareas`, `guardarTareas`, `agregarTareas`, `actualizarTareas`, `siguiente`, `generadosPor`, `datos`, `plantilla`, `notasYTareas`, `checkSnapshot`, `keepAside`, `checkOne`, `checkLeftovers`, `stripJsonc`, `snippetScopes`, `snippetPolicy`, `toSnippetBody`, `crearSnippet`, `loadEstado`, `saveEstado`, `getHilo`, `setHilo`, `hilosDe`, `deleteHilo`, `riesgos`, `explica`, `pregunta`, `corre`, `keep`, `error`, `noProbable`, `generarCasos`, `probarCasos`, `proponerTests`, `limpio`, `correrTests`, `recorrerCasos`, `guiaId`, `findThreads`, `nextThreadId`, `regionOf`, `regionesTop`, `mk`, `iaOpts`, `pedidoExplicito`, `marcadores`, `splitQuestions`, `resolveMissing`, `runGuia`, `sugeridos`, `sinAprobaciones`, `cegar`, `huella`, `verificar`, `dentro`, `sanitizeGuia`, `verifyCommentOnly`, `watch`, `handle`, `resaltarDestino`, `insertarSnippet`, `provideCodeActions`, `revisarConEdiciones`, `provideCodeLenses`, `cli`, `root`, `relDe`, `correr`, `vista`, `envVista`, `guardadoPropio`, `guardar`, `archivoNotas`, `claveDeSimbolo`, `nombre`, `notasDe`, `silenciado`, `minutosSilencio`, `silenciar`, `mostrarError`, `leerConfig`, `registrarConfiguracion`, `actual`, `actualizar`, `run`, `dispose`, `programar`, `cambiar`, `activate`, `reg`, `vistaActual`, `validateInput`, `programarAsentado`, `acompanarAhora`, `probarAlGuardar`, `abrir`, `deactivate`, `sanear`, `resolveWebviewView`, `vigilarEnVivo`, `leer`, `enfocar`, `seguir`, `notaActual`, `deEsta`, `recibir`, `esqueleto`, `md`, `boton`, `render`, `opcion`, `meta`, `enLinea`, `icono`, `provideCommentingRanges`, `notas`, `dibujar`, `lineas`, `comentarios`, `ubicar`, `pedir`, `args`, `ocupado`, `pedirSinHilo`, `alCambiar`, `avisar`, `provideHover`, `crearArchivo`, `irA`, `refrescar`, `cargar`, `getTreeItem`, `comandoPaso`, `getChildren`, `servidor`, `limpiar`, `mostrar`, `consultar`, `respaldo` (pídelos con `@ia? !tests` o `cai tests <archivo> <función>`).
- Preguntas `@ia?` sin responder: examples/demo-ts/src/cuota.ts (1).
- Snippets sugeridos sin activar: packages/complementairy/src/render.ts (1), packages/complementairy/src/selftest.ts (3).
- Tus errores más frecuentes: seguridad/validacion-entrada (2), bugs/async-faltante (2), tests/tests-casos-borde (2), seguridad/api-incorrecta (1), seguridad/manejo-errores (1).
- IA en los últimos 7 días: 83 llamadas, US$2.79 (detalle: `cai uso`).
