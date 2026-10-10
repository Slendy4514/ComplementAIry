# Plan A: ComplementAIry v1.0, "el que vio el proyecto"

> **Origen:** un agente planificador que **leyó el código** de ComplementAIry v0.11 y los documentos (`docs/design.md`, `docs/historial.md`, `docs/research.md`, `docs/ESTRUCTURA.md`). Fecha: 2026-10-10.
>
> **Numeración:** este plan usa la numeración **anterior** del manifiesto. Equivalencias con la actual: II (Cimientos) → **III**; III (Prompting) → **IV**; IV (Workflow) → **V**; V (Reglas de oro) → **VI**. Los puntos nuevos (**I.6** Regla de Oro del Aprendiz y la sección **II** Psicología) no figuran aquí; están en [plan-C-mezclado.md](plan-C-mezclado.md).
>
> Ver también: [plan-B-desde-cero.md](plan-B-desde-cero.md) · [comparacion.md](comparacion.md) · [plan-C-mezclado.md](plan-C-mezclado.md).

## 0. El cambio de fondo, antes del plan

ComplementAIry v0.11 se apoya en un principio: **"la IA nunca escribe tu código"**. Lo dicen `package.json` ("nunca escribe tu código"), CLAUDE.md ("No escribas código en zona humana") y el `preEdit` de `hook.ts`, que deniega todo cambio que no sea un comentario. La única excepción es `construir.ts`, y ese código entra solo con tu clic.

El Manifiesto pide otra cosa. Su paso IV.3 dice "Ejecución con restricciones": la IA implementa un plan aprobado y tú revisas. Además pides que el programador "baje a tocar código y use la IA donde lo requiera".

Por eso v1.0 deja de ser "la IA no escribe" y pasa a ser **"la IA escribe solo dentro de una tarea con plan aprobado, nunca en líneas rojas, y nada entra a un commit sin evidencia de que un humano lo entendió"**.

Esto contradice la conclusión 2 de `docs/research.md`: delegar reduce la comprensión (Shen y Tamkin 2026: 50 % contra 67 %). El mismo estudio también da la salida: a quienes hacían preguntas conceptuales y pedían explicaciones no les bajó la comprensión. El plan entero está diseñado para obligar a usar la IA de esa forma.

---

## 1. Diagnóstico: qué conservar, qué tirar y qué fusionar

### Conservar (es lo valioso y está probado)

| Pieza | Por qué |
|---|---|
| `verify.ts` → `verifyCommentOnly` y `sanearGuia` | Es la regla determinista más probada (escenarios `[seg]`). Sigue siendo la regla para la IA cuando no hay una tarea en ejecución. |
| `hook.ts`: `applyEdits`, `variants`, `realPath`, la elección de zona más restrictiva y la falla cerrada (`NO_SIMULABLE`, `MAX_VERIFY_BYTES`) | Es la base del nuevo control de acceso. |
| `snapshot.ts` (`takeSnapshot`, `checkSnapshot`, `checkLeftovers`, `soloHumano`, `propuestaHonesta`) | Impide que la IA escriba por Bash. Es indispensable para que el registro de procedencia sea exacto. |
| `bash.ts` y la detección de riesgos de `terminal.ts` | Bloquean instalaciones y commits; también se reutilizan en `cai git`. |
| `confirmar.ts` | Registrar la respuesta humana en el PostToolUse de AskUserQuestion (`tool_response.answers`, opciones exactas, texto completo) es el único canal verificado de "lo decidió el humano" desde Claude Code. |
| `almacen.ts` (escritura atómica, `DatosDanados`, `leerCache`) y los candados de `ocupado.ts` (`conCandadoSync`) | Base del almacén unificado. |
| `indice.ts` (firmas, `llama`/`llamadaPor`, huellas, `mapaArchivo`) e `impacto.ts` | Cubren II.1 y alimentan el modelo mental. |
| `sandbox.ts` (`node:vm`, dobles con Proxy) y `validarExpresion` | Permiten predicciones ejecutadas sin juez de IA. |
| `construir.ts`: `ordenValida`, `copiado`, `VAGO`/`AMPLIO`, `trampas`, `verificarFiel`, `partesDeFuncion`/`armar` | Son el núcleo de "con tus palabras" y del verificador barato. |
| `decisiones.ts` (pendiente/vigente/retractada, `decisionesHonestas`) y `arquitectura.ts` (ADR) | Base de los marcos de decisión. |
| `gate.ts` y `adapters.ts`; `metricas.ts`; `profile.ts`; `snippets.ts`; `notas.ts` (anclas que se re-anclan solas) | Cada una tiene un papel en el manifiesto (ver la tabla de la sección 3). |
| `review.ts` (revisión a ciegas, consolidación) | Pasa a ser el rol "agente revisor". |

### Tirar

- **Los modos en dos ejes** (`compartido.ts` → `Modo`, `MODOS`, `modos.ts`, `config.modos.porCarpeta/porArchivo/porFuncion`). Quién escribe pasa a ser propiedad de la **tarea**, no del archivo. Cuánta ayuda se da sale del perfil. Con esto desaparece la explosión de combinaciones (4 modos × 2 vistas × escalera × nivel del acompañante).
- **`vista: "notas" | "comentarios"` como configuración.** Queda solo notas. Los `@guia` sobreviven como formato de salida para editores sin extensión, no como modo. Así se va la rama `agregaGuia` del hook.
- **`ideas.ts`**: no está en el manifiesto. Las ideas pasan a ser tareas en borrador.
- **`chat.ts` como segundo chat con su propio historial.** Se reemplaza por una conversación por tarea, ligada a la sesión de Claude Code o del SDK (III.6).
- **`rapida.ts` como canal aparte**: se fusiona con la guía (ver abajo).
- **Los campos de compatibilidad** `ia.modeloRapido`, `.aicode/` y `migrarModos`. Los absorbe el migrador.

