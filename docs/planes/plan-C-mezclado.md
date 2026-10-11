# Plan C: ComplementAIry v1.0, el mezclado (recomendado y aprobado)

> Ver también: [plan-A-con-proyecto.md](plan-A-con-proyecto.md) · [plan-B-desde-cero.md](plan-B-desde-cero.md) · [comparacion.md](comparacion.md) · [plan-C-mezclado.md](plan-C-mezclado.md).

## Contexto
Quieres reestructurar ComplementAIry entero para que implemente **cada punto** de `Manifiesto.md`, en su versión actualizada:
- I: principios, incluida la nueva **Regla de Oro del Aprendiz**;
- II: psicología y riesgos cognitivos (sección nueva);
- III: cimientos;
- IV: prompting;
- V: el workflow de 7 pasos;
- VI: reglas de oro y reconstrucción semanal.

Lo que pides:
- que puedas bajar a tocar código o pedirle a la IA donde lo necesites;
- determinismo máximo;
- que el programa **haga cumplir** el manifiesto;
- que diga qué código **no revisó un humano**;
- que ayude a construir el **modelo mental**, tanto en proyectos propios como en ajenos.

Tus decisiones (AskUserQuestion):
- "tev/jev" = **las dos cosas**: proveedores de IA intercambiables y baratos (incluidos locales) + marcos de decisión estructurados;
- exigencia **siempre estricta**;
- **romper compatibilidad, con migrador**.

Entregables: Plan A (el que vio el proyecto), Plan B (desde cero, sin verlo), la comparación, Plan C (mezclado) y la tabla de cómo se hace cumplir cada punto. Los planes A y B salieron de dos agentes independientes: A leyó el código y B solo el manifiesto. Los dos trabajaron con la numeración **anterior** del manifiesto. Aquí todo va con la numeración **nueva**, y lo que ninguno cubría (I.6 y II.1–5) está agregado en C.

**Los otros documentos de esta carpeta:**
- [plan-A-con-proyecto.md](plan-A-con-proyecto.md): el plan del agente que leyó el código;
- [plan-B-desde-cero.md](plan-B-desde-cero.md): el plan del agente que solo leyó el manifiesto;
- [comparacion.md](comparacion.md): qué aporta cada uno y qué se tomó para C.

A y B usan la numeración vieja del manifiesto (cada uno trae la equivalencia). Este plan usa la nueva. Las secciones numeradas siguen la numeración del plan original (la 1 y la 2 son los resúmenes de A y B, y la 3 la comparación, que están en sus propios archivos).

**El cambio de fondo:** v0.11 se apoya en "la IA nunca escribe tu código" (`hook.ts` → `verifyCommentOnly`). El manifiesto (V.3) acepta que la IA implemente un plan aprobado. v1.0 pasa a ser: **"la IA escribe solo dentro de una tarea con diseño humano y plan aprobado, nunca en líneas rojas, solo lo que tú ya sabes escribir (I.6), y nada llega a un commit sin evidencia de que un humano lo entendió"**.

---

---

## 4. Plan C: el mezclado (el recomendado)

### 4.1 Principios operativos
1. **Escribir a mano nunca se bloquea.** Las compuertas aplican a las acciones de la IA y a integrar código de la IA.
2. **El semáforo es determinista:** parser, AST, git, tests, ejecución, contadores y hashes. La IA (cara o barata) solo propone, explica o resume.
3. **Sin botones "Aceptar":** cada compuerta pide algo tuyo que se pueda verificar, sea texto propio que pasa chequeos objetivos, una predicción que se ejecuta, una edición o un test.
4. **Primero piensas, después ves** (Buçinca 2021): tu diseño, tus criterios, tus bordes y tus predicciones van antes de lo de la IA.
5. **Defensa en capas:** hooks de Claude Code, git hooks y CI. Si no se sabe algo, se bloquea.
6. **Estricto siempre, sin habituación:** la evidencia es variada (polimórfica), las unidades son chicas, y cuando aparecen señales de piloto automático se **endurece**, no se afloja.
7. **Lo subjetivo lo decide un decisor chico; las reglas fijas solo lo objetivo** (idea del usuario).
   - **Qué es subjetivo:** si un pedido, una orden o una respuesta es vago; si es **demasiado amplio** para delegarlo; cuántos temas trae un pedido; si una explicación explica de verdad el tramo. Primero lo decide un **decisor rápido** (rol `decidir`):
     - un modelo "System One" como **Jev** (TypeSafe, `POST /v1/systemone`: estado + preguntas tipadas → probabilidades), en la nube o local con **Ollama** (`/v1/systemone`);
     - si no hay API key, **Haiku** vía Claude Code.
   - **Escala según la incertidumbre:** si el decisor está seguro, se aplica; si duda, pasa a un modelo mayor; si sigue la duda, se te pregunta. Un pedido llega a la IA que delega **solo después** de pasar este filtro.
   - **Qué queda en reglas fijas:** lo objetivo, que no se puede engañar: entrada vacía, "sí"/"dale" a secas, copia literal de la sugerencia (n-gramas) e identificadores que no existen. Esas reglas son un piso: el decisor no puede aprobar algo que ellas rechazaron.
   - **Si el decisor te rechaza,** puedes rebatirlo con tus palabras. Queda registrado y alimenta `cai ia evaluar`, que mide acierto **y calibración** por separado.
   - **Si no hay ningún decisor disponible,** se usan las heurísticas, marcadas "sin decisor".
   - **Motores configurables por rol:** Claude Code (por defecto), **OpenCode** (`opencode run -m proveedor/modelo`), endpoints compatibles con OpenAI y la API de Anthropic.

### 4.2 Arquitectura
Paquete `packages/complementairy/src/`:

```
nucleo/     puro: lang, parser, comments, metricas, soloComentarios (verify.ts), diffLineas,
            flujo (máquina de estados), prediccion, matriz (EV/sensibilidad), especificidad
            (desde ordenValida/VAGO/AMPLIO/copiado), huellasConstruccion (I.6)
proyecto/   único que toca .cai/: almacen, esquemas/, config, reglas (global/proyecto/ruta),
            tareas, decisiones, procedencia, evidencias, licencias, indice, notas, migraciones/
garantias/  hook (un manejador por evento), bash, snapshot, confirmar, gitHooks, ci
            → NO importa ia/ ni flujos/
ia/         proveedores/ (agentSdk, anthropicApi, openaiCompatible, falso), roles, uso
flujos/     tarea/(diseño, plan, aprobación, ejecutar[pasos|agente], worktree), revision/,
            comprension, pruebas, desconectar, reconstruir, entender (mapa, tarjetas,
            recorrido, repaso), decidir, guia/ (un solo pipeline), git, informe
cli/        tabla de comandos, args, servir, mcp (cai-mcp)
```

Se hace cumplir con `test/arquitectura.test.ts`.

La **extensión** queda en 2 paneles, **Tarea** y **Comprensión**, más el gutter de procedencia, y pasa de 55 a unos 12 comandos.

**Almacén `.cai/` v1**, con versión y esquema validado al leer. Va al repo salvo `cache/` e `indice.json`:

| Ruta | Qué guarda |
|---|---|
| `config.json` | zonas: rojas, delegadas, heredado, terceros; `ia.roles`; umbrales |
| `reglas/proyecto.md` | secciones obligatorias: Stack y versiones, Datos, API, Ramas, Pruebas |
| `reglas/*.md` | reglas por ruta, con `paths:` |
| `reglas/mecanicas.json` | reglas mecánicas |
| `tareas/<id>/tarea.json` | la tarea; sus capturas van en `tareas/<id>/adjuntos/` |
| `decisiones/<id>.json` | cada decisión |
| `procedencia/<archivo>.json` | origen y revisión de cada tramo |
| `evidencias/<id>.json` | cada evidencia, ligada al hash de su tramo |
| `mapa/<modulo>.md` | tarjetas de comprensión |
| `notas/` | notas, como hoy |

**Global, `~/.cai/`:**

| Ruta | Qué guarda |
|---|---|
| `reglas-globales.{md,json}` | reglas que valen en todos tus proyectos |
| `perfil.json` | tu perfil |
| `licencias.json` | lo que ya escribiste a mano (I.6) |
| `uso.jsonl` | consumo de IA |
| `proveedores.json` | proveedores, sin claves: van en variables de entorno |
| `repertorio/` | tu repertorio |

### 4.3 La tarea (V, pasos 1 a 7)
```
borrador ─(diseño humano válido)→ diseñada ─(plan IA sin código)→ planificada
 ─(decisiones resueltas + restricciones + paráfrasis + licencias)→ aprobada
 ─(ejecutar)→ ejecutando ─(Stop)→ en-revision ─(evidencia por tramo IA)→ revisada
 ─(gate + detectores V.5)→ probada ─(commit verificado)→ cerrada
 ejecutando/en-revision ─(detector de bucle o humano)→ desconectada → (volver a verde) → diseñada
```

- **`intencion`** (II.5): `aprender` (escribes tú y la IA guía con la escalera) o `producir` (la IA puede ejecutar). Se declara al crear la tarea.
- **`ejecutor`:** `humano`, `pasos` (el construir.ts de hoy, con tus órdenes) o `agente` (Claude Code o el SDK dentro del alcance; opcionalmente en un worktree).
- **`cai avanzar`** evalúa las guardas (funciones puras) y dice **exactamente qué falta**.
- **La sesión queda ligada a la tarea** en SessionStart. Los Pre/Post de Edit aplican alcance, `preservar`, sin dependencias, presupuesto de líneas, líneas rojas, licencias y "no tocar tus líneas".

### 4.3b Entrada: objetivos, foco de hoy, pedidos separados y entrevista de restricciones
Antes de que exista una tarea, `cai` necesita saber **qué buscas** (en general y hoy), **qué pediste** (sin perder nada) y **con qué restricciones**.

**1. Objetivos generales.** Se conserva `entender.ts`, que guarda `.cai/objetivos.json` y `objetivos.md` con: qué busca el proyecto, para quién es, criterios de terminado, restricciones globales y lo que queda fuera del alcance.
- Confirmarlos y reabrirlos lo hace solo el humano.
- Cada tarea se liga a un objetivo (campo `objetivo`).
- Si pides algo fuera de alcance, la IA te lo dice y se abre una decisión: ampliar el alcance o descartarlo.

