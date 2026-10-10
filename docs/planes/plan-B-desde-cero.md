# Plan B: ComplementAIry (`cai`), diseño desde cero

> **Origen:** un agente planificador que **solo leyó `Manifiesto.md`** y no miró ningún otro archivo del repositorio, para tener una visión sin anclarse a la implementación existente. Todas las rutas y nombres son propuestas, no referencias a código existente. Fecha: 2026-10-10.
>
> **Numeración:** este plan usa la numeración **anterior** del manifiesto. Equivalencias con la actual: II (Cimientos) → **III**; III (Prompting) → **IV**; IV (Workflow) → **V**; V (Reglas de oro) → **VI**. Los puntos nuevos (**I.6** Regla de Oro del Aprendiz y la sección **II** Psicología) no figuran aquí; están en [plan-C-mezclado.md](plan-C-mezclado.md).
>
> Ver también: [plan-A-con-proyecto.md](plan-A-con-proyecto.md) · [comparacion.md](comparacion.md) · [plan-C-mezclado.md](plan-C-mezclado.md).

---

## 1. Principios de diseño y modelo mental

**En una frase:** `cai` no te programa nada. Es el cinturón de seguridad entre tú y la IA. Sigue cada tarea por los 7 pasos del manifiesto, deja que la IA actúe solo en la fase que le toca y no te deja integrar código que no hayas demostrado entender.

Piensa en `cai` con cuatro imágenes:

1. **Cada tarea es un expediente.** Tiene un estado (Paso 1 a 7) y unos documentos propios: tu diseño, el plan, las decisiones, la revisión. La IA solo puede hacer lo que permite el estado actual.
2. **Cada línea tiene pasaporte.** Se sabe quién la escribió (tú, la IA, un snippet, un pegado, código heredado) y si un humano la revisó, cuándo y cómo.
3. **Las reglas van por capas:** global, proyecto y submódulo. La capa más específica gana, salvo las líneas rojas, que solo se pueden endurecer.
4. **El semáforo lo pone un programa, no una IA.** Lo que bloquea es determinista: parsers, AST, git, tests, contadores, hashes. La IA solo propone, explica o resume. Nunca decide si algo pasa.

Principios operativos:

- **Escribir a mano nunca se bloquea.** Puedes tocar código en cualquier estado y esas líneas quedan como `humano`. Las compuertas valen para las acciones de la IA y para integrar (commit/merge) código de IA.
- **Mínimo privilegio por fase.** La IA es el "pasante calificado" (I.2): en cada fase tiene solo las herramientas que necesita.
- **Los artefactos humanos son solo tuyos.** La IA no puede escribir en `diseno.md`, en tus explicaciones de revisión ni en la sección "Decisión" de un ADR. Un hook lo bloquea.
- **Nada de botones "Aceptar".** Cada compuerta pide algo que produces tú y que se puede verificar: texto propio que pasa chequeos objetivos, una predicción que se comprueba ejecutando, una edición o un test.
- **Primero piensas, después ves la respuesta de la IA** (Buçinca 2021). Tus criterios, tu diseño y tus predicciones se escriben antes de mostrarte la propuesta de la IA.
- **Todo vive en git:** archivos en `.cai/` y notas en `refs/notes/cai`. Se puede auditar, versionar y comprobar en CI.
- **Defensa en profundidad.** Los hooks de Claude Code son la primera barrera, los git hooks la segunda y CI la tercera. Si alguien se salta una con `--no-verify` o usa otra IA, la siguiente lo detecta.
- **Ante la duda, bloquea.** Si `cai` no puede determinar algo, por ejemplo una línea sin pasaporte, la trata como "origen desconocido, no revisado".

---

## 2. Arquitectura

### 2.1 Capas

```
┌────────────────────────── Superficies ──────────────────────────┐
│ CLI cai │ Extensión VSCode │ Panel TUI │ GitHub Action │ MCP cai │
├────────────────────────── Adaptadores ──────────────────────────┤
│ Hooks Claude Code │ Git hooks │ Eventos de editor │ Proveedores IA│
├──────────────────────── Núcleo determinista ─────────────────────┤
│ Motor de estados │ Ledger de procedencia │ Motor de reglas │      │
│ Evaluador de compuertas │ Detector de bucle │ Checkpoints        │
├────────────────────────── Analizadores ──────────────────────────┤
│ tree-sitter (JS/TS/Py) │ grafo de imports │ diff de manifiestos  │
│ runners de test + diff-coverage │ mutación │ linters │ git blame │
├────────────────────────── Almacenamiento ────────────────────────┤
│ .cai/ (versionado) │ refs/notes/cai │ .git/cai/ (local)          │
└──────────────────────────────────────────────────────────────────┘
```