### Fusionar

| Hoy | v1.0 |
|---|---|
| `verify.ts` + `verificar.ts` | `nucleo/soloComentarios.ts` + `flujos/comprension.ts` |
| `context.ts` + `contexto.ts` | `proyecto/contexto.ts` |
| `plano.ts` + `planoArchivo.ts` | `flujos/plano.ts` (alcance proyecto o archivo) |
| `tutor.ts`, `responder.ts`, `rapida.ts`, `acompanante.ts` | `flujos/guia/`: **un solo pipeline** `guiar(pedido, canal)`. `acompananteDecisiones.ts` queda puro, como ya proponía ESTRUCTURA.md. |
| `siguiente.ts`, `tareas`, `ideas.ts`, `hoy`/`deuda`/`sesion` (`resumenSesion.ts`), `panorama.ts` | `flujos/estado.ts`: un único "qué sigue", **determinista**, calculado desde el estado de las tareas y la deuda de comprensión. El panorama con IA queda como insumo opcional de decisiones. |
| `predict.ts`, `predecirConstruir`, `probarPorcion`, `probarDiferida`, `generarCasos`, `casosConstruir` | `nucleo/prediccion.ts` (validar, ejecutar y comparar) + `flujos/comprension.ts` |
| `review.ts`, `revisionCompleta.ts` y la parte de IA de `verificar.ts` | `flujos/revision/` (solo revisores IA a ciegas; **no** deciden nada) |
| `Nota.programada`, `deudaComprension`, `acompanante.revisados` | El nuevo **registro de procedencia** |
| `comandos.ts` (switch de 1422 líneas) | `cli/tabla.ts` declarativo |
| `selftest.ts` (2785 líneas) | `test/escenarios/<modulo>.test.ts` + `cai selftest` como prueba de humo del binario instalado |

**Violaciones de capas que hay que cortar:** `indice → verificar → llm` (el índice no puede depender de la IA; el resumen de IA se inyecta desde fuera), `siguiente → panorama → llm` y `hook → confirmar → siguiente/ideas`. El registro de respuestas pasa a `proyecto/registro.ts`, sin ninguna IA en la cadena del hook.

---

## 2. Arquitectura objetivo v1.0

### 2.1 Capas

Tomo la propuesta de `docs/ESTRUCTURA.md` y le agrego tres módulos centrales:

```
src/
  nucleo/      puro: lang, parser, comments, metricas, soloComentarios, diffLineas,
               flujo (máquina de estados), prediccion (validar/comparar), matriz (EV, pesos)
  proyecto/    único que conoce .cai/: almacen, esquemas/, config, reglas (global+proyecto),
               tareas, decisiones, procedencia, evidencias, indice, notas, migraciones/
  garantias/   hook (por evento), bash, snapshot, gitHooks, ci. NO importa ia/ ni flujos/
  ia/          proveedores/ (agentSdk, anthropicApi, openaiCompatible, falso), roles, uso
  flujos/      tarea (diseño, plan, aprobación, ejecución), revision, comprension, pruebas,
               desconectar, reconstruir, entender (mapa/recorrido/repaso), decidir, guia/, git
  cli/         tabla de comandos, args, servir
```

`test/arquitectura.test.ts` hace cumplir estas reglas desde la Fase 0.

### 2.2 Almacén unificado `.cai/` v1

Cada archivo lleva `version` y un esquema en `proyecto/esquemas/`, validado al leer. Las migraciones van en `proyecto/migraciones/`.

| Ruta | Contenido | ¿Va al repo? |
|---|---|---|
| `.cai/config.json` | `version: 1`, zonas (`rojas`, `delegadas`, `heredado`, `terceros`), `ia.roles`, `flujo` (umbrales) | sí |
| `.cai/reglas/proyecto.md` | Secciones obligatorias: Stack y versiones, Datos, API, Ramas, Pruebas | sí |
| `.cai/reglas/*.md` | Reglas con `paths:` | sí |
| `.cai/reglas/mecanicas.json` | Reglas mecánicas | sí |
| `.cai/tareas/<id>/tarea.json` | Estado, diseño, plan, restricciones y bitácora de eventos | sí |
| `.cai/tareas/<id>/adjuntos/` | Capturas (III.4) | sí |
| `.cai/decisiones/<id>.json` | Pregunta, criterios, opciones y elección | sí |
| `.cai/procedencia/<archivo>.json` | Quién escribió cada tramo y si se revisó | sí, con merge driver propio |
| `.cai/evidencias/<id>.json` | Explicaciones, predicciones, interrogatorios y reconstrucciones | sí |
| `.cai/notas/`, `.cai/indice.json`, `.cai/cache/` | Como hoy | `indice.json` y `cache/` se regeneran |
| `~/.cai/reglas-globales.md` y `reglas-globales.json` | Reglas globales (II.2) | — |
| `~/.cai/` | `perfil.json`, `uso.jsonl`, `proveedores.json` (sin claves: las claves van por variables de entorno), `repertorio/` | — |

**Precedencia de reglas, una sola y explícita:** zona protegida > línea roja > regla de proyecto por ruta > regla de proyecto > regla global > valor por defecto. `cai reglas` muestra la regla efectiva junto a su origen. Esto resuelve las "reglas en ~10 lugares sin esquema".

### 2.3 Modelo central: la tarea

