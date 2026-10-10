# ComplementAIry: tú programas, la IA te acompaña

## La idea en simple
**Tú escribes tu código. La IA te acompaña:** te da el plano de lo que vas a construir, te dice qué funciones o piezas sirven, te sugiere snippets y te ayuda cuando ve que te trabas. Todo con **comentarios** dentro del código. La IA **no puede escribir tu código**, y eso no depende de que "se porte bien": lo impiden reglas automáticas (hooks) que bloquean y revierten cualquier intento.

El único código que entra rápido a tus archivos son **snippets**: código que ya existe y que tú apruebas. Pueden ser tuyos o de una base de estructuras muy conocidas. La IA solo puede *sugerirlos apagados* (`[ ]`); **los activas tú** (`[x]`).

**Principio:** todo lo que *bloquea* o *decide* es determinista (parsers, tests, compiladores, ejecución real, contadores). La IA solo *produce* texto, y ese texto se controla mecánicamente antes de llegar a tu archivo.

---

## Un día con ComplementAIry

### 1. El acompañante: trabaja cada vez que guardas
En VSCode corre solo al guardar (o con `cai watch` en cualquier editor). Hace esto, en orden:

| Cuándo (regla determinista) | Qué hace |
|---|---|
| Activaste un snippet con `[x]` | lo reemplaza por el código real |
| Hay un `@ia?` o `@yo:` sin responder | responde en el hilo |
| Escribiste `.cai/proyecto.md` y no hay `docs/ESTRUCTURA.md` | propone **la arquitectura del proyecto**: carpetas, módulos, orden y reglas (una vez) |
| Archivo nuevo o casi vacío | deja **el plano del archivo**: funciones, responsabilidades, orden y snippets útiles (una vez) |
| Una misma función **sigue con errores tras 3 guardados en los que la cambiaste** | te deja una pista sobre ese error (una vez por problema) |
| **Terminaste una parte**: la cambiaste, compila y en el siguiente guardado ya no la tocaste porque pasaste a otra cosa | la comenta como lo haría un buen par: **corrige** lo que está mal, **sugiere mejoras** y señala si no se cumplen tus reglas (máximo 2 comentarios por parte; si está bien, no dice nada) |
| Vas bien | **no interrumpe** |

Se configura en `.cai/config.json`, en `"acompanar": { "nivel": "normal", "intentos": 3, "maxLlamadasHora": 20, "revisar": true, "porCarpeta": { "src/legacy/**": "silencioso" } }`:
- `silencioso`: solo responde tus `@ia?`.
- `normal`: el comportamiento de la tabla.
- `activo`: ayuda un intento antes y comenta sin esperar a que pases a otra parte.
- `porCarpeta`: un nivel distinto por carpeta (gana el primero que coincide).
- `revisar: false`: apaga los comentarios automáticos.