- **Núcleo:** TypeScript, distribuido como binario único. Usa un daemon local (`caid`) para que cada hook responda en menos de 100 ms y mantenga el índice en caliente.
- **Analizadores:** tree-sitter para símbolos, hashes de AST y complejidad. Runners `vitest`/`jest`/`pytest`. Diff-coverage desde lcov o coverage.py. Mutación ligera propia: negar condiciones, cambiar `<` por `<=`, quitar `await`.

### 2.2 Modelo de datos

**Tarea** (`.cai/tareas/<id>/tarea.yaml`):

```yaml
id: T-0142
titulo: "Campo editable en users"
estado: EJECUCION        # ver máquina abajo
modo: ia | manual | exploracion | reconstruccion
sesion_claude: <session_id>   # 1 sesión activa por tarea (III.6)
worktree: ../repo.cai/T-0142  # opcional (IV.6)
archivos_permitidos: [src/api/users.ts, src/components/EditButton.tsx]
dependencias_nuevas: []       # vacío = prohibido añadir
lineas_rojas_tocadas: false
checkpoints: [refs/cai/cp/T-0142/1, ...]
modelos: {plan: razonamiento-alto, ejecucion: codigo}
historial: [{de, a, cuando, evidencia_hash}]
```

**Máquina de estados** (workflow IV):

```
BORRADOR → DISEÑO_HUMANO(P1) → PLAN(P2) → PLAN_APROBADO → EJECUCION(P3)
   → REVISION(P4) → VALIDACION(P5) → INTEGRADA
Cualquier estado con IA ─(detector de bucle | cai desconectar)→ DESCONECTADA(P7)
DESCONECTADA → (revertir a checkpoint) → DISEÑO_HUMANO | MANUAL
REVISION/VALIDACION ─(fallo)→ EJECUCION
```

El paso 6 no es un estado: es la posibilidad de tener varias máquinas en paralelo, una por worktree, cada una con roles de agente.

Las guardas de transición son funciones puras sobre archivos, git y resultados de tests. `cai avanzar` las evalúa y te dice exactamente qué falta.

**Ledger de procedencia.** La unidad es el hunk, con un hash normalizado por línea.

- **Origen:** `humano` | `ia(modelo, sesión, tool_use_id)` | `snippet(id)` | `pegado(fuente declarada)` | `heredado` | `generado` (lockfiles, codegen; queda excluido).
- **Revisión:** `no_revisado` | `revisado{método, quién, cuándo, hash_contenido}`.
- **Métodos de revisión:** `explicacion`, `prediccion`, `mutacion`, `edicion_humana`, `par_humano` (aprobación en PR), `reconstruccion`.
- **Invalidación:** si cambia el hash de la línea por una acción de IA, la revisión se pierde.

Dónde se guarda:

- **Antes del commit:** en `.git/cai/ledger-wip.jsonl`, anclado por hash de línea.
- **En el commit:** el post-commit escribe una nota en `refs/notes/cai` para ese commit, con rangos por archivo.
- **Para consultar una línea actual:** `git blame -C -M` da el commit de origen y la nota da origen y revisión. Esto aguanta movimientos y renombres, es determinista y viaja con `git push` de las notas.

**Reglas** (ver 2.3) y **mapa mental** (ver 4.4) completan el modelo.

### 2.3 Almacén de reglas

- **Global:** `~/.config/cai/reglas/*.yaml`.
- **Proyecto:** `.cai/reglas.yaml`.
- **Submódulo:** `<dir>/.cai/reglas.yaml` o secciones por glob.

Hay dos tipos de regla:

- **`instruccion`:** texto para la IA. `cai reglas compilar` lo vuelca entre marcadores en `CLAUDE.md`/`AGENTS.md`/`.cursorrules`.
- **`verificable`:** se comprueba de forma determinista. Ejemplos: regex de rama, lista de dependencias permitidas, versión exacta del stack contra `package.json`/`pyproject`, comando de test, consulta AST prohibida, ruta del esquema de BD.

Precedencia:

- Los escalares se sobrescriben con la capa más específica. Las listas se concatenan.
- **`lineas_rojas` y `prohibiciones` solo admiten unión:** una subcarpeta puede añadir líneas rojas pero nunca quitarlas.
- `cai reglas explicar <archivo>` muestra la regla efectiva y de qué capa viene.

### 2.4 Proveedores de IA

Interfaz `Proveedor { completar(), resumir(), embeber?() }` con adaptadores para Anthropic, OpenAI-compatible (DeepSeek, Gemini vía endpoint compatible, OpenRouter) y Ollama local.

La tabla de enrutamiento va por tipo de trabajo, no por modelo:

```yaml
enrutamiento:
  planificar:   {proveedor: anthropic, modelo: razonamiento-alto}
  barato:       {proveedor: ollama, modelo: qwen2.5-coder:7b, respaldo: haiku}
  privado:      {solo_local: true}   # para rutas marcadas sensibles
```

