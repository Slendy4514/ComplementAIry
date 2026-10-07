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
git clone https://github.com/<tu-usuario>/ComplementAIry.git
cd ComplementAIry && sh scripts/instalar.sh
```
Deja el comando `cai` global (enlazado al repo: cada `pnpm build` se aplica al instante) e instala la extensión de VSCode.

### Opción B: en el devcontainer de otro proyecto (versión publicada)
Crea un release con `git tag v0.2.0 && git push --tags`. El workflow `release` publica `complementairy.tgz` y `complementairy.vsix`. Después, en el `.devcontainer/Dockerfile` del otro proyecto:
```dockerfile
RUN npm i -g https://github.com/<tu-usuario>/ComplementAIry/releases/latest/download/complementairy.tgz
```
Para la extensión, agrega a `devcontainer.json` → `"postAttachCommand"`:
```bash
curl -sL -o /tmp/complementairy.vsix https://github.com/<tu-usuario>/ComplementAIry/releases/latest/download/complementairy.vsix && code --install-extension /tmp/complementairy.vsix --force
```
> Si el repo es **privado**, esas URLs piden autenticación. En ese caso usa la opción A dentro del contenedor, o descarga los archivos con `gh release download`.

### En cada proyecto
```bash
cd mi-proyecto
git init                                  # si todavía no es repo
cai init .                             # hooks, configuración, snippets base, tareas de VSCode, skills, CI
cai doctor --instalar                  # herramientas del lenguaje (tsc, eslint, vitest, stryker / mypy, ruff, pytest...)
cai perfil set javascript intermedio   # tu nivel por tema
```
Después escribe con tus palabras `.cai/proyecto.md` (qué buscas) y `.cai/reglas.md` (cómo escribes). Las prácticas medibles (largo de funciones, anidamiento...) vienen activas por defecto y se ajustan en `.cai/config.json` → `practicas`. Al guardar el primer archivo, el acompañante propone la arquitectura del proyecto.

## Uso diario

| | VSCode | Terminal |
|---|---|---|
| Preguntar en el código (`// @ia? ...`) | `Ctrl+Alt+G` | `cai guia <archivo>` |
| Expandir o elegir un snippet | `Ctrl+Alt+E` | `cai expandir <archivo>` |
| Crear un snippet tuyo | `Ctrl+Alt+S` (con selección) | `cai snippet nuevo <nombre> --archivo f --lineas a-b` |
| Revisión completa | `Ctrl+Alt+R` | `cai revisar <archivo>` |
| Acompañante (plano, ayuda, comentarios) | automático al guardar | `cai watch` |
| Preguntas sueltas, comandos, errores | — | `cai pregunta "..."`, `cai explica -- <cmd>`, `cai corre -- <cmd>` + `cai error` |
| Tests de una función (casos apagados en `tests/`) | `@ia? !tests` o Ctrl+Shift+P → "proponer tests" | `cai tests <archivo> <función>` |
| Visión del proyecto completo | `Ctrl+Alt+P` | `cai panorama` |
| Memoria del proyecto (responder preguntas) | Ctrl+Shift+P → "memoria del proyecto" | `.cai/conocimiento.md` |
| Consumo de IA | — | `cai uso` |

## Qué IA usa y cómo ahorra tokens
**Modelo:**
- Usa el que tengas por defecto en Claude Code. Para cambiarlo, edita `.cai/config.json` → `"ia": { "modelo": "claude-sonnet-5-5" }`.
- Las tareas simples (consolidar revisiones) usan `ia.modeloRapido` (por defecto `claude-haiku-4-5`).

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