La máquina de estados vive en `nucleo/flujo.ts`. Es una tabla pura de transiciones: estado, evento, guarda y siguiente estado. Cada guarda es una función determinista y se prueba con tablas en vitest.

```
borrador ─(diseño válido)→ diseñada ─(plan IA sin código)→ planificada
  ─(decisiones resueltas + restricciones + paráfrasis humana)→ aprobada
  ─(cai tarea ejecutar)→ ejecutando ─(Stop del ejecutor o humano)→ en-revision
  ─(evidencia por tramo IA)→ revisada ─(gate + checklist IV.5)→ probada
  ─(commit verificado)→ cerrada
Desde ejecutando/en-revision: ─(detector de bucle o humano)→ desconectada → (volver a verde) → diseñada
```

- **Diseño humano (IV.1).** Campos: problema, enfoque con tus palabras, archivos y símbolos de contexto, criterios de terminado y ejecutor (`ia` o `humano`). Las guardas son deterministas:
  - mínimo de palabras;
  - el enfoque menciona al menos 2 identificadores que existen en `indice.json` o que están declarados como nuevos;
  - la lista `VAGO` de `construir.ts` se amplía a verbos sin objeto ("arregla", "mejora", "haz que funcione");
  - al menos un criterio de terminado verificable (una llamada con su resultado esperado o un comando).
  - Si `copiado()` da 0,5 o más contra cualquier texto de la IA, se rechaza: el diseño no puede salir de la IA.
- **Plan (IV.2).** Lo hace el rol `planificar` (modelo de razonamiento) con un esquema JSON fijo: `flujoDeDatos`, `funcionesClave[]`, `integracion[]`, `retos[]`, `supuestos[]`, `ambiguedades[]` (cada una con exactamente 2 opciones con pros y contras), `archivos[]`, `comoProbar[]` y `fuentes[]`. El prompt dice textualmente: "No escribas código todavía". `guard.ts` rechaza de forma determinista cualquier bloque o expresión de código y vuelve a pedir el plan. Cada supuesto y cada ambigüedad se convierten en una **decisión pendiente**.
- **Aprobación.** Sin botón "Aceptar":
  1. No queda ninguna decisión pendiente.
  2. Se completan las restricciones: `alcance` (archivos que se pueden tocar, por defecto los del plan y editables), `sinDependencias: true`, `preservar[]` (símbolos cuyo cuerpo no puede cambiar, verificado por la huella de tree-sitter) y `presupuestoLineas`.
  3. Escribes una **paráfrasis** con tus palabras que cumple `ordenValida`: no copiada, y menciona al menos 2 pasos del plan.

  Al aprobar se congela `planHash`. Desde Claude Code se hace con AskUserQuestion, header `cai:ap-<id>`, y respuesta de texto libre que valida el hook PostToolUse.

### 2.4 Registro de procedencia

`proyecto/procedencia.ts` guarda, por archivo, **tramos**: listas de líneas consecutivas con la misma metadata. Cada línea se ancla por la huella de su texto normalizado más la función que la contiene, igual que `notas.ts`. Cada tramo guarda:

```ts
{ origen: "humano"|"ia"|"snippet"|"heredado"|"previo-propio"|"ia-previa"|"pegado",
  autor?: { modelo, proveedor, rol, sesion }, tarea?, fecha,
  revision: { nivel: 0|1|2|3|4, evidencias: string[] } }
```

Los niveles de revisión: 0 = nada, 1 = mostrado (solo telemetría, **no cuenta**), 2 = explicado, 3 = predicción ejecutada que acertó, 4 = reescrito por el humano.

**Cómo se atribuye de forma exacta:**

1. **PreToolUse Edit/Write de la IA.** Antes de editar se "asienta" lo pendiente: la diferencia entre el archivo y la última foto del registro se atribuye a `humano`. Después se guarda la foto.
2. **PostToolUse Edit/Write** (hoy no está en el matcher de `init.ts`). La diferencia se atribuye a `ia`, con modelo, rol y tarea.
3. **La extensión, al guardar.** La diferencia es `humano`. Los cambios grandes en un solo evento de `onDidChangeTextDocument` que no vienen de un snippet ni de un deshacer se marcan como `pegado` (origen desconocido: puede venir de otra IA).
4. **Expansión de snippets** (`cai expandir`): `snippet`.
5. **`cai adoptar`** (al iniciar en un repo existente o al migrar): `git blame --porcelain`. Si el autor es tu email: `previo-propio`. Si el commit trae un trailer `Co-Authored-By: Claude…`/Copilot: `ia-previa`. El resto: `heredado`. Todo empieza en nivel 0.
6. **pre-commit.** Hace una última asentada, reescribe `.cai/procedencia/*.json` y lo agrega al commit. Un **merge driver** (`cai merge-procedencia`, unión determinista por huella) evita conflictos.

Por qué no se usan git notes: se pierden con squash y rebase en GitHub. Un archivo versionado sobrevive y se revisa en el PR.

### 2.5 Quién hace cumplir qué

**Hooks de Claude Code** (los instala `garantias/hook.ts`, uno por evento):