Claude Code sigue siendo quien implementa. `cai` no lo reemplaza: lo encauza.

### 2.5 Integraciones

**Hooks de Claude Code:**

| Hook | Qué hace `cai` ahí |
|---|---|
| `SessionStart` | Vincula la sesión a la tarea activa. Sin tarea, la sesión queda en modo `exploracion` (solo lectura). Comprueba que el índice esté al día. Inyecta reglas y estado. |
| `UserPromptSubmit` | Linter de prompts (III.1–4). Cuenta turnos (III.6). Bloquea con exit 2 y una sugerencia concreta. |
| `PreToolUse` | Compuertas por fase: whitelist de archivos, líneas rojas, dependencias, Bash peligroso, artefactos humanos, rol del agente, estado `DESCONECTADA`. |
| `PostToolUse` | Registra la procedencia `ia` de cada edición, firmas de error de Bash y resultados de tests (alimenta el detector de bucle). Captura las respuestas de `AskUserQuestion` como decisiones humanas. |
| `Stop`/`SubagentStop` | Calcula lo pendiente y lo inyecta ("12 hunks sin revisar, estado REVISION"). Crea un checkpoint si los tests están en verde. |

**Git hooks:**

- `pre-commit`: ninguna línea `ia` staged sin revisar. La tarea está en `VALIDACION` aprobada o es `manual`. Hay ADR si hay disparadores (ver 4.1).
- `commit-msg`: añade los trailers `Cai-Tarea:` y `Cai-Procedencia: ia=34/34 rev, humano=120`.
- `post-commit`: escribe las notas de procedencia.
- `pre-push`: nombre de rama y empuje de `refs/notes/cai`.
- `post-checkout`: avisa si la rama no corresponde a ninguna tarea.

**CI** (`cai verificar` como GitHub Action):

- Recalcula la procedencia del diff del PR. Una línea añadida sin nota cuenta como `origen desconocido` y debe declararse.
- Falla si queda algo de IA sin revisar.
- Publica SARIF con el mapa de no revisado.

**VSCode:**

- Captura `onDidChangeTextDocument`: lo tecleado es `humano`, un pegado grande es `pegado` (te pregunta la fuente), un snippet insertado es `snippet`, y una inserción multilínea sin pegado es `ia-probable` (por ejemplo autocompletado de Copilot).
- Gutter de colores: IA sin revisar en ámbar, revisado en verde, heredado sin comprender en gris.
- Panel de revisión y predicciones.

**MCP propio (`cai-mcp`):**

- Expone a la IA el estado de la tarea, el plan, las reglas efectivas y el mapa.
- Ofrece herramientas estructuradas: `cai.plan.proponer` (valida el esquema) y `cai.opciones.presentar` (exige 2 o más opciones con pros y contras).

---

## 3. Tabla: cada ítem del manifiesto y su mecanismo

D = determinista; ND = no determinista (asiste, nunca bloquea).