**Ahorro de tokens:** las decisiones son deterministas, y solo viaja a la IA lo que cambió (huella por función o clase). Los modelos van por tamaño de tarea (chico, mediano y grande: Haiku, Sonnet y Opus por defecto), caché de prompts y límites por hora. `cai uso` muestra el consumo y cuántas llamadas se evitaron. Detalles en el [README](../README.md#qué-ia-usa-y-cómo-ahorra-tokens).

### 2. Preguntar: directo, o el escalón que elijas
```ts
// @ia? ¿cómo armo la validación del préstamo?
// @guia[t1.1] plano: 1) validarMonto(monto): lanza si no es finito o es <= 0. 2) validarMeses(meses)...
// @guia[t1.1] snippet [ ]: fnexport nombre=validarMeses args=meses
// @guia[t1.1]   (Marca [x] para usarlo; puedes cambiar los valores o preguntar con @ia? debajo.)
// @guia[t1.1] pieza: Number.isInteger ya descarta NaN e Infinity.
// @guia[t1.1] docs: https://developer.mozilla.org/es/docs/Web/JavaScript/Reference/Global_Objects/Number/isInteger
```
- **Modo directo (lo normal):** ideas útiles de inmediato: plano, piezas con documentación y snippets sugeridos.
- **Escalones a pedido**, en cualquier `@ia?`:

| Pedido | Qué te da |
|---|---|
| `!pista` | una pista o pregunta guía |
| `!piezas` | funciones o APIs útiles |
| `!pseudo` | los pasos en palabras |
| `!ejemplo` | un ejemplo análogo de otro dominio |
| `!plano` | qué funciones crear y en qué orden |
| `!snippet` | qué snippets usar |
| `!arquitectura` | cómo encaja en el proyecto |

- **Escalera gradual** (pista → piezas → pasos → ejemplo): solo en **zonas críticas** o si escribes `!aprender`. En lo crítico, para subir de escalón hay que haber intentado algo.
- **Una pregunta nueva empieza de cero.** Solo se sube si pides más (`!mas`, "no entiendo", "otra pista"...).
- **Para cuestionar algo,** escribe `@ia?` debajo de la sugerencia, por ejemplo "¿por qué next(error)?". El tutor conoce el código del snippet que sugirió y te explica esa parte.

**Controles deterministas sobre lo que responde la IA:**
- Las respuestas no pueden traer código: ni en bloques ni en una línea.
- Los ejemplos que reutilizan tus nombres (o sea, que se podrían copiar) se descartan.
- Los snippets que no existen en tu biblioteca se descartan.
- Una sugerencia que llega marcada `[x]` se rechaza.
- Cada pregunta y cada sub-pregunta es **una consulta separada y en paralelo**.

### 3. Snippets: el código rápido, siempre aprobado por ti
- **Tú lo pides:** escribe `// @snippet: express-ruta metodo=post ruta=/prestamos` y presiona **`Ctrl+Alt+E`**. Se reemplaza por la ruta lista, con los huecos para tabular. Si presionas `Ctrl+Alt+E` en una línea vacía, eliges un snippet de tu biblioteca.
- **La IA lo sugiere:** llega como `snippet [ ]: ...` (apagado). Lo revisas, cambias los valores si quieres, lo marcas `[x]` y guardas. Se expande solo.
- **La biblioteca:** tus snippets (`Ctrl+Alt+S` convierte el código seleccionado en un snippet tuyo) más la base de estructuras conocidas en `.vscode/cai-base.code-snippets` (fn, fnasync, fnexport, try, error, test, describe, express-ruta, express-app, clase, def, main), que puedes editar. Para verla: `cai snippet lista`.
- **La IA nunca puede activar un snippet:** ni escribiendo `[x]` (lo bloquea el hook) ni a través de la CLI (las sugerencias siempre se escriben apagadas y se verifica antes de guardar).

### 3b. Buenas prácticas, tests y el proyecto completo
**Prácticas medibles (por defecto activas y modificables).** Están en `.cai/config.json` → `practicas`; `null` desactiva una:

| Práctica | Por defecto |
|---|---|
| `maxFuncionesArchivo` | 12 |
| `maxLineasArchivo` | 300 |
| `maxLineasFuncion` | 40 |
| `maxAnidamiento` | 3 |
| `maxParametros` | 4 |

Se miden **sin IA** (con el parser) cada vez que guardas. Cuando se supera un umbral, el acompañante pide **un** plano de diseño, una vez por problema:
- para una función: *"sepárala en validarPago(datos) y registrarPago(pago)…"*;
- para un archivo: *"mueve la validación a validacion.ts…"*.

Si en tu caso la práctica no aplica, te lo dice. Las prácticas en palabras van en `.cai/reglas.md`.

**Tests en su propia carpeta** (`tests/` por defecto, configurable en `tests.carpeta`):
1. Al terminar una función exportada que no tiene tests, te avisa (sin IA) cómo pedirlos.
2. Los pides con `@ia? !tests` o `cai tests <archivo> <función>`. La IA propone **casos** (qué probar y qué *debería* pasar según la intención, no según el código actual, para no copiar bugs). El script valida cada llamada y calcula los imports.
3. En `tests/<archivo>.test.ts` aparecen apagados (`snippet [ ]: test descripcion=... llamada=... esperado=...`). Si el valor esperado depende de una decisión tuya, te pregunta.
4. Ajustas, activas con `[x]` y guardas: quedan tests reales. Los números con decimales usan `toBeCloseTo` automáticamente.

En la prueba real, de 3 casos activados pasaron 2 y falló 1, que era justo el bug pendiente.

**El proyecto completo: `cai panorama`** (`Ctrl+Alt+P`) deja en `.cai/panorama.md`:
- el estado del proyecto;
- sugerencias de diseño (con porqué y plano);
- **otras formas de hacerlo**;
- riesgos;
- **preguntas para ti**;
- las mediciones sin IA: prácticas, funciones sin tests, `@ia?` sin responder, snippets sin activar, errores frecuentes y consumo.

**Memoria del proyecto: `.cai/conocimiento.md`.**
- Contiene qué hace cada módulo, *lo que le contaste* y las preguntas abiertas.
- Respondes después de `R:` y en el siguiente panorama la respuesta pasa a la memoria.
- Se usa como contexto en todas las guías, revisiones y planos. Así entiende cada vez mejor el proyecto **sin releerlo entero**: solo resume los archivos que cambiaron, con el modelo rápido.

**Criterio de todas las IAs:**
- No se anclan a cómo lo hiciste: si hay un enfoque claramente mejor, lo proponen con su porqué, sin imponerlo.
- Si les falta contexto, preguntan en vez de suponer.

### 3c. Proyectos ya armados: autoría y arranque guiado
**`cai conocer`** (te lo ofrece `cai init` si el proyecto ya tiene código):
1. **Escaneo sin IA:** stack, `package.json`, README, estructura y **quién escribió qué según git**.
2. **Una consulta a la IA:** redacta borradores de `.cai/proyecto.md` y `.cai/reglas.md` (las convenciones que *se ven* en el código) y prepara hasta 5 preguntas, **cada una con su respuesta probable**.
3. **En la terminal te pregunta de a una:** Enter acepta, un número elige otra opción, `-` la salta. Las respuestas quedan en la memoria y en `proyecto.md`. Sin terminal, las preguntas quedan en `.cai/conocimiento.md`.
4. **No pisa lo que ya escribiste:** si había contenido, deja `*.borrador.md`.

**Autoría** (`.cai/config.json` → `autoria`):

| Valor | Qué significa | Qué cambia |
|---|---|---|
| `heredado` | código que no escribiste tú | la IA te lo explica sin atribuírtelo; no cuenta en tu perfil ni en tus errores frecuentes; el acompañante no comenta salvo `acompanarHeredado: true` |
| `terceros` | librerías copiadas o código generado | se ignora en el acompañante y el panorama |

`cai origen` muestra lo marcado y sugiere, según git, las carpetas que nunca tocaste.

### 4. Revisar al terminar
**`Ctrl+Alt+R`** (o `cai revisar archivo.ts`):
1. **Verificaciones deterministas:** tipos, lint, tests relacionados, reglas de arquitectura, tus reglas mecánicas (`.cai/reglas.json`) y, en zonas críticas, **mutation testing**, que muestra qué cambios de tu código no detecta ningún test.
2. **Revisores de IA enfocados, en paralelo:**
   - bugs
   - seguridad
   - simplicidad
   - tests
   - convenciones (si escribiste reglas)
   - arquitectura (si hay ADRs)

   Un paso de consolidación elimina los duplicados y deja como máximo 8 comentarios.
3. Todo llega como comentarios **encima de la línea** que corresponde:
   ```ts
   // @guia[r1.4] revision: question (blocking): ¿Qué devuelve esta línea si `meses` es 0?...
   ```

Las opiniones de la IA **no bloquean**. Lo que bloquea son las verificaciones deterministas (pre-commit y CI).

### 5. Comprobar que entendés tu código (sin juez IA)
`cai predecir archivo.ts` agrega preguntas del tipo *"Sin ejecutarlo: ¿qué devuelve `calcularCuota(1000, 0.1, 1)`?"*. Respondés con `@yo: 1100` y corrés `cai check archivo.ts`: **se ejecuta tu código** y se compara.
```ts
// @yo: 1100
// @guia[p2.2] revision: praise: ✓ Correcto, calcularCuota(1000, 0.1, 1) devuelve 1099.999999999999.
```
Hay dos controles:
- Las expresiones solo pueden ser llamadas a tus funciones exportadas con argumentos literales. Esto se valida antes de ejecutar.
- Si la explicación de la pregunta revelaba el resultado, se elimina.

### 6. Quién puede crear snippets
Seleccionás código que repetís y apretás **`Ctrl+Alt+S`**: se convierte en un snippet tuyo (`.vscode/cai.code-snippets`), donde marcás los huecos (`${1:nombre}`). Después lo usás escribiendo el prefijo y Tab, **sin IA**.

¿Puede la IA redactar snippets? Depende de `snippets.modo` en `.cai/config.json`, y el hook lo hace cumplir:

| Modo | La IA puede redactar snippets… |
|---|---|
| `ganado` (por defecto) | solo en lenguajes donde tu perfil dice *experto*. La delegación se gana |
| `por-lenguaje` | solo en los lenguajes listados |
| `libre-con-aviso` | siempre, con aviso |
| `humano` | nunca |

### 7. Terminal y arquitectura
| Comando | Qué hace |
|---|---|
| `cai explica -- git rebase -i HEAD~3` | explica cada parte y sus riesgos. Los riesgos conocidos (`rm -rf`, `curl \| sh`, `reset --hard`...) se detectan sin IA. **No ejecuta** |
| `cai pregunta "¿cómo veo los logs de un contenedor?"` | misma escalera de pistas; `--mas` sube un escalón, `--intente "..."` cuenta lo que probaste |
| `cai corre -- pnpm test` y luego `cai error` | corre tu comando; si falla, te ayuda a entender el error (no lo arregla por vos) |
| `cai shell` | atajos para tu `~/.bashrc`: `ia`, `iamas`, `ex`, `c` |
| `cai plano "API de préstamos"` | propone la arquitectura del proyecto (carpetas, módulos, orden, reglas verificables) en `docs/ESTRUCTURA.md` |
| `cai arquitectura "cómo representar el dinero"` | crea `docs/adr/NNNN-....md` con preguntas y opciones (pros, contras, cuándo conviene) como comentarios. **Decidís y escribís vos** |
| `cai adr nuevo "título"` | ADR vacío con la estructura |

Las decisiones que se pueden expresar como regla (por ejemplo, "el dominio no importa infraestructura") se escriben con dependency-cruiser o import-linter y pasan a ser verificaciones deterministas.

---

## Lo que vos le decís al sistema (memoria y reglas)
| Archivo | Qué es | Quién lo escribe |
|---|---|---|
| `.cai/proyecto.md` | qué busca el proyecto, para quién es, qué es lo más importante, qué querés aprender | vos |
| `.cai/reglas.md` | tu "código de conducta" de cómo escribir código, en lenguaje natural; la revisión lo usa (revisor de convenciones) | vos |
| `.cai/reglas/*.md` | reglas por carpeta (`paths:` en el frontmatter) | vos |
| `.cai/reglas.json` | reglas **mecánicas** (regex por línea), verificadas sin IA | vos |
| `.cai/config.json` | zonas críticas o delegadas, modo de snippets, comandos de Bash permitidos, modelo, Context7 | vos |
| `docs/adr/` | decisiones de arquitectura | vos (con guía) |
| `~/.cai/perfil.json` | tu nivel por tema (lenguajes y librerías) | declarado por vos y ajustado por evidencia |
| `~/.cai/eventos.jsonl` | cada ajuste del perfil, con su motivo | el sistema |
| `~/.cai/patrones.json` | tus errores frecuentes; la guía insiste en ellos ("esto ya te pasó antes") | el sistema |

La IA **no puede editar** `.cai/` ni `.claude/`: las reglas son tuyas.

**Cómo se ajusta el perfil, siempre con eventos observables:**

| Evento | Efecto |
|---|---|
| Resolver un hilo con nivel 1 | sube +0.08 |
| Resolver un hilo con nivel 2 | sube +0.04 |
| Resolver un hilo con nivel 4 | baja −0.04 |
| Pedir más ayuda | baja −0.02 |
| Saltar la escalera | baja −0.06 |
| Predicción correcta | sube +0.06 |
| Predicción incorrecta | baja −0.08 |
| Revisión con problemas | baja hasta −0.05 |
| Revisión limpia | sube +0.02 |

`cai perfil` muestra el perfil y `cai perfil set typescript experto` declara tu nivel.

---

## Qué garantiza el sistema
| Garantía | Cómo |
|---|---|
| La IA no cambia código en zona humana | Hook `PreToolUse`: simula la edición y parsea antes y después con tree-sitter (25 lenguajes, más Dockerfile, SQL y Markdown). Si el código sin comentarios difiere, bloquea |
| Solo comentarios `@guia` | Cada comentario nuevo debe empezar con `@guia`. Se bloquean `@ts-ignore`, `# type:`, `eslint-disable`, `/** */` y `///` |
| Tus comentarios no se tocan | Los comentarios que no son `@guia` (incluidos `@ia?` y `@yo:`) deben quedar idénticos |
| No se puede hacer trampa por terminal | Reglas para Bash más una **foto antes y después de cada comando**: lo que cambió sin permiso se revierte, y la versión cambiada queda en `.cai/cache/cuarentena/` |
| No se instalan paquetes inventados | La IA no puede ejecutar `pnpm add`, `npx`, `pip install`... (salvo lo que permitas en `bash.permitir`) |
| Las reglas no se tocan | `.cai/`, `.claude/`, `.githooks/` y los lockfiles están siempre protegidos |
| Nada pendiente en el commit | El pre-commit rechaza comentarios de conversación y corre la verificación rápida (tipos, lint, reglas). CI repite todo |
| La guía de la IA no trae soluciones | Cada respuesta pasa un control determinista: código en niveles bajos o ejemplos copiables, se descartan |
| La IA que guía no puede editar | Las consultas usan el Claude Agent SDK con herramientas **solo de lectura** (Read, Grep, Glob y, si lo activás, Context7). Las inserta la CLI, verificando que sean solo comentarios |

**Lo que no garantiza:** que no copies lo que te dice la IA. Por eso la guía escalona la ayuda y, en lo crítico, exige un intento antes de dar más.

---

## Instalación en un proyecto
```bash
cai init .            # hooks, config, plantillas, pre-commit, tareas de VSCode, skills, CI
cai perfil set typescript intermedio
cai doctor            # qué falta y cómo arreglarlo (doctor --instalar instala las herramientas del stack)
```
Después completá `.cai/proyecto.md` y `.cai/reglas.md`.

**Extensión de VSCode** (`packages/vscode-complementairy`): atajos `Ctrl+Alt+G` (guía), `Ctrl+Alt+R` (revisar), `Ctrl+Alt+E` (expandir snippet o elegir de la biblioteca) y `Ctrl+Alt+S` (snippet desde la selección); el acompañante corre al guardar, más resaltado de comentarios: azul para `@guia`, ámbar para `@ia?`/`@yo:` y un borde rojo en lo bloqueante. En este devcontainer se instala sola.

**Stacks:**
- **TypeScript/JavaScript:** tsc, ESLint, Vitest, Stryker, dependency-cruiser y tsx.
- **Python:** mypy, ruff, pytest, mutmut e import-linter.

Agregar un stack es agregar una entrada en `packages/complementairy/src/adapters.ts`.

**Requisitos y límites conocidos:**
- Stryker necesita Node 22, por eso el devcontainer usa `javascript-node:22`.
- typescript-eslint aún no soporta TypeScript 7, por eso se usa `typescript@^6`.
- CI necesita el paquete `cai` publicado, o un tarball (`pnpm pack`) en la variable `CAI_PKG`.
- Costo aproximado por uso: guía US$0,02–0,05 por pregunta; revisión completa US$0,25–0,30.

## Componentes
```
packages/complementairy/src/
  lang.ts, parser.ts, comments.ts   lenguajes y extracción de comentarios (tree-sitter)
  verify.ts                         regla central: "solo cambiaron comentarios @guia"
  hook.ts, bash.ts, snapshot.ts     hooks de Claude Code, reglas de terminal, foto y reversión
  config.ts, files.ts               zonas, configuración
  threads.ts, render.ts, guard.ts   hilos de conversación, formato de comentarios, controles a la IA
  tutor.ts, watch.ts                cai guia / watch
  review.ts, gate.ts, adapters.ts   cai revisar / gate, herramientas por stack
  predict.ts                        cai predecir / check
  profile.ts, context.ts, state.ts  perfil, proyecto/reglas/patrones, estado de hilos
  snippets.ts                       snippets propios y política de delegación
  terminal.ts, arquitectura.ts      explica / pregunta / corre / error; arquitectura / ADR
  doctor.ts, init.ts, cli.ts        diagnóstico, instalación, comandos
  selftest.ts                       escenarios que prueban cada garantía (cai selftest)
packages/complementairy/kit/                skills para el chat de Claude Code y workflow de CI
packages/vscode-complementairy/             extensión de VSCode
examples/demo-ts/                   proyecto de prueba con todo instalado
```

## Notas: lo que dice la IA, fuera del código (v0.5)
**Problema que resuelve:** la IA escribía comentarios en el archivo, en disco, mientras el usuario editaba. Con autoguardado las dos escrituras se pisaban, y el archivo se llenaba de texto.

**Cómo funciona:**
- Todo lo que dice la IA (respuestas, revisión, acompañante, plano, predicciones) se guarda como **notas** en `.cai/notas/<archivo>.json`. Una salida única (`salida.ts → publicar`) decide si van a notas o a comentarios (`"vista"` en `.cai/config.json`; por defecto notas).
- **Ancla sin IA:** cada nota guarda la línea, su texto y la función. Cuando el código se mueve, se re-ancla por el texto y la función; si no encuentra su lugar queda "desanclada", visible, nunca se pierde.
- **Conversación:** `cai responder` (botones = mismos pedidos que `!pista`, `!pseudo`, `!tests`…; "no entiendo" sube un escalón; las predicciones se comprueban ejecutando, sin IA). Los `@ia?` escritos en el archivo se convierten en notas.
- **Un pedido a la vez por archivo:** `.cai/cache/ocupado/` (pid, tarea, línea, hora). Un segundo pedido se rechaza con un aviso (código 3); el acompañante deja **uno** en espera. Los bloqueos de procesos muertos se limpian solos. La extensión lo lee para mostrar "pensando…", aunque el pedido venga del chat.
- **Siguiente paso, sin IA:** `cai siguiente` ordena: 1) lo que espera tu respuesta, 2) verificaciones que fallan, 3) tareas del plano, 4) notas bloqueantes, 5) el resto. Las tareas "crear X" se marcan hechas solas cuando la función aparece.
- **Plano de archivo estructurado:** un resumen breve arriba, una nota junto a cada función que existe y una tarea por cada función que falta.
- **Snippets donde van:** cada snippet sugerido guarda la línea después de la cual va; "Insertar aquí" (solo con tu clic) lo pone ahí, un nivel adentro si la línea abre un bloque.