| Evento | Qué hace |
|---|---|
| `SessionStart` | Liga `session_id` a una tarea e inyecta un contexto corto: estado, alcance, resumen del plan y restricciones. |
| `UserPromptSubmit` | Bloquea (`decision: block`) si la sesión ya está ligada a otra tarea, o si el transcript (`transcript_path`) supera el umbral de turnos o tamaño (III.6). Sin tarea en `ejecutando`, agrega: "no hay plan aprobado: puedes conversar, planificar o guiar". |
| `PreToolUse Edit/Write/MultiEdit` | Ver el detalle debajo de la tabla. |
| `PostToolUse Edit/Write` | Registra la procedencia y corre lint/tipos del archivo como retroalimentación para la IA. |
| `PreToolUse Bash` | Como hoy, más: se bloquea `git commit/reset/checkout` de la IA y la IA no puede escribir código por Bash, para que toda escritura pase por Edit y la atribución sea exacta. |
| `PreToolUse mcp__.*` | Política por herramienta: las de lectura se permiten; las que escriben en sistemas externos devuelven `permissionDecision: "ask"`. |
| `PreToolUse Task` | Solo se permiten los roles de subagente definidos para la tarea. |
| `Stop` | Si hay diff y la tarea está en `ejecutando`, pasa a `en-revision` y corre el gate rápido. Respeta `stop_hook_active` para no entrar en bucle. |

Las reglas del `PreToolUse` de edición, en orden:
1. Lo protegido y las líneas rojas se deniegan **siempre**.
2. Sin una tarea en `ejecutando` cuyo alcance incluya el archivo, solo se permite `verifyCommentOnly`.
3. Con una tarea en `ejecutando` se deniega si: el archivo está fuera del alcance; cambia un símbolo de `preservar`; agrega dependencias (diff de `package.json`/`pyproject`); toca **líneas `humano` de esta tarea** (IV.4.3: "refactoriza alrededor"); supera `presupuestoLineas`; o el detector de bucle se disparó.

**Hooks de git** (en `.githooks/`):

| Hook | Qué verifica |
|---|---|
| `pre-commit` | `cai gate --staged --rapido`. Luego `cai procedencia verificar --staged`: todo tramo `ia` o `pegado` del diff tiene nivel 2 o más; no hay ninguna línea `ia` en zona roja; la tarea asociada está en `probada`. |
| `commit-msg` | Agrega los trailers `Cai-Tarea:` y `Cai-IA: 34 líneas (34 revisadas)`. |
| `post-commit` | Si el gate pasó, registra el **último commit verde**. |
| `pre-push` | Gate completo y regex del nombre de rama (II.3). |

**CI** (`kit/github`, nuevo comando `cai ci`): vuelve a calcular todo desde `.cai/procedencia` y `.cai/evidencias` del repo. Esto cierra el bypass con `--no-verify`. Cada evidencia guarda el hash del tramo al que se refiere: si el código cambió después, deja de valer.

---

## 3. Tabla: cada ítem del manifiesto y su mecanismo

D = determinista; IA = depende de una IA (y nunca bloquea sola).