| Ítem | Mecanismo que lo hace cumplir | D/ND | Componente |
|---|---|---|---|
| **I.1** Colaboración, no delegación | Con IA, nada se integra sin pasar P1→P5. Las tareas sin `diseno.md` humano no admiten escritura de IA. | D | Motor de estados + PreToolUse |
| **I.2** Pasante calificado | Capacidades por fase (Read en todas; Edit solo en EJECUCION y solo en `archivos_permitidos`). Todo lo que produce la IA entra como `no_revisado`. | D | PreToolUse + ledger |
| **I.3** Entender antes que correr | Pre-commit y CI bloquean líneas `ia` sin revisar. La revisión exige explicación, predicción o mutación. | D | Evaluador de compuertas |
| **I.4** Kernighan | Si fallas una predicción sobre un hunk, ese hunk queda en `no_comprendido`. Solo se integra cuando aciertas otra predicción tras releerlo, o cuando lo simplificas (baja su complejidad ciclomática, medida). | D | Revisión + tree-sitter |
| **I.5** Aumentar el criterio | Ciertos disparadores (dependencia nueva, módulo nuevo, cambio de esquema, API pública nueva) exigen un ADR. La sección "Decisión" solo la escribe un humano. | D | Detector de disparadores + PreToolUse |
| **II.1** Indexación | `cai init` crea un índice de símbolos y un grafo de imports y genera el "Mapa estructural" en `CLAUDE.md`. `SessionStart` comprueba el hash del índice contra HEAD y lo regenera si hace falta. | D | Analizadores + compilador de reglas |
| **II.2** Reglas globales | Capa global con tests, librerías preferidas, estilo y bash. Al iniciar un proyecto sin capa global, el init no termina. | D | Almacén de reglas |
| **II.3** Reglas de proyecto | Las versiones de stack se verifican contra los manifiestos (deriva = aviso que bloquea el plan). El esquema de BD apunta a un archivo que debe existir. Los patrones de API son instrucciones. La rama se comprueba con regex en `post-checkout` y `pre-push`. Hay reglas por submódulo. | D | Reglas + git hooks |
| **II.4** MCP | `cai init` detecta el stack (svelte, stripe, @sentry, figma, jira…) y propone `.mcp.json`; comprueba el handshake. Las herramientas MCP con efectos (aprovisionar en la nube, escribir issues) pasan por PreToolUse y necesitan tu confirmación con la descripción del efecto. | D | Init + PreToolUse |
| **III.1** Especificidad | Linter de prompts: verbos vagos sin objeto ("arregla", "mejora", "haz que funcione"), un mínimo de referencias a símbolos o rutas que existen en el índice, y un criterio de aceptación. Si falla, se bloquea con una reescritura sugerida (la reescritura es ND). | D (+ND sugerencia) | UserPromptSubmit |
| **III.2** Contexto explícito | En EJECUCION el prompt debe citar `@archivo` o un símbolo, y todo lo citado debe estar en el plan. | D | UserPromptSubmit |
| **III.3** Prohibido adivinar | El plan tiene un campo `decisiones_abiertas`. Cada una exige 2 o más opciones con pros y contras (validado por esquema). No se aprueba el plan con decisiones sin resolver por ti. | D | Validador de plan |
| **III.4** Apoyo visual | Si la tarea toca `.tsx/.vue/.css/.svelte` y el prompt usa léxico visual ("se ve", "alineado", "desborda"), se exige una imagen adjunta. | D | UserPromptSubmit |
| **III.5** Modelos por fase | `SessionStart` y `PostToolUse` leen el modelo del transcript. En PLAN tiene que ser de clase `planificar` y en EJECUCION de clase `codigo`. Solo se permite cambiar de modelo en la transición PLAN_APROBADO→EJECUCION, que además abre una sesión nueva. | D | Hooks + enrutamiento |
| **III.6** Chats cortos | Una sesión por tarea. Hay un umbral de turnos o tokens (configurable, por ejemplo 40 turnos o 1 compactación). Al superarlo se bloquea y `cai` genera un traspaso (resumen ND que tú corriges) para la sesión nueva. | D | Contadores |
| **IV.1** Diseño humano | `diseno.md` con secciones obligatorias: problema, comportamiento esperado, módulos afectados (rutas validadas), enfoque, cómo sabré que funciona (al menos una predicción ejecutable) y riesgos. Lo escribe un humano: la IA tiene la escritura bloqueada y el solapamiento de 5-gramas con el transcript debe ser menor de 0,3. | D | Estados + PreToolUse |
| **IV.2** Plan sin código | En PLAN solo se permite escribir `plan.md`. El esquema exige flujo de datos, funciones clave, integración, retos, `archivos_permitidos`, dependencias y pruebas. Bloques de código de más de 5 líneas se rechazan. Para aprobar, escribes qué difiere de tu diseño y por qué. | D | Validador + PreToolUse |
| **IV.3** Ejecución con restricciones | Whitelist de archivos. Dependencias: se parsea el diff de `package.json`/`pyproject` en PreToolUse y se bloquean `npm i`/`pip install`. Hay que preservar los tests existentes (no se pueden borrar ni marcar `.skip` sin regla). Cada paso del plan debe traer "cómo probarlo". | D | PreToolUse |
| **IV.4** Revisión | `cai revisar` va hunk por hunk (ver 4.3). Antes de ver las respuestas de la IA, escribes tus propias respuestas a "¿por qué este patrón?", "¿casos borde?" y "¿rendimiento?". Después puedes preguntar a la IA y anotar la diferencia. Tus ediciones quedan como `humano` y puedes pedir "refactoriza alrededor de mis cambios" sin perder la autoría de tus líneas. | D (+ND diálogo) | Revisión + ledger |
| **IV.5** Pruebas y rendimiento | Tests en verde. Diff-coverage al menos del umbral. Cada función nueva tiene un test. Detectores AST de riesgo: `await` en bucle, estado mutable compartido entre handlers async, `setTimeout` sin limpiar, `fetch` en bucle sin limitador, `cache.set` sin TTL ni invalidación, hilos o asyncio en Python. Cada hallazgo exige un test o una nota humana. | D | Validación |
| **IV.6** Multiagente / worktrees / git NL | `cai paralelo` y roles con capacidades (ver 4.7). Las órdenes git en lenguaje natural pasan a comandos visibles; las destructivas exigen escribir el nombre de la rama y ver un dry-run. | D | Paralelo + PreToolUse |
| **IV.7** Desconectar | Detector de bucle con señales objetivas, bloqueo automático, checkpoints y replanteo obligatorio (ver 4.5). | D | Detector + checkpoints |
| **V.1** Líneas rojas | Globs y etiquetas en reglas (solo unión). Heurística de imports (`bcrypt`, `jsonwebtoken`, `crypto`, `passlib`, `cryptography`) que propone añadir rutas. En líneas rojas, la IA no escribe en ningún estado; solo lee y explica. | D | Reglas + PreToolUse |
| **V.2** Para qué sí | Categoría `boilerplate` (config, plantillas de test, globs declarados) con revisión proporcional. Modo `exploracion` de solo lectura y `cai decidir` para "3 enfoques". | D | Reglas + estados |
| **V.3** Reconstrucción semanal | `cai reconstruir`. Si pasan 7 días sin hacerla (con 2 de gracia), no se pueden abrir tareas nuevas con IA. Las manuales siguen permitidas. | D | Planificador + estados |