**En VSCode:** hilos de la API de comentarios (botones, caja de respuesta, "+" en el margen), CodeLens por función, hover, Problemas para lo bloqueante, panel lateral y barra de estado con cancelar y silenciar 30 min.

**Tres niveles (v0.6):** proyecto, archivo y función no se mezclan.
- **Proyecto:** `cai plano` escribe `docs/ESTRUCTURA.md` en markdown limpio (se edita a mano) y `.cai/estructura.json` (para el panel). Cada archivo que falta es una tarea `crear`, ordenada según "por dónde empezar", que se marca hecha sola cuando el archivo existe. Las sugerencias del panorama también son tareas, con el archivo a tocar. Las preguntas traen pregunta y sugerencia por separado y se responden desde el panel o con `cai memoria responder`; la respuesta pasa al instante a "Lo que me contaste". La IA del chat no puede responderlas: es conocimiento del humano, y el hook lo revierte.
- **Archivo:** las notas con `alcance: "archivo"` van arriba y no se atan a una función (`cai responder --archivo-entero`). Un plano nuevo del archivo archiva el anterior.
- **Función:** los botones por función ya no ofrecen "Plano", que es del archivo.

**Una nota por función (v0.7):** todo lo que se dice de una función (revisión, plano, respuestas, verificación) se agrega al hilo de **su** nota (`notasFuncion.ts`: la función que contiene la línea, por el árbol de sintaxis; fuera de funciones → la nota del archivo). Las notas duplicadas de versiones anteriores se fusionan al leerlas (un id viejo apunta a la que quedó). `responder` sobre una función solo ve esa función y las firmas de las demás.
- **"¿Quedó lista?"** (`verificar.ts`): primero sin IA (sintaxis de la función, tipos, lint y reglas en sus líneas); si falla, 🔴 sin llamar a la IA. Si pasa, la IA dice lista (la nota se cierra), casi o falta. No se re-verifica si el código de la función no cambió (huella).
- **Autoguardado:** la extensión distingue Ctrl+S (actúa ya) de un autoguardado (espera a que dejes de editar y corre una vez).
- **Tareas:** las rutas se normalizan sin IA ("a.js (y b.ts)" → dos tareas); un archivo creado con el mismo nombre en otra carpeta cuenta; las hechas se archivan al día siguiente; se pueden descartar.
- **Preguntas:** se descartan sin IA las que preguntan por algo que se ve en el código ("¿X ya hace…?"); se puede conversar sobre una antes de responderla (`cai memoria conversar`).
- **Chat de Claude Code en vista notas:** el hook rechaza que la IA agregue `@guia` y le indica `cai responder`.

