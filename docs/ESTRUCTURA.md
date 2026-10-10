# Estructura del proyecto

<!-- Propuesta de ComplementAIry (2026-10-09). Edítala con lo que decidas: es la referencia para guías, planos y revisiones. -->

## Arquitectura

Mantén el monorepo como está (CLI + extensión que habla con la CLI por `execFile`/`cai servir`, un buen límite), pero ordena los ~50 archivos sueltos de `packages/complementairy/src` en 5 capas: nucleo (puro), proyecto (lectura de .cai y config), garantias (deterministas), ia (lo único que habla con Claude) y flujos (los comandos), más cli/ arriba. Encaja porque la promesa del producto es "las garantías no dependen de la IA". Con capas, esa promesa se puede comprobar con un test en vez de confiar en la memoria. Además, hoy nombres como verify.ts/verificar.ts o plano.ts/planoArchivo.ts confunden incluso a quien los escribió.

## Carpetas

- `packages/complementairy/src/nucleo/`: Código puro sin fs ni IA: lang, parser, comments, render, metricas y la regla "solo cambiaron comentarios". Es lo más testeable y lo que más se reutiliza.
- `packages/complementairy/src/proyecto/`: Leer y escribir el estado del proyecto: config, files, profile, context, state, memoria, modos, adapters, ocupado. Es la única capa que conoce el formato de .cai/.
- `packages/complementairy/src/garantias/`: Lo que impide que la IA toque tu código: hook, bash, snapshot, guard. Ninguno de estos archivos puede depender de la IA.
- `packages/complementairy/src/ia/`: llm, sesion, tutor, threads, rapida, dialogo, responder. Así el costo y los fallos de red quedan aislados en un solo lugar.
- `packages/complementairy/src/flujos/`: Un archivo por caso de uso (acompanante, plano, biblioteca, snippets, review, gate, panorama, arquitectura, terminal, conocer, siguiente, notas, predict, doctor, init, comprension). Orquestan las capas de abajo.
- `packages/complementairy/src/cli/`: Solo leer los argumentos y enrutar (cli.ts, servir.ts, watch.ts), sin lógica de negocio.
- `packages/complementairy/test/`: Espejo de src/ más un test de arquitectura que hace cumplir las reglas de dependencias.
- `examples/`: Proyectos de prueba. Aquí debería vivir `Files.js` (proyecto Obsidian) en vez de estar en la raíz del repo de la herramienta.

## Módulos

_✓ ya existe · ○ por crear (aparece como tarea en el panel)_

- ○ `packages/complementairy/test/arquitectura.test.ts`: Lee los imports de cada archivo de src/ y falla si alguno rompe una regla de capas. Usa vitest, que ya tienes, sin sumar dependency-cruiser.
  - listarImports: devuelve, para cada archivo, las rutas relativas y los paquetes que importa
  - capaDe: deduce la capa (nucleo, proyecto, garantias, ia, flujos, cli) a partir de la carpeta
  - reglasPermitidas: tabla de qué capa puede importar a cuál
  - explicarViolacion: arma un mensaje del tipo "garantias/hook.ts importa ia/llm.ts: las garantías deben ser deterministas"
- ○ `packages/complementairy/src/nucleo/soloComentarios.ts`: Nuevo nombre de verify.ts: decide si entre el antes y el después solo cambiaron comentarios @guia. Es la regla central del producto.
  - verificarSoloComentarios: compara los dos árboles sin comentarios y devuelve el veredicto con su motivo
  - sanearGuia: limpia el texto de un comentario @guia antes de insertarlo
- ○ `packages/complementairy/src/flujos/comprension.ts`: Nuevo nombre de verificar.ts: comprueba que entiendes tu código (cegar, sinAprobaciones). Así no se confunde con soloComentarios.
  - verificarComprension: arma el ejercicio y evalúa la respuesta
  - cegar: oculta una línea para el ejercicio
  - sinAprobaciones: quita marcas de aprobación del código
- ○ `packages/complementairy/src/ia/llm.ts`: Único punto que importa @anthropic-ai/claude-agent-sdk. Expone una interfaz LLM que los flujos reciben por parámetro, para poder testearlos con un falso.
  - crearLLM: arma el cliente con herramientas de solo lectura
  - consultar: envía el prompt y devuelve texto y costo
  - llmFalso: versión determinista para tests y selftest
- ○ `packages/complementairy/src/flujos/acompananteDecisiones.ts`: Se separa de acompanante.ts: solo la parte determinista (errores persistentes, archivo vacío, falta plano, trabado) sin fs ni IA, para testearla con datos.
  - decidirAcciones: a partir del estado del archivo y las métricas, devuelve la lista de acciones a tomar
  - detectarTrabado: aplica la regla de tiempo e intentos sin progreso
  - errorPersistente: dice si el mismo error se repite N guardados seguidos
