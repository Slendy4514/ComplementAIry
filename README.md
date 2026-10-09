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

### Modos: programar o aprender
| | 🚀 programar (por defecto) | 🎓 aprender |
|---|---|---|
| ayuda | directa (plano, piezas, snippets) | gradual (pista → piezas → pseudo → ejemplo) |
| snippets | sí | después de que lo intentes |
| sugerencias rápidas | sí | no (primero piensas tú) |
| "¿quedó lista?" | verificación | + explícala con tus palabras (se compara con el código) y 🎯 predecir |

Se elige por **proyecto, carpeta, archivo o función** (gana el más específico): clic en el modo de la barra de estado, el selector del panel Nota o `cai modo aprender --funcion src/x.ts:miFuncion`. **Cambiar de modo no toca lo ya hecho**: notas, tareas, estructura y panorama quedan igual. En ningún modo la IA escribe tu código.

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

### En VSCode
**Una nota por función, en el panel "Nota".** Lo que dice la IA de una función va a **su** nota, que se va ampliando (revisión, plano, respuestas, verificación): sin duplicados. El panel **Nota** (barra lateral ComplementAIry) **sigue al cursor**: muestra la nota de la función donde estás, con:
- su estado (🟢 lista · 🟡 casi · 🔴 falta · sin verificar) y el **▶ Qué hacer**;
- botones: 💡 Pista · 🧩 Piezas · 📝 Pseudocódigo · 🔁 Ejemplo · 🧪 Tests · ❓ Explícame · **✅ ¿Quedó lista?** · Insertar snippet · ✓ Resuelta;
- una caja para escribirle (Enter envía).

En el código **no se abre nada entre las líneas** ni te quita el foco: solo un ícono en el margen (azul nota · ámbar casi/falta · rojo bloqueante) y, sobre cada función, `💬 nota · 💡 Ayuda · ✅ ¿Lista? · 🧪 Tests`. (Si prefieres los hilos dentro del código: ajuste `cai.notasEnLinea`.)

**✅ ¿Quedó lista?** (`Ctrl+Alt+L` o el botón): revisa la función con lo que ya escribiste. Primero sin IA (sintaxis, tipos, lint, reglas); si eso pasa, la IA dice 🟢 lista (cierra la nota), 🟡 casi o 🔴 falta, con qué mejorar. También corre solo al guardar las funciones con nota que cambiaron. **Con autoguardado:** Ctrl+S actúa enseguida; un autoguardado espera a que dejes de editar (45 s por defecto) y corre una sola vez.

**Sugerencias rápidas:** tras una pausa escribiendo en una función con nota, aparece en gris al final de la línea una pista de una línea (no se inserta nada). Con el **proceso de Claude Code abierto** (`cai servir`, lo arranca la extensión) tardan **~1 s y cuestan ~US$0,002**; si ese proceso falla, se usa la llamada normal (~20 s). Se apagan en la configuración; en modo aprender no aparecen.

**Panel lateral:**
| Sección | Qué tiene |
|---|---|
| **▶ Ahora** | una sola cosa, elegida sin IA (lo que espera tu respuesta, errores, tareas, notas) |
| **Pendientes** | todo lo demás en orden; clic = detalle completo en el panel Nota |
| **Proyecto** | estado (y aviso si el panorama está desactualizado), **Estructura** (✓ existe · ○ por crear · "fuera de la propuesta"), **Preguntas para ti** (respondes o **conversas** con la IA antes de responder) |
| **Hechas recientes** | se archivan solas al día siguiente; cualquier tarea se puede descartar |
| **IA** | qué está haciendo ahora (cancelar, silenciar 30 min) |

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

### Desde el chat de Claude Code
En un proyecto con `cai init`, el chat de Claude Code también es ComplementAIry:
- **Sabe usarlo:** viene con la skill `cai`, que indica qué comando corresponde a cada pedido, más `cai-guia`, `cai-revisar` y `cai-snippet`. La sección de `CLAUDE.md` le explica las reglas.
- **Corre los mismos comandos que los atajos.** Por ejemplo, "revisa src/cuota.ts" lleva a `cai revisar`, "¿cómo sigo?" a `cai panorama` y "tests para calcularCuota" a `cai tests`. Lo que esos comandos escriben (`panorama.md`, `conocimiento.md`, ADRs, `ESTRUCTURA.md`) se conserva, solo si el comando es **una sola llamada a `cai`, sin encadenar**.
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