| Ítem | Mecanismo que lo hace cumplir | Tipo | Módulo |
|---|---|---|---|
| I. Colaboración, no delegación | La IA no escribe código sin una tarea con diseño humano y plan aprobado (hook) | D | `garantias/hook.ts`, `nucleo/flujo.ts` (nuevo) |
| I. Pasante calificado | Restricciones por tarea (alcance, preservar, sin deps, presupuesto) + revisión obligatoria | D | `hook.ts`, `proyecto/tareas.ts` (nuevo) |
| I. Entendimiento sobre velocidad | Sin nivel ≥ 2 en cada tramo IA no hay commit (pre-commit y CI) | D | `flujos/comprension.ts`, `garantias/gitHooks.ts` |
| I. Kernighan | **Presupuesto de complejidad**: si una función IA supera el percentil 90 de anidamiento, longitud y parámetros de las funciones que tú escribiste en ese lenguaje (medido desde la procedencia; sin historial, los umbrales de `practicas`), exige nivel 3 en esa función o que se simplifique | D | `metricas.ts`, `profile.ts` |
| I. Aumentar el criterio | Decidir, retractar, aprobar y ADR son solo humanos (`confirmar.ts`, `soloHumano`, `decisionesHonestas`) | D | existentes |
| II.1 Indexación | `indice.ts` del repo completo al iniciar y al guardar; `doctor` verifica el plugin LSP y la frescura del índice; el ejecutor recibe `mapaArchivo` | D | `indice.ts`, `doctor.ts` |
| II.2 Reglas globales | `~/.cai/reglas-globales.{md,json}` con esquema: filosofía de pruebas, librerías preferidas (una dependencia nueva fuera de la lista se vuelve decisión en el plan), estilo y `bash.permitir` global; fusión con precedencia | D | `proyecto/reglas.ts` (nuevo) |
| II.3 Reglas de proyecto | `proyecto.md` con secciones obligatorias (`doctor` falla si faltan); stack y versiones detectados de lockfiles y contrastados; nombre de rama con regex en pre-push; reglas por submódulo → `.claude/rules/*.md` generadas | D | `reglas.ts`, `init.ts`, `gitHooks.ts` |
| II.4 MCP | Catálogo por stack en `cai doctor` (Context7, Svelte, Figma, Sentry, Stripe, GitHub). La instalación la hace el humano (`.mcp.json` protegido). Hook `mcp__*` con lectura permitida y escritura en "ask". Si la tarea toca una librería con MCP de docs, el plan exige `fuentes[]` | D (política); IA (uso) | `hook.ts`, `doctor.ts`, `flujos/tarea/plan.ts` |
| III.1 Especificidad | Guardas del diseño (identificadores existentes, sin verbos vagos, criterio verificable). El clasificador barato da una segunda opinión que **no** bloquea | D (+IA) | `nucleo/especificidad.ts` (desde `ordenValida`) |
| III.2 Contexto explícito | `contexto[]` obligatorio en el diseño; el ejecutor recibe solo eso + el mapa; las lecturas fuera de contexto se cuentan y se muestran ("agrega X al contexto") | D | `proyecto/contexto.ts`, PostToolUse Read |
| III.3 Prohibido adivinar | `supuestos[]` y `ambiguedades[]` del plan → decisiones; no se aprueba con pendientes; el Stop deniega un diff que toca símbolos que no están en el plan | D | `decisiones.ts`, `hook.ts` |
| III.4 Apoyo visual | Si la tarea toca archivos UI (`*.tsx`, `*.vue`, `*.css`…), aprobar exige al menos una captura en `adjuntos/` o una razón escrita; las imágenes viajan al proveedor que acepte imágenes | D | `flujos/tarea`, `ia/proveedores` |
| III.5 Modelo por fase | `ia.roles` (planificar: razonamiento alto; implementar: modelo de código; revisar; clasificar: barato). **Una sesión por fase**, así nunca se cambia de modelo a mitad de conversación; SessionStart registra el modelo y avisa si cambia | D | `ia/roles.ts` (nuevo) |
| III.6 Conversaciones cortas | Sesión ligada a una tarea; UserPromptSubmit bloquea otra tarea o un transcript largo y sugiere `/clear` con un resumen de traspaso | D | `hook.ts` |
| IV.1 Diseño humano | Estado `borrador`→`diseñada` con guardas; el texto copiado de la IA se rechaza | D | `nucleo/flujo.ts` |
| IV.2.1–2 Plan detallado | Esquema del plan con flujo de datos, funciones, integración y retos | IA + D (esquema) | `flujos/tarea/plan.ts` |
| IV.2.3 "No escribas código" | Instrucción literal + `guard.ts` rechaza código y vuelve a pedir | D | `guard.ts` |
| IV.2.4 Dos opciones con pros y contras | Cada ambigüedad viene con exactamente 2 opciones → matriz de decisión | D (forma) | `flujos/decidir.ts` |
| IV.3 Ejecución con restricciones | Hook: alcance, preservar, sin deps, presupuesto; `comoProbar[]` se convierte en comandos del gate. Dos ejecutores: **por pasos** (el `construir.ts` de hoy, con tus órdenes) o **agente** (SDK con Edit en un worktree) | D | `hook.ts`, `construir.ts` → `flujos/tarea/ejecutar.ts` |
| IV.4.1 Revisión rigurosa | Vista por tramo; nivel ≥ 2 por tramo IA; tramos chicos (presupuesto) | D | `flujos/comprension.ts`, extensión |
| IV.4.2 Preguntas críticas | **Interrogatorio "decidir antes de ver"**: por función cambiada, primero escribes tus casos de borde y tu impacto en rendimiento; recién después la IA responde "¿por qué este patrón? ¿bordes? ¿rendimiento?" y se muestra la diferencia entre las dos listas. Sin tus listas no hay nivel 2 | D (gate) + IA | `flujos/revision/interrogar.ts` (nuevo) |
| IV.4.3 Editar y "refactoriza alrededor" | Tus ediciones quedan `humano` (nivel 4); el hook impide que la IA las toque; `cai tarea refactorizar` abre un paso nuevo con esas líneas bloqueadas | D | `hook.ts`, `procedencia.ts` |
| IV.5 Concurrencia, debounce, rate limit, caché | Detectores con tree-sitter: estado mutable compartido entre `await`, `Promise.all` con escrituras, `setTimeout`/eventos sin cancelar, `fetch` dentro de bucles, `Map` usado como caché sin invalidación. Cada hallazgo exige un test escrito por ti o una decisión "no aplica porque…" | D | `flujos/pruebas.ts` (nuevo) |
| IV.5 Unitarias e integración | `gate.ts` + mutación (Stryker/mutmut) obligatoria si la tarea toca archivos con mucho fan-in | D | `gate.ts`, `adapters.ts` |
| IV.6.1 Agentes especializados | Roles con permisos distintos en el hook: implementador (alcance sin `tests/`), tester (solo `tests/`; los valores esperados los pones tú), revisor (solo lectura, a ciegas), refactorizador (alcance menos líneas humanas) | D (permisos) | `ia/roles.ts`, `hook.ts` |
| IV.6.2 Worktrees | `cai tarea ejecutar --aislada` crea `git worktree` en `cai/t<id>`; un tablero en VSCode con tareas × estado; integrar es humano | D | `flujos/tarea/worktree.ts` (nuevo) |
| IV.6.3 Git en lenguaje natural | `cai git "…"`: la IA traduce a una lista de comandos; el detector de riesgos de `terminal.ts` los clasifica; los corre el humano (los destructivos piden escribir el nombre de la rama) | IA + D | `flujos/git.ts`, `terminal.ts` |
| IV.7 Detectar el bucle | Señales deterministas: el mismo test falla tras N intentos de la IA; oscilación (la huella de un tramo vuelve a un valor anterior); M denegaciones seguidas del hook; el diff crece sin que pasen más tests; transcript largo. Pasa a `desconectada` y el hook deniega toda edición de la tarea | D | `flujos/desconectar.ts` (nuevo) |
| IV.7 Volver al último verde | `cai volver`: solo humano. Guarda el estado actual en una rama `cai/abandono-<id>` y vuelve al último commit verde registrado; la tarea vuelve a `diseñada` | D | `desconectar.ts`, `gitHooks.ts` |
| V.1 Líneas rojas | `zonas.rojas` (antes `criticas`, que hoy solo agrega fricción): la IA no escribe ahí nunca, **ni siquiera con `construir.ts`** (hoy sí puede). `doctor` sugiere rojas por imports de cripto/auth/JWT. Un hunk IA con APIs de seguridad fuera de zona roja se deniega hasta que decidas | D | `config.ts`, `hook.ts` |
| V.2 Para qué sí | Zonas delegadas por tipo (config, plantillas de test); snippets (`snippets.ts`); `cai decidir alternativas` (3 enfoques → matriz); onboarding con `cai entender mapa` | D + IA | `snippets.ts`, `flujos/decidir.ts`, `flujos/entender.ts` |
| V.3 Reconstrucción semanal | `cai reconstruir`: elige una función IA de la semana (ponderada por riesgo); worktree con el cuerpo vacío; ahí el hook deniega **toda** IA, incluida la guía. Validación con tus casos originales y una predicción. Sin reconstrucción en 7 días, las tareas con ejecutor IA no pasan a `ejecutando` | D | `flujos/reconstruir.ts` (nuevo) |

