# ComplementAIry

**Tú programas, la IA te acompaña.** Mientras escribes, ComplementAIry te deja en comentarios:
- el plano de lo que vas a construir;
- qué funciones o APIs te sirven;
- correcciones y mejoras cuando terminas una parte;
- ayuda cuando ve que te trabas.

La IA **no puede escribir tu código**: lo impiden hooks deterministas. El código rápido entra solo como **snippets que tú activas**.

**Comando:** `cai` (también existe `complementairy`). Antes se llamaba AICode: el comando `aicode` y los proyectos con `.aicode/` siguen funcionando, y `cai init .` los actualiza.

- [docs/design.md](docs/design.md): cómo funciona, con ejemplos.
- [docs/research.md](docs/research.md): la investigación detrás.
- [docs/historial.md](docs/historial.md): las decisiones y por qué se tomaron.

## Requisitos
- Node 22+ y git.
- **Claude Code con tu sesión iniciada.** ComplementAIry usa tu misma sesión, sin API key. Si defines `ANTHROPIC_API_KEY`, pasará a cobrarse por la API.

## Instalar

### Opción A: clonar (para desarrollar ComplementAIry o probar lo último)
```bash
git clone https://github.com/Slendy4514/ComplementAIry.git
cd ComplementAIry && sh scripts/instalar.sh
```
Deja el comando `cai` global (enlazado al repo: cada `pnpm build` se aplica al instante) e instala la extensión de VSCode.

### Opción B: en todos tus devcontainers, desde GitHub (recomendado)
1. Sube el repo a GitHub (público) y crea un release: `git tag v0.3.0 && git push --tags`. El workflow publica la feature en `ghcr.io/Slendy4514/complementairy/complementairy`, con la CLI y la extensión adentro.
2. En la configuración de VSCode de **tu computador** (User Settings JSON):
   ```jsonc
   "dev.containers.defaultFeatures": { "ghcr.io/Slendy4514/complementairy/complementairy:0": {} },
   "dev.containers.defaultExtensions": ["anthropic.claude-code"]
   ```
   Desde ahí, cualquier devcontainer que construyas trae ComplementAIry. Para un solo proyecto, pon esa línea en `"features"` de su `devcontainer.json`.
3. **Actualizaciones:** cuando publiques un tag nuevo, la extensión te avisa y ofrece "Reconstruir ahora".

Detalles y la alternativa sin GitHub: [devcontainer-feature/complementairy/README.md](devcontainer-feature/complementairy/README.md).

### En cada proyecto
**Desde VSCode (lo más simple):** al abrir un proyecto que todavía no usa ComplementAIry, la extensión te ofrece **🚀 Iniciar** (también está en el panel y en Ctrl+Shift+P → "ComplementAIry: iniciar en este proyecto"). Hace todo el recorrido:
1. crea la configuración (`cai init`: hooks de Claude Code, `CLAUDE.md`, skills, plantillas);
2. si ya hay código, lo **conoce** (borradores de qué busca y de tus reglas, qué código no es tuyo; las preguntas te quedan en el panel);
3. abre **🎯 Entender el proyecto** en el chat, con la primera pregunta;
4. cuando confirmas los objetivos, te ofrece **proponer la estructura** a partir de ellos.

**Empezar de cero** (Ctrl+Shift+P → "ComplementAIry: empezar de cero en este proyecto"): mueve `.cai/` a `.cai.viejo-<fecha>/` (nada se borra; tu código no se toca) e inicia de nuevo. Hasta que inicies, la extensión no hace nada automático en ese proyecto (ni gasta IA).

**Desde la terminal:**
```bash
cd mi-proyecto
git init                                  # si todavía no es repo
cai init .                             # hooks, configuración, snippets base, tareas de VSCode, skills, CI
cai doctor --instalar                  # herramientas del lenguaje (tsc, eslint, vitest, stryker / mypy, ruff, pytest...)
cai perfil set javascript intermedio   # tu nivel por tema
```
**Proyecto ya armado:** `cai init .` te ofrece `cai conocer`, que analiza el proyecto, redacta borradores de `.cai/proyecto.md` y `.cai/reglas.md` (las convenciones que se ven en el código) y te hace unas pocas preguntas con la respuesta probable ya puesta (Enter para aceptar). También detecta, según git, qué carpetas no escribiste tú, para marcarlas como `heredado`: la IA no te atribuye ese código ni lo cuenta en tu perfil.