---

## 4. Diseños concretos

### 4.1 Marcos de decisión (`cai decidir`)

**Cuándo se dispara.** Por un trigger determinista (dependencia nueva, carpeta de módulo nueva, cambio de esquema, nueva ruta pública de API, decisión abierta en el plan) o a mano.

**Orden anti-anclaje:**

1. **Tú primero:** contexto, criterios y pesos (que suman 100). La IA no ve nada todavía.
2. **Opciones:** la IA (barata o fuerte, según la complejidad) propone de 2 a 4 opciones con pros, contras y supuestos. Puedes añadir opciones tuyas.
3. **Puntúas tú** cada opción por criterio, de 1 a 5. Solo después ves la puntuación sugerida por la IA, y las discrepancias de 2 o más puntos te piden una nota.
4. **`cai` calcula de forma determinista:**
   - El total ponderado.
   - La sensibilidad: el cambio mínimo de peso que voltea al ganador. Si es menor de 10 puntos, te avisa: "decisión frágil".
   - El valor esperado si marcaste incertidumbre (probabilidad × resultado por escenario).
5. **Escribes la decisión en tus palabras**, "qué me haría cambiar de opinión" y una fecha de revisión.

Sale un ADR en formato MADR (`docs/adr/NNNN-*.md`), con las opciones de la IA en un anexo marcado como `ia`. El `pre-commit` exige el ADR enlazado cuando hubo trigger. `cai informe` lista los ADR con la fecha de revisión vencida.

### 4.2 Proveedores baratos

Tareas `barato`, por defecto locales con Ollama:

- Resumir un hunk o un módulo (marcado como "hipótesis").
- Sugerir la reescritura de un prompt rechazado.
- Generar preguntas socráticas de revisión.
- Proponer opciones para un ADR simple.
- Hacer el traspaso de sesión.
- Clasificar hunks como boilerplate o lógica, solo como sugerencia; la clasificación que vale es la de las reglas y el AST.

Garantías:

- **Ninguna salida barata decide una compuerta.** Las compuertas dependen de esquemas, AST, tests y contadores.
- **Caché** por hash de entrada.
- **Presupuesto** por tarea y semana, con tokens leídos de los transcripts.
- **Privacidad:** las rutas `privado` o de líneas rojas solo van a proveedores locales.
- **Evaluación:** `cai proveedores probar` ejecuta un set dorado (resúmenes contra referencias) para elegir modelo con datos.

### 4.3 "No revisado por humano"

**Cómo se revisa** (`cai revisar`, en el TUI o el panel de VSCode), agrupando hunks por símbolo:

- **Explicación propia.** Chequeos deterministas:
  - 20 palabras o más.
  - Menciona al menos un identificador del hunk.
  - Solapamiento de 5-gramas con el transcript de la IA y con los comentarios del código menor de 0,3.
  - Similitud con tus explicaciones anteriores menor de 0,8 (evita la plantilla).
  - Después, de forma opcional y sin bloquear, una IA te devuelve "omitiste el caso X" como aprendizaje.
- **Predicción ejecutada.** Obligatoria en hunks con ramas (complejidad 2 o más):
  - Para funciones puras, eliges tú una entrada y escribes la salida esperada; `cai` la ejecuta en sandbox y compara con igualdad profunda.
  - Para código con efectos, `cai` aplica una mutación (por ejemplo niega una condición) y tú predices qué tests fallarán. Si predices "ninguno" y aciertas, has encontrado un hueco de tests y debes añadir uno.
  - No es un quiz: la entrada la eliges tú y la respuesta la da la ejecución.
- **Edición humana.** Si lo modificas, esas líneas pasan a `humano` y el resto del hunk sigue requiriendo método.
- **Revisión de par.** Una aprobación en el PR marca `par_humano`, una categoría más débil que se ve aparte en el informe.