---

## 4. Marcos de decisión y proveedores baratos

### 4.1 Marcos de decisión (`flujos/decidir.ts`, `nucleo/matriz.ts`)

Hay tres formas, todas sobre `.cai/decisiones/<id>.json`:

1. **Binaria (IV.2.4).** Dos opciones con pros, contras y "cuándo conviene". Decides con AskUserQuestion o en el panel (como hoy).
2. **Matriz ponderada.**
   - **Defines los criterios y sus pesos antes de ver las opciones.** Así se evita el anclaje (arXiv 2412.06593, ya citado en design.md).
   - La IA llena la evidencia por criterio y opción, citando archivos o docs.
   - **Tú pones los puntajes.**
   - El total y el **análisis de sensibilidad** son deterministas: "si el peso de *mantenibilidad* baja 20 %, gana B".
   - Si la IA sugiere un puntaje, aparece marcado y nunca se suma solo.
3. **Valor esperado.** Para decisiones con riesgo: opciones × escenarios. Tú pones la probabilidad y el costo; la IA solo sugiere rangos, marcados como tales. Se calculan de forma determinista el valor esperado, el **minimax regret** y el caso peor.

Cuando una decisión con alcance de arquitectura queda vigente, se genera `docs/adr/NNNN.md` (Contexto, Opciones, Matriz, Decisión, Consecuencias) con `arquitectura.ts`. Las decisiones expresables como regla se ofrecen como dependency-cruiser/import-linter.

### 4.2 Proveedores intercambiables (`ia/proveedores/`)

```ts
interface Proveedor {
  id: string; capacidades: { herramientas: boolean; imagenes: boolean; json: boolean; razonamiento: boolean };
  local: boolean; precio: { entradaMTok: number; salidaMTok: number };
  consultar<T>(r: { rol: Rol; system: string; prompt: string; schema: object; imagenes?: string[] }): Promise<{ data: T; costo: number; modelo: string }>;
}
```

- **Implementaciones:**
  - `agentSdk`: el `realLLM` actual, para roles con herramientas de lectura.
  - `anthropicApi`: llamada directa, sin la sobrecarga de Claude Code (Haiku para clasificar).
  - `openaiCompatible`: una sola implementación cubre Ollama (`localhost:11434/v1`), DeepSeek, Gemini (endpoint compatible) y OpenRouter.
  - `falso`: reemplaza a `setLLM` en los tests.
- **Ruteo por rol, no por tamaño:**

  ```json
  "ia": { "roles": { "planificar": "anthropic:opus+alto", "implementar": "agentSdk:sonnet",
          "revisar": "agentSdk:sonnet", "interrogar": "anthropic:sonnet",
          "clasificar": "ollama:qwen2.5-coder", "verificarFiel": "anthropic:haiku",
          "resumir": "ollama:…", "traducirGit": "anthropic:haiku" },
          "privacidad": "normal" | "solo-local" | "solo-anthropic", "respaldo": ["anthropic:haiku"] }
  ```

- **Qué se permite abaratar:** clasificar (especificidad, ¿la pregunta ya se responde con el código?), filtrar, `verificarFiel` y resumir módulos. **Nunca** planificar en zona sensible, revisar seguridad, ni nada que bloquee. Lo barato **solo aconseja**. La salida se valida con el esquema; si falla, se usa el respaldo.
- **`cai ia evaluar <rol>`:** corre un set dorado (fixtures del selftest + casos que etiquetaste) y muestra aciertos, latencia y costo por proveedor. Un rol barato se habilita solo si alcanza la precisión mínima configurada. Es una medición determinista, no una impresión.
- **Privacidad:** cada proveedor externo que no sea Anthropic exige un opt-in explícito por proyecto (`doctor` lo muestra). `solo-local` deniega mandar código fuera.
- `uso.jsonl` suma `proveedor` y `rol`; `cai ia uso` desglosa el costo por fase.

---

## 5. "No revisado por humano" y modelo mental

### 5.1 `cai entender sin-revisar` (CLI, panel y gutter)

- **En el gutter de VSCode**, con colores tipo cobertura: IA sin revisar (rojo), IA revisada (verde), heredado sin entender (ámbar), pegado (morado).
- **Reporte por módulo y función:** `ia 120 líneas (98 revisadas) · heredado 2300 (140 entendidas) · pegado 12`.
- **Ordenado por riesgo**, con un puntaje determinista: zona roja × fan-in (`llamadaPor`) × churn (`git log`) × origen × sin tests.
- **"Cobertura de comprensión"** por proyecto, separada por origen.

### 5.2 Evidencia válida (sin botones ni quizzes)