**2. Foco de hoy** (`.cai/sesiones/<fecha>.json`).
- La primera vez en el día que quieras usar la IA, escribes en una frase qué buscas hoy, o eliges tareas pendientes por su id.
- Al cerrar (`cai sesion`) se compara de forma determinista lo que te propusiste con lo que se hizo, lo que quedó pendiente y lo que apareció en el camino.
- `cai hoy` te muestra el foco, lo pendiente de ayer y los temas olvidados.

**3. Pedidos separados, sin que se olvide nada** (`.cai/pedidos/<id>.json`). Si un pedido mezcla varias cosas, `AMPLIO` ya no lo rechaza: ofrece separarlo.
- **Qué se guarda:** el **texto original literal** del pedido y, por cada tema, el **fragmento exacto** del texto que lo originó, la tarea creada (o "descartado porque…", con tus palabras) y su estado.
- **Cobertura determinista:**
  - cada fragmento tiene que ser un trozo real del texto, así que la IA no puede inventar temas;
  - lo que no quedó asignado a ninguna tarea se resalta para que lo asignes o lo descartes.
- **Ningún tema se olvida:** un pedido no se cierra mientras tenga temas sin destino. `cai avanzar`, `cai hoy` y el panel te recuerdan, por ejemplo: "p4: 1 tema sin empezar hace 5 días".
- **Rastro:** se ve qué se tocó y cuándo. Por ejemplo: `p4: "exportar a PDF" → t11 ✔ cerrada (commit a1b2) · "buscador se cuelga" → t12 ⏳ en revisión · "color tema oscuro" → t13 ○ borrador`. Los commits llevan el trailer `Cai-Pedido: p4`.
- **Choques:** si dos tareas tocan los mismos archivos, el sistema lo detecta y te pide decidir: hacerlas en orden, o en paralelo con un worktree cada una.
- **Ajustes:** puedes unir, quitar o reescribir tareas con tus palabras. Cada una debe pasar sola las guardas de especificidad, y si queda vaga, se te pregunta antes de crearla.

**4. Entrevista de restricciones** (antes de `diseñada`).
- **Cómo pregunta:** de a una. La IA **sugiere** cada respuesta con su porqué, y tú contestas con tus palabras.
- **Restricciones comunes una sola vez:** las que valen para todo el pedido (por ejemplo, "sin dependencias nuevas") se preguntan una vez, para que no se vuelva repetitivo.
- **Lo que pregunta depende del tipo de tarea:**

  | Tipo | Qué pregunta |
  |---|---|
  | Funcionalidad | archivos que puede tocar, dependencias, qué no cambiar (`preservar`), cómo sabremos que funciona (criterio verificable) y, si toca algo sensible, seguridad |
  | Bug | cómo reproducirlo, tu hipótesis primero, alcance y el test que lo demuestra |
  | UI | captura, alcance y comportamiento esperado |
  | Refactor | qué no puede cambiar y qué tests deben seguir pasando |

- **Cuestionar:** en cualquier pregunta puedes repreguntar ("¿por qué no puppeteer?"). Todo queda en el **diálogo de la tarea**.
- **Compuerta determinista:** la tarea no pasa a `diseñada` sin todas las respuestas, escritas por ti (la IA no puede contestarlas: `confirmar.ts` + `soloHumano`).
- **Qué se hace con cada respuesta:** se convierte en una regla que se hace cumplir (alcance → hook; "sin deps" → diff de `package.json`; `preservar` → huella) o en una decisión con tu porqué.
- **En la reconstrucción semanal** (4.8):
  - el enunciado se arma con esas restricciones y decisiones;
  - los bordes que la IA vio y tú no pasan a ser casos ocultos del oráculo;
  - tus "¿por qué?" vuelven en la reflexión final.

**5. Si eres vago, o contestas "sí, dale".** Se valida sin IA, con la misma familia de guardas de `ordenValida`:
- **Se rechaza la aprobación vacía:** "sí", "dale", "ok", "lo que digas", "como sugieres", "haz eso", "todo eso", "lo de arriba". La copia de la sugerencia también (`copiado` ≥ 0,5).
- **Lo que vale:** la respuesta tiene que **decir el contenido** (nombrar la carpeta, la opción, el valor) con tus palabras. Corto está bien: `src/export/, el comando lo registro yo` pasa; `sí` no.
- **El rechazo explica qué falta.** Ya se resolvieron los falsos positivos de v0.11: el "si" condicional no se lee como "sí", y se arregló el `\b` después de una tilde.
- **Pedidos vagos** ("mejora el buscador"): no se crea la tarea hasta que nombres qué (archivo, función, comportamiento). La IA te ayuda con preguntas, no adivinando (IV.3).
- **Señales de pereza medidas:** respuestas mínimas repetidas, mucha similitud entre tus respuestas o segundos de lectura menores que el largo del texto. Cuando aparecen, se **endurece**: pide el porqué y exige nivel 3 en la revisión de esa tarea.
- **Escribir a mano nunca se bloquea:** si no quieres contestar, puedes escribir el código tú. Lo que no se puede es delegar sin pensar.

### 4.4 Procedencia y "no revisado por humano"
- **Por tramos**, con la estructura de A: los orígenes de A más `ia-probable` de B, que marca las inserciones multilínea que no son pegado (Copilot y similares).
- **Niveles de revisión:**
  - 0 = nada;
  - 1 = mostrado, no cuenta;
  - 2 = explicado;
  - 3 = predicción ejecutada que acertó, o mutante detectado;
  - 4 = reescrito por ti;
  - más `reconstruccion`.
- **Validez de la evidencia:** cada una guarda el hash de su tramo. Si la IA cambia el tramo, la evidencia deja de valer.
- **`cai informe`** (CLI, panel y SARIF en CI) reporta por módulo y función: líneas por origen y nivel, una **cobertura de comprensión** separada por origen y la lista ordenada por riesgo (zona roja × fan-in × churn × sin tests).
- **Gutter de colores:**

  | Color | Qué marca |
  |---|---|
  | Rojo | IA sin revisar |
  | Verde | revisado |
  | Ámbar | heredado sin entender |
  | Morado | pegado o `ia-probable` |
- **`cai adoptar`** se corre en proyectos existentes y en el migrador:
  - usa `git blame -C -M --porcelain`;
  - tu email cuenta como `previo-propio`;
  - un trailer Co-Authored-By de una IA cuenta como `ia-previa`;
  - el resto, como `heredado`;
  - todo empieza en nivel 0.

### 4.5 Marcos de decisión (`cai decidir`) y proveedores baratos
**Cuándo se abre una decisión, sin IA:**
- una dependencia nueva fuera de las librerías preferidas;
- un módulo o carpeta nueva;
- un cambio de esquema de BD;
- una ruta de API pública nueva;
- un supuesto o una ambigüedad del plan;
- o a mano.

**Formas:**
- **binaria:** 2 opciones con pros, contras y "cuándo conviene";
- **matriz ponderada:**
  1. tú pones criterios y pesos **antes** de ver opciones;
  2. la IA propone 2–4 opciones con evidencia, y puedes agregar las tuyas;
  3. **puntúas tú**, y solo después ves la sugerencia de la IA; una diferencia ≥ 2 te pide una nota;
  4. el sistema calcula el total y la **sensibilidad**: el menor cambio de peso que da vuelta al ganador; si es < 10 puntos, "decisión frágil";
- **valor esperado:** escenarios × probabilidad × costo que pones tú → EV, minimax regret y peor caso.

**Cierre:** escribes la decisión con tus palabras, "qué me haría cambiar de opinión" y una fecha de revisión. Si la decisión es de arquitectura, sale un ADR (MADR) en `docs/adr/`. Las que se pueden expresar como regla pasan a dependency-cruiser o import-linter. El pre-commit exige el ADR cuando hubo un disparador.

**Proveedores:**
- `ia/proveedores/` con una interfaz única: `consultar({rol, system, prompt, schema, imagenes?})`.
- **Roles por defecto:**

  | Rol | Proveedor |
  |---|---|
  | `planificar` | `anthropic:claude-opus-5-5` con razonamiento alto |
  | `implementar` y `revisar` | `agentSdk:claude-sonnet-5-5` |
  | `interrogar` | Sonnet |
  | `clasificar`, `verificarFiel`, `resumir`, `traducirGit` y `traspaso` | `claude-haiku-5-5`, o Ollama/DeepSeek/Gemini Flash si los habilitas |

  Hay que actualizar el `claude-haiku-4-5` que trae hoy `config.ts`.
- **`cai ia evaluar <rol>`:** un set dorado. Un proveedor barato se habilita solo si alcanza la precisión mínima.
- **Privacidad:** `solo-local` para rutas rojas o privadas, y opt-in explícito para cada proveedor que no sea Anthropic.
- **Lo barato nunca decide una compuerta.**
- `uso.jsonl` registra proveedor y rol; `cai ia uso` muestra el costo por fase.

### 4.6 Modelo mental (propio y heredado)
1. **`cai mapa`**, determinista: grafo de módulos, llamadas e imports, puntos de entrada y flujo de datos en Mermaid. Los resúmenes de la IA se marcan como "hipótesis sin verificar".
2. **Tarjetas** `.cai/mapa/<modulo>.md`, escritas por ti: propósito, invariantes, a quién llama, quién lo llama y una predicción. Se verifican contra el grafo y ejecutando. **Caducan** cuando cambia el AST.
3. **`cai mapa --recorrido`**, para proyectos ajenos: va por centralidad. En cada parada:
   1. predices el propósito por el nombre y las firmas;
   2. lees;
   3. la IA explica;
   4. escribes la diferencia.

   Incluye **traza real**: predices el camino de llamadas y una ejecución instrumentada muestra el real.
4. **Entender antes de modificar:** una tarea cuyo alcance toca funciones `heredado`, `ia-previa` o `pegado` con nivel < 2 no se aprueba. Lo heredado que no tocas no bloquea, pero aparece en el informe.
5. **`cai repaso`:** predicciones espaciadas a 1, 7 y 30 días sobre el código de la IA que revisaste. Si fallas, el tramo baja de nivel.

### 4.7 Pull the plug (V.7) y worktrees/agentes (V.6)
**Detector de bucle.** Todas las señales son deterministas y suman puntaje por tarea:
- el mismo test con el mismo error normalizado en 3 ciclos;
- oscilación (A→B→A según la huella);
- churn mayor que 3× el presupuesto;
- más de 2 denegaciones del hook seguidas;
- el diff crece y no pasan más tests;
- compactación o un umbral de tokens;
- disculpas de la IA, que solo suman.