Después escribe con tus palabras `.cai/proyecto.md` (qué buscas) y `.cai/reglas.md` (cómo escribes). Las prácticas medibles (largo de funciones, anidamiento...) vienen activas por defecto y se ajustan en `.cai/config.json` → `practicas`. Al guardar el primer archivo, el acompañante propone la arquitectura del proyecto.

## Uso diario

### Modos: sugerir, aprender o programar
| | 💡 sugerir (por defecto) | 🎓 aprender | 🚀 programar |
|---|---|---|---|
| quién escribe el código | tú | tú | la IA, **por pasos que diriges tú** o como un PR por porciones; entra a tu archivo **solo con tu clic** |
| ayuda | directa (plano, piezas, snippets) | gradual (pista → piezas → pseudo → ejemplo) | plan de pasos + propuestas |
| snippets | sí | después de que lo intentes | sí |
| guía mientras escribes | sí | no (primero piensas tú) | sí |
| "¿quedó lista?" | verificación | + explícala con tus palabras y 🎯 predecir | verificación |

Se elige por **proyecto, carpeta, archivo o función** (gana el más específico): clic en el modo de la barra de estado, el selector del panel Nota o `cai modo programar --funcion src/x.ts:miFuncion`. **Cambiar de modo no toca lo ya hecho.** Hasta v0.9, "programar" se llamaba así lo que hoy es "sugerir": una configuración vieja se lee como "sugerir" (nadie pasa al nuevo modo sin elegirlo).

### Modo programar: la IA escribe, tú no te pierdes
Delegar todo baja la comprensión (en el estudio de Anthropic, 2026, quienes delegaban todo sacaron menos de 40%; quienes pedían el código con explicación y preguntaban, 65% o más). Por eso, en este modo:
- **Plan de pasos primero:** 3 a 5 pasos por **idea** (validar, caso especial, cálculo, resultado), no por líneas, que editas tú. **Si hacen falta más de 5, son dos funciones:** se propone una auxiliar, que queda como tarea y se trabaja **en su propia nota**.
- **🧭 Tú diriges, la IA escribe:** dices en palabras cómo hacer el paso; la IA escribe **solo eso**. Si a tu paso le falta algo, no lo completa en silencio: te lo dice ("tu paso no dice cómo importar calcularCuota"). Ves la propuesta y la insertas (o la corriges).
- **📦 Como un pull request, por porciones:** defines **tus casos** (el resultado esperado lo pones tú, con al menos un borde); la IA propone la función en porciones (una por paso) **ya probada contra tus casos**. Ves una porción a la vez y, para avanzar, la pruebas en el **probador**: tu entrada (que **tiene que pasar por esas líneas**: se comprueba con marcas en una copia, sin IA) y lo que esperas, escrito **antes** de ver el resultado. Si no coincide, ves el resultado real y por qué. Al final, ⤵ Insertar (con diff).
- **Repertorio personal:** tus funciones 🟢 (escritas por ti o insertadas pasando el probador) se guardan en un repo git tuyo, entre proyectos (`~/.complementairy/repertorio`; en devcontainers, un volumen de Docker). Lo que ya hiciste va en pasos más grandes, y se puede proponer **tu versión adaptada** (como diff). Se configura por proyecto (guardar sí/no; usar siempre / preguntar / nunca); nunca guarda lo heredado ni de terceros.
- **Después:** al día siguiente, una **prueba diferida** sobre lo que insertaste (otra entrada, comprobada ejecutando). Lo insertado sin probar (si apagas la prueba obligatoria) queda como **deuda de comprensión** en `cai deuda`. `cai programar estado` mide si sirve (aciertos a la primera, deuda, diferidas).