- **Nivel 2, explicación.** Tus palabras sobre el tramo. Se valida de forma determinista:
  - largo proporcional a la complejidad del tramo;
  - menciona al menos un identificador del tramo;
  - `copiado() < 0,5` contra el plan, la respuesta de la IA y los comentarios del código.

  Una comparación con IA ("tu explicación omite la rama `else`") aparece como **nota, nunca como juez**. Bisra 2018 muestra que el efecto viene de generar la explicación.
- **Nivel 3, predicción ejecutada.** Eliges una entrada y predices la salida; `sandbox.ts` la ejecuta. Si fallas, la evidencia no cuenta y el tramo te muestra por qué.
- **Nivel 4, reescritura.** Lo detecta la procedencia sola.

### 5.3 Modelo mental de un proyecto heredado o que estás modificando

1. **Mapa determinista** (`cai entender mapa`): módulos, grafo de llamadas e imports, puntos de entrada y flujo de datos a partir de `indice.ts`, en Mermaid. Los resúmenes de IA van marcados "IA, sin verificar".
2. **Recorrido** (`cai entender recorrido`): orden topológico (de las hojas a la raíz) cruzado con el riesgo. En cada parada:
   - escribes qué crees que hace;
   - **recién después** ves el resumen de la IA y la diferencia;
   - haces una predicción ejecutada.

   Así se acumula evidencia de nivel 2 y 3.
3. **Entender antes de modificar (estricto).** Si el alcance de una tarea incluye una función `heredado`, `ia-previa` o `pegado` con nivel menor a 2, la tarea no pasa a `aprobada`. También se muestran sus llamadores (`impacto.ts`). Lo heredado que no tocas **no bloquea** (sería imposible trabajar), pero aparece en el reporte.
4. **Repaso espaciado** (`cai entender repaso`): esto generaliza `probarDiferida`. Hace predicciones sobre funciones IA a 1, 3, 7 y 21 días (Leitner; Cepeda 2006 sobre práctica distribuida). La comprensión por función decae con el tiempo, como un BKT simple (research.md §2.5). Si fallas, el tramo baja de nivel.
5. **Reconstrucción semanal** (V.3): la evidencia más fuerte, registrada en el perfil.

---

## 6. Fases, migrador y verificación

| Fase | Contenido | Tamaño | Cómo se verifica |
|---|---|---|---|
| F0 | Rama `v0.11`; `test/arquitectura.test.ts` con las violaciones como pendientes; `selftest.ts` partido en `test/escenarios/*.test.ts` | S (2–3 d) | Los 209 escenarios en verde en vitest |
| F1 | Capas, renombres, cortar las 3 violaciones, LLM inyectado | M (1 sem) | Test de arquitectura activo; hook ≤ 100 ms medido |
| F2 | `ia/proveedores` + roles + `cai ia evaluar` | M | vitest con `falso`; prueba real Haiku contra Ollama en "clasificar" |
| F3 | Almacén v1, esquemas, reglas globales/proyecto con precedencia, esqueleto del migrador | M | vitest por esquema; JSON dañados (los casos de `almacen.ts`) |
| F4 | **Procedencia**: `diffLineas`, tramos, PreToolUse/PostToolUse de Edit, `adoptar` (blame + trailers), pre-commit con stage, merge driver, `sin-revisar` + gutter | L (2 sem) | Propiedades con fast-check (dev dep nueva: editar, mover y borrar al azar no pierde ni inventa atribución); escenario de Claude Code real editando |
| F5 | **Flujo de tareas**: máquina de estados, especificidad, plan sin código, aprobación con paráfrasis, restricciones en el hook, SessionStart, UserPromptSubmit, Stop | L (2 sem) | Tabla de transiciones en vitest; `[seg]`: la IA intenta editar sin plan, fuera de alcance, agregando deps o tocando `preservar` |
| F6 | **Revisión y comprensión**: vista por tramo, explicación, interrogatorio "decidir antes", predicciones unificadas, refactorizar alrededor, presupuesto Kernighan | L | Escenarios: copia de la IA rechazada, predicción fallida no cuenta; prueba real en `examples/demo-ts` |
| F7 | Pruebas IV.5 (detectores), mutación por fan-in, roles tester e implementador | M | Fixtures con race, debounce y caché, positivos y negativos |
| F8 | Detector de bucle, último verde, `cai volver`, worktrees y agentes, tablero, `cai git` | L | Bucle simulado con `falso` que oscila; worktree real |
| F9 | MCP (catálogo y política), ramas, `.claude/rules` generadas, **CLAUDE.md de ≤ 40 líneas** + skills `cai-tarea`/`cai-revisar`/`cai-guia` | M | `doctor`; hook `mcp__*` con fixtures |
| F10 | Mapa, recorrido, repaso, reconstrucción | M | Repo heredado real en `examples/heredado/` (una librería OSS chica) |
| F11 | Superficie: `cli/tabla.ts` con ~14 comandos (`init`, `migrar`, `doctor`, `tarea`, `decidir`, `revisar`, `entender`, `volver`, `reconstruir`, `reglas`, `ia`, `guia`, `git`, `gate`, más los internos `hook`, `servir`, `ci`, `selftest`); extensión de 55 a ~12 comandos con dos paneles: **Tarea** y **Comprensión** | L | Prueba de humo `scripts/humo.cjs` + recorrido manual |
| F12 | Migrador final, docs y **prueba con 2–3 personas** (recomendación pendiente de v0.11) | M | Tiempo por etapa, abandonos, cobertura de comprensión y aciertos en el repaso |

**Por qué este orden:** la procedencia (F4) va antes que el flujo (F5) porque es lo que entrega el pedido final ("qué no revisó un humano") y funciona incluso sin tareas. La revisión (F6) depende de ambas.

### `cai migrar` (v0.11 → v1)