Al pasar el umbral, la tarea queda `desconectada` y el hook deniega toda escritura de la IA en ella.

**Checkpoints.** En cada Stop con tests en verde se guarda `refs/cai/cp/<tarea>/<n>`. El post-commit registra el último commit verde.

**`cai volver`**, solo humano:
1. deja el trabajo actual en `cai/abandono-<id>`;
2. muestra el diff;
3. vuelve al checkpoint;
4. pide un replanteo escrito por ti, y la tarea vuelve a `diseñada`. También puedes seguir a mano.

**Paralelo.** `cai tarea ejecutar --aislada` crea un worktree en `cai/t<id>`. Los roles, impuestos por el hook según `CAI_ROL`:
- **implementador:** solo escribe en el alcance, sin `tests/`;
- **tester:** solo `tests/`, **sin leer la implementación**, y los valores esperados los pones tú;
- **revisor:** solo lectura y a ciegas;
- **refactorizador:** el alcance menos tus líneas.

Hay un límite de 2 tareas en revisión al mismo tiempo, y el tablero las muestra todas.

**`cai git "…"`.** La IA traduce el pedido a comandos y `terminal.ts` clasifica su riesgo. Los corres tú; los destructivos piden un dry-run y que escribas el nombre de la rama.

### 4.8 Reconstrucción semanal (VI.3)
1. `cai reconstruir` propone 3 candidatas de la semana con más IA (sacadas de la procedencia). Eliges una.
2. Abre un worktree con la función vaciada. Ahí el hook **deniega toda IA**; solo permite WebFetch a la documentación oficial.
3. Los tests originales sirven de **oráculo oculto**.
4. Al terminar ves el diff contra la versión de la IA y escribes la diferencia. La evidencia queda como `reconstruccion`.
5. Si pasan 7 días (+2 de gracia) sin hacerla, las tareas con ejecutor IA no pasan a `ejecutando`. Lo manual sigue libre.

### 4.9 El acompañamiento a **tu** código se conserva (y se ordena)
Todo lo que hoy te ayuda cuando escribes algo mal, o cuando algo se te pasa, **sigue estando**. Cambian dos cosas:
- **cuándo habla:** en pausas naturales, no mientras tecleas (II.3);
- **dónde vive:** un solo pipeline `flujos/guia/`, en lugar de cuatro.

**Al guardar o al terminar una parte** (acompañante, `acompanante.ts` → `flujos/guia/`):
- **corrige** lo que está mal y **sugiere mejoras**, como un buen par, con un máximo de 2 por parte y nada si está bien;
- señala cuándo no cumples tus reglas (`reglas.md`, las prácticas medibles);
- si sigues trabado tras 3 guardados con el mismo error, te da una **pista escalonada** (escalera solo en lo crítico o en `aprender`).

**A pedido:**
- **"¿Quedó lista?"** (`verificar`): primero sin IA, después "lista / casi / falta", comparada con tus criterios de terminado.
- **Revisión a ciegas + "otra mirada"** (un plan hecho sin ver tu código y comparado), y la revisión completa del archivo con veredicto.
- Notas por función con botones (`!pista`, `!pseudo`, `!ejemplo`, `!tests`…), preguntas sobre la selección y la sugerencia rápida (Ctrl+Alt+Espacio).

**Lo que no notaste:**
- **Impacto:** cambiaste una función que otras llaman → aviso en sus notas y se vuelven a correr sus casos.
- **Contradicciones:** tu código choca con una decisión vigente o con un criterio de terminado.
- **Bordes:** el interrogatorio también sirve para tu código. Primero listas los bordes que ves, después la IA los suyos, y se muestra la diferencia.
- **Detectores de V.5** (carreras, debounce, rate limit, caché), prácticas medibles y reglas mecánicas: corren sobre **todo** el código, también el tuyo.
- **Tus errores frecuentes** (`patrones.json`): la guía insiste donde más fallas ("esto ya te pasó antes"), y con ellos se arman katas y repasos.
- **Tests según la intención**, no según tu código actual, para no copiar tus bugs.

**Cómo te ayuda a mejorar sin quitarte el aprendizaje:**
- En tareas `aprender` la IA **no te da el código**: te da piezas, pistas y "por qué".
- En `producir` puede ofrecer **su versión** de tu función como diff ("puedo hacerlo así, y por qué es mejor"). Si la tomas, entra por el flujo normal: tus palabras y evidencia.
- No se ancla a cómo lo hiciste: si hay un enfoque claramente mejor, lo propone con su porqué. Si prefieres dejarlo así, se registra como decisión y no lo vuelve a insistir.

**Qué bloquea y qué no** (sin cambios):
- Las opiniones de la IA **nunca bloquean** tu código: te ayudan a mejorarlo.
- Lo que bloquea el commit son las verificaciones deterministas (tipos, lint, tests, reglas, detectores sin justificar), y valen para todos por igual.
- La evidencia de comprensión se exige solo para lo que **no escribiste tú**.

### 4.10 Expediente del programador (lo que sabes, entre proyectos)
Es global, vive en `~/.cai/` (volumen que sobrevive al rebuild) y queda en archivos que puedes leer. Junta lo que hoy está repartido entre `perfil.json`, `patrones.json` y `repertorio/`. Todo sale de **evidencia, sin IA**; lo que declares tú se muestra aparte y nunca sube tu nivel por sí solo.

| Archivo | Qué guarda | De dónde sale |
|---|---|---|
| `expediente/licencias.json` | Construcciones que dominas (I.6), con su fecha de último uso | Lo que escribiste a mano y quedó en verde, y las katas |
| `expediente/dominios.json` | Nivel por dominio (TS, SQL, React, regex, Docker…) | Aciertos de predicción, resultados de revisión, katas y reconstrucciones (el ajuste por eventos de `profile.ts`, ampliado) |
| `expediente/calibracion.json` | Seguridad declarada frente a acierto real, por dominio | Revisiones y repasos |
| `patrones.json` | Errores frecuentes | Lo que más te corrigen (ya existe) |
| `expediente/proyectos.json` | Por proyecto: nombre, stack, fechas, % de código tuyo, dominios usados, licencias ganadas ahí, qué aprendiste | Se actualiza al cerrar cada sesión |
| `expediente/practica.json` | Katas, repasos y reconstrucciones: fecha, resultado y qué cambió | Las propias katas, repasos y reconstrucciones |
| `repertorio/` | Tus funciones en verde, reutilizables entre proyectos | Ya existe; es un repo git propio |

**En cada proyecto** queda lo aprendido ahí: `.cai/evidencias/` (va al repo) y un resumen en `expediente/proyectos.json`.

**Para qué se usa:**
- **Al empezar un proyecto nuevo** (`cai init`): carga tus reglas globales y tus licencias vigentes. Así no te pide una kata de algo que ya dominas en otro proyecto.
- **Ajusta la ayuda** a tu nivel real (reversión de la pericia): en lo que dominas, la evidencia es una sola predicción; en lo nuevo, tareas `aprender`, la escalera y katas.
- **Decide qué puede delegarse** (licencias) y dónde `producir` queda limitado (II.1).
- **`cai yo`** muestra el expediente, por ejemplo: "SQL ▲ (3 licencias nuevas) · regex ▼ (2 predicciones falladas) · 4 proyectos · React en 3". También aparece en el informe semanal.
- **`cai yo exportar` / `importar`** lo lleva a otra máquina. El repertorio ya se puede subir como repo git.

**Decaimiento (honestidad):** haberlo hecho antes no garantiza recordarlo.
- Una licencia sin uso en N semanas pasa a "por repasar", y `cai repaso` la vuelve a pedir.
- Una predicción fallida en una construcción la revoca hasta otra kata.
- Sin esto, el expediente terminaría diciendo que sabes cosas que ya olvidaste.

**Privacidad:** es local. Nada sale de tu máquina salvo que lo exportes tú.

---

## 5. Lo nuevo del manifiesto (I.6 y II) en C

| Punto | Mecanismo | Determinista |
|---|---|---|
| **I.6 Regla de Oro del Aprendiz** | **Licencias por construcción.** tree-sitter saca la "huella de construcciones" de cada paso que la IA va a escribir: APIs (`fetch`, `Promise.all`, `AbortController`), patrones (reduce, regex, recursión, joins SQL) e imports de librerías. La IA solo puede escribir construcciones que en `~/.cai/licencias.json` figuran como **escritas por ti a mano**, con origen `humano` y la función en verde. Si falta una, la aprobación pide una **kata a mano**: en un worktree sin IA escribes una versión mínima que pasa un caso tuyo, y eso otorga la licencia. Las licencias **decaen**: sin usarlas en N semanas, `cai repaso` las vuelve a pedir. Es la generalización del `snippets.modo: ganado` y del `repertorio.ts` que ya existen | Sí |
| **II.1 La brecha creciente** | Perfil por evidencia, por dominio (`profile.ts`). Si eres novato en un dominio, `producir` queda limitado a las zonas delegadas y los snippets hasta tener licencias (es la crítica de A, ahora como regla). El informe muestra la **autonomía por dominio** (líneas propias vs. de la IA, licencias) | Sí |
| **II.2 La ilusión de competencia** | **Calibración:** antes de revisar declaras qué tan seguro estás de entender el tramo, y se compara con el acierto de tus predicciones. Una brecha alta pide más evidencia. **Escalabilidad:** si la IA agrega bucles anidados o búsquedas dentro de bucles (detectado por AST), predices el tiempo a 10× n y `cai` lo mide ejecutando con n, 2n y 4n. **Estructuras de datos:** si la IA introduce Map/Set/árbol/caché, explicas "por qué esta y no otra" con tus palabras (guardas de especificidad) | Sí (la medición); las palabras con guardas |
| **II.3 Interrupción del flujo** | **Sin sugerencias que no pediste mientras escribes.** La guía gris por pausa (v0.8.2) y las sugerencias rápidas pasan a ser **solo a pedido** (Ctrl+Alt+Espacio). El acompañante habla solo en pausas naturales (al guardar y salir de la función), agrupado. `cai doctor` revisa `editor.inlineSuggest.enabled` y Copilot y avisa; las inserciones `ia-probable` quedan sin revisar. Cuando la IA trae código, la explicación va **antes** y no se puede colapsar | Sí |
| **II.4 Propiedad y efecto "meh"** | La procedencia hace visible tu autoría: el trailer `Cai-Humano: N líneas` en cada commit y "lo que escribiste tú" en el informe. Una **bitácora de logros propios** registra sin IA cuando resuelves algo difícil por tu cuenta (una función con fallos o gate en rojo que pasa a verde con origen `humano` y sin código de IA). Va en el resumen semanal, sobria: nada de puntos ni juego (rechazaste que pareciera un juego) | Sí |
| **II.5 Aprender vs. hacer** | La `intencion` de la tarea (aprender/producir) es obligatoria y se registra. El resumen semanal muestra los **atajos cognitivos**: % de IA por dominio, licencias usadas, deuda de comprensión y reconstrucciones pendientes | Sí |