### Entender antes de programar
- **El proyecto** (chat → **🎯 Entender el proyecto**, o `cai entender --texto "…"`): la IA lee el proyecto y te pregunta de a poco, con opciones: qué buscas, para quién, qué es **"terminado"** (criterios comprobables), restricciones y qué queda fuera. Cuando cree que ya entendió, lo dice con un resumen; **tú lo confirmas** (o corriges, o lo reabres después). Lo confirmado entra al contexto de toda la IA.
- **Una función o un archivo** (🎯 Objetivo en su nota): qué debe hacer y cuándo está terminada.
- **"Creo que terminó":** "¿quedó lista?" compara la función contra sus criterios y, si los cumple, te propone **🏁 Dar por terminada**. El panorama revisa cada criterio del proyecto (✓ / ◐ / ✗ con evidencia) y, si se cumplen todos, te propone darlo por terminado. Siempre lo decides tú.

### Sin sesgo hacia lo ya hecho
- **Revisión a ciegas:** el revisor ve el código, el objetivo y tus reglas, pero no la conversación ni comentarios tipo "esto está bien / no tocar". Primero describe qué hace (citando líneas), después opina; un hallazgo sin una línea real se descarta.
- **🔀 Otra mirada** (con el botón "¿quedó lista?" y al pedir "Revisar"): la IA piensa cómo lo haría **sin ver tu código** y luego compara; solo deja las diferencias que importan (p. ej. un caso borde que no cubres).

### Saber qué pasa sin frenarte
- **Qué hizo la IA** (panel): hora, qué hizo, sobre qué función, modelo, costo y tiempo (`cai actividad`).
- Cada respuesta de una nota dice de qué tipo es, con qué modelo y cuánto costó; la respuesta se ve **mientras se escribe**.
- **Lo ya dado no se vuelve a ofrecer** (si ya tienes el pseudocódigo, no aparece el botón); **➕ Más ayuda** pide el escalón que falta.
- **Snippets donde van:** la línea se valida dentro de la función; al insertar ves **dónde iría** (vista previa) y eliges "Aquí", "En el cursor" o "Cancelar". Queda registrado en la nota qué insertaste.
- **Pasos chicos:** sobre la función, "✅ ¿Lista? (40 líneas sin revisar)" cuando cambiaste mucho sin verificar.
- La barra de estado muestra el **modo** donde estás y el **▶ siguiente paso**.

### Todo se conoce: índice, decisiones e impacto
- **Índice vivo** (`.cai/indice.json`, sin IA): cada función con su firma, a quién llama y quién la llama, el estado de su nota, sus tests y un resumen. Se actualiza al guardar, y solo lo que cambió.
- **Nadie piensa de cero:** cada pedido a la IA (responder, ¿quedó lista?, revisar, tests, guía gris) recibe un contexto común: estructura, panorama, las funciones del archivo, las que llama y las que la llaman, y **tus decisiones**. Lo ya calculado (resúmenes, veredictos, la "otra mirada" de cada función) se reutiliza, no se vuelve a pagar.
- **Decisiones con botones:** cuando la IA necesita que elijas ("¿un monto negativo lanza error?"), aparece la pregunta con **un botón por opción** (⭐ la recomendada) y "Otra…". Lo que eliges queda **vigente**: la IA lo respeta y no lo vuelve a preguntar. Si cambias de opinión, **↩ Retractar** (panel → Proyecto → Decisiones): queda en el historial y deja de regir. Solo tú decides y retractas (desde el chat de Claude Code, no).
- **Avisos de impacto:** si cambias una función que otras usan, esas funciones avisan ("⚠ cambió `calcularCuota`, revisa") en su nota y sobre ellas en el código, y sus tests se vuelven a probar.

### Revisar un archivo: ¿quedó listo?
**🔎 Revisar** corre en segundo plano (puedes seguir y revisar otro archivo a la vez) y hace todo: la revisión a ciegas, **"¿quedó lista?" de cada función** (reutiliza la de las que no cambiaron), sus tests y un **veredicto del archivo**: 🟢 listo · 🟡 casi · 🔴 falta ("0/1 funciones listas"). El veredicto aparece arriba del archivo y en su nota.