Proporcionalidad estricta pero calibrada:

- **Boilerplate declarado:** una línea de resumen y tests en verde.
- **Lógica:** explicación y predicción.
- **Cerca de líneas rojas:** no aplica, porque ahí la IA no escribe.

**Informe:** `cai informe` da, por módulo, archivo y función, las líneas por origen y estado de revisión, el porcentaje comprendido y una lista priorizada (riesgo × centralidad en el grafo). Sale en JSON y SARIF para CI. La pregunta "¿qué no ha visto un humano?" se responde con un comando y es reproducible a partir de git.

### 4.4 Modelo mental (propio y heredado)

**Capa estructural (determinista).** `cai mapa` construye:

- El grafo de imports y llamadas (tree-sitter).
- Los puntos de entrada (rutas HTTP, CLI, main).
- El esquema de BD.
- Por módulo: % de IA, % revisado, % heredado sin comprender, y si la tarjeta está al día.

**Capa de hipótesis (ND, etiquetada).** Resúmenes de la IA barata, que se muestran como "hipótesis no verificada".

**Tarjetas de comprensión (humanas).** `.cai/mapa/<modulo>.md` con propósito, invariantes, quién lo llama, a quién llama y una predicción. `cai` verifica lo que se puede verificar:

- Los símbolos citados existen.
- "llama a X" coincide con el grafo.
- La predicción se ejecuta.

Si el AST del módulo cambia por encima de un umbral, la tarjeta queda **caduca**.

**Proyecto ajeno** (`cai mapa --explorar`):

- Todo empieza como `heredado`.
- Tour ordenado por centralidad.
- En cada parada: (1) predices el propósito viendo solo el nombre y las firmas; (2) lees el código; (3) la IA explica; (4) escribes la diferencia.
- **Traza real:** eliges un punto de entrada, predices el camino de llamadas y `cai` ejecuta un test o petición instrumentado (hooks de cobertura por función) para mostrarte el camino real. La diferencia queda en tu tarjeta.
- **Compuerta:** un plan no se aprueba si toca un módulo heredado sin tarjeta vigente. Primero lo entiendes, luego lo modificas (coherente con P1).

**Aprendizaje.** `cai repaso` (5 minutos) te pide predecir el comportamiento de código que revisaste hace 1, 7 y 30 días (repetición espaciada), y prioriza tus errores pasados de predicción. Las predicciones falladas forman tu "lista de aprendizaje" por tarea.

### 4.5 Detección de bucle y "pull the plug"

Señales deterministas, con una puntuación acumulada por tarea:

1. El mismo test falla con la misma firma normalizada de error en 3 ciclos editar→probar seguidos.
2. Oscilación: un hash de contenido vuelve a aparecer en un hunk (A→B→A).
3. Churn: líneas cambiadas mayores que 3× la estimación del plan, o más de 2 intentos bloqueados de tocar archivos fuera del plan.
4. La misma firma de stack trace en salidas de Bash 3 o más veces.
5. El diff crece y el número de tests en verde no sube en N pasos.
6. Contexto: una compactación o un umbral de tokens.
7. Señal secundaria: regex de disculpa o reintento ("tienes razón", "probemos otro enfoque") 3 o más veces. Solo suma, nunca basta sola.

**Checkpoints.** En cada `Stop` con tests en verde se crea un commit en `refs/cai/cp/<tarea>/<n>`, sin tocar tu rama.

**Al superar el umbral,** la tarea pasa a `DESCONECTADA` y PreToolUse bloquea toda escritura de IA. `cai desconectar` te ofrece:

- Revertir al último checkpoint, con diff previo.
- Escribir un replanteo: qué falló en tu diseño o en el plan. Esto devuelve la tarea a P1.
- O seguir **a mano** (modo manual en esa tarea).

También puedes desconectar tú cuando quieras. Las señales y umbrales se calibran con sesiones grabadas y etiquetadas (ver fases).

### 4.6 Reconstrucción semanal

1. `cai reconstruir` propone las 3 funcionalidades de la semana con más % de IA (sacado del ledger). Eliges tú.
2. Crea un worktree en el commit anterior a la funcionalidad y retira su código.
3. **Desactiva toda herramienta de IA en ese worktree** (PreToolUse lo deniega todo). Como mucho permite `WebFetch` a dominios de documentación oficial en lista blanca.
4. Guarda los tests originales como **oráculo oculto** y mide el tiempo.
5. Al terminar: ejecuta el oráculo, muestra el diff entre tu versión y la de la IA, y escribes qué difiere y por qué.
6. Las líneas originales quedan con el método `reconstruccion`, y la métrica de autonomía por dominio se actualiza.
7. Si se incumple, no se abren tareas nuevas con IA. Lo manual sigue libre.