**v0.8: rápido, sin sesgo y con modos.**
- **Modos** (`modos.ts`): una tabla de comportamientos (escalera, snippets antes de intentar, sugerencias rápidas, explicar, predecir) por modo; se elige por función (en su nota) > archivo > carpeta > proyecto. Solo cambia la ayuda nueva.
- **Proceso abierto** (`sesion.ts`, `cai servir`): un `query()` del Agent SDK con entrada continua, sin herramientas ni razonamiento extendido; se reinicia cada 20 usos o 10 min sin uso; si tarda o falla, la llamada normal. Medido: ~1 s y ~US$0,002 por sugerencia (antes ~20 s y ~US$0,016).
- **Sin sesgo:** revisión a ciegas (sin conversación ni comentarios que aprueban; evidencia antes del veredicto) y "otra mirada" (plan sin ver el código + comparación). Base: Cross-Context Review (arXiv 2603.12123), framing en revisión con LLM (arXiv 2603.18740), anclaje en LLMs (arXiv 2412.06593).
- **Control:** línea de tiempo desde `~/.cai/uso.jsonl`, metadatos por mensaje, texto en vivo, escalones ya dados, ubicación validada de snippets con vista previa y procedencia, líneas sin revisar.

**Límite conocido:** en modo comentarios, `guia` y el acompañante siguen escribiendo en disco (solo `revisar` se aplica sobre el buffer desde VSCode). Con autoguardado conviene el modo notas.