## 6. Tabla: cómo se hace cumplir cada punto del manifiesto (numeración nueva)

**La IA sigue sugiriendo y ayudando, pero como lo haría alguien que sigue el manifiesto.** Por eso cada fila tiene dos caras:
- **lo que te pide a ti** el programa;
- **cómo se comporta la IA** cuando sugiere: un par que cumple el manifiesto.

Lo que la IA "debe hacer" no queda en manos de su buena voluntad. Su salida pasa por **filtros deterministas** antes de llegar a ti (hoy `guard.ts`, en v1.0 `flujos/guia/`); si no los pasa, la sugerencia se pide de nuevo o se descarta.

Columna **D**: **D** = determinista (parser, AST, git, tests, ejecución, contadores, esquema); **D+P** = determinista sobre tus palabras (guardas, nunca un juez IA); **IA** = la ayuda la da una IA, sin bloquear nunca.

### I. Principios
| Punto | Qué te pide / te da el programa | Cómo sugiere la IA (siguiendo el manifiesto) | Cómo se hace cumplir | D |
|---|---|---|---|---|
| I.1 Colaboración, no delegación ciega | La IA escribe código solo dentro de una tarea con tu diseño y un plan aprobado. Lo demás lo escribes tú, acompañado | Propone, pregunta y explica como un par. Nunca "te lo hago todo" | Hook PreToolUse Edit/Write: sin una tarea `ejecutando` cuyo alcance incluya el archivo, solo se permiten comentarios o notas (`verifyCommentOnly`) | D |
| I.2 La IA es un pasante calificado | Fijas los límites: alcance, sin dependencias, `preservar`, presupuesto de líneas | Trabaja solo dentro de esos límites y dice lo que le falta saber, en vez de suponer | Hook: alcance, `preservar` por huella, diff de `package.json`, presupuesto. Todo lo suyo entra en nivel 0 (sin revisar) | D |
| I.3 Entendimiento sobre velocidad | Das evidencia de que entiendes cada tramo de la IA: tus palabras, una predicción ejecutada o reescribirlo | Explica **antes** de mostrar código. Nunca "funciona, listo" | El pre-commit y el CI rechazan un tramo de la IA con nivel < 2. La evidencia se invalida si el tramo cambia (hash) | D |
| I.4 Regla de Kernighan | Si la IA escribe algo más complejo que lo que tú sueles escribir, lo simplificas o demuestras que lo entiendes (nivel 3) | Prefiere la versión más simple que tú puedas depurar y avisa cuando su propuesta te queda por encima | Presupuesto de complejidad (anidamiento, largo, ramas) contra tu percentil 90 por lenguaje (`metricas.ts` + procedencia) | D |
| I.5 Aumentar el criterio, no reemplazarlo | Decides tú: arquitectura, aprobaciones, ADR, retractar | Da opciones con trade-offs y su evidencia. Nunca decide | Decidir, aprobar y retractar son solo humanos (`confirmar.ts`: tu respuesta en AskUserQuestion; `soloHumano` revierte si lo intenta la IA). Disparadores sin IA abren una decisión | D |
| I.6 Regla de Oro del Aprendiz | La IA solo escribe construcciones que **ya escribiste tú a mano**. Si falta una, haces una kata sin IA (≈10 min) | Sugiere a tu nivel. Si su idea usa algo que no dominas, te lo dice y te propone aprenderlo primero | **Licencias**: la huella de construcciones (tree-sitter) de cada paso se compara con `~/.cai/licencias.json`; si falta una, la aprobación queda bloqueada. Kata con tu caso + uno oculto ejecutado. Las licencias decaen y se revocan si fallas una predicción | D |

### II. Psicología y riesgos cognitivos
| Punto | Qué te pide / te da el programa | Cómo sugiere la IA | Cómo se hace cumplir | D |
|---|---|---|---|---|
| II.1 La brecha creciente | En los dominios donde eres novato aprendes primero: tareas `aprender` y katas | Ahí da piezas, pistas y el porqué, no código | Perfil por evidencia (`profile.ts`). Si eres novato en el dominio, `producir` queda limitado a zonas delegadas y snippets hasta tener licencias. El informe muestra tu autonomía por dominio | D |
| II.2 La ilusión de competencia | Declaras qué tan seguro estás y se compara con tus aciertos. Predices la escalabilidad. Explicas por qué esa estructura de datos | Hace preguntas conceptuales ("¿qué pasa con 10× datos?") en vez de felicitarte porque funciona | Calibración (seguridad declarada vs. acierto ejecutado). Benchmark n/2n/4n contra tu predicción. Una estructura nueva (Map/Set/caché), detectada por AST, exige tu porqué | D / D+P |
| II.3 Interrupción del flujo | Nada aparece mientras tecleas | Habla solo en pausas naturales (al guardar o al terminar una parte) o cuando la llamas, y agrupa lo que tiene que decir | La guía gris y las sugerencias rápidas quedan **solo a pedido**. El acompañante se dispara por eventos (guardar o salir de la función). `doctor` revisa Copilot e `inlineSuggest`. Las inserciones `ia-probable` quedan sin revisar | D |
| II.4 Propiedad y efecto "meh" | Tu autoría se ve: líneas tuyas, logros propios | Te deja la parte interesante a ti y no "remata" lo que estás resolviendo | Procedencia; trailer `Cai-Humano: N`; bitácora de logros (función en rojo que pasó a verde con origen humano y sin IA), sobria, sin puntos | D |
| II.5 Aprender vs. solo hacer | Cada tarea declara `aprender` o `producir` | En `aprender` no da código. En `producir` te recuerda el atajo que estás tomando | Campo obligatorio de la tarea. El resumen semanal muestra los atajos cognitivos (% de IA por dominio, deuda, licencias usadas) | D |

### III. Cimientos y reglas de entorno
| Punto | Qué te pide / te da el programa | Cómo sugiere la IA | Cómo se hace cumplir | D |
|---|---|---|---|---|
| III.1 Indexación del código | Nada: se indexa solo | Sugiere sabiendo qué funciones existen ("usa `normalize`") y no inventa ninguna | `indice.ts` del repo completo al iniciar y al guardar; `doctor` verifica que esté fresco y el plugin LSP. Una sugerencia que nombra una función que no existe en el índice se descarta | D |
| III.2 Reglas globales: filosofía de tests | Escribes tu filosofía una vez para todos los proyectos | Propone tests según tu filosofía | `~/.cai/reglas-globales` con esquema; `init` no termina sin la capa global | D |
| III.2 Librerías preferidas | Las listas | Sugiere primero las tuyas | Una dependencia fuera de la lista abre una decisión (sin IA) | D |
| III.2 Estilo y comandos bash | Los escribes (`bash.permitir` global) | Respeta tu estilo y tus comandos | Reglas mecánicas en el gate; Bash filtrado (`bash.ts`) | D |
| III.3 Stack y versiones exactas | Sección obligatoria en `reglas/proyecto.md` | No sugiere APIs de otra versión | `doctor` contrasta con los lockfiles; si no coinciden, el plan no se aprueba. Con un MCP de docs, el plan exige `fuentes[]` | D |
| III.3 Esquema de BD y patrones de API | Sección obligatoria (la ruta al esquema debe existir) | Diseña respetando el esquema y los patrones | `doctor` falla si falta. Un cambio de esquema dispara una decisión + ADR | D |
| III.3 Nombres de ramas | Escribes la regex | Propone nombres válidos (`cai git`) | git hooks post-checkout y pre-push + CI | D |
| III.3 Reglas por submódulo | `reglas/*.md` con `paths:` | Aplica la regla de la carpeta en la que está | Precedencia única (`cai reglas` muestra el origen); se compilan a `.claude/rules/`; las líneas rojas solo se suman | D |
| III.4 MCP de frameworks (Svelte…) | `doctor` los recomienda según tu stack; los instalas tú | Los usa para no alucinar APIs viejas | Catálogo por stack; `.mcp.json` protegido; hook `mcp__*` | D (política) |
| III.4 MCP de diseño (Figma) | Ídem | Saca la especificación de la interfaz del diseño, no la inventa | Si la tarea de UI tiene un Figma enlazado, el plan exige `fuentes[]` | D |
| III.4 MCP de monitoreo (Sentry) | Ídem | Arranca de los errores reales | Lectura permitida; el incidente queda enlazado a la tarea | D |
| III.4 MCP de APIs (Stripe) | Ídem | Usa la documentación de **tu** versión | Ídem a frameworks: `fuentes[]` en el plan | D |
| III.4 MCP de gestión e infraestructura (GitHub, Jira, AWS, Cloudflare) | Ídem | Puede leer tickets. Para escribir o aprovisionar, te pide confirmación con el efecto descrito | Hook `mcp__*`: escritura → "ask" con la descripción del efecto | D |

