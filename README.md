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

### En VSCode: tres niveles que no se mezclan
| Nivel | Dónde | Qué tienes |
|---|---|---|
| **Proyecto** | panel ComplementAIry → **Proyecto** | **Estado** (del panorama), **Estructura** como árbol (✓ existe · ○ por crear, con botón "Crear archivo") y **Preguntas para ti**: clic, respondes en una cajita con la sugerencia ya escrita, y queda en la memoria del proyecto al instante. |
| **Archivo** | botones arriba del archivo | `🗺️ Plano · 💡 Ayuda con el archivo · 🔎 Revisar · 💬 N notas`. El plano deja un resumen arriba, una nota en cada función que ya existe y una tarea por cada una que falta. |
| **Función** | botones sobre cada función | `💬 notas · 💡 Ayuda · 🧪 Tests`. |

Lo que la IA propone a nivel proyecto se vuelve **tareas**: cada archivo que falta en la estructura (en el orden de "por dónde empezar") y cada sugerencia del panorama, con el archivo a tocar. Se marcan solas cuando creas el archivo o la función, y **▶ Siguiente paso** te dice cuál toca.

### Notas en la línea exacta (por defecto)
Lo que dice la IA aparece como **notas**: hilos al costado del código, como en la revisión de un PR. **El archivo no se toca**, así que el autoguardado no choca con nada.
- **Cada nota tiene botones:** 💡 Pista · 🧩 Piezas · 📝 Pseudocódigo · 🔁 Ejemplo · 🧪 Tests · 🗺️ Plano · ❓ Explícame · ✓ Resuelta. Si sugiere un snippet, también tiene **Insertar aquí**, que lo pone dentro de la función con huecos para completar con Tab.
- **Escribirle:** en la caja de la nota escribes y presionas Ctrl+Enter; la IA responde en el mismo hilo. "No entiendo" sube un escalón.
- **Preguntar sobre código:** seleccionas y usas `Ctrl+Alt+G` (o clic derecho → "preguntar"). También puedes usar el **+** del margen en cualquier línea.
- **Sobre cada función:** `💬 2 notas · 💡 Ayuda · 🧪 Tests`.
- **Panel ComplementAIry** (barra lateral): **▶ Siguiente paso** (una sola cosa, elegida sin IA), Tareas con casillas (se marcan solas cuando creas la función), Notas por archivo y qué está haciendo la IA. `Ctrl+Alt+N` abre el siguiente paso.
- **¿Está pensando?** La barra de estado muestra `⟳ revisando cuota.ts (12 s)` y la línea muestra "pensando…". Si pides otra cosa sobre el mismo archivo, te avisa en vez de pisar. Desde la barra de estado puedes cancelar o **silenciar 30 min**.
- **Lo bloqueante** también aparece en el panel Problemas.

¿Prefieres los comentarios `@guia` dentro del archivo, como antes? Usa `"vista": "comentarios"` en `.cai/config.json` (o el ajuste `cai.vista`). Desde VSCode, la revisión se aplica sobre el texto del editor, no en disco.

| | VSCode | Terminal |
|---|---|---|
| Preguntar (selección o línea) | `Ctrl+Alt+G` | `cai responder <archivo> --linea N --texto "..."` (o `// @ia? ...` + `cai guia <archivo>`) |
| Siguiente paso | panel o `Ctrl+Alt+N` | `cai siguiente` |
| Notas y tareas | panel | `cai notas [archivo]`, `cai tareas` |
| Estructura del proyecto | panel → Proyecto, o el botón del panel | `cai plano "<qué construyes>"` → `docs/ESTRUCTURA.md` + tareas |
| Preguntas que te hizo la IA | panel → Preguntas para ti | `cai memoria`, `cai memoria responder <n> "..."` |
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