### 4.7 Worktrees y multiagente

`cai paralelo T-0142 T-0143` crea `../<repo>.cai/<id>`, con una rama según la regla de nombres, una máquina de estados y una sesión propias.

Roles con capacidades impuestas por PreToolUse, leídas de la variable de entorno `CAI_ROL` del subagente:

- **`implementador`:** escribe solo en `archivos_permitidos`.
- **`revisor`:** solo lee y escribe `revision-ia.md`.
- **`tester`:** escribe solo `**/*.test.*`/`tests/**`, y **no puede leer la implementación**, solo el plan y las firmas. Así los tests salen de la especificación y no de la implementación.
- **`refactorizador`:** solo cuando hay feedback del revisor, con los tests congelados.

La revisión de una IA nunca sustituye la compuerta humana. **Límite WIP:** como máximo 2 tareas en `REVISION` pendientes, para evitar que se acumulen revisiones y acabes aprobando en serie.

`cai tarea --todas` es el tablero de ajedrez: estado por tarea, hunks pendientes y señales de bucle.

---

## 5. Experiencia de uso

**Comandos** (10, con un verbo central):

| Comando | Para qué |
|---|---|
| `cai init` | Reglas, hooks, índice, MCP y notas de git |
| `cai tarea "<título>" [--manual]` / `cai tarea [--todas]` | Crear una tarea o ver su estado (tablero) |
| `cai avanzar` | Intentar el siguiente paso; si no se puede, dice exactamente qué falta |
| `cai revisar` | Revisión hunk por hunk |
| `cai decidir` | ADR, matriz y valor esperado |
| `cai desconectar` | Pull the plug |
| `cai mapa [--explorar]` | Modelo mental |
| `cai informe` | No revisado, métricas y aprendizaje |
| `cai reconstruir` | Ejercicio semanal |
| `cai paralelo` | Worktrees y roles |

**Un día típico:**

1. **09:00.** `cai repaso`: 3 predicciones sobre código de la semana pasada; fallas una sobre el TTL de caché y queda anotada.
2. **09:10.** `cai tarea "users.editable"`. Se abre `diseno.md` y lo escribes en 10 minutos. `cai avanzar` rechaza: "Sección 'Cómo sabré que funciona' sin predicción ejecutable". Añades "GET /api/users/7 devuelve `editable:false`" y pasa.
3. **09:25.** En Claude Code (sesión nueva, modelo de razonamiento), pides el plan. El hook rechaza tu primer prompt ("haz que el botón alterne": verbo vago, 0 símbolos) y lo reescribes. El plan trae una decisión abierta: migración con default o columna nullable. `cai decidir`: tú pones los pesos, la IA las opciones, tú puntúas. Sensibilidad: frágil. Escribes la decisión.
4. **09:50.** `cai avanzar` lleva el plan a aprobado y abre una sesión de ejecución con el modelo de código. Claude intenta tocar `auth/session.ts` y lo bloquea la línea roja. Intenta `npm i lodash` y lo bloquea la regla de dependencias. Terminas tú a mano un ajuste en `EditButton.tsx`, sin ningún bloqueo.
5. **10:30.** `cai revisar` muestra 9 hunks. En `canEdit()` predices `false` para un admin sin flag; la ejecución devuelve `true`. Relees, descubres el *override* de admin, lo explicas y aprendes algo. Las preguntas de casos borde las respondes tú primero; luego preguntas a la IA y añade la concurrencia en doble PATCH, que no habías visto.
6. **11:00.** `cai avanzar`: diff-coverage 78% de un umbral del 80%, y un detector marca `fetch` en bucle. Añades un test y el limitador. Commit con trailers.
7. **Tarde.** Un bug sale en bucle: 3 fallos con la misma firma, desconexión automática. Reviertes al checkpoint, escribes el replanteo y lo resuelves a mano.
8. **Viernes.** `cai reconstruir`.

---

## 6. Fases de implementación y verificación