Por defecto corre en modo `--simular` y escribe un reporte. Es idempotente y respalda todo en `.cai.v0-<fecha>/`.

| De v0.11 | A v1 |
|---|---|
| `zonas.criticas` | `zonas.rojas`, avisando del cambio: ahora la IA no escribe ahí nunca |
| `delegadas`, `autoria.*` | Zonas v1 |
| `modos.*`, `vista`, `rapidas`, `ideas`, `chat` | Se descartan, quedan listados en el reporte |
| `Nota.programada` | Tramos `ia` con nivel 3 si se probaron (`sinProbar` = 0 y acierto), si no, 0 |
| `decisiones.json` | Archivos por decisión (criterios vacíos) |
| Tareas de `siguiente.ts` e ideas | Tareas en `borrador` |
| `objetivos.json` | Sección de `proyecto.md` |
| `.aicode/` | Se trata igual que `.cai/` v0 |
| CLAUDE.md (bloque `cai:inicio`), `settings.json` (matchers nuevos), `.githooks` | Se reemplazan |

Al final corre `cai adoptar`. Se prueba con fixtures congeladas del `.cai/` de `examples/demo-ts` y de `examples/obsidian-files`.

---

## 7. Riesgos y críticas al pedido (con evidencia)

1. **Habituación (Vance et al., CHI 2017/2018: con la repetición, la respuesta neural a las advertencias cae rápido; las advertencias "polimórficas" la reducen).** Un gate estricto de "revisado" se vuelve otro clic. Cómo se mitiga **sin aflojar**:
   - toda evidencia es **generativa** (palabras propias o predicción), nunca un clic;
   - la forma de la evidencia **varía**: explicar, predecir, listar bordes antes de ver o encontrar el caso que falla;
   - las unidades de revisión son chicas (`presupuestoLineas`). Cohen/SmartBear sobre Cisco (2006) muestra que la detección cae fuerte sobre 200–400 LOC y sobre ~500 LOC/hora; Kemerer y Paulk (2009) confirman el efecto de la tasa;
   - la predicción de nivel 3 cae al azar sobre una función por tarea, además de las obligatorias. Que sea impredecible evita el automatismo, y el mínimo nunca baja.

   Opcional, a evaluar con cuidado: un "mutante sembrado" solo en la vista de revisión de tareas críticas, en la línea de la *threat image projection* de la seguridad aeroportuaria. Puede confundir: haz primero una prueba con usuarios.
2. **Goodhart y explicaciones de relleno** ("esta función suma"). Las guardas deterministas (identificadores, largo proporcional, no copiada) más las predicciones ejecutadas, que no se pueden fingir, lo acotan. No lo eliminan. Sé honesto en el diseño: un humano decidido a mentir puede hacerlo. La herramienta impide que **la IA** finja e impide la autocomplacencia accidental, no el fraude deliberado.
3. **La fricción lleva al bypass y al abandono.** Buçinca et al. 2021: las *cognitive forcing functions* reducen la sobredependencia, pero gustan menos. METR 2025: los desarrolladores fueron 19 % más lentos y creían ir 20 % más rápido. Mitigaciones: CI que recalcula (el `--no-verify` no sirve), verificaciones deterministas de milisegundos, proveedores baratos para la latencia y una métrica visible de tiempo por etapa. Promete comprensión, no velocidad.
4. **El pivote contradice la investigación propia del proyecto.** Shen y Tamkin 2026 (delegar: menos de 40 %; preguntar conceptualmente: 65 % o más). Prather 2024 ("widening gap"): los novatos son los más dañados. Por eso el presupuesto Kernighan se ata al perfil. **Cuestiono tu pedido aquí:** recomiendo que, en lenguajes donde tu perfil es "novato", el ejecutor IA quede limitado a zonas delegadas y snippets hasta que haya evidencia de nivel 3 acumulada. Es más estricto que el manifiesto, pero es coherente con la evidencia.
5. **IV.6.1 (un agente escribe los tests) choca con research.md §1.7** (reward hacking en tests, Anthropic 2025). Mitigación: separar roles en el hook, valores esperados puestos por humanos, mutación y `trampas()`.
6. **La atribución es imperfecta.** Otra IA (Copilot o Cursor) o código tipeado a mano desde otra fuente se cuentan como `humano`. Se detectan los pegados, no lo retipeado. Documéntalo como límite, igual que hoy se documentan los límites del snapshot.
7. **Dependencia de la API de hooks de Claude Code** (`transcript_path`, `tool_response.answers`, `stop_hook_active`). Mitigación: fixtures grabadas de hooks reales en los tests y verificación de la versión de Claude Code en `doctor`.
8. **Riesgo de alcance.** `historial.md` muestra que cada versión sumó funcionalidad y que quedó sin hacer la recomendación de probar con 2–3 personas. Esta reestructuración es de 10–12 semanas. Recomiendo una puerta dura después de F6: probar con personas reales antes de F7–F11.
9. **La reconstrucción semanal bloqueante** puede vivirse como castigo. Mantenla estricta, pero deja que elijas el día y la función entre 3 candidatas: dar algo de autonomía reduce el rechazo sin bajar la exigencia.
10. **Proveedores baratos.** Menor precisión: solo aconsejan y se habilitan con `ia evaluar`. Privacidad: el opt-in es explícito, y `solo-local` está disponible.

### Archivos clave para la implementación
- `packages/complementairy/src/hook.ts`
- `packages/complementairy/src/config.ts`
- `packages/complementairy/src/construir.ts`
- `packages/complementairy/src/llm.ts`
- `packages/complementairy/src/programar.ts`