## Todo se conoce (v0.9)
- **Índice vivo** (`indice.ts` → `.cai/indice.json`, sin IA): funciones con firma, `llama`/`llamadaPor`, estado de la nota, última prueba, resumen y huella. Se actualiza por archivo al guardar, solo si cambió la huella.
- **Contexto común** (`contexto.ts → contextoComun`): proyecto, reglas, memoria, **decisiones vigentes**, estructura, panorama del archivo, funciones del archivo y vecinas (llama / la llaman). Tope de ~9000 caracteres; versión corta para la guía gris. Lo usan responder, verificar, revisar, tests, plano de archivo, acompañante y tutor.
- **Decisiones** (`decisiones.ts` → `.cai/decisiones.json`): pendiente → vigente → retractada, con historial. Se deduplican por similitud de la pregunta. Decidir y retractar es **solo humano** (el hook revierte si lo intenta el chat de Claude Code).
- **Impacto** (`impacto.ts`, sin IA): si cambia la huella de una función que otras llaman, sus notas reciben `impacto` (se crea la nota si no existía) y se vuelven a correr sus casos. Verificar la función limpia el aviso.
- **Revisión completa** (`revisionCompleta.ts`, `cai revisar --completo`): revisión a ciegas + "¿quedó lista?" de cada función (reutiliza el veredicto y el `planIndependiente` de las que no cambiaron) + casos de test → veredicto del archivo (lista / casi / falta) en `.cai/cache/veredictos.json` y en la nota del archivo.
- **Chat del proyecto** (`chat.ts`, `cai chat`): modelo mediano con herramientas **solo de lectura** y el contexto común completo; responde `{texto, decisiones, tareas}`; historial en `.cai/chat.json`.
- **Retomar y cerrar** (`resumenSesion.ts`): `hoy` (desde la última visita, por huellas), `deuda` y `sesion` (medido sin IA; resumen y commit sugerido con el modelo chico).
- **Tests sin export** (`sandbox.ts`): el archivo se carga **tal cual** en `node:vm` en un proceso aparte. tree-sitter detecta declaraciones de primer nivel y globales del entorno; los globales son **dobles** (Proxy) que registran lo usado o devuelven valores propuestos **como datos JSON**. La expresión de prueba se valida (llamada simple sobre algo declarado, argumentos literales). Los tests guardados usan el ayudante `_cai/aislado.mjs`. Nada es específico de una aplicación.