**Al salir de un archivo** (opcional, `revisar.alSalir`): si lo cambiaste y no vuelves en `revisar.minutosFuera` minutos (10), se revisa una vez. Por defecto **nunca** (a pedido); se puede poner en **ligera** (solo "¿quedó lista?" de lo que cambió) o **completa**.

### Tests de código que no exporta
Hay código que no puede llevar `export`: scripts que carga otra aplicación tal cual, o archivos que usan variables de su entorno (`window`, `document`, `app`…). Para esos, 🧪 Tests **carga el archivo sin modificarlo** en un entorno aislado de Node y reemplaza lo que viene del entorno por **dobles** que registran qué se usó. Cuando un caso depende del entorno, la IA propone como **datos** (no como código) qué devuelve cada llamada. El resultado lo dice ("✅ pasa, con dobles de `app.vault`"), porque no se probó contra la aplicación real. Los tests guardados usan un ayudante que se crea en la carpeta de tests (`_cai/aislado.mjs`). Es un mecanismo genérico: no hay nada especial para ninguna aplicación.

### Retomar y cerrar
- **Al abrir el proyecto** (panel → Proyecto → "Desde tu última visita"), sin IA: funciones nuevas o cambiadas, tests que empezaron a fallar, decisiones pendientes y si conviene un commit (`cai hoy`).
- **Deuda visible** (`cai deuda`): por archivo, notas abiertas, tests apagados y funciones sin tests.
- **📝 Resumen de la sesión** (en el chat, o `cai sesion`): qué hiciste, qué quedó listo, las decisiones y lo que falta commitear, con un **mensaje de commit sugerido** que editas y usas tú.

### En VSCode
**Notas fáciles de leer:** arriba lo vigente (estado, ▶ Qué hacer y lo último que dijo la IA, resumido); abajo el **historial** de lo que pediste, una línea por pedido con qué y cuándo ("🙋 Piezas · hoy 10:32", "🤖 Revisión al guardar · ayer"), que se despliega con un clic. **Cada nota habla solo de su función:** lo que la IA ve de otra función o del archivo va a la nota del archivo ("Sobre `b`: …").

**Una nota por función, en el panel "Nota".** Lo que dice la IA de una función va a **su** nota, que se va ampliando (revisión, plano, respuestas, verificación): sin duplicados. El panel **Nota** (barra lateral ComplementAIry) **sigue al cursor**: muestra la nota de la función donde estás, con:
- su estado (🟢 lista · 🟡 casi · 🔴 falta · sin verificar) y el **▶ Qué hacer**;
- botones: 💡 Pista · 🧩 Piezas · 📝 Pseudocódigo · 🔁 Ejemplo · 🧪 Tests · ❓ Explícame · **✅ ¿Quedó lista?** · Insertar snippet · ✓ Resuelta;
- una caja para escribirle (Enter envía).

En el código **no se abre nada entre las líneas** ni te quita el foco: solo un ícono en el margen (azul nota · ámbar casi/falta · rojo bloqueante) y, sobre cada función, `💬 nota · 💡 Ayuda · ✅ ¿Lista? · 🧪 Tests`. (Si prefieres los hilos dentro del código: ajuste `cai.notasEnLinea`.)

**✅ ¿Quedó lista?** (`Ctrl+Alt+L` o el botón): revisa la función con lo que ya escribiste. Primero sin IA (sintaxis, tipos, lint, reglas); si eso pasa, la IA dice 🟢 lista (cierra la nota), 🟡 casi o 🔴 falta, con qué mejorar. También corre solo al guardar las funciones con nota que cambiaron. **Con autoguardado:** Ctrl+S actúa enseguida; un autoguardado espera a que dejes de editar (45 s por defecto) y corre una sola vez.