- ○ `packages/complementairy/src/flujos/acompanante.ts`: Se queda solo como orquestador: carga el estado, pide las decisiones, delega la redacción a ia/ y publica la salida.
  - acompanar: ejecuta un ciclo de guardado completo
  - ejecutarAccion: aplica una acción decidida (expandir snippet, responder, proponer plano)
- ○ `packages/complementairy/src/cli/comandos.ts`: Tabla de comandos (nombre, ayuda, función del flujo) que reemplaza el switch largo de cli.ts. Agregar un comando pasa a ser agregar una fila.
  - comandos: lista declarativa de comandos con su descripción y su handler
  - buscarComando: resuelve alias como predecir/check y lanza un error explicativo si el comando no existe
- ○ `packages/complementairy/src/cli/cli.ts`: Punto de entrada del bin: parsea argv, busca el comando y muestra los errores de forma legible.
  - main: lee argv, ejecuta el comando y fija el código de salida
  - mostrarError: imprime el mensaje explicativo sin stack, salvo con --debug
- ○ `packages/complementairy/src/garantias/hook.ts`: Hook PreToolUse/PostToolUse. Solo usa nucleo/, proyecto/ y garantias/ para que una caída de la IA nunca abra un hueco.
  - alPreTool: simula la edición y bloquea si no es solo comentarios
  - alPostTool: compara la foto y revierte cambios sin permiso

## Por dónde empezar

1. Escribe test/arquitectura.test.ts con las reglas y márcalas como pendientes: así ves la lista real de violaciones antes de mover nada.
2. Renombra verify.ts → soloComentarios.ts y verificar.ts → comprension.ts, y une plano/planoArchivo y notas/notasFuncion si resultan ser lo mismo. Son cambios chicos que quitan la mayor confusión.
3. Mueve nucleo/ (lang, parser, comments, render, metricas, soloComentarios) y corre `cai selftest` y `pnpm test`.
4. Mueve proyecto/ y garantias/, y activa en el test las reglas de nucleo y garantias.
5. Mueve ia/ y haz que los flujos reciban el LLM por parámetro, con llmFalso en los tests.
6. Mueve flujos/ y separa acompananteDecisiones.ts con tests de sus decisiones (incluye casos borde: archivo vacío, error que cambia de línea, ¿el contador de trabado se reinicia al guardar sin cambios?).
7. Convierte cli.ts en una tabla de comandos dentro de cli/ y actualiza el bin en package.json.
8. Actualiza la sección Componentes de docs/design.md y activa todas las reglas del test en CI.

## Reglas verificables

- nucleo/ no importa node:fs, node:child_process, @anthropic-ai/claude-agent-sdk ni ninguna otra capa de src/.
- Solo ia/llm.ts importa @anthropic-ai/claude-agent-sdk.
- garantias/ no importa ia/ ni flujos/: las garantías deben funcionar sin IA.
- Ningún archivo fuera de cli/ importa cli/, y flujos/ no se importan entre sí salvo por acompanante.ts.
- packages/vscode-complementairy no importa código de packages/complementairy: solo lo invoca por la CLI (cai … --json / cai servir).

_Se pueden verificar con dependency-cruiser / import-linter (pide "!arquitectura")._

## Decisiones pendientes

_También están en el panel → Preguntas para ti._

- ¿Files.js (proyecto Obsidian) en la raíz es tu sandbox de prueba real o quedó ahí por accidente? _(sugerencia: Muévelo a examples/obsidian-files/ con su propio .cai/. Así no mezclas el estado de .cai/ de la herramienta con el de un proyecto usuario.)_
- ¿Prefieres hacer la reorganización en un solo commit grande o capa por capa? _(sugerencia: Capa por capa, con selftest en verde en cada paso: si algo se rompe, sabes qué movimiento fue.)_
- ¿La extensión de VSCode debe seguir hablando solo por CLI, o planeas importar el núcleo directamente para ganar velocidad? _(sugerencia: Sigue por CLI y `cai servir` (ya lo usas en rapidas.ts): mantiene una sola fuente de verdad y deja la puerta abierta a otros editores.)_
- Para usuarios no técnicos, ¿piensas en otra interfaz (web o chat) o en la misma extensión simplificada? _(sugerencia: Decídelo antes de tocar flujos/: si habrá otra interfaz, los flujos deben devolver datos (JSON) y nunca imprimir directamente.)_