### IV. Prompting y modelos
| Punto | Qué te pide / te da el programa | Cómo sugiere la IA | Cómo se hace cumplir | D |
|---|---|---|---|---|
| IV.1 Especificidad extrema | Tus pedidos y órdenes nombran qué (campo, endpoint, componente) | Sus sugerencias también son específicas: archivo, función, campo. Nunca "mejora esto" | Guardas sin IA (`ordenValida`, `VAGO`, `AMPLIO`, identificadores del índice) en el diseño, las órdenes y el chat (linter en UserPromptSubmit, con una reescritura sugerida). A sus sugerencias se les aplica el mismo filtro: una vaga se pide de nuevo. Un pedido con varias cosas se separa en tareas, con cobertura del texto original (4.3b) | D |
| IV.2 Contexto explícito | Declaras `contexto[]` en el diseño (archivos o símbolos) | Trabaja con eso y dice "me falta ver X", en vez de buscar a ciegas | El ejecutor recibe solo el contexto + el mapa; las lecturas fuera de él se cuentan y se muestran | D |
| IV.3 Prohibido adivinar | Respondes las ambigüedades | Ante la duda **no supone**: da 2 opciones con pros y contras | Esquema: `ambiguedades[]` con exactamente 2 opciones → una decisión pendiente; no se aprueba con pendientes. Una sugerencia que dice "supongo…" sin opciones se rechaza. El Stop deniega tocar símbolos que no están en el plan | D |
| IV.4 Apoyo visual | En una tarea de UI adjuntas una captura (o escribes por qué no hace falta) | Pide la captura en vez de imaginar la pantalla | UI (por extensión) o léxico visual en el pedido → falta la captura en `adjuntos/`, no avanza | D |
| IV.5 Modelo de razonamiento para planificar | Nada: va por rol | El planificador piensa a fondo | `ia.roles.planificar` = modelo de razonamiento alto | D |
| IV.5 Modelo de código para implementar | Ídem | Implementa con el modelo de código | `ia.roles.implementar` | D |
| IV.5 No cambiar de modelo a mitad de conversación | Ídem | — | Una sesión por fase; el modelo leído del transcript; un cambio fuera de la transición plan→ejecución se bloquea | D |
| IV.6 Conversaciones cortas | Una tarea = una conversación | Al llegar al umbral te propone cerrar y te deja un traspaso | La sesión queda ligada a la tarea (SessionStart). UserPromptSubmit bloquea por otra tarea o por el umbral de turnos o tamaño. El traspaso lo corriges tú | D |

### V. Workflow
| Punto | Qué te pide / te da el programa | Cómo sugiere la IA | Cómo se hace cumplir | D |
|---|---|---|---|---|
| V.1 Comprensión y diseño previo humano | Escribes tú el diseño: problema, enfoque, contexto, criterio verificable | No diseña por ti. Si se lo pides, te hace preguntas que te ayudan a pensar | Estado borrador→diseñada con guardas. Lo copiado de la IA (5-gramas ≥ 0,5) se rechaza | D+P |
| V.2.1 Plan detallado | — | Hace un plan en palabras | Rol `planificar`, salida con esquema JSON | D (forma) |
| V.2.2 Flujo de datos, funciones, integración, retos | — | Los incluye todos | El esquema exige `flujoDeDatos`, `funcionesClave`, `integracion`, `retos`, `archivos` y `comoProbar` | D |
| V.2.3 "No escribas código todavía" | — | Solo pasos prácticos | La instrucción va literal; `guard.ts` rechaza código y vuelve a pedir | D |
| V.2.4 Dos opciones con pros y contras | Eliges tú (matriz o EV si es importante) | Presenta 2 opciones concretas | Esquema + `cai decidir` (pesos antes de ver, puntajes tuyos, sensibilidad) | D |
| V.3 Ejecución con restricciones | Respondes la **entrevista de restricciones** (4.3b) con tus palabras; escribes la paráfrasis del plan | Sugiere cada restricción con su porqué y la respeta; implementa **exactamente** el plan, con instrucciones para probarlo | Hook: alcance, sin dependencias, `preservar`, presupuesto, licencias, líneas rojas; `comoProbar[]` → gate | D |
| V.4.1 Revisión rigurosa | Revisas por tramos chicos con evidencia variada | Te muestra el tramo y su porqué, nunca un "Aceptar" | Nivel ≥ 2 por tramo; evidencia polimórfica; se endurece ante señales de piloto automático; límite de 2 tareas en revisión | D+P |
| V.4.2 Preguntas críticas ("¿por qué este patrón? ¿bordes? ¿rendimiento?") | Escribes **primero** tus bordes y el impacto en rendimiento | Responde las tres preguntas y se muestra la diferencia con las tuyas | Sin tus listas no hay nivel 2 (interrogatorio "decidir antes de ver") | D+P |
| V.4.3 Editas tú y la IA refactoriza alrededor | Editas a mano lo que quieras (nivel 4) | Se adapta a tus cambios sin tocarlos | El hook deniega a la IA editar líneas `humano` de la tarea; `cai tarea refactorizar` | D |
| V.5 Concurrencia y race conditions | Escribes un test o un "no aplica porque…" | Te señala dónde mirar | Detector AST: estado compartido entre `await`, `Promise.all` con escrituras | D |
| V.5 Debounce, rate limiting y caché | Ídem | Ídem | Detectores: timers sin cancelar, `fetch` en bucle sin limitador, caché sin invalidación | D |
| V.5 Tests unitarios y de integración | Pones los valores esperados según tu intención | Propone casos según la intención, no según el código | Gate (tests en verde, diff-coverage), mutación si hay mucho fan-in, tester ciego | D |
| V.6.1 Agentes especializados | Apruebas lo que hace cada uno | Cada rol hace solo lo suyo | Permisos por rol en el hook (`CAI_ROL`): implementador sin `tests/`; tester sin leer la implementación; revisor de solo lectura; refactorizador sin tus líneas | D |
| V.6.2 Worktrees en paralelo | Supervisas e integras tú | Trabaja aislado | `cai tarea ejecutar --aislada` → worktree; tablero; integrar es humano | D |
| V.6.3 Git en lenguaje natural | Corres tú los comandos | Traduce tu pedido a comandos y explica los riesgos | `cai git`; riesgos detectados sin IA (`terminal.ts`); los destructivos piden dry-run y escribir el nombre de la rama | D |
| V.7 Detener la interacción | Decides cómo seguir | Si ve que da vueltas, **te dice que pares** en vez de intentar otra vez | Detector de bucle (mismo fallo 3 veces, oscilación, churn, denegaciones, diff sin avance) → `desconectada`: el hook deniega toda escritura de la IA | D |
| V.7 Volver al último commit estable y replantear | Escribes el replanteo, o sigues a mano | Te ayuda a replantear: preguntas, no otro parche | Checkpoints en verde; `cai volver` (solo humano) deja `cai/abandono-<id>` y vuelve a `diseñada` | D |

### VI. Reglas de oro senior y ejercicios
| Punto | Qué te pide / te da el programa | Cómo sugiere la IA | Cómo se hace cumplir | D |
|---|---|---|---|---|
| VI.1 Lógica central de negocio | La marcas como zona roja (`doctor` te propone candidatas) | Ahí solo explica, guía y revisa. No escribe | `zonas.rojas`: el hook deniega escribir **siempre**, también por `construir` y por Bash | D |
| VI.1 Rutas críticas y arquitectura distribuida | Ídem | Ídem | Ídem + mutación obligatoria en el gate | D |
| VI.1 Seguridad, autenticación y cifrado | Ídem | Ídem | Ídem + un hunk de la IA con APIs de seguridad (bcrypt, jwt, crypto) **fuera** de zona roja abre una decisión | D |
| VI.2 Boilerplate que entiendes | Usas snippets o zonas delegadas | Te sugiere el snippet (apagado; lo activas tú) o la herramienta | Snippets tuyos + licencias; los codemods son origen `herramienta` con AST equivalente | D |
| VI.2 Configuración y plantillas de test | Resumen de una línea | Los escribe en la zona delegada | Zonas delegadas por tipo, con evidencia proporcional y el gate en verde | D |
| VI.2 Explorar 3 enfoques | Pones los criterios y eliges | Propone 3 enfoques con trade-offs | `cai decidir --alternativas 3` (matriz y sensibilidad) | D |
| VI.2 Onboarding en código desconocido | Recorrido: tu hipótesis primero | Diagramas, rastreo y resúmenes, marcados como "hipótesis" | `cai mapa` (grafo determinista), tarjetas que caducan, traza real; "entender antes de modificar" | D+P |
| VI.3 Elegir una funcionalidad de la semana | Eliges entre 3 candidatas | — | Las candidatas salen de la procedencia (más % de IA) | D |
| VI.3 Reconstruirla solo con docs oficiales | La reconstruyes en un worktree | **No ayuda**: está apagada | El hook deniega toda IA en el worktree; solo WebFetch a dominios de docs oficiales | D |
| VI.3 Modelos mentales sin atrofia | Comparas tu versión con la de la IA y escribes la diferencia | Después, te explica las diferencias | Oráculo oculto (los tests originales). Sin reconstrucción en 7+2 días, las tareas con IA no pasan a `ejecutando` | D |

**Superficie de la CLI** (~14 comandos): `init`, `migrar`, `doctor`, `tarea`, `avanzar`, `guia` (notas, "¿quedó lista?", pistas), `decidir`, `revisar`, `informe`, `mapa`, `repaso`, `reconstruir`, `volver`, `git`, `ia`, `reglas`. Los internos son `hook`, `servir`, `ci`, `mcp` y `selftest`. **CLAUDE.md queda en ≤ 40 líneas**, más las skills `cai-tarea`, `cai-revisar` y `cai-guia`.

---

## 7. Fases de implementación (Plan C)
Cada fase se cierra con `pnpm build && pnpm test && node dist/cli.js selftest` en verde y un commit hecho por ti.