**Guía mientras escribes:** no adelanta lo que ya escribiste más abajo (si lo que iba a sugerir ya está en otra línea, busca lo que falta). Dentro de cualquier función, tras una pausa (~1 s), aparece en gris **al final de la línea del cursor** qué toca ahora: el próximo paso (siguiendo los pasos de la nota, si los hay) o qué está mal en esa línea ("compara en vez de asignar"). Se actualiza en cada pausa, la anterior queda tenue mientras escribes, nunca trae código y no se inserta nada. Es corta (≤ 70 caracteres) y, si no cabe, se corta en una palabra: el **hover** sobre la línea y el panel Nota ("💡 Guía actual") la muestran completa. Funciona sin guardar. **Ctrl+Alt+Espacio** la pide ya. Con el proceso abierto: ~1 s y ~US$0,002 cada una (tope por hora configurable).

**🧪 Tests:** el botón propone casos y **los prueba al instante** contra tu código (✅ pasa · ❌ falla · ❓ decide tú el resultado), y los **guarda como tests** en la carpeta de tests (los dudosos, apagados con su pregunta). **Cada vez que guardas con Ctrl+S** (con autoguardado: cuando dejas de editar) se vuelven a probar y el resultado aparece en la nota de la función y en la barra de estado: si un cambio rompe algo, lo ves en el momento. Tu código nunca se toca; los tests los crea tu clic (desde el chat no). Con el **proceso de Claude Code abierto** (`cai servir`, lo arranca la extensión) tardan **~1 s y cuestan ~US$0,002**; si ese proceso falla, se usa la llamada normal (~20 s). Se apagan en la configuración; en modo aprender no aparecen.

**Panel lateral:**
| Sección | Qué tiene |
|---|---|
| **▶ Ahora** | una sola cosa, elegida sin IA (lo que espera tu respuesta, errores, tareas, notas) |
| **Pendientes** | todo lo demás en orden; clic = detalle completo en el panel Nota |
| **Proyecto** | desde tu última visita, estado (y aviso si el panorama está desactualizado), **Decisiones** (pendientes con botones, vigentes con ↩ Retractar, historial), **Funciones** (quién llama a quién, con su estado), **Deuda**, **Estructura** (✓ existe · ○ por crear · "fuera de la propuesta"), **Preguntas para ti** (respondes o **conversas** con la IA antes de responder) |
| **Hechas recientes** | se archivan solas al día siguiente; cualquier tarea se puede descartar |
| **IA** | qué está haciendo ahora (cancelar, silenciar 30 min) |

**Chat "Proyecto"** (vista propia en la barra lateral, fuera de los archivos), en **varias conversaciones** (Nueva, volver a una anterior, 🎯 Entender el proyecto) y con **la IA que elijas** en cada una (chica, mediana o grande). La IA **solo lee** el proyecto y conoce los objetivos, la estructura, el panorama, el índice, tus decisiones y tus correcciones. Según lo que le cuentes, propone:
- **decisiones** con botones (y **Otra…**, **↩ Retractar**, cambiar de opción);
- **cambios de tareas** ("voy a implementar X", "ya terminé Y"): crear, editar, marcar hecha o reabrir, cada uno con **Aplicar** (el botón queda en "✓ Aplicado");
- **correcciones** de lo que entiende del proyecto ("ese archivo no es una API"): con **Aplicar corrección**, mandan sobre lo generado y el panorama ya no las pisa. También puedes corregir con ✎ sobre un archivo en el panel.

Nada se aplica sin tu clic. Ahí también está **📝 Resumen de la sesión**.

**💡 Ideas** (panel → Proyecto): funcionalidades nuevas y mejoras, salidas del panorama (sin costo extra) o con "🔄 Más ideas". Cada una: ➕ tarea o ✕ no me interesa (no vuelve). "Qué aprender" solo si lo activas (pensado para el modo aprender).

Arriba de cada archivo: `🗺️ Plano · 💡 Ayuda con el archivo · 🔎 Revisar · 💬 N notas`.

**Configuración** (⚙ en el panel, o "ComplementAIry: configuración"): qué ayuda dar por defecto (según tu nivel, pista, piezas, pseudocódigo o ejemplo), sugerencias rápidas, el acompañante (nivel, verificar al guardar, espera con autoguardado, llamadas por hora), qué modelo usa cada tamaño y dónde se ven las notas. Se guarda en `.cai/config.json`.