## Entender, chat completo y modo programar (v0.10)
- **Modos** (`modos.ts`): sugerir (antes "programar"), aprender y programar (`proponerSolucion`). `migrarModos`: sin `modosVersion: 2`, "programar" se lee como "sugerir" (CLI y extensión).
- **Entender** (`entender.ts` → `.cai/objetivos.json` + `objetivos.md`): borrador que arma la IA en la conversación "entender" del chat; confirmar/reabrir/terminado son humanos. `objetivosHonestos` (snapshot): un comando de la IA solo cambia el borrador. El panorama evalúa los criterios de terminado en la misma llamada (`cache/terminado.json`); "cree que terminó" es determinista (todos "cumple"). Por función/archivo: `objetivoFuncion.ts` (`nota.objetivo`), y verificar compara contra los criterios confirmados.
- **Chat** (`chat.ts` → `.cai/chats/<id>.json`): conversaciones normal/entender, modelo por conversación (`chat.modelo` por defecto), propuestas de `cambiosTareas` y `correcciones` que se aplican solo con `--aplicar` (humano: el snapshot lo revierte si lo corre la IA). Migra el `chat.json` de v0.9.
- **Correcciones** (`correcciones.ts` → `.cai/correcciones.json`): resumen de módulo, rol en la estructura o hecho del proyecto; mandan sobre lo generado (`aplicarAResumenes`, `aplicarAEstructura`, `bloqueCorrecciones` en el contexto común).
- **Claude Code = chat del plugin** (`confirmar.ts`): lo que solo decide el humano se registra con su respuesta en AskUserQuestion (header `cai:<id>`). PreToolUse rechaza llamadas con `answers`; PostToolUse lee `tool_response.answers` (verificado con un hook real) y exige que la pregunta incluya el texto de lo que se registra.
- **Ideas** (`ideas.ts` → `.cai/ideas.json`): funcionalidad/mejora (y aprender, opcional) desde el panorama o `cai ideas mas`; las descartadas no vuelven (filtro sin IA + van al prompt).
- **Notas**: cada ítem de verificar/responder trae `funcion`; `repartir` manda lo de otra función o del archivo a la nota del archivo. La guía rápida marca lo que está después del cursor como "(ya escrito)" y se autoverifica con `yaEscrito`.
- **Modo programar** (`programar.ts`): plan 3–5 pasos (más → auxiliar como tarea); paso dirigido (solo lo dicho; `falta` en vez de completar); PR por porciones contra tus casos (`validarContrato`: ≥ 2, literales, uno borde); probador con **marcas** insertadas por tree-sitter en una copia junto al original (se borra siempre): la entrada debe recorrer la porción (en una rama, su interior); lo esperado se compara ejecutando. Inserción solo desde la extensión (tu clic); `programada` en la nota; deuda de comprensión y prueba diferida. Repertorio personal (`repertorio.ts`): repo git fuera del proyecto (`CAI_REPERTORIO`), solo lo tuyo 🟢, búsqueda léxica sin IA, versión adaptada como diff.