| Fase | Contenido | Cómo se verifica |
|---|---|---|
| **F0** | Escribir los planes en `docs/planes/` (ver abajo). Rama `v1`. `selftest.ts` partido en `test/escenarios/*.test.ts`. `test/arquitectura.test.ts` con las violaciones como pendientes | Los 209 escenarios en verde dentro de vitest |
| **F1** | Capas (`nucleo/proyecto/garantias/ia/flujos/cli`), cortar las 3 violaciones, `comandos.ts` → tabla. `ia/proveedores` + roles + `falso` + `openaiCompatible` (Ollama) + `cai ia evaluar` | Test de arquitectura activo; hook ≤ 100 ms medido; prueba real Haiku vs. Ollama en "clasificar" |
| **F2** | Almacén v1 con esquemas; reglas global/proyecto/ruta con precedencia; compilación a CLAUDE.md y `.claude/rules`; esqueleto de `cai migrar --simular` | vitest por esquema; JSON dañado; tabla de precedencia (las líneas rojas solo por unión) |
| **F3** | **Procedencia**: `diffLineas`, tramos, Pre/Post de Edit (agregar el matcher en `init.ts`), guardado de la extensión, `adoptar`, pre-commit + merge driver, `cai informe` + gutter | Propiedades con fast-check (editar, mover y borrar al azar no pierde ni inventa atribución); sesión real de Claude Code editando |
| **F4** | **Tareas**: objetivos y foco de hoy, pedidos separados con cobertura (`.cai/pedidos/`), entrevista de restricciones por tipo, validación contra "sí, dale", `nucleo/flujo.ts`, `cai avanzar`, diseño con guardas, plan sin código, decisiones (matriz/EV/sensibilidad) + ADR, aprobación con paráfrasis, intención, licencias + kata (I.6), hooks SessionStart/UserPromptSubmit/Stop | Tabla de transiciones; escenarios `[seg]`: la IA edita sin plan, fuera del alcance, agrega deps, toca `preservar`, usa una construcción sin licencia; "sí"/"dale" rechazados; ningún tema de un pedido queda sin destino |
| **F5** | **Revisión y comprensión**: niveles 2–4, polimorfismo, interrogatorio, "refactorizar alrededor", Kernighan, calibración, señales de habituación, WIP | Una copia de la IA se rechaza; una predicción fallida no cuenta; prueba real en `examples/demo-ts` |
| **Puerta** | **Prueba con 2–3 personas** antes de seguir | Tiempo por etapa, abandonos, cobertura de comprensión |
| **F6** | Detectores de V.5, benchmarks de escalabilidad, mutación por fan-in, roles tester e implementador | Fixtures positivas y negativas con race, debounce y caché |
| **F7** | Detector de bucle, checkpoints, `cai volver`, worktrees, tablero, `cai git` | Un `falso` que oscila; worktree real |
| **F8** | Mapa, tarjetas, recorrido + traza, repaso, reconstrucción (enunciado y oráculo desde la entrevista), bitácora propia, **expediente del programador** (`cai yo`, exportar e importar, decaimiento) | Repo ajeno real en `examples/heredado/` |
| **F9** | Superficie final: CLI de ~12 comandos, extensión con 2 paneles, guía solo a pedido (II.3), `cai-mcp`, catálogo y política MCP, regex de ramas, CLAUDE.md ≤ 40 líneas | `scripts/humo.cjs` + recorrido manual |
| **F10** | `cai migrar` final (respaldo `.cai.v0-<fecha>/`, idempotente, reporte), docs, release v1.0, estudio de eficacia | Fixtures congeladas de `examples/demo-ts` y `examples/obsidian-files` |

**F0, al aprobar este plan:** crear `docs/planes/` con estos archivos:

| Archivo | Contenido |
|---|---|
| `plan-A-con-proyecto.md` | el texto completo del agente A, con una nota sobre la numeración vieja |
| `plan-B-desde-cero.md` | el texto completo del agente B, con la misma nota |
| `comparacion.md` | la sección 3 |
| `plan-C-mezclado.md` | las secciones 4 a 11 |

Además, enlazarlos desde `docs/design.md` y anotar la sesión en `docs/historial.md`.

**Archivos críticos que se modifican primero:** `packages/complementairy/src/hook.ts`, `config.ts`, `init.ts` (los matchers), `llm.ts` → `ia/`, `construir.ts` → `nucleo/especificidad` + `flujos/tarea/ejecutar`, `comandos.ts` → `cli/tabla.ts`, `selftest.ts` → `test/escenarios/`.

## 8. Problemas y casos límite, y cómo los resuelve C
Cada solución mantiene la exigencia **estricta**. Ninguna afloja una compuerta: o la vuelve más precisa, o mueve el trabajo a un camino determinista que no necesita revisión línea por línea.

### 8.1 Problemas de fondo
| Problema | Solución |
|---|---|
| **Delegar baja la comprensión** (Anthropic 2026: 50 % vs. 67 %), y la brecha crece en los novatos (Prather 2024 = manifiesto II.1) | La IA solo escribe lo que ya demostraste saber escribir (licencias, I.6). Todo lo suyo exige evidencia generativa por tramo. En un dominio donde eres novato, `producir` queda limitado a zonas delegadas y snippets hasta que ganes licencias. Lo nuevo se aprende con tareas `aprender`: escribes tú y la IA guía sin dar código |
| **Habituación**: aprobar sin leer (Vance 2017/18) | Evidencia **polimórfica**: explicar, predecir una salida, predecir qué test mata a un mutante, listar los bordes antes de ver. El tipo cambia al azar entre tramos. Los tramos son chicos (presupuesto ≤ ~150 líneas por paso; la detección cae sobre 200–400 LOC, Cisco/SmartBear 2006). Hay **señales medidas** de piloto automático (segundos sobre el tramo menos que su largo, explicaciones con similitud > 0,8 con las tuyas anteriores, caída del acierto): cuando aparecen, **se endurece** (nivel 3 obligatorio) |
| **Goodhart**: explicaciones de relleno ("esta función suma") | Guardas deterministas: menciona identificadores del tramo, largo proporcional a la complejidad, no copiada (5-gramas contra la IA y los comentarios). Las predicciones ejecutadas no se pueden fingir: pesan más y aparecen sin aviso. `cai repaso` vuelve semanas después sobre lo que "explicaste". Límite declarado: la herramienta frena a la IA y la autocomplacencia, no a alguien decidido a mentirse |
| **Fricción y abandono** (Buçinca 2021: las forcing functions funcionan pero gustan menos) | Sección 10: caminos rápidos deterministas, evidencia que se ajusta a tu pericia (no se afloja, cambia de forma), `cai avanzar` dice exactamente qué falta, y el tiempo por etapa se mide y se muestra |
| **Las licencias son una aproximación** (haber escrito `Promise.all` una vez ≠ dominarlo) | Las licencias **decaen** si no las usas, `repaso` las vuelve a pedir, y una predicción fallida sobre esa construcción revoca la licencia hasta otra kata |

### 8.2 Casos límite del día a día
| Caso | Qué pasa en C |
|---|---|
| **Arreglo de una línea o un typo** | Escrito a mano: **ninguna compuerta**. Si lo hace la IA, es una "tarea express": diseño de una frase con el identificador, el plan es el diff y la evidencia es proporcional (una línea explicada o una predicción). Nunca cero, nunca un formulario largo |
| **Emergencia en producción** | Escribir a mano nunca se bloquea, así que el hotfix lo escribes tú. La IA ayuda en **modo exploración** (sin tarea, solo lectura): lee logs, explica y propone hipótesis. Y si existe el MCP de Sentry, trae el incidente |
| **Refactor mecánico gigante** (renombrar en 200 archivos, mover módulos) | Lo hace una **herramienta determinista** (rename del LSP, ts-morph, codemod) con origen `herramienta`. Se verifica de forma determinista que el AST sea equivalente salvo los identificadores renombrados, así que **no hay revisión por línea**: solo la decisión. Si la IA quiere hacerlo editando a mano, se le deniega y se le indica la herramienta |
| **El formateador (prettier/ruff) reescribe líneas** | Si el AST es equivalente (cambio solo de formato), se **conservan el origen y la evidencia**. No se invalida nada |
| **Rebase, squash, cherry-pick, conflictos** | Los tramos se anclan por la huella del texto más la función; el merge driver une por huella; el CI recalcula. Una línea que no se puede anclar = `desconocido` (fallo cerrado: hay que dar evidencia) |
| **Equipo con varias personas** | Origen `humano(autor)`. La evidencia es por persona: el informe separa "no revisado por ningún humano" de "no revisado **por ti**". La aprobación de un PR cuenta como `par_humano`, más débil, y se muestra aparte |
| **Proyecto heredado de 500 mil líneas** | No se exige entender todo. Solo **lo que tu tarea toca** (y sus llamadores directos) necesita nivel ≥ 2 o una tarjeta vigente. El recorrido prioriza por centralidad y riesgo. El informe muestra el resto, sin bloquear |
| **Uso fuera de Claude Code** (Cursor, Copilot, ChatGPT en el navegador) | Sin hooks, igual atrapan la extensión (pegado e `ia-probable`: ráfagas multilínea más rápidas que tipear), los git hooks y el CI (líneas sin procedencia = `desconocido`). Las reglas se compilan también a AGENTS.md y `.cursorrules` |
| **Código retipeado desde otra pantalla** | Indetectable del todo. La extensión marca `ia-probable` si el ritmo de tecleo es anómalo (por ejemplo, > 15 caracteres/s sostenidos sin pausas). Y `repaso` también pregunta, de vez en cuando, por código "humano". Queda documentado como límite |
| **Sin red o sin IA** | Todas las compuertas son deterministas y siguen funcionando. El plan lo puedes escribir tú (un plan humano vale igual). Solo se pierden la ayuda y los resúmenes |
| **Código no determinista** (hora, azar, red) en las predicciones | Dobles del sandbox (ya existen, `sandbox.ts`) con valores que fijas tú. Si no se puede, la evidencia pasa a explicación + predicción de mutante ("¿qué test falla si niego esta condición?") |
| **Código de UI difícil de predecir** | Evidencia visual: una captura antes/después + tu descripción de lo que cambia + la predicción de un estado (props → qué se ve). Más adelante, Playwright |
| **Kata "trampa"** (trivial, solo para ganar la licencia) | La kata debe pasar **tu** caso y un caso oculto generado al azar, verificado ejecutando. Además debe usar la construcción que se licencia (lo comprueba tree-sitter) |
| **Una compuerta da un falso positivo** | Toda denegación ofrece "no aplica porque…": con tus palabras y guardas, se registra como **decisión** (visible y retractable). `cai reglas --estadisticas` muestra qué regla se salta más, y ajustar el umbral es una decisión humana registrada. Precisa, no floja |
| **Contestas "sí, dale" o "lo que digas"** | Se rechaza sin IA: la respuesta tiene que nombrar el contenido con tus palabras (corto vale). Si se repiten respuestas mínimas, se endurece. Escribir a mano sigue libre (4.3b) |
| **Pides 3 cosas a la vez** | Se separan en 3 tareas ligadas a un pedido que guarda el texto literal. Ningún tema se cierra sin destino, y cada uno muestra su tarea, su estado y su commit (4.3b) |
| **La IA dice "ambiguo", pero te da igual** | Se permite la opción "cualquiera, porque…" como decisión registrada. No se adivina en silencio |
| **Dos tareas sobre el mismo archivo** | Al aprobar se detecta el solapamiento de alcances: se pide una decisión (secuenciar, o un worktree cada una) |
| **Pregunta rápida a la IA sin tarea** | Sesión sin tarea = **modo exploración**: la IA lee, explica y responde. Escribir código está denegado. Las conversaciones siguen siendo cortas (umbral de turnos) |
| **La reconstrucción semanal cae en una semana de entrega** | Eliges el día y una de 3 candidatas (las hay de 20–40 min). Solo bloquea las tareas **con IA**; lo manual sigue libre. Hay 2 días de gracia |
| **Costo que se dispara** | Presupuesto por tarea y por semana, roles baratos, caché por hash de la entrada, una sesión por fase (aprovecha la caché de prompts), contexto explícito. `cai ia uso` muestra el costo por fase |
| **Cambia la API de hooks de Claude Code** | Fixtures grabadas de hooks reales en los tests, versión mínima verificada en `doctor`, falla cerrada. El respaldo son los git hooks y el CI |
| **El migrador rompe datos** | `--simular` por defecto, respaldo en `.cai.v0-<fecha>/`, idempotente y con reporte de lo descartado |
| **Usuarios no técnicos** | Revisar tramos no les sirve. Variante futura con compuertas de **comportamiento** (criterios en lenguaje natural → tests, predicciones sobre lo que hará la app). Fuera de v1.0, pero el núcleo (tareas, procedencia, decisiones) la soporta |
| **Privacidad con proveedores baratos** | Opt-in explícito por proyecto; `solo-local` para zonas rojas y rutas privadas |
| **Alcance del proyecto** (~10–12 semanas) | La puerta tras F5 es dura: probar con 2–3 personas antes de F6–F10 |