¿Prefieres los comentarios `@guia` dentro del archivo, como antes? Elige la vista "comentarios" en la configuración.

| | VSCode | Terminal |
|---|---|---|
| Preguntar (selección o línea) | `Ctrl+Alt+G` | `cai responder <archivo> --linea N --texto "..."` (o `// @ia? ...` + `cai guia <archivo>`) |
| Siguiente paso | panel o `Ctrl+Alt+N` | `cai siguiente` |
| ¿Quedó lista esta función? | `Ctrl+Alt+L`, ✅ en la nota o sobre la función | `cai verificar <archivo> --funcion <nombre>` |
| Notas y tareas | panel | `cai notas [archivo]`, `cai tareas [hecha\|pendiente\|descartar <id>]` |
| Estructura del proyecto | panel → Proyecto, o el botón del panel | `cai plano "<qué construyes>"` → `docs/ESTRUCTURA.md` + tareas |
| Preguntas que te hizo la IA | panel → Preguntas para ti | `cai memoria`, `cai memoria responder <n> "..."`, `cai memoria conversar <n> --texto "..."` |
| Ayuda sobre el archivo entero | botón "💡 Ayuda con el archivo" | `cai responder <archivo> --archivo-entero --texto "..."` |
| Plano de un archivo | Ctrl+Shift+P → "plano de este archivo" | `cai plano --archivo <archivo>` |
| Expandir o elegir un snippet | `Ctrl+Alt+E` | `cai expandir <archivo>` |
| Crear un snippet tuyo | `Ctrl+Alt+S` (con selección) | `cai snippet nuevo <nombre> --archivo f --lineas a-b` |
| Revisión completa | `Ctrl+Alt+R` | `cai revisar <archivo>` |
| Acompañante (plano, ayuda, comentarios) | automático al guardar | `cai watch` |
| Preguntas sueltas, comandos, errores | — | `cai pregunta "..."`, `cai explica -- <cmd>`, `cai corre -- <cmd>` + `cai error` |
| Tests de una función (casos apagados en `tests/`) | botón 🧪 Tests | `cai tests <archivo> <función>` |
| Visión del proyecto completo | `Ctrl+Alt+P` | `cai panorama` |
| Memoria del proyecto (responder preguntas) | Ctrl+Shift+P → "memoria del proyecto" | `.cai/conocimiento.md` |
| Consumo de IA | — | `cai uso` |
| Funciones del proyecto (índice) | panel → Proyecto → Funciones | `cai indice [actualizar]` |
| Decisiones | botones en la nota, el chat y el panel | `cai decisiones`, `cai decisiones decidir <id> "<opción>"`, `cai decisiones retractar <id>` |
| Chat del proyecto | vista "Proyecto" | `cai chat --texto "..."` |
| Revisar con veredicto | 🔎 Revisar | `cai revisar <archivo> --completo` |
| Retomar y cerrar | panel y chat | `cai hoy`, `cai deuda`, `cai sesion` |
| Entender el proyecto / una función | chat → 🎯, o 🎯 Objetivo en la nota | `cai entender --texto "…"`, `cai entender --funcion f.ts:nombre --texto "…"`, `cai entender confirmar\|reabrir\|terminado` |
| Conversaciones del chat | selector del chat | `cai chat --lista`, `--nueva`, `--conversacion <id>`, `--modelo chico\|mediano\|grande` |
| Corregir lo que entiende | chat, o ✎ en el panel | `cai memoria corregir --modulo\|--estructura <archivo> \| --proyecto --texto "…"` |
| Ideas | panel → 💡 Ideas | `cai ideas`, `cai ideas mas`, `cai ideas tarea\|descartar <id>` |
| Modo programar | panel Nota (🧭, 📋, 📦, 🔬) | `cai programar plan\|paso\|contrato\|pr\|probar … --funcion f`, `cai programar estado`, `cai repertorio` |