| Fase | Entrega | Cómo verificarla |
|---|---|---|
| **F0 Ledger** | Núcleo, PostToolUse→procedencia, notas git, `cai informe` | Repos fixture y *replays* de payloads JSON de hooks grabados. Tests dorados: el informe reproduce exactamente las líneas esperadas tras rebase, `mv` y cherry-pick |
| **F1 Estados y compuertas** | Máquina de estados, PreToolUse, esquemas de diseño y plan, pre-commit | Tests de propiedad: ningún payload de escritura pasa fuera de EJECUCION ni de la whitelist; batería de intentos de evasión (Bash `sed -i`, `tee`, `python -c`, symlinks) |
| **F2 Revisión y validación** | Explicación, predicción, mutación, diff-coverage, detectores AST | Corpus de hunks con predicciones conocidas; precisión y recall de los detectores sobre ejemplos etiquetados |
| **F3 Reglas y prompts** | Capas, precedencia, compilador a CLAUDE.md, linter, modelo por fase, contadores | Tabla de casos de merge (incluida la unión de líneas rojas); corpus de prompts etiquetados con tasa de falsos positivos aceptable (< 10%) |
| **F4 Bucle y checkpoints** | Detector, `refs/cai/cp`, `desconectar` | Sesiones reales etiquetadas como bucle o sano; curva ROC para fijar umbrales |
| **F5 Decisiones y proveedores** | `decidir`, enrutamiento, Ollama, presupuesto | Cálculos de matriz y sensibilidad con casos analíticos; set dorado de proveedores |
| **F6 Modelo mental** | `mapa`, tarjetas, tour, traza, `repaso`, `reconstruir` | Validación de tarjetas contra el grafo; piloto en un repo ajeno |
| **F7 Superficies** | Extensión VSCode, GitHub Action, `paralelo`/roles, `cai-mcp` | E2E: un PR con `--no-verify` falla en CI; tester sin acceso a la implementación |
| **F8 Eficacia** | Estudio piloto | Comparar comprensión entre grupo `cai` y control (diseño tipo Anthropic 2026: quiz posterior de conceptos y depuración), tiempo por tarea y bugs en producción. Si `cai` no mejora la comprensión, se rediseña |

---

## 7. Riesgos y críticas al pedido

1. **Las máquinas no pueden medir la comprensión.** Lo determinista mide *proxies* (palabras propias, predicciones acertadas, mutaciones detectadas), y los proxies se pueden manipular (Goodhart). Mitigaciones:
   - Las predicciones ejecutadas son el proxy más difícil de falsear y por eso pesan más.
   - Auditorías aleatorias por pares de tus explicaciones en el PR.
   - Detección de plantillas.
   - Hay que ser honestos: `cai` garantiza **evidencia de compromiso**, no comprensión.
2. **Habituación** (Vance et al. 2017: la respuesta cerebral a avisos repetidos cae enseguida; los avisos polimórficos la atenúan). Un régimen siempre estricto la favorece. Mitigaciones sin aflojar:
   - **Compuertas polimórficas:** alternar explicación, predicción de salida, mutación y "¿qué test falta?".
   - **Proporcionalidad por riesgo,** para que el esfuerzo vaya donde importa.
   - **Lotes pequeños:** pasos de plan con menos de unas 150 líneas, para no revisar 800 de golpe.
   - **Límite WIP.**
   - **Señales de habituación medidas:** tiempo sobre el hunk, similitud entre explicaciones, caída en el acierto de predicciones. Cuando aparecen, la revisión se endurece en lugar de ablandarse.
3. **Efecto de reversión de la pericia** (Kalyuga): el andamiaje que ayuda al novato estorba al experto. No se afloja la compuerta; **cambia el tipo de evidencia.** Al novato, preguntas guiadas y pistas graduales. Al experto (alto acierto sostenido por dominio), predicciones abiertas, mutaciones o escribir el test que mata al mutante, que son más rápidas para él e igual de exigentes.
4. **La fricción empuja a hacer trampa:** ChatGPT en el navegador y pegar. Hay detección de pegado y origen desconocido en CI, pero no es infalible. Lo tecleado copiando de otra pantalla es indetectable. Asúmelo.
5. **El manifiesto tiene tensiones internas.** "Indexar todo" (II.1) choca con "contexto explícito" (III.2); se resuelve con el índice para navegar y contexto explícito en el prompt. Los nombres de modelos concretos (GPT-5, Sonnet) envejecen, por eso la tabla de enrutamiento va por *clase* de modelo. Algunas citas son de divulgación, no de evidencia fuerte.
6. **"Lógica central" no se detecta sola.** Clasificar como línea roja es una decisión humana (globs y etiquetas). `cai` hace cumplir esa clasificación de forma determinista y solo *sugiere* candidatas mediante imports.
7. **Usuarios no técnicos.** Pedirles revisar hunks contradice el objetivo. Para ellos la compuerta sube a nivel de comportamiento: criterios de aceptación en lenguaje natural compilados a tests, y predicciones sobre lo que hará la app. Es otra variante del producto, no un modo de este.
8. **Dependencia de la API de hooks de Claude Code,** que puede cambiar. Los git hooks y CI son el respaldo, y el adaptador debe estar versionado.
9. **Coste de tiempo real.** Estricto siempre significará tareas más lentas al principio. Hay que medirlo (F8) y mostrarlo junto a la métrica de bugs evitados. Si no, el equipo lo desinstalará.
10. **Privacidad.** Los proveedores baratos en la nube reciben código: por defecto local, y las rutas sensibles solo local.