---

## 9. Ejemplos de uso
*(Los tiempos y costos son ilustrativos, para mostrar el flujo. Los reales se miden en la puerta.)*

### Ejemplo 1: funcionalidad nueva en tu proyecto, con la IA escribiendo
```
$ cai tarea "Campo editable en users" --producir
✔ Tarea t7 creada (intención: producir). Abre el diseño: .cai/tareas/t7 (o el panel Tarea).
```
Escribes el diseño en 5 minutos:
- **problema:** solo los dueños editan;
- **enfoque:** un booleano `editable` en `users`, expuesto en `GET /api/users/:id`, y `EditButton` que lo lee;
- **contexto:** `src/db/schema.ts`, `src/api/users.ts`, `src/components/EditButton.tsx`;
- **criterio:** `GET /api/users/7 → editable:false`.

```
$ cai avanzar
✘ Falta 1 cosa: el criterio debe ser verificable. "funciona bien" no se puede comprobar.
  Ejemplo de forma: una llamada y su resultado esperado, o un comando.
```
Lo corriges, y `cai avanzar` pasa a **planificada**. El planificador (Opus, razonamiento alto) devuelve un plan sin código y una ambigüedad: *columna nullable* o *migración con valor por defecto*.

```
$ cai decidir d12
Tus criterios y pesos primero (suman 100): compatibilidad 50, simplicidad 30, rendimiento 20
Opciones (IA): A) nullable  B) default false   · puntúa tú cada una 1–5…
Total: A 3,4 · B 4,3  → gana B. Sensibilidad: haría falta subir "compatibilidad" a 78 para que gane A. Robusta.
Escribe la decisión con tus palabras: …
```
Para aprobar escribes la paráfrasis del plan y fijas el alcance (3 archivos), sin dependencias.

```
$ cai avanzar
✘ Licencia faltante: el paso 2 usa "migración con knex.schema.alterTable" y nunca lo escribiste a mano.
  Kata (≈10 min, sin IA): agrega una columna a una tabla de prueba en .cai/katas/k3. Tu caso + 1 oculto.
```
Haces la kata, ganas la licencia y la tarea pasa a **aprobada**. En Claude Code: "ejecuta t7".
- La IA intenta `npm i zod`: **denegado** (sin dependencias).
- Intenta tocar `src/auth/session.ts`: **denegado** (línea roja y fuera del alcance).
- Escribe los 3 archivos. El Stop pasa la tarea a **en-revision**.

```
$ cai revisar
Tramo 1/4  src/api/users.ts:40-58 (IA, 19 líneas)  evidencia pedida: predicción
  Elige una entrada y predice: getUser({id:7, rol:"admin"}) → ?
  Tu predicción: { editable:false }   Ejecutado: { editable:true }  ✘
  Mira la línea 51: los admin siempre editan. ¿Era tu intención? → decisión d13 abierta.
Tramo 2/4  … evidencia pedida: antes de ver la respuesta de la IA, ¿qué bordes ves?
  Tú: id inexistente, usuario borrado.   IA agrega: doble PATCH concurrente.  → diferencia guardada.
```
La validación encuentra un `fetch` en un bucle sin limitador (V.5): escribes un test o "no aplica porque…". Commit, con el trailer `Cai-IA: 61 líneas (61 revisadas) · Cai-Humano: 12`.

**Total:** unos 50 minutos. La IA escribió el 80 %, tú entiendes el 100 % y encontraste un bug de intención (el admin) antes de producción.

### Ejemplo 2: bajar a tocar código en medio de la tarea
Durante la revisión de t7 no te gusta cómo quedó `EditButton` y lo reescribes a mano. Esas líneas quedan como `humano`, nivel 4.

```
$ cai tarea refactorizar t7 "adapta los tests y el tipo UserDTO a mi nuevo EditButton"
```
La IA ajusta los tests y el tipo. Si intenta tocar tus líneas, la deniega el hook. Tus líneas no necesitan evidencia: las escribiste tú.

### Ejemplo 3: proyecto ajeno, arreglar un bug
```
$ cai init && cai adoptar
Procedencia: 41.200 líneas heredado · 0 tuyas · 3.100 ia-previa (trailers Co-Authored-By). Todo en nivel 0.
$ cai mapa --recorrido --hacia src/billing/invoice.ts
Parada 1/5: calcularTotal(items, cupon)  — solo nombre y firma. ¿Qué crees que hace?
```
En cada parada: tu hipótesis → lees → la IA explica → escribes la diferencia → una predicción ejecutada. Al final quedan una tarjeta de `billing/` y nivel ≥ 2 en las 5 funciones.

```
$ cai tarea "Cupón se aplica dos veces" --producir
$ cai avanzar
✔ Entender antes de modificar: las 3 funciones del alcance tienen nivel ≥ 2. OK.
```
Arreglas el bug (tú o la IA, con el flujo). El informe muestra: *billing 38 % entendido, resto del proyecto 2 %*. No bloquea; queda como mapa de lo que todavía no sabes.

### Ejemplo 4: la IA entra en bucle
La IA prueba tres correcciones y el mismo test falla con el mismo error. A la tercera:
```
⛔ t9 desconectada: mismo fallo 3 veces (TypeError en parseFecha), el diff creció 140 líneas sin pasar más tests.
   cai volver t9  → guarda esto en cai/abandono-t9 y vuelve al checkpoint verde de las 11:02
```
Corres `cai volver t9` y escribes el replanteo: "el problema es la zona horaria, no el parser". Lo resuelves a mano en 10 minutos.

**Ahorro:** sin el detector, lo típico son 20 intentos más (la "rueda de prompts").

### Ejemplo 5: lo trivial, rápido
- **Config de ESLint y CI:** son zonas delegadas de tipo `config`. La IA las escribe, y la evidencia es proporcional: un resumen tuyo de una línea + el gate en verde.
- **Renombrar `cliente` → `customer` en 120 archivos:** la IA lo propone vía rename del LSP (origen `herramienta`). La equivalencia del AST se verifica sola: 0 tramos que revisar.
- **Una ruta express nueva:** el snippet `express-ruta` es código tuyo, ya aprobado, y entra sin IA.

### Ejemplo 6: escribes algo mal y te ayuda a mejorarlo
Escribes `aplicarCupon` a mano y guardas al pasar a otra función. El acompañante deja en su nota:
```
🔴 Si el cupón es mayor que el total, el resultado queda negativo. ¿Qué debería pasar?
💡 Recorres items dos veces (filter + reduce); con un solo reduce queda más claro. ¿Por qué? …
⏳ Usa calcularTotal: cambió hace 10 min, vuelve a correr sus casos (impacto).
```
Pides `!pista` sobre lo del negativo, lo corriges tú y pruebas "¿quedó lista?":
```
🟡 casi: falta el caso cupón vencido (criterio de terminado #2).
```
Lo agregas, queda 🟢 y la nota se cierra. El detector de V.5 no encontró nada. Todo es tuyo: no te pide evidencia, y la bitácora registra que lo resolviste por tu cuenta.

### Ejemplo 7: pides 3 cosas a la vez
```
Tú:  agrega exportar a PDF, arregla que el buscador se cuelga y cambia el color del tema oscuro
IA:  Veo 3 temas. Pedido p4:
       t11 "exportar a PDF"            funcionalidad
       t12 "buscador se cuelga"        bug (probable debounce, V.5)
       t13 "color del tema oscuro"     UI (pedirá captura)
     t11 y t12 tocan src/notas/indice.ts → ¿en orden o en paralelo?  ¿Por cuál empezamos?
Tú:  primero el buscador, después PDF, el color al final
IA:  Común a las 3: ¿"sin dependencias nuevas"? Sugiero que sí, porque…
Tú:  sí
cai: ✘ "sí" no dice qué. Escríbelo con tus palabras (ej.: "sin deps salvo PDF, que lo decido ahí").
Tú:  sin dependencias, salvo PDF que lo decido en su tarea
IA:  t12 (1/4) Bug: ¿cómo lo reproduces? Y antes de que te diga la mía: ¿tu hipótesis?
```
Días después, `cai hoy` muestra: `p4: t12 ✔ (commit 9f3e) · t11 ⏳ en revisión · t13 ○ sin empezar hace 4 días`.

### Ejemplo 8: el informe semanal
```
$ cai informe --semana
Tareas cerradas 9 (5 producir · 4 aprender)  ·  tiempo medio 41 min (semana 1: 63 min)
Código: tuyo 1.140 · IA 2.380 (100 % con evidencia) · herramienta 4.900 · pegado 0
Autonomía por dominio: SQL ▲ (3 licencias nuevas)  React =  regex ▼ (fallaste 2 predicciones → kata pendiente)
Calibración: dijiste "seguro" 12 veces, acertaste 10  ·  Retrabajo: 2 tramos reabiertos (semana 1: 7)
Logros propios: resolviste parseFecha a mano después de desconectar la IA.
Pendiente: reconstrucción semanal (candidatas: slugNota, validarCupon, debounceBusqueda) · repaso: 4 predicciones
```