## Estado
| Fase | Contenido | Estado |
|---|---|---|
| 1 | Investigación y diseño | ✅ |
| 2 | Núcleo determinista: hooks, verificación con tree-sitter, Bash con snapshot, limpieza, pre-commit, init | ✅ |
| 3 | `guia`: consultas separadas y en paralelo, IA de solo lectura, inserción anclada, escalera con fricción, perfil, `watch`, tareas de VSCode | ✅ |
| 4 | Ajuste del perfil por evidencia, ejemplo análogo no copiable, snippets propios con delegación configurable | ✅ |
| 5 | Gates por stack, mutation testing, `revisar` con consolidación, `predecir`/`check`, `doctor`, reglas mecánicas | ✅ |
| 6 | Terminal (`explica`, `pregunta`, `corre`, `error`, `shell`), `arquitectura`, ADRs, revisor de arquitectura | ✅ |
| 7 | Extensión de VSCode | ✅ · adaptador de Honcho: pendiente (opcional; ver abajo) |
| 8 (v0.5) | Notas fuera del archivo, botones, panel "Siguiente paso", bloqueo por archivo, "pensando…", modelos por tamaño | ✅ |
| 9 (v0.6) | Tres niveles (proyecto, archivo, función), estructura y panorama como tareas, preguntas desde el panel | ✅ |
| 10 (v0.7) | Una nota por función, panel Nota, "¿quedó lista?", sugerencias rápidas, configuración, autoguardado | ✅ |
| 11 (v0.8) | Modos programar/aprender por función, proceso abierto (~1 s), sin sesgo (a ciegas + otra mirada), qué hizo la IA, snippets con vista previa | ✅ |
| 12 (v0.9) | Índice vivo, contexto común, decisiones con botones (retractables), impacto, chat del proyecto, revisión con veredicto y al salir, tests sin export (sandbox), hoy/deuda/sesión | ✅ |
| 13 (v0.10) | Modos sugerir/aprender/programar, entender (proyecto, archivo, función), chat con conversaciones y modelo, tareas y correcciones desde el chat, Claude Code con confirmación por sus botones, ideas, notas con historial, modo programar (plan, tú diriges, PR por porciones con probador, repertorio) | ✅ |