### Desde el chat de Claude Code
En un proyecto con `cai init`, el chat de Claude Code también es ComplementAIry:
- **Sabe usarlo:** viene con la skill `cai`, que indica qué comando corresponde a cada pedido, más `cai-guia`, `cai-revisar` y `cai-snippet`. La sección de `CLAUDE.md` le explica las reglas.
- **Corre los mismos comandos que los atajos.** Por ejemplo, "revisa src/cuota.ts" lleva a `cai revisar`, "¿cómo sigo?" a `cai panorama` y "tests para calcularCuota" a `cai tests`. Lo que esos comandos escriben (`panorama.md`, `conocimiento.md`, ADRs, `ESTRUCTURA.md`) se conserva, solo si el comando es **una sola llamada a `cai`, sin encadenar**.
- **Es el mismo chat que el del plugin:** entiende el proyecto (`cai entender`), conversa (`cai chat`), cambia tareas cuando le cuentas qué harás, propone ideas, y en modo programar propone planes, pasos y PRs.
- **Lo que solo decides tú, con sus botones:** para decidir, retractar, descartar, confirmar objetivos o aplicar una corrección, Claude Code te pregunta con su herramienta de preguntas y **un hook registra tu respuesta** (comprobado: la respuesta llega después de tu clic; si la pregunta ya trae una respuesta puesta, se rechaza, y el texto de la pregunta tiene que incluir exactamente lo que se registra). Si lo intentara con un comando, se revierte.
- **Conoce el proyecto:** consulta `cai entender estado`, `cai indice`, `cai decisiones` y `cai memoria correcciones` antes de responder. En modo notas, lo que diga sobre tu código va a las notas (`cai responder`), no como comentarios en el archivo. Si tu `CLAUDE.md` tiene instrucciones de una versión anterior, la extensión ofrece actualizarlas (`cai init --solo-claude`).
- **No puede escribir tu código:** los hooks lo bloquean. Tampoco puede activar snippets (`cai expandir`), instalar (`cai init`), crear snippets ni declarar tu perfil: eso lo haces tú.

## Qué IA usa y cómo ahorra tokens
**Modelo:** todos a través de tu sesión de Claude Code (sin API key), según el tamaño de la tarea:

| Tamaño | Modelo por defecto | Para qué |
|---|---|---|
| chico | `claude-haiku-4-5` | comentario al terminar una función, ayuda al trabarte, consolidar |
| mediano | `claude-sonnet-5-5` | responder notas, revisar un archivo, tests, plano de un archivo |
| grande | `claude-opus-5-5` | panorama, plano del proyecto, conocer, arquitectura |

Se cambian en `.cai/config.json` → `"ia": { "modelos": { "chico": "...", "mediano": "...", "grande": "..." } }`.

**Cómo ahorra:**
- **Las decisiones no las toma la IA:** cuándo ayudar, si cambió algo o si hay errores lo resuelven contadores, hashes y compiladores. Solo se llama a la IA cuando hay algo que redactar.
- **Solo lo que cambió:**
  - `revisar` no vuelve a enviar un archivo sin cambios.
  - Si cambió una parte, envía esa parte completa y del resto solo las firmas.
  - El acompañante comenta solo la parte que terminaste.
- **Una consulta por pregunta,** con el contexto justo: la región, tus reglas y tu perfil.
- **Caché de prompts:** las instrucciones de sistema son fijas, así que se reaprovechan entre llamadas.
- **Límites:** `acompanar.maxLlamadasHora` (20 por defecto); 60 s de pausa entre comentarios automáticos en un mismo archivo.

`cai uso` muestra llamadas, tokens, % de caché, costo estimado por comando y cuántas veces **se evitó** llamar a la IA.

Costo de referencia, medido: pregunta o plano US$0,02–0,06; comentario al terminar una función US$0,04; revisión completa US$0,25.

## Desarrollo
```bash
cd packages/complementairy && pnpm build && pnpm test && node dist/cli.js selftest
```
En este repo los hooks de ComplementAIry están desactivados (`.claude/off-settings.json`), porque aquí se construye la herramienta.