---

## 10. Por qué al final es más rápido y no te deteriora
**El tiempo real de una funcionalidad** = escribir + revisar + depurar + retrabajo. El vibe coding baja "escribir" a casi cero, pero infla depurar y retrabajar: el manifiesto I.3, y METR 2025, donde los desarrolladores fueron 19 % más lentos y se creían 20 % más rápidos. C ataca los cuatro términos:

| Dónde se gana tiempo | Mecanismo |
|---|---|
| **Lo trivial es instantáneo** | Snippets, zonas delegadas con evidencia proporcional y herramientas deterministas (rename, codemod, formateador) con 0 revisión por línea |
| **La delegación crece contigo** | Cada licencia ganada habilita más código escrito por la IA. Cada semana, más de tu trabajo pasa por el camino rápido de forma legítima |
| **Revisar cuesta menos a medida que sabes más** | Reversión de la pericia: con un acierto sostenido en un dominio, la evidencia pasa a una sola predicción, no a explicar. La exigencia es la misma, el formato más rápido |
| **Sin ciclos a ciegas** | `cai avanzar` dice exactamente qué falta. Los tramos chicos se revisan más rápido y mejor |
| **Menos depuración en producción** | Detectores V.5, predicciones y bordes listados antes de ver atrapan lo que la IA pasa por alto (Ejemplo 1: el bug del admin) |
| **Se corta la rueda de prompts** | El detector de bucle para a los 3 ciclos, no a los 20 (Ejemplo 4) |
| **No se discute dos veces** | Las decisiones y los ADR quedan registrados y entran al contexto de la IA |
| **Menos costo de IA** | Roles baratos, sesiones cortas por fase (caché), contexto explícito, caché por hash |
| **Paralelo sin caos** | Worktrees + roles + límite WIP |

**La curva esperada (una hipótesis que se mide, no una promesa):**
- **Semanas 1–2:** más lento que hoy, por las katas, las tarjetas y aprender el flujo.
- **Semanas 3–4:** cruce. Las licencias cubren lo habitual y lo trivial va por caminos rápidos.
- **Después:** más rápido que sin `cai`, con menos retrabajo y menos bugs.

**Criterios de la puerta tras F5**, todos medidos por `cai informe`. Si no se cumplen, se rediseña antes de seguir:
1. tiempo por tarea en la semana 4 ≤ tiempo sin `cai`;
2. retrabajo en baja;
3. acierto de predicciones ≥ 70 %;
4. abandono 0.

**Por qué no te deteriora (cada punto se apoya en evidencia sólida del aprendizaje):**

| Mecanismo | Base |
|---|---|
| **Efecto de generación** | Explicas con tus palabras: auto-explicación, Bisra 2018, g ≈ 0,55 |
| **Práctica de recuperación espaciada** | `cai repaso` (efecto de testeo, Roediger y Karpicke 2006; Cepeda 2006) |
| **Pensar antes de ver** | Bordes, pesos y predicciones antes que la IA (Buçinca 2021) |
| **Práctica deliberada** | Katas y reconstrucción semanal (VI.3), sin IA y con oráculo |
| **Tu techo sube, no baja** | Licencias (I.6) y Kernighan: la IA nunca escribe por encima de lo que demostraste |
| **Medición de la atrofia** | Autonomía por dominio, calibración y acierto. Si un dominio cae, `cai` agenda katas y tareas `aprender` ahí |
| **Flujo protegido** | Nada aparece mientras escribes (II.3); tu autoría es visible y los logros propios quedan registrados (II.4) |

## 11. Verificación de punta a punta
- Por fase: `pnpm build && pnpm test && node dist/cli.js selftest` (vitest por módulo + escenarios `[seg]` de cada compuerta nueva).
- La prueba de humo de la extensión (`scripts/humo.cjs`) en el CI.
- **Pruebas reales con IA** en `examples/demo-ts`:
  1. tarea completa diseño → plan → decisión → ejecución → revisión → commit;
  2. un intento de la IA fuera del alcance, bloqueado;
  3. un bucle simulado → `desconectada` → `cai volver`;
  4. `cai informe` mostrando lo no revisado;
  5. `cai mapa --recorrido` en `examples/heredado/`.
- Que `--no-verify` falle en CI.
- Al cerrar: actualizar `docs/historial.md` y hacer el respaldo (`cp -r ~/.claude/projects ~/.claude/plans .claude-backup/`).

---

## 12. Estado de la implementación
*(2026-10-11. Verificación: `pnpm build && pnpm test && node dist/cli.js selftest` → 278 pruebas de vitest (capas, núcleo, flujo, plan, extra y los escenarios por área) + 209 escenarios del selftest, en verde. La extensión compila y pasa la prueba de humo y la de paneles (`scripts/paneles.cjs`: los paneles Tarea y Comprensión con un VSCode simulado y la CLI real, sin IA). Prueba real con IA en una copia de `examples/demo-ts`: ver `docs/design.md` → v1.)*

| Parte del plan | Estado | Notas |
|---|---|---|
| Capas `nucleo/proyecto/garantias/ia/flujos/cli` + test de arquitectura | ✅ | Los 74 módulos de v0.11 se reubicaron. Fusiones: `context`+`contexto`, `plano`+`planoArchivo`, `verify`→`nucleo/soloComentarios`; la guía en `flujos/guia/`, con una entrada única `guiar(pedido, canal)` que usan la CLI y `cai servir` |
| Motores por rol (Claude Code, OpenCode, Anthropic, OpenAI-compatible), privacidad y presupuesto semanal | ✅ | `cai ia` |
| Decisor System One con escalada, caché y `cai ia evaluar` (acierto + Brier) | ✅ / ⚠️ | Haiku y Sonnet probados de verdad. Jev se integró según su contrato publicado, **sin probarlo con la API real** (acceso por lista de espera) |
| Doble llave (reglas para lo objetivo, decisor para lo subjetivo, rebatir, `cai reglas --estadisticas`) | ✅ | |
| Pedidos separados con cobertura, entrevista por tipo, objetivos, foco del día y un solo "qué sigue" | ✅ | `cai siguiente` y el panel incluyen las tareas v1 y los temas sin destino. Los supuestos del plan se agrupan en **una** decisión (muchas decisiones chicas acostumbran a contestar sin leer). Lo que la IA chica extrae de tus respuestas se valida sin IA: aparece literal y es un nombre real («el resto» no es un archivo) |
| Tarea: estados, `cai avanzar`, plan sin código (con capturas), disparadores con ADR, aprobación con paráfrasis | ✅ | Sin reglas globales ni secciones obligatorias, no se aprueba |
| Ejecución con restricciones (alcance, línea roja, dependencias, `preservar` firma/cuerpo, tus líneas, presupuesto, licencias) | ✅ | |
| Procedencia por línea (formato, merge driver, adoptar, pegado, `ia-probable`, inserciones con tu clic), informe, SARIF | ✅ | |
| Revisión con evidencia polimórfica (explicación, bordes, predicción con seguridad obligatoria, mutante, visual), Kernighan, calibración, habituación, WIP | ✅ | `--tarea` y `--archivo`; predicciones aisladas si la función no se exporta |
| Pruebas: detectores V.5, escalabilidad medida y **tus criterios ejecutados** antes de "probada" | ✅ | |
| Refactor mecánico con herramienta determinista (`cai renombrar`, origen `herramienta`) | ✅ | |
| Licencias (I.6), katas, repaso, reconstrucción semanal con oráculo, expediente (`cai yo`), bitácora | ✅ | |
| Pull the plug: señales, desconexión, checkpoints, `cai volver` | ✅ | |
| Worktrees, tablero, agentes con roles (`canUseTool`), git en lenguaje natural con dry-run | ✅ | Agentes tester, implementador y revisor probados con IA real: el tester no lee la implementación, el implementador no toca los tests (su md5 no cambió), el revisor solo lee. Lo que destapó la prueba: `allowedTools` se saltaba `canUseTool` (ahora `tools` + `allowedTools: []`), los agentes solo veían los ids de las decisiones (ahora el texto), y los archivos nuevos quedaban como «desconocido» |
| Modelo mental: mapa, tarjetas que caducan (su predicción se ejecuta), recorrido, traza real (cobertura V8) | ✅ | |
| Hooks v1, aviso de modelo por fase, git hooks, CI, MCP propio, catálogo MCP | ✅ | |
| CLAUDE.md v1, skills `cai` y `cai-tarea`, workflow de CI | ✅ | |
| Extensión: paneles Tarea y Comprensión, procedencia en el margen, guía solo a pedido, 14 comandos visibles | ✅ | Prueba de humo + prueba de paneles en el CI (dibujan; «sí» se rechaza; la explicación de relleno se rechaza; sin seguridad no se ejecuta la predicción; con ella se ejecuta y queda evidencia de nivel 3; las 6 pestañas de Comprensión). Falta el recorrido a mano en VSCode |
| Intención de la tarea → ayuda en su alcance (II.5) | ✅ | "aprender" → escalera sin código; ejecutor "pasos" → construir juntos |
| Migrador `cai migrar` | ✅ | Probado en `examples/demo-ts` |

**Lo que quedó distinto del plan, a propósito:**
- **Los modos, la vista y el chat aparte se conservan** (eran del Plan A, no del C). Plan C 4.9 conserva el acompañamiento. En v1 la intención de cada tarea fija el modo de los archivos de su alcance, y lo configurado a mano manda.
- **`comandos.ts` sigue siendo un `switch`** para el acompañamiento. La superficie v1 es una tabla (`cli/v1.ts`).
- **Decisiones en un solo `decisiones.json`** extendido (marco, tarea, ADR), en vez de un archivo por decisión.
- **Presupuesto de IA solo por semana**, no por tarea.

**Cerrado:** commit `95790be` en la rama `v1` (sin push). **Lo que no puede hacer la IA (quedó anotado como tuyo, por decisión del programador):**
- La **puerta tras F5**: probar con 2–3 personas (tiempo por etapa, abandonos, cobertura de comprensión, acierto ≥ 70 %).
- El **estudio de eficacia**.
- Recorrer los paneles a mano en VSCode (la prueba automática cubre lo que dibujan y sus botones, no cómo se ven).
- Probar Jev con su API real cuando tengas acceso.
- Correr `cai init --solo-claude` en tus proyectos (y en este repo) para tener el `CLAUDE.md` v1.