**Honcho:** el perfil y la memoria hoy son archivos locales legibles, que es lo que pide el principio de transparencia. Conectar Honcho, un servicio externo de modelado de usuario, requiere una cuenta y una API key tuyas, y envía datos de tu forma de programar a un tercero. Queda para cuando lo decidas.

## Revisiones hechas (2026-10-07)
Dos revisores independientes analizaron el código. Uno intentó **romper las garantías** y el otro buscó **bugs de corrección**. Encontraron 23 problemas reales; todos están corregidos y cada uno tiene una prueba de regresión en `cai selftest` (71 escenarios, marcados `[seg]` y `[corr]`). Los más importantes:

- **Verificación exacta, sin normalizar.** Antes, quitar líneas en blanco y espacios finales escondía cambios dentro de strings de Python y bloques YAML. Ahora solo se quitan los `@guia` que ocupan líneas completas o el final de una línea, y el resto tiene que quedar idéntico byte a byte.
- **Nada de comentarios a mitad de línea ni de bloque en medio del código.** Un `/* @guia \n */` después de `return` cambiaba el resultado en JS por la inserción automática de `;`.
- **Directivas prohibidas dentro de `@guia`.** Por ejemplo, `coding: utf-7` en Python permitía ejecutar código oculto. La lista incluye noqa, pragmas, `@ts-`, `eslint-`, `//go:`, `__PURE__`, entre otras. Cuando la CLI escribe texto con alguna de ellas, la neutraliza.
- **Falla cerrada.** Una edición que no se puede simular, un archivo demasiado grande, una foto previa dañada o un comando interrumpido se bloquean o se re-verifican. Nunca se dejan pasar.
- **Escaneo lineal.** Antes era cuadrático: un SQL grande tardaba 36 s, lo que podía hacer vencer el timeout del hook y que la edición pasara. Ahora tarda 30 ms. Además, el escaneo ignora los bloques de código de Markdown, los heredocs de Dockerfile y el `$$` de SQL.
- **También se vigilan los hooks de git** (`.git/hooks`, `.git/config`). Los symlinks se resuelven antes de decidir la zona, y los snippets sin `scope` no se pueden delegar.
- **El gate ya no aprueba tests fallidos.** Antes los tests que fallaban en otro archivo pasaban, y un texto "not found" en la salida de un test se interpretaba como "herramienta no instalada".
- **Los hilos de conversación son robustos.** Una revisión no le roba el hilo a un `@ia?`, una línea en blanco separa hilos, los mensajes de varias líneas se leen enteros y un ternario no parte la pregunta.
- **`check` no califica fallos de infraestructura.** Además soporta imports relativos en Python, `NaN` e `Infinity`, y se respeta CRLF al insertar.

**Límites que siguen existiendo:**
- La foto antes y después de cada comando no ve lo que escribe un proceso en segundo plano después del comando, ni archivos fuera del proyecto.
- Las directivas se bloquean con una lista conocida, no con todas las posibles.
